/**
 * 日期工具：星期几 / 相差几天 / 加减天数。
 *
 * 全部**复用倒数日那套解析与"本地日历日"口径**（`countdown.ts`）—— 同一个用户在两张卡里
 * 敲 `2027-05-01`，不能一张按日历日、一张按毫秒算出两个答案。
 */

import { parseDate } from './countdown.js'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** `YYYY-MM-DD` → 周几；认不出返回 `null` */
export function weekdayOf(date: string): string | null {
  const p = parseDate(date)
  if (!p) return null
  return WEEKDAYS[new Date(p.y, p.m - 1, p.d).getDay()]
}

/** `a` 比 `b` 晚几天（b 在后为正）。任一日期非法返回 `null` */
export function diffDays(a: string, b: string): number | null {
  const pa = parseDate(a)
  const pb = parseDate(b)
  if (!pa || !pb) return null
  const da = new Date(pa.y, pa.m - 1, pa.d)
  const db = new Date(pb.y, pb.m - 1, pb.d)
  return Math.round((da.getTime() - db.getTime()) / 86_400_000)
}

/** 往前 / 往后数 N 天的 `YYYY-MM-DD`。起点非法或 `n` 非整数返回 `null` */
export function addDays(date: string, n: number): string | null {
  const p = parseDate(date)
  if (!p || !Number.isInteger(n)) return null
  const d = new Date(p.y, p.m - 1, p.d + n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
