/**
 * 倒数日：算"还有几天"。日期是用户敲进来的字符串（`YYYY-MM-DD`），这里只做三件事：
 * 校验它真的存在、按**本地日历日**算差、给人话。
 *
 * 为什么按日历日而不是 24 小时制：用户说"到 10-20 还有几天"时，心里算的是日期；
 * 按小时算会出现"今天是 0.7 天"这种没人想要的东西。
 */

import { daysInMonth } from './calendar.js'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface PlainDate {
  y: number
  m: number
  d: number
}

/** 严格解析：形状不对、月份越界、`2026-02-30` 这种"看着像日子但不是"的一律 null */
export function parseDate(s: string): PlainDate | null {
  const match = DATE_RE.exec(s.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

export function isValidDate(s: string): boolean {
  return parseDate(s) !== null
}

/**
 * 距那天还有几天：0 = 就是今天，1 = 明天，负数 = 已经过去。
 * 认不出日期返回 `null` —— 卡片显示"还没设日期"，而不是一个编出来的数字。
 * 用 `Math.round` 吸收夏令时带来的 ±1 小时（差的分钟数会落在整天附近）。
 */
export function daysUntil(date: string, now: Date): number | null {
  const p = parseDate(date)
  if (!p) return null
  const target = new Date(p.y, p.m - 1, p.d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export function countdownText(days: number): string {
  if (days === 0) return '就是今天'
  return days > 0 ? `还有 ${days} 天` : `已过 ${-days} 天`
}

/** `2026-10-20` → `10 月 20 日`（认不出就原样返回，不编） */
export function formatDateLabel(date: string): string {
  const p = parseDate(date)
  return p ? `${p.m} 月 ${p.d} 日` : date
}
