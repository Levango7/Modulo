/**
 * 「定时任务」的胶水层（PR-F2）：读档 / 每分钟对表 / 到点执行 / 记录运行。
 *
 * 与 `useReminders` 同一条分工：判定在 `cron.ts`（纯函数，时钟注入可测），这里只做
 * "必须活在组件层"的事 —— setInterval、invoke、Channel 的收尾等待。
 *
 * 三条纪律：
 * 1. **先记账后执行**（mirror reminders）：到点的任务先把 id 记进 fired 再发请求 ——
 *    执行通道挂了也不该下一分钟再跑一遍，用户看到两次同样的结果比漏一次更糟。
 * 2. **错过不补跑**：应用当时没开着，记一条 `missed`（原因写明几点、应用没在跑），
 *    不静默追赶 —— 追赶等于替用户做"这笔钱该花"的决定（§12.67 边界 1）。
 * 3. **invoke 只代表"请求已受理"**：Rust 的 `ai_chat` 是 spawn 后立刻返回会话号，
 *    流式帧异步到达 —— 所以"跑完"以 `done` 帧为准（或出错帧 / 超时），不是以 await 为准。
 */

import { ref, type Ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import type { StorageAdapter } from './store'
import { normalizeEvent } from './aiChat'
import {
  appendRun,
  addTask,
  clipRunText,
  CRON_DOC_KEY,
  CRON_RUNS_MAX,
  dueTasks,
  parseCronDoc,
  removeTask,
  setTaskEnabled,
  type CronRun,
  type CronTask,
  type PickedTask,
} from './cron'
// 今天的口径（YYYY-MM-DD 本地日）不另写一份：与提醒共用同一个已测的纯函数
import { localDay } from './reminders'

/** 单次执行的整体等待上限。超了就记失败并**取消那次对话**（不让后台挂着的流白烧钱） */
export const RUN_TIMEOUT_MS = 180_000

interface RuntimeState {
  day: string
  fired: string[]
  missed: string[]
}

export interface CronOptions {
  storage?: StorageAdapter
  /** 测试缝：注入时钟；生产不传 = 真实时间 */
  now?: () => Date
  /** 执行时解析模型服务（读启动时 hydrate 的 ai-settings 镜像，零 IO） */
  providers?: () => { id: string }[]
  /** 桌面壳才有 ai_chat 通道；网页版 start() 不开定时器（界面也不渲染这一节） */
  canRun?: () => boolean
}

/** Rust `ConversationRef`（camelCase） */
interface ConversationRef {
  conversationId: string
}

export interface CronApi {
  tasks: Ref<CronTask[]>
  runs: Ref<CronRun[]>
  now: Ref<Date>
  /** 建任务并落盘；拒收理由逐条回给调用方 */
  add(picked: PickedTask): string[]
  remove(id: string): void
  toggle(id: string): void
  /** 对一次表。返回这次真正**开始执行**的任务（测试用它断言"到点真的跑了"） */
  tick(): CronTask[]
  start(): void
  stop(): void
}

export function createCron(opts: CronOptions = {}): CronApi {
  const clock = opts.now ?? (() => new Date())
  const raw = opts.storage?.get(CRON_DOC_KEY) ?? null
  const doc = parseCronDoc(raw)
  const tasks = ref<CronTask[]>(doc.tasks)
  const runs = ref<CronRun[]>(doc.runs)
  const now = ref(clock())

  // 今天的调度状态与任务/记录放同一个键（mirror reminders：写它们的时机天然在一起）
  const sched = ref<RuntimeState>({ day: '', fired: [], missed: [] })
  try {
    const o = raw ? (JSON.parse(raw) as Partial<RuntimeState>) : null
    if (o && typeof o === 'object') {
      if (typeof o.day === 'string') sched.value.day = o.day
      if (Array.isArray(o.fired)) sched.value.fired = o.fired.filter((x) => typeof x === 'string')
      if (Array.isArray(o.missed)) sched.value.missed = o.missed.filter((x) => typeof x === 'string')
    }
  } catch {
    /* parseCronDoc 已兜住主文档；这三个字段读不到就当全新一天 */
  }

  const persist = (): void => {
    try {
      opts.storage?.set(
        CRON_DOC_KEY,
        JSON.stringify({ schemaVersion: 1, tasks: tasks.value, runs: runs.value, ...sched.value }),
      )
    } catch {
      /* 写失败由存储适配器自己的 error 通道报 */
    }
  }

  function record(taskId: string, status: CronRun['status'], text: string | undefined, error: string | undefined): void {
    runs.value = appendRun(runs.value, {
      id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      taskId,
      at: Math.floor(clock().getTime() / 1000),
      status,
      ...(text !== undefined ? { text: clipRunText(text) } : {}),
      ...(error !== undefined ? { error } : {}),
    })
  }

  /** 执行时的模型服务：任务里存的那个没了就回落第一个可用的；一个都没有如实报错 */
  function resolveProvider(task: CronTask): string | null {
    const list = opts.providers?.() ?? []
    if (!list.length) return null
    return list.some((p) => p.id === task.providerId) ? task.providerId : list[0].id
  }

  /**
   * 跑一个任务。**跑完的判据是 done 帧**（或错误帧 / 本地超时），不是 await ——
   * Rust 那边 spawn 后立刻返回，await 只代表"受理了"。
   */
  async function execute(task: CronTask): Promise<void> {
    const provider = resolveProvider(task)
    if (!provider) {
      record(task.id, 'error', undefined, '没有可用的模型服务：先去「设置 → 实验室」配置并点「测试连接」')
      persist()
      return
    }
    let full = ''
    let failed: string | null = null
    let settled = false
    let guard: ReturnType<typeof setTimeout> | null = null
    let conversationId: string | null = null
    const settle = (): void => {
      if (settled) return
      settled = true
      if (guard !== null) clearTimeout(guard)
      if (failed !== null) record(task.id, 'error', full || undefined, failed)
      else record(task.id, 'ok', full, undefined)
      persist()
    }
    // 事件流（F-15 P1a §2.2）：解析只走 `normalizeEvent`，收尾只认 `done`。
    // 定时任务 / 工作流不需要工具与轮次 —— 它们只取「说了什么」与「成没成」。
    const ch = new Channel<unknown>()
    ch.onmessage = (raw) => {
      for (const ev of normalizeEvent(raw)) {
        if (ev.t === 'error') failed = ev.message
        else if (ev.t === 'text') full += ev.delta
        else if (ev.t === 'done') settle()
      }
    }
    guard = setTimeout(() => {
      if (settled) return
      failed = '等了 3 分钟还没跑完，先放弃等待；那次对话如果还在跑，已经发了停止'
      if (conversationId) void invoke('ai_chat_cancel', { conversationId }).catch(() => undefined)
      settle()
    }, RUN_TIMEOUT_MS)
    void invoke<ConversationRef>('ai_chat', {
      providerId: provider,
      conversationId: null,
      messages: [{ role: 'user', content: task.prompt }],
      onChunk: ch,
    })
      .then((r) => {
        conversationId = r.conversationId
      })
      .catch((e: unknown) => {
        if (settled) return
        failed = String(e)
        settle()
      })
  }

  function tick(): CronTask[] {
    now.value = clock()
    const today = localDay(now.value)
    if (sched.value.day !== today) {
      sched.value = { day: today, fired: [], missed: [] }
    }
    const { due, missed: toMiss } = dueTasks(tasks.value, [...sched.value.fired, ...sched.value.missed], now.value)
    if (toMiss.length) {
      for (const t of toMiss) {
        sched.value.missed.push(t.id)
        record(t.id, 'missed', undefined, `错过了（${t.time}，应用当时没在跑）—— 不补跑，要看就手动跑一次`)
      }
    }
    const started: CronTask[] = []
    for (const t of due) {
      // 先记账后执行：执行通道挂了也不该下一分钟再跑一遍
      sched.value.fired.push(t.id)
      started.push(t)
      void execute(t)
    }
    if (toMiss.length || due.length) persist()
    return started
  }

  let timer: ReturnType<typeof setInterval> | null = null

  function start(): void {
    if (timer !== null) return
    if (opts.canRun && !opts.canRun()) return
    tick()
    timer = setInterval(tick, 60_000)
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  return {
    tasks,
    runs,
    now,
    add(picked) {
      const before = tasks.value.length
      const r = addTask(tasks.value, picked, clock().getTime())
      tasks.value = r.tasks
      // 有实际入库才落盘（一次全是拒收的提交不必空写一遍）
      if (tasks.value.length !== before) persist()
      return r.rejected
    },
    remove(id) {
      tasks.value = removeTask(tasks.value, id)
      // 任务删了，它的运行记录也一起清（列表里挂着死任务的记录只会让人误会还能点）
      runs.value = runs.value.filter((r) => r.taskId !== id).slice(0, CRON_RUNS_MAX)
      persist()
    },
    toggle(id) {
      const t = tasks.value.find((x) => x.id === id)
      if (!t) return
      tasks.value = setTaskEnabled(tasks.value, id, !t.enabled)
      persist()
    },
    tick,
    start,
    stop,
  }
}
