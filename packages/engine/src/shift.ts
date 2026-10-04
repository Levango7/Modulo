/**
 * 值班/轮值表：一份名单，按周期轮着排班，某天谁值班。
 *
 * ## 排班规则写死在这里，不做成可配置的表达式
 *
 * 可以做的替代方案是"每人一条正则式排班规则"（周一和周四张三……）—— 那才是真正的
 * 排班系统，也是最容易出错的软件。这一版刻意只支持一种规则：
 *
 * **从锚点日期起按天序轮转，同一天内按班次顺延。**
 * 索引 = `(距锚点的天数 × 每天班次数 + 班次序号) mod 名单长度`
 *
 * 这条规则覆盖了绝大多数小团队的"轮流值日"，而且**任何一天的值都能被手算验证**。
 * 需要复杂规则时正解是接一个日历系统，不是把这张卡做成半个日历。
 */

import { monthGrid } from './calendar.js'

export interface ShiftBlock {
  id: string
  label: string
  /** 0–23，跨零点用 `endHour < startHour` 表示 */
  startHour: number
  endHour: number
}

/** 默认三班。班次时间是"给人看的"，不影响轮转索引 */
export const DEFAULT_SHIFT_BLOCKS: readonly ShiftBlock[] = [
  { id: 'morning', label: '早班', startHour: 8, endHour: 12 },
  { id: 'noon', label: '中班', startHour: 12, endHour: 18 },
  { id: 'night', label: '晚班', startHour: 18, endHour: 24 },
]

export interface DutySlot {
  date: string
  day: number | null
  weekday: number
  weekdayLabel: string
  block: ShiftBlock
  /** 值班的姓名；名单为空时是 null（界面显示"待排"） */
  person: string | null
  isToday: boolean
  isWeekend: boolean
  /** 本月已过去的日子之外 → 未来，界面画得更淡 */
  future: boolean
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

const ymd = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** 两个日期之间相差几天（按本地日历日，不受时区/夏令时影响） */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000)
}

/**
 * 某天某班次轮到谁。
 *
 * `anchor` 是轮转起点（通常是元旦或某一天）。名单为空 → null（"待排"），
 * 而不是回落到第一个名字 —— 那会让一张没填名单的表看起来像已经排好了。
 */
export function whoOnDuty(roster: readonly string[], blocks: readonly ShiftBlock[], anchor: Date, date: Date, blockIndex: number): string | null {
  if (roster.length === 0) return null
  const perDay = Math.max(1, blocks.length)
  const step = daysBetween(anchor, date) * perDay + Math.max(0, blockIndex)
  const idx = ((step % roster.length) + roster.length) % roster.length
  return roster[idx] ?? null
}

/** 某一整天的所有班次 */
export function dayDuties(
  roster: readonly string[],
  blocks: readonly ShiftBlock[],
  anchor: Date,
  date: Date,
  now: Date,
): DutySlot[] {
  const todayKey = ymd(now)
  const key = ymd(date)
  const weekday = date.getDay()
  return blocks.map((block, i) => ({
    date: key,
    day: date.getDate(),
    weekday,
    weekdayLabel: WEEKDAYS[weekday],
    block,
    person: whoOnDuty(roster, blocks, anchor, date, i),
    isToday: key === todayKey,
    isWeekend: weekday === 0 || weekday === 6,
    future: key > todayKey,
  }))
}

/**
 * 整月的排班表，沿用 `calendar.ts` 的**固定 6×7 网格** ——
 * 所以这张卡的高度不会因为某月 28 天而跳一截（这是月历当初就定下的规矩）。
 *
 * 输出**拍平成 42 格**（6 行 × 7 列）而不是嵌套数组：嵌套数组在模板里要两层 `v-for`，
 * 而 vue-tsc 对两层 `(item, index)` 形式的推断会把内层推多一层数组。
 * 拍平后界面直接 `grid-template-columns: repeat(7, 1fr)`，少一层循环、少一处类型体操。
 */
export function monthDuties(
  roster: readonly string[],
  blocks: readonly ShiftBlock[],
  anchor: Date,
  month: Date,
  now: Date,
): { label: string; weekdays: readonly string[]; cells: (DutySlot | null)[][] } {
  // `monthGrid` 的 month 是 1–12，`Date.getMonth()` 是 0–11 —— 少加 1 会画错月份
const grid = monthGrid(month.getFullYear(), month.getMonth() + 1, now)
  const todayKey = ymd(now)
  const cells = grid.weeks.map((row) =>
    row.map((c): DutySlot | null => {
      if (c.day === null) return null
      const d = new Date(grid.year, grid.month - 1, c.day)
      const weekday = d.getDay()
      const key = ymd(d)
      const isToday = key === todayKey
      // 每天只给一个"主班"（第一个班次），因为竖版格子放不下三行；
      // 完整的当日三班用 `dayDuties` 查。那是接口的分工，不是数据丢了。
      const block = blocks[0]
      if (!block) return null
      return {
        date: key,
        day: c.day,
        weekday,
        weekdayLabel: WEEKDAYS[weekday],
        block,
        person: whoOnDuty(roster, blocks, anchor, d, 0),
        isToday,
        isWeekend: weekday === 0 || weekday === 6,
        future: key > todayKey,
      }
    }),
  )
  return { label: grid.label, weekdays: grid.weekdays, cells }
}

/** 班次时间的人话：`08:00–12:00`；跨零点写成 `18:00–24:00`（不换成 00:00，避免"结束早于开始"的错觉） */
export function blockTimeLabel(b: ShiftBlock): string {
  const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`
  return `${hh(b.startHour)}–${hh(b.endHour)}`
}

/** 今天是哪个班、谁在值 —— 卡上给"此刻"的答案，不只是整张表 */
export function currentDuty(
  roster: readonly string[],
  blocks: readonly ShiftBlock[],
  anchor: Date,
  now: Date,
): DutySlot | null {
  const hour = now.getHours()
  const hit = blocks.find((b) => (b.endHour > b.startHour ? hour >= b.startHour && hour < b.endHour : hour >= b.startHour || hour < b.endHour))
  const list = dayDuties(roster, blocks, anchor, now, now)
  if (hit) {
    const idx = blocks.indexOf(hit)
    return list[idx] ?? null
  }
  // 不在任何班次内（比如空班表）：退回第一个班次的位置，但界面上标出"现在没有班"
  return list[0] ?? null
}