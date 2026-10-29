/**
 * 提醒的判定层（P0-④ 阶段 1，2026-10-21）。
 *
 * 只在**"今天"**这个粒度上提醒：倒数日就是今天、生日就是今天、习惯到了点还没打卡。
 * **不做待办到期提醒** —— `Todo` 没有截止日期字段（`cardDataTypes.ts`），编一个不存在的字段
 * 比不做更糟；等真有 dueAt 再加，规则表加一行就够。
 *
 * 全是纯函数：`now` 注入、不读时钟、不碰存储 —— 规则才可能被穷举断言。
 * 日期口径是**本地日**（不是 UTC），与 `@levango7/engine/habit` 的私有 `ymd` 同一口径；
 * 那一条不许靠"我们都很小心"来维持：测试里拿 `lastNDays([], now, 1)[0].date` 交叉核对。
 *
 * 静默时段**只影响投递**（`inQuietHours` 由胶水层调用），不影响 dueReminders 的返回值 ——
 * "今天有没有这条事实"与"此刻要不要弹出来"是两件事，混在一起会让"静默结束后补弹"没法实现。
 */

import { daysUntil, streakDays, upcomingBirthdays, type Birthday, type HabitState } from '@levango7/engine'
import type { CountdownSetting } from './cardDataTypes'

export type ReminderKind = 'countdown' | 'birthday' | 'habit'

export interface ReminderSettings {
  enabled: boolean
  /** `HH:MM`，本地时间。start === end 视为不静默（否则用户永远收不到，还没有解释） */
  quietStart: string
  quietEnd: string
  /** 习惯提醒从几点开始（本地时间）。太早提醒"今天还没打卡"是打扰，不是提醒 */
  habitAfter: string
  /** 桌面壳上是否同时发系统通知（应用内横幅始终发；网页版没有这一路） */
  systemNotifications: boolean
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  // **默认不静默**（start === end）。静默一旦跨午夜，那一天的提醒就再也不会补 ——
  // 对"生日/倒数日就是今天"这类事件等于静默吞掉。宁可默认响，让用户自己选清静。
  quietStart: '00:00',
  quietEnd: '00:00',
  habitAfter: '20:00',
  systemNotifications: true,
}

export interface Reminder {
  /** 稳定键：同一天同一条提醒永远同一个 key，去重与"今天已提醒过"都按它记 */
  key: string
  kind: ReminderKind
  title: string
  body: string
}

export interface ReminderInput {
  now: Date
  /**
   * **所有**倒数日（顶层 + 各实例自己的那一份）。F-01 阶段 2（2026-10-30）起倒数日
   * 按实例分，只传第一张会让第二张的到期日静默不提醒 —— 界面上红红火火、提醒没有，
   * 这类"看着对、实际漏"的缝最危险。由 `instanceData.allCountdowns` 铺平。
   */
  countdowns: readonly CountdownSetting[]
  birthdays: readonly Birthday[]
  habit: HabitState
  settings: ReminderSettings
}

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `HH:MM` → 当日分钟数；认不出返回 null（不猜、不补全） */
export function hmToMinutes(hm: string): number | null {
  const m = HM_RE.exec(hm.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 本地日 `YYYY-MM-DD`。**不要用 toISOString** —— 那会把晚上 23:00 算成"明天"（UTC+8） */
export function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 是否落在静默时段。区间是**左闭右开**、允许跨午夜（22:00–08:00）。
 * 两个端点认不出、或 start === end，都按"不静默"处理 —— 静默失效只多弹一次，
 * 而误静默会让用户整天收不到任何提醒却不明白为什么。
 */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const s = hmToMinutes(start)
  const e = hmToMinutes(end)
  if (s === null || e === null || s === e) return false
  const m = now.getHours() * 60 + now.getMinutes()
  return s < e ? m >= s && m < e : m >= s || m < e
}

/**
 * 此刻"今天"有哪些提醒事实。顺序固定：倒数日 → 生日 → 习惯（同一天里可预期）。
 * 不看静默时段，也不管"今天已经提醒过" —— 那两件属于投递层。
 */
export function dueReminders(input: ReminderInput): Reminder[] {
  const { now, countdowns, birthdays, habit, settings } = input
  if (!settings.enabled) return []
  const out: Reminder[] = []
  const today = localDay(now)

  // 倒数日：今天到站的那几张。按**日子**去重 —— 同一天到站的候选只出一条提醒，
  // 标题把名字都列上（用「」「」隔开，与单条时同一个格式，单条标题逐字不变）。
  // key 仍是 `countdown:日子`：与既有 fired 记录逐字兼容，升级不会让已提醒过的
  // 那一天重弹一遍。daysUntil 为 0 ⟺ 日子就是今天，所以到站的几张同一天、
  // `due[0].date` 就是今天。
  const due = countdowns.filter((c) => c.label.trim() && c.date && daysUntil(c.date, now) === 0)
  if (due.length) {
    const names = due.map((c) => c.label.trim()).join('」「')
    out.push({
      key: `countdown:${due[0].date}`,
      kind: 'countdown',
      title: `今天是「${names}」`,
      body: '倒数到站了。',
    })
  }

  for (const n of upcomingBirthdays(birthdays, now)) {
    if (n.days !== 0) continue
    out.push({
      key: `birthday:${n.b.id ?? `${n.b.name}:${n.b.month}-${n.b.day}`}:${today}`,
      kind: 'birthday',
      title: `今天是 ${n.b.name} 的生日`,
      body: n.turns === null ? '别忘了说一声生日快乐。' : `今天 ${n.turns} 岁。`,
    })
  }

  const after = hmToMinutes(settings.habitAfter)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const dueHour = after !== null && nowMin >= after
  if (habit.name.trim() && dueHour && !habit.days.includes(today)) {
    const streak = streakDays(habit.days, now)
    out.push({
      key: `habit:${today}`,
      kind: 'habit',
      title: `今天还没打卡：${habit.name.trim()}`,
      body: streak > 0 ? `连续 ${streak} 天，今天还差一次。` : '今天还差一次。',
    })
  }

  return out
}
