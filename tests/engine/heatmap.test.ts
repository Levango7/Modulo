import { describe, expect, it } from 'vitest'
import { daysInMonthOf, monthHeatmap } from '../../packages/engine/src/heatmap'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

describe('monthHeatmap：6×7 固定网格 + 相对色阶', () => {
  it('固定 6 行 × 7 列 —— 与月历同一口径，卡片高度不随月份跳', () => {
    for (const [y, m] of [[2026, 2], [2026, 4], [2024, 2]] as const) {
      const h = monthHeatmap({}, at(y, m, 15))
      expect(h.weeks).toHaveLength(6)
      for (const w of h.weeks) expect(w).toHaveLength(7)
    }
  })

  it('补位格是 null（画留白），不占用一天', () => {
    // 2026 年 2 月只有 28 天
    const h = monthHeatmap({}, at(2026, 2, 15))
    const blanks = h.weeks.flat().filter((c) => c.date === null).length
    expect(blanks).toBe(42 - 28)
    expect(daysInMonthOf(2026, 2)).toBe(28)
    expect(daysInMonthOf(2024, 2)).toBe(29)
  })

  it('标出今天，且只标一个', () => {
    const h = monthHeatmap({}, at(2026, 10, 15))
    const todays = h.weeks.flat().filter((c) => c.today)
    expect(todays).toHaveLength(1)
    expect(todays[0].date).toBe('2026-10-15')
  })

  it('未来的日子画得更淡、不上色 —— 还没到的日子不该显示成"没打卡"', () => {
    const h = monthHeatmap({ '2026-10-20': 3 }, at(2026, 10, 15))
    const future = h.weeks.flat().find((c) => c.date === '2026-10-20')!
    expect(future.muted).toBe(true)
    expect(future.level).toBe(0)
    expect(h.futureDays).toBeGreaterThan(0)
  })

  it('往回翻月时"未来"不再适用（那些日子已过去或仍是当月）', () => {
    const h = monthHeatmap({ '2026-09-20': 1 }, at(2026, 10, 15), -1)
    const day20 = h.weeks.flat().find((c) => c.date === '2026-09-20')!
    expect(day20.muted).toBe(false)
    expect(day20.value).toBe(1)
  })

  it('色阶按本月最大值归一，取值只到最大值', () => {
    const h = monthHeatmap({ '2026-10-01': 1, '2026-10-02': 4 }, at(2026, 10, 15))
    expect(h.max).toBe(4)
    const b = h.weeks.flat().find((c) => c.date === '2026-10-02')!
    expect(b.level).toBe(4)
  })

  it('**只有"最大值为 1"时才退化成两档**（所有非零值都是 1，渐变是编出来的）', () => {
    const h = monthHeatmap({ '2026-10-01': 1, '2026-10-02': 1 }, at(2026, 10, 15))
    expect(h.max).toBe(1)
    const filled = h.weeks.flat().filter((c) => c.value > 0)
    expect(filled).toHaveLength(2)
    for (const c of filled) expect(c.level).toBe(2)
    expect(h.weeks.flat().find((c) => c.value === 0)!.level).toBe(0)
  })

  it('{1, 4} 是真有两个量级，必须画出差', () => {
    const h = monthHeatmap({ '2026-10-01': 1, '2026-10-02': 4 }, at(2026, 10, 15))
    const a = h.weeks.flat().find((c) => c.date === '2026-10-01')!
    const b = h.weeks.flat().find((c) => c.date === '2026-10-02')!
    expect(b.level).toBe(4)
    expect(a.level).toBeLessThan(b.level)
  })

  it('**上个月的极端值不得影响本月的色阶**（早先是对整份数据求 max）', () => {
    const h = monthHeatmap({ '2026-09-30': 99, '2026-10-01': 1, '2026-10-02': 4 }, at(2026, 10, 15))
    expect(h.max).toBe(4)
    const b = h.weeks.flat().find((c) => c.date === '2026-10-02')!
    expect(b.level).toBe(4)
  })

  it('max / total / activeDays 只统计画出来的格子', () => {
    const h = monthHeatmap({ '2026-10-01': 2, '2026-10-02': 3, '2026-09-30': 9 }, at(2026, 10, 15))
    expect(h.activeDays).toBe(2)
    expect(h.total).toBe(5)
    expect(h.max).toBe(3)
  })

  it('全零的月份不除以零（max 为 0，全部 level 0）', () => {
    const h = monthHeatmap({}, at(2026, 10, 15))
    expect(h.max).toBe(0)
    expect(h.weeks.flat().every((c) => c.level === 0)).toBe(true)
    expect(h.activeDays).toBe(0)
    expect(h.total).toBe(0)
  })

  it('坏数据当 0：非法日期、负数、NaN、超长都丢，**不抛**', () => {
    const h = monthHeatmap(
      { '2026-13-01': 5, '10-01': 5, bad: 5, '2026-10-01': -3, '2026-10-02': Number.NaN, '2026-10-03': 9_999_999 },
      at(2026, 10, 15),
    )
    const by = (d: string) => h.weeks.flat().find((c) => c.date === d)!
    expect(by('2026-10-01').value).toBe(0)
    expect(by('2026-10-02').value).toBe(0)
    // 超上限的值被夹住而不是丢整条
    expect(by('2026-10-03').value).toBe(9999)
    expect(h.activeDays).toBe(1)
  })

  it('统计：有多少天有记录、累计多少次', () => {
    const h = monthHeatmap({ '2026-10-01': 2, '2026-10-02': 3, '2026-09-30': 9 }, at(2026, 10, 15))
    expect(h.activeDays).toBe(2)
    expect(h.total).toBe(5)
  })

  it('label 与 weekdays 沿用月历', () => {
    const h = monthHeatmap({}, at(2026, 10, 15))
    expect(h.label).toBe('2026 年 10 月')
    expect([...h.weekdays]).toEqual(['一', '二', '三', '四', '五', '六', '日'])
  })
})