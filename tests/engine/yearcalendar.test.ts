import { describe, expect, it } from 'vitest'
import { formatYearLabel, shiftYear, yearGrid } from '@levango7/engine/yearcalendar'

// daysInMonthOf 由 heatmap 持有（年历直接复用它），闰年/世纪年的断言在 heatmap.test.ts。

describe('shiftYear / formatYearLabel：翻年与标题写法固定', () => {
  it('往前、往后、原地不动', () => {
    expect(shiftYear(2026, 1)).toBe(2027)
    expect(shiftYear(2026, -1)).toBe(2025)
    expect(shiftYear(2026, 0)).toBe(2026)
  })

  it('标题是 "2026 年" 这种样子（卡片标题直接用）', () => {
    expect(formatYearLabel(2026)).toBe('2026 年')
  })
})

describe('yearGrid：12 个月、每个 6×7、周一开头', () => {
  const now = new Date(2026, 9, 16) // 2026-10-16（周五）
  const grid = yearGrid(2026, now)

  it('一年 12 张，每张 6 行 × 7 列', () => {
    expect(grid).toHaveLength(12)
    for (const mini of grid) {
      expect(mini.monthRows).toHaveLength(6)
      for (const row of mini.monthRows) expect(row).toHaveLength(7)
    }
  })

  it('2026-10-01 是周四：10 月首行前 3 格补位，第 4 格是 1 号', () => {
    const oct = grid[9]
    expect(oct.month).toBe(10)
    expect(oct.monthRows[0][0].day).toBeNull()
    expect(oct.monthRows[0][3].day).toBe(1)
  })

  it('"今天"只有一个：注入 2026-10-16，全年就 10 月 16 号那格亮', () => {
    const todayCells = grid.flatMap((m) => m.monthRows.flat()).filter((c) => c.today)
    expect(todayCells).toHaveLength(1)
    expect(todayCells[0].day).toBe(16)
  })

  it('看别的年份时一格都不亮（不能拿"今天"去点亮 2025 年的 10 月 16 号）', () => {
    const other = yearGrid(2025, now)
    expect(other.flatMap((m) => m.monthRows.flat()).filter((c) => c.today)).toHaveLength(0)
  })

  it('周末只看列：第 6、7 列是周末，前五列不是', () => {
    for (const mini of grid) {
      for (const row of mini.monthRows) {
        for (let i = 0; i < 7; i++) {
          expect(row[i].weekend, `${mini.month} 月第 ${i + 1} 列`).toBe(i >= 5)
        }
      }
    }
  })
})
