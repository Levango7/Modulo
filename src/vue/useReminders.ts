/**
 * 提醒的胶水层（P0-④ 阶段 1）：读设置 / 每分钟对一次表 / 去重 / 静默 / 投递。
 *
 * 投递走注入的 `deliver` —— 阶段 1 接到应用内横幅，阶段 2 换成系统通知时只换 App 里那一个回调，
 * 判定与去重一行不用动。
 *
 * **存储键必须进 `fileStorage.ts` 的 `DATA_KEYS`**：桌面适配器的 `get` 只读启动时 hydrate 的
 * 内存镜像，漏登记不会报错，症状是"写得下去、重启读不到"（P0-③ 在自动备份上踩过同一条）。
 *
 * 设置与"今天提醒过哪些"放同一个键：两者都是**本机状态**，而且写它们的时机天然在一起
 * （投递后立刻记 fired）。分开成两个键只会多一处可能不同步的地方。
 */

import { computed, reactive, ref, watch } from 'vue'
import {
  DEFAULT_REMINDER_SETTINGS,
  dueReminders,
  inQuietHours,
  localDay,
  type Reminder,
  type ReminderSettings,
} from './reminders'
import type { CardData } from './cardData'
import { allCountdowns } from './instanceData'
import type { StorageAdapter } from './store'

export const REMINDERS_KEY = 'modulo.reminders.v1'
const TICK_MS = 60_000
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

interface StoredState {
  settings: ReminderSettings
  /** fired 属于哪一天；不是今天就在下一次判定时整体清空 */
  day: string
  fired: string[]
}

export interface RemindersOptions {
  storage?: StorageAdapter
  /** 测试缝：注入时钟；生产不传 = 真实时间 */
  now?: () => Date
  /** 投递回调（阶段 1 = 应用内横幅） */
  deliver?: (items: Reminder[]) => void
}

/** 盘上是不可信数据：逐字段校验，坏字段回默认值而不是整份报废 */
function readStored(storage?: StorageAdapter): StoredState {
  const base: StoredState = { settings: { ...DEFAULT_REMINDER_SETTINGS }, day: '', fired: [] }
  if (!storage) return base
  try {
    const raw = storage.get(REMINDERS_KEY)
    if (!raw) return base
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return base
    const obj = parsed as Record<string, unknown>
    const s = (typeof obj.settings === 'object' && obj.settings !== null ? obj.settings : {}) as Record<string, unknown>
    const time = (v: unknown, fallback: string) => (typeof v === 'string' && HM_RE.test(v.trim()) ? v.trim() : fallback)
    base.settings = {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_REMINDER_SETTINGS.enabled,
      quietStart: time(s.quietStart, DEFAULT_REMINDER_SETTINGS.quietStart),
      quietEnd: time(s.quietEnd, DEFAULT_REMINDER_SETTINGS.quietEnd),
      habitAfter: time(s.habitAfter, DEFAULT_REMINDER_SETTINGS.habitAfter),
      systemNotifications:
        typeof s.systemNotifications === 'boolean' ? s.systemNotifications : DEFAULT_REMINDER_SETTINGS.systemNotifications,
    }
    if (typeof obj.day === 'string' && DAY_RE.test(obj.day)) base.day = obj.day
    if (Array.isArray(obj.fired)) base.fired = obj.fired.filter((x): x is string => typeof x === 'string')
    return base
  } catch {
    return base
  }
}

export function useReminders(cardData: () => CardData, opts: RemindersOptions = {}) {
  const state = reactive<StoredState>(readStored(opts.storage))
  const clock = opts.now ?? (() => new Date())
  const now = ref(clock())
  /** 用全局 setInterval（不是 window.*）：node 里的单测与浏览器共用同一条路径，不必为环境分叉 */
  let timer: ReturnType<typeof setInterval> | null = null

  const persist = () => {
    try {
      opts.storage?.set(REMINDERS_KEY, JSON.stringify({ settings: state.settings, day: state.day, fired: state.fired }))
    } catch {
      /* 写失败由存储适配器自己的 error 通道报（fileStorage 会把红条顶出来），这里不吞第二次 */
    }
  }

  /** 今天还没提醒过的那些（静默与否都算在内 —— 静默只影响投递） */
  const pending = computed<Reminder[]>(() => {
    const all = dueReminders({
      now: now.value,
      // 全部倒数日（顶层 + 各实例）：倒数日按实例分之后只看顶层，第二张到期会静默不提醒
      countdowns: allCountdowns(cardData()),
      birthdays: cardData().birthdays,
      habit: cardData().habit,
      settings: state.settings,
    })
    const fired = new Set(state.day === localDay(now.value) ? state.fired : [])
    return all.filter((r) => !fired.has(r.key))
  })

  const quietNow = computed(() => inQuietHours(now.value, state.settings.quietStart, state.settings.quietEnd))

  /**
   * 对一次表。返回**这次真的投递出去**的条目（静默/已提醒过 → 空数组）。
   * 记 fired 放在投递**之前**：投递回调若抛错，也不该下一分钟再弹一遍——
   * 用户看到两个一样的提醒比漏一个更糟。
   */
  function tick(): Reminder[] {
    now.value = clock()
    const items = pending.value
    if (!items.length || quietNow.value) return []
    const today = localDay(now.value)
    if (state.day !== today) {
      state.day = today
      state.fired = []
    }
    state.fired.push(...items.map((r) => r.key))
    persist()
    opts.deliver?.(items)
    return items
  }

  /** 幂等：重复调用只保留一个定时器 */
  function start(): void {
    if (timer !== null) return
    tick()
    timer = setInterval(tick, TICK_MS)
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  /**
   * 设置面板的写入入口：时间串认不出就**保留原值**（输入框可能是 `''` 或 `9:5` 这种中间态），
   * 而不是把静默时段悄悄改成一个用户没选过的值。
   */
  function setSettings(patch: Partial<ReminderSettings>): void {
    const next: ReminderSettings = { ...state.settings, ...patch }
    for (const k of ['quietStart', 'quietEnd', 'habitAfter'] as const) {
      if (typeof patch[k] === 'string' && !HM_RE.test(patch[k]!.trim())) next[k] = state.settings[k]
    }
    if (typeof patch.enabled !== 'boolean') next.enabled = state.settings.enabled
    if (typeof patch.systemNotifications !== 'boolean') next.systemNotifications = state.settings.systemNotifications
    state.settings = next
  }

  /** 设置面板改完立刻生效（不必等下一分钟），并落盘。`flush:'sync'` 是刻意的：
   *  "改完立刻写盘"必须是**这一刻**成立的——默认 'pre' 会推到微任务，用户改完就关窗口时那一笔可能没写出去。 */
  watch(
    () => ({ ...state.settings }),
    () => {
      persist()
      tick()
    },
    { deep: true, flush: 'sync' },
  )

  return { state, pending, quietNow, tick, start, stop, setSettings }
}

export type RemindersApi = ReturnType<typeof useReminders>
