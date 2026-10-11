/**
 * 节假日与调休：一张本地年表 + 一组纯查询。
 *
 * 年表是**纯数据**：国务院办公厅每年 11 月前后发布下一年安排，往 `HOLIDAYS` 里
 * 加一年即可，查询逻辑一行不用动。年表没覆盖的年份，卡片如实显示「待公布」——
 * 宁可少一行信息，不给一个编出来的假期。
 *
 * 数据来源（逐年注明文号，别删 —— 这是这张卡"数据可信"的全部依据）：
 * - 2026：国办发明电〔2025〕7 号（2025-11-04 发布，
 *   www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm）
 * - 2025：国办发明电〔2024〕17 号（2024-11-12 发布）
 *
 * 日期口径与 `countdown.ts` 同一套：`YYYY-MM-DD` 字符串、本地日历日
 * （"还有几天"按日期差算，不按 24 小时制）。
 */

import { daysUntil, parseDate } from './countdown.js'

export interface HolidayPlan {
  /** 节名（元旦 / 春节 / 清明节 / 劳动节 / 端午节 / 中秋节 / 国庆节） */
  name: string
  /** 放假首日 `YYYY-MM-DD`（含） */
  start: string
  /** 放假末日 `YYYY-MM-DD`（含） */
  end: string
  /** 调休补班日 `YYYY-MM-DD` 列表（没调休就是空表） */
  workdays: string[]
}

export const HOLIDAYS: Readonly<Record<number, readonly HolidayPlan[]>> = {
  2025: [
    { name: '元旦', start: '2025-01-01', end: '2025-01-01', workdays: [] },
    { name: '春节', start: '2025-01-28', end: '2025-02-04', workdays: ['2025-01-26', '2025-02-08'] },
    { name: '清明节', start: '2025-04-04', end: '2025-04-06', workdays: [] },
    { name: '劳动节', start: '2025-05-01', end: '2025-05-05', workdays: ['2025-04-27'] },
    { name: '端午节', start: '2025-05-31', end: '2025-06-02', workdays: [] },
    { name: '国庆节', start: '2025-10-01', end: '2025-10-08', workdays: ['2025-09-28', '2025-10-11'] },
  ],
  2026: [
    { name: '元旦', start: '2026-01-01', end: '2026-01-03', workdays: ['2026-01-04'] },
    { name: '春节', start: '2026-02-15', end: '2026-02-23', workdays: ['2026-02-14', '2026-02-28'] },
    { name: '清明节', start: '2026-04-04', end: '2026-04-06', workdays: [] },
    { name: '劳动节', start: '2026-05-01', end: '2026-05-05', workdays: ['2026-05-09'] },
    { name: '端午节', start: '2026-06-19', end: '2026-06-21', workdays: [] },
    { name: '中秋节', start: '2026-09-25', end: '2026-09-27', workdays: [] },
    { name: '国庆节', start: '2026-10-01', end: '2026-10-07', workdays: ['2026-09-20', '2026-10-10'] },
  ],
}

export type HolidayPhase = 'past' | 'ongoing' | 'upcoming'

export interface HolidayView {
  plan: HolidayPlan
  phase: HolidayPhase
  /** 距放假首日的整天数（0 = 今天开始/正在放，负 = 已开始几天） */
  daysUntil: number
  /** 假期总天数（含首尾） */
  length: number
}

/** 某条假期今天处于哪一段：开始日还没到 = upcoming；结束日没走完 = ongoing；否则 past */
export function planPhase(plan: HolidayPlan, now: Date): HolidayPhase {
  const s = daysUntil(plan.start, now)
  const e = daysUntil(plan.end, now)
  if (s !== null && s > 0) return 'upcoming'
  if (e !== null && e >= 0) return 'ongoing'
  return 'past'
}

/** 假期总天数（含首尾）。年表是硬编码的、单测守合法，这里对坏数据兜底 0 而不是 NaN */
export function planLength(plan: HolidayPlan): number {
  const a = parseDate(plan.start)
  const b = parseDate(plan.end)
  if (!a || !b) return 0
  const ms = new Date(b.y, b.m - 1, b.d).getTime() - new Date(a.y, a.m - 1, a.d).getTime()
  return Math.round(ms / 86_400_000) + 1
}

/** 某年的年表视图（保持官方通知的先后顺序）。没数据的年份返回空表 */
export function yearView(year: number, now: Date): HolidayView[] {
  const plans = HOLIDAYS[year] ?? []
  return plans.map((plan) => ({
    plan,
    phase: planPhase(plan, now),
    daysUntil: daysUntil(plan.start, now) ?? 0,
    length: planLength(plan),
  }))
}

/**
 * 下一个还没放完的假期：今年按表顺序找第一个非 past；今年全过完了才看明年
 * （表按时间升序，第一个非 past 就是最早的那个）。跨年都没有数据时返回 null ——
 * 卡片据此显示「安排待公布」，不编。
 */
export function nextHoliday(now: Date): HolidayView | null {
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const upcoming = yearView(year, now).find((v) => v.phase !== 'past')
    if (upcoming) return upcoming
  }
  return null
}

/** 某日是不是调休补班日（扫全部年份的补班表；表很小，不值得建索引） */
export function isAdjustedWorkday(ymd: string): boolean {
  if (parseDate(ymd) === null) return false
  for (const plans of Object.values(HOLIDAYS)) {
    for (const plan of plans) {
      if (plan.workdays.includes(ymd)) return true
    }
  }
  return false
}

/**
 * 距下一个元旦还有几天。元旦固定 1 月 1 日，天数是事实；
 * **放几天是官方定的** —— 卡片展示时必须带「安排待公布」，不能把天数当成放假承诺。
 */
export function newYearEstimate(now: Date): { date: string; days: number } {
  const date = `${now.getFullYear() + 1}-01-01`
  return { date, days: daysUntil(date, now) ?? 0 }
}
