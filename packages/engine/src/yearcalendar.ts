/**
 * 整年 12 个迷你月历：一张卡看十二个月，今天那格亮着。
 *
 * 每个月仍是**固定 6 行 × 7 列** —— 月历行数随月份跳会让卡片上下抖，补位格给 `null`，界面画留白。
 * 纯函数 + 注入"今天"，能被单测直接压。`Date` 不算环境依赖（包构建的 lib 是 ES2022）。
 */

import { daysInMonthOf } from './heatmap.js'

export interface DayCell {
  /** 1–31；补位格是 `null` */
  day: number | null
  today: boolean
  weekend: boolean
}

export interface MonthMini {
  /** 1–12 */
  month: number
  /** "10 月" */
  label: string
  /** 6 × 7，周一为第一列，固定 */
  monthRows: DayCell[][]
}

/** `daysInMonthOf` 直接复用 heatmap 那份（大小月/闰年同源），这里不再重写一遍 */

/** 翻年：`delta` 可正可负，直接滚年份 */
export function shiftYear(year: number, delta: number): number {
  return year + delta
}

export function formatYearLabel(year: number): string {
  return `${year} 年`
}

export function yearGrid(year: number, now: Date): MonthMini[] {
  const todayY = now.getFullYear()
  const todayM = now.getMonth() + 1
  const todayD = now.getDate()

  const months: MonthMini[] = []
  for (let month = 1; month <= 12; month++) {
    const first = new Date(year, month - 1, 1)
    /** JS 的 `getDay()` 里周日是 0；换算成"距周一几天"才能让第一列是周一 */
    const lead = (first.getDay() + 6) % 7
    const total = daysInMonthOf(year, month)

    const monthRows: DayCell[][] = []
    for (let w = 0; w < 6; w++) {
      const row: DayCell[] = []
      for (let i = 0; i < 7; i++) {
        // 周末是**列**的属性（第 6、7 列），补位格也带着它 —— 界面据此给整列做底色
        const weekend = i >= 5
        const day = w * 7 + i - lead + 1
        if (day < 1 || day > total) {
          row.push({ day: null, today: false, weekend })
          continue
        }
        row.push({ day, today: year === todayY && month === todayM && day === todayD, weekend })
      }
      monthRows.push(row)
    }
    months.push({ month, label: `${month} 月`, monthRows })
  }
  return months
}
