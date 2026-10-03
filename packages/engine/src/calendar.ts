/**
 * 月历的日期算术：给年月，铺出一张**固定 6 行 × 7 列**的月历格子。
 *
 * 为什么固定 6 行：卡片高度必须稳定 —— 一个月是 4~6 行，行数随月份跳会让整块版面上下抖，
 * 而这个项目最贵的一条规矩就是"版面不许因为它不知道的事变化"。补位格给 `null`，界面画留白。
 *
 * 纯函数 + 注入"今天"，所以能被单测直接压。`Date` 不算环境依赖（包构建的 lib 是 ES2022）。
 */

export interface CalendarCell {
  /** 1–31；补位格是 `null` */
  day: number | null
  today: boolean
  weekend: boolean
}

export interface MonthGrid {
  year: number
  /** 1–12 */
  month: number
  /** "2026 年 10 月" */
  label: string
  /** 周一起 —— 中国人的日历从周一读起 */
  weekdays: readonly string[]
  /** 6 × 7，固定 */
  weeks: CalendarCell[][]
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** `month` 是 1–12：下个月第 0 天 = 本月最后一天 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 翻月：`delta` 可正可负，跨年由它自己滚（10 月 +3 = 次年 1 月） */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function formatMonth(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}

export function monthGrid(year: number, month: number, now: Date): MonthGrid {
  const first = new Date(year, month - 1, 1)
  /** JS 的 `getDay()` 里周日是 0；换算成"距周一几天"才能让第一列是周一 */
  const lead = (first.getDay() + 6) % 7
  const total = daysInMonth(year, month)
  const todayY = now.getFullYear()
  const todayM = now.getMonth() + 1
  const todayD = now.getDate()

  const weeks: CalendarCell[][] = []
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = []
    for (let i = 0; i < 7; i++) {
      // 周末是**列**的属性（第 6、7 列），补位格也带着它 —— 界面据此给整列做底色，
      // 空了几天不该让那一列的颜色断掉
      const weekend = i >= 5
      const day = w * 7 + i - lead + 1
      if (day < 1 || day > total) {
        row.push({ day: null, today: false, weekend })
        continue
      }
      row.push({ day, today: year === todayY && month === todayM && day === todayD, weekend })
    }
    weeks.push(row)
  }
  return { year, month, label: formatMonth(year, month), weekdays: WEEKDAY_LABELS, weeks }
}
