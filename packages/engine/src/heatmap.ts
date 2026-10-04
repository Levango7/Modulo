/**
 * 月度热力图：把一组「日期 → 次数」铺成当月格子，用深浅表示量。
 *
 * 复用的是 `habit.ts` 的打卡集合与 `calendar.ts` 的固定 6×7 网格 —— 这张卡不是新的
 * 概念，只是把"最近 7 天"换成"当月 30 天"，所以它复用而不重写。
 *
 * ## 一条关键的诚实约束：**色阶是相对的，不是绝对的**
 *
 * 一个只用来显示"这个月哪天忙"的热力图，**不该对用户声称"这天很轻"**。所以：
 *
 * - 色阶按**这个月的最大值**归一，且**至少 1** —— 全零的月份不能除以零；
 * - 只有 0 和 1 两种取值时不给假色阶（第二格和第一格同深浅），因为"填满 vs 空着"
 *   已经是全部信息，再画成渐变是在编造差异；
 * - 界面上写明这是相对深浅，不是"好/坏"。**颜色带评价色彩，而一天打了三次卡既不
 *   是好也不是坏** —— 这个评价不该由一张卡片替用户下。
 */

import { monthGrid } from './calendar.js'

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface HeatCell {
  day: number | null
  date: string | null
  value: number
  level: HeatLevel
  /** 补位格 / 未来的日子：界面画成空白而不是最浅的一格 */
  muted: boolean
  today: boolean
}

export interface HeatMonth {
  year: number
  month: number
  label: string
  weekdays: readonly string[]
  /** 固定 6×7 —— 与月历同一口径，所以卡片高度不会随月份跳 */
  weeks: HeatCell[][]
  max: number
  /** 本月有记录的天数 */
  activeDays: number
  /** 本月累计次数 */
  total: number
  /** 未来的日子（不可点、不上色） */
  futureDays: number
}

const ymd = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 把原始值映射到 0–4 的色阶。
 *
 * **只有"最大值为 1"时才退化成两档**（有就是 2、无就是 0）——
 * 那说明这批数据里所有非零值都是 1，"填满 vs 空着"已经是全部信息，再画渐变是在编造差异。
 * 反过来 `{1, 4}` 是真有两个量级（distinct 为 2），这时候必须画出差。
 */
function levelOf(value: number, max: number): HeatLevel {
  if (value <= 0) return 0
  if (max <= 1) return 2
  const bucket = Math.ceil((value / max) * 4)
  return Math.min(4, Math.max(1, bucket)) as HeatLevel
}

/**
 * 当月热力图。`counts` 是「日期 → 次数」的映射（值可以是次数，也可以只是"做过/没做过"）。
 *
 * 非法日期、负数、NaN 一律当 0（不是抛错）：这一层的数据来自用户手输，
 * 坏的一天不该让整张图打不开。
 */
export function monthHeatmap(counts: Readonly<Record<string, number>>, now: Date, shiftMonths = 0): HeatMonth {
  const cursor = new Date(now.getFullYear(), now.getMonth() + shiftMonths, 1)
  // `monthGrid` 的 month 是 **1–12**，而 `Date.getMonth()` 是 0–11。
// 少加这一句，整个模块会安静地画上个月的格子 —— 不报错、格子数也对，只是全错。
const grid = monthGrid(cursor.getFullYear(), cursor.getMonth() + 1, now)

  // 先把日期形状与数值收干净：夹成非负整数，坏的一天当 0（不是抛错 ——
  // 这一层的数据来自用户手输，坏一天不该让整张图打不开）
  const clean = new Map<string, number>()
  for (const [k, v] of Object.entries(counts)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    clean.set(k, Math.min(9999, Math.round(v)))
  }

  const todayKey = ymd(now)
  const weeks: HeatCell[][] = grid.weeks.map((row) =>
    row.map((c) => {
      if (c.day === null) return { day: null, date: null, value: 0, level: 0 as HeatLevel, muted: true, today: false }
      const d = new Date(grid.year, grid.month - 1, c.day)
      const date = ymd(d)
      const future = shiftMonths === 0 && date > todayKey
      const value = clean.get(date) ?? 0
      return {
        day: c.day,
        date,
        value,
        // 色阶在下面按**本月**最大值填，所以这一格先存 0，等 max 出来再回填
        level: 0 as HeatLevel,
        muted: future,
        today: c.today,
      }
    }),
  )

  // max / total / activeDays **只统计画出来的那些格子**。
  // 早先的写法是对整份 counts 求 max，结果是"9 月某个 99"会把 10 月的色阶压成一片浅色 ——
  // 用户看到的是上个月的极端值决定了这个月的深浅，而界面上没有任何地方能解释这件事。
  let max = 0
  let total = 0
  let activeDays = 0
  let futureDays = 0
  for (const row of weeks) {
    for (const c of row) {
      if (c.date === null) continue
      if (c.muted) {
        futureDays += 1
        continue
      }
      if (c.value > 0) activeDays += 1
      total += c.value
      if (c.value > max) max = c.value
    }
  }
  for (const row of weeks) {
    for (const c of row) {
      if (c.date === null || c.muted) continue
      c.level = levelOf(c.value, max)
    }
  }

  return {
    year: grid.year,
    month: grid.month,
    label: grid.label,
    weekdays: grid.weekdays,
    weeks,
    max,
    activeDays,
    total,
    futureDays,
  }
}

/** 那个月的实际天数（不是 30/31 猜） */
export function daysInMonthOf(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 图例文案：**刻意说"相对深浅"**，不说"好/坏"—— 见文件头那条约束 */
export const HEAT_LEGEND = '颜色按本月相对深浅，不是好坏'