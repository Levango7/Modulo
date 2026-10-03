import { describe, expect, it } from 'vitest'
import { WEEKDAY_LABELS, daysInMonth, formatMonth, monthGrid, shiftMonth } from '@modulo/engine/calendar'

describe('daysInMonth：闰年与否只看二月，但验证方式要能抓住"整形错误"', () => {
  it('平年 / 闰年 / 世纪年', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28) // 整百不闰
    expect(daysInMonth(2000, 2)).toBe(29) // 四百年又闰
  })

  it('大小月与 12 月的边界', () => {
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
    expect(daysInMonth(2027, 1)).toBe(31)
  })
})

describe('shiftMonth：翻月跨年自己滚', () => {
  it('往前、往后、一次跨多年', () => {
    expect(shiftMonth(2026, 10, 3)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 10, 12)).toEqual({ year: 2027, month: 10 })
    expect(shiftMonth(2026, 2, -14)).toEqual({ year: 2024, month: 12 })
  })

  it('原地不动也要是同一对数字', () => {
    expect(shiftMonth(2026, 7, 0)).toEqual({ year: 2026, month: 7 })
  })
})

describe('monthGrid：固定 6×7，补位留 null', () => {
  const now = new Date(2026, 9, 16) // 2026-10-16（周五）
  const grid = monthGrid(2026, 10, now)

  it('形状是死的：6 行 × 7 列，星期名从周一起', () => {
    expect(grid.weeks).toHaveLength(6)
    for (const row of grid.weeks) expect(row).toHaveLength(7)
    expect(grid.weekdays).toEqual([...WEEKDAY_LABELS])
    expect(grid.label).toBe('2026 年 10 月')
  })

  it('2026-10-01 是周四（getDay=4 → 距周一 3 天）：首行前 3 格是补位，第 4 格才是 1 号', () => {
    const first = grid.weeks[0]
    expect(first[0].day).toBeNull()
    expect(first[1].day).toBeNull()
    expect(first[2].day).toBeNull()
    expect(first[3].day).toBe(1)
  })

  it('1 号到 31 号一个不少、顺序正确；总计 31 个非空格', () => {
    const days = grid.weeks.flat().filter((c) => c.day !== null).map((c) => c.day)
    expect(days).toHaveLength(31)
    expect(days[0]).toBe(1)
    expect(days[days.length - 1]).toBe(31)
    expect(days).toEqual([...Array(31)].map((_, i) => i + 1))
  })

  it('周末只看列：第 6、7 列是周末，前五列不是', () => {
    for (const row of grid.weeks) {
      for (let i = 0; i < 7; i++) {
        expect(row[i].weekend, `第 ${i + 1} 列`).toBe(i >= 5)
      }
    }
  })

  it('"今天"只有一个：注入 2026-10-16，就那一格亮', () => {
    const todayCells = grid.weeks.flat().filter((c) => c.today)
    expect(todayCells).toHaveLength(1)
    expect(todayCells[0].day).toBe(16)
  })

  it('看别的月份时一格都不亮（不能拿"今天"去点亮 8 月的 16 号）', () => {
    const other = monthGrid(2026, 8, now)
    expect(other.weeks.flat().filter((c) => c.today)).toHaveLength(0)
  })

  it('周一开头的月份没有前导补位（2026-06-01 是周一），短月的尾行整行补位', () => {
    const june = monthGrid(2026, 6, now)
    expect(june.weeks[0][0].day).toBe(1)
    // 6 月 30 天 + lead 0 = 30 格 → 第 5 行第 2 格之后全是补位
    expect(june.weeks[4][1].day).toBe(30)
    expect(june.weeks[4][2].day).toBeNull()
    expect(june.weeks[5].every((c) => c.day === null)).toBe(true)
  })

  it('formatMonth 的写法固定（卡片标题直接用）', () => {
    expect(formatMonth(2026, 10)).toBe('2026 年 10 月')
    expect(formatMonth(2027, 1)).toBe('2027 年 1 月')
  })
})
