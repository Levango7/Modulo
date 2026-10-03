/**
 * 时间进度：今天 / 本月 / 今年 各过去了多少（0–1），外加两句人话（今天还剩几小时、今年还剩几天）。
 *
 * 放进引擎的理由与别处一致：全是日期算术，界面只负责画条；`now` 注入 → 测试能钉死到秒。
 * 它也是这张卡存在的理由：**唯一一张不需要用户输入、也不会过时的卡** —— 每看一眼都在变。
 */

import { daysInMonth } from './calendar.js'

export interface ProgressSnapshot {
  /** 0–1 */
  today: number
  month: number
  year: number
  /** 向上取整的剩余整点：23:30 → 1，00:00 → 24 */
  hoursLeftToday: number
  /** 不含今天 */
  daysLeftYear: number
  /** 1-based */
  dayOfYear: number
  daysInYear: number
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365
}

/**
 * 今年的第几天（1-based）。
 * 用**本地日期之差**而不是毫秒差：跨夏令时的机器上毫秒差会差一小时，`floor` 之后就差一天。
 */
export function dayOfYear(now: Date): number {
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((startOfDay.getTime() - startOfYear.getTime()) / 86_400_000) + 1
}

/** 夹到 0–1；`NaN` 也当 0 —— 坏输入不该画出"NaN%"的进度条 */
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function progressOf(now: Date): ProgressSnapshot {
  const year = now.getFullYear()
  const doy = dayOfYear(now)
  const diy = daysInYear(year)
  const dim = daysInMonth(year, now.getMonth() + 1)
  const secondsToday =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000
  const today = secondsToday / 86_400

  return {
    today,
    month: (now.getDate() - 1 + today) / dim,
    year: (doy - 1 + today) / diy,
    hoursLeftToday: Math.ceil((86_400 - secondsToday) / 3600),
    daysLeftYear: diy - doy,
    dayOfYear: doy,
    daysInYear: diy,
  }
}

/** 界面上那三个百分比。取整、夹在 0–100 —— 一手滑算出 100.4% 会很难看 */
export function formatPct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`
}
