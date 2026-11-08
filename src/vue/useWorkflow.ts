/**
 * 「工作流」的胶水层（PR-F3，生态位第三格）：读档 / 顺次执行 / 记下每一步的产出。
 *
 * 与 `useCron` 同一条分工：判定在 `workflow.ts`（纯函数，可离线断言），这里只做
 * "必须活在组件层"的事 —— invoke、Channel 的收尾等待、逐步串起来。
 *
 * 三条纪律：
 * 1. **首败即停**：某一步出错就停，后面几步不发请求 —— 后面几步的前提是上一步的产出。
 * 2. **invoke 只代表"请求已受理"**：Rust 的 `ai_chat` 是 spawn 后立刻返回会话号，
 *    流式帧异步到达 —— 所以"跑完"以 `done` 帧为准（或出错帧 / 超时），不是以 await 为准。
 * 3. **一次只跑一个**：并发跑工作流 = 双倍花钱，用户只点了一下。
 */

import { ref, type Ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import type { StorageAdapter } from './store'
import type { ChatChunk } from './aiChat'
import {
  appendRun,
  addFlow,
  clipStepText,
  parseWorkflowDoc,
  removeFlow,
  stepPrompt,
  WORKFLOW_DOC_KEY,
  WORKFLOW_RUNS_MAX,
  type PickedFlow,
  type WorkflowFlow,
  type WorkflowRun,
  type WorkflowStepRun,
} from './workflow'

/** 单步等待上限。超了就记失败并**取消那次对话**（不让后台挂着的流白烧钱） */
export const STEP_TIMEOUT_MS = 180_000

export interface WorkflowOptions {
  storage?: StorageAdapter
  /** 测试缝：注入时钟；生产不传 = 真实时间 */
  now?: () => Date
  /** 执行时解析模型服务（读启动时 hydrate 的 ai-settings 镜像，零 IO） */
  providers?: () => { id: string }[]
}

/** Rust `ConversationRef`（camelCase） */
interface ConversationRef {
  conversationId: string
}

export interface WorkflowApi {
  flows: Ref<WorkflowFlow[]>
  runs: Ref<WorkflowRun[]>
  /** 正在跑的工作流 id（一次只跑一个） */
  running: Ref<string | null>
  /** 建工作流并落盘；拒收理由逐条回给调用方 */
  add(picked: PickedFlow): string[]
  remove(id: string): void
  /** 跑一遍。返回 false = 这次没跑起来（找不到流程 / 已有一次在跑） */
  run(id: string): boolean
}

export function createWorkflow(opts: WorkflowOptions = {}): WorkflowApi {
  const clock = opts.now ?? (() => new Date())
  const doc = parseWorkflowDoc(opts.storage?.get(WORKFLOW_DOC_KEY) ?? null)
  const flows = ref<WorkflowFlow[]>(doc.flows)
  const runs = ref<WorkflowRun[]>(doc.runs)
  const running = ref<string | null>(null)

  const persist = (): void => {
    try {
      opts.storage?.set(
        WORKFLOW_DOC_KEY,
        JSON.stringify({ schemaVersion: 1, flows: flows.value, runs: runs.value }),
      )
    } catch {
      /* 写失败由存储适配器自己的 error 通道报 */
    }
  }

  function record(flowId: string, status: 'ok' | 'error', steps: WorkflowStepRun[], error?: string): void {
    runs.value = appendRun(runs.value, {
      id: `wfr${clock().getTime().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      flowId,
      at: Math.floor(clock().getTime() / 1000),
      status,
      steps,
      ...(error !== undefined ? { error } : {}),
    })
  }

  /** 执行时的模型服务：流程里存的那个没了就回落第一个可用的；一个都没有如实报错 */
  function resolveProvider(flow: WorkflowFlow): string | null {
    const list = opts.providers?.() ?? []
    if (!list.length) return null
    return list.some((p) => p.id === flow.providerId) ? flow.providerId : list[0].id
  }

  /**
   * 跑一步。**跑完的判据是 done 帧**（或错误帧 / 本地超时），不是 await ——
   * Rust 那边 spawn 后立刻返回，await 只代表"受理了"。
   */
  function runStep(provider: string, prompt: string): Promise<{ text: string; error?: string }> {
    return new Promise((resolve) => {
      let full = ''
      let failed: string | null = null
      let settled = false
      let guard: ReturnType<typeof setTimeout> | null = null
      let conversationId: string | null = null
      const settle = (): void => {
        if (settled) return
        settled = true
        if (guard !== null) clearTimeout(guard)
        if (failed !== null) resolve({ text: full, error: failed })
        else resolve({ text: full })
      }
      const ch = new Channel<ChatChunk>()
      ch.onmessage = (c) => {
        if (c.error !== null && c.error !== undefined) failed = c.error
        else if (c.delta) full += c.delta
        if (c.done) settle()
      }
      guard = setTimeout(() => {
        if (settled) return
        failed = '等了 3 分钟还没跑完，先放弃等待；那次对话如果还在跑，已经发了停止'
        if (conversationId) void invoke('ai_chat_cancel', { conversationId }).catch(() => undefined)
        settle()
      }, STEP_TIMEOUT_MS)
      void invoke<ConversationRef>('ai_chat', {
        providerId: provider,
        conversationId: null,
        messages: [{ role: 'user', content: prompt }],
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
    })
  }

  /**
   * 顺次跑完一个工作流：**首败即停**。跑完（或中途失败）才记一条运行记录 ——
   * 半途崩掉的应用不会留下一条"看起来跑成功了"的假记录（每一步自己的对话仍在会话历史里）。
   */
  async function execute(flow: WorkflowFlow): Promise<void> {
    const provider = resolveProvider(flow)
    if (!provider) {
      record(flow.id, 'error', [], '没有可用的模型服务：先去「设置 → 实验室」配置并点「测试连接」')
      persist()
      return
    }
    const stepRuns: WorkflowStepRun[] = []
    let prevOut = ''
    let failure: string | undefined
    try {
      for (const [i, step] of flow.steps.entries()) {
        const r = await runStep(provider, stepPrompt(step, prevOut))
        if (r.error !== undefined) {
          stepRuns.push({ stepId: step.id, text: clipStepText(r.text), error: r.error })
          failure = `第 ${i + 1} 步没跑通：${r.error}`
          break
        }
        stepRuns.push({ stepId: step.id, text: clipStepText(r.text) })
        prevOut = r.text
      }
    } catch (e: unknown) {
      failure = `工作流跑崩了：${String(e)}`
    }
    if (failure === undefined) {
      record(flow.id, 'ok', stepRuns)
    } else {
      record(flow.id, 'error', stepRuns, failure)
    }
    persist()
  }

  return {
    flows,
    runs,
    running,
    add(picked) {
      const before = flows.value.length
      const r = addFlow(flows.value, picked, clock().getTime())
      flows.value = r.flows
      // 有实际入库才落盘（一次全是拒收的提交不必空写一遍）
      if (flows.value.length !== before) persist()
      return r.rejected
    },
    remove(id) {
      flows.value = removeFlow(flows.value, id)
      // 流程删了，它的运行记录也一起清（列表里挂着死流程的记录只会让人误会还能点）
      runs.value = runs.value.filter((r) => r.flowId !== id).slice(0, WORKFLOW_RUNS_MAX)
      persist()
    },
    run(id) {
      // 一次只跑一个：并发跑 = 双倍花钱，用户只点了一下
      if (running.value !== null) return false
      const flow = flows.value.find((f) => f.id === id)
      if (!flow) return false
      running.value = id
      void execute(flow).finally(() => {
        running.value = null
      })
      return true
    },
  }
}
