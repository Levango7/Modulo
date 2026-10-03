import { describe, expect, it } from 'vitest'
import { dayOfYear, daysInYear, formatPct, isLeapYear, progressOf } from '@modulo/engine/progress'

describe('闰年与年天数', () => {
  it('四条规则各一例（整百不闰、四百年再闰）', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })

  it('年天数只有两种取值', () => {
    expect(daysInYear(2026)).toBe(365)
    expect(daysInYear(2028)).toBe(366)
  })
})

describe('dayOfYear：1-based，跨闰日要对', () => {
  it('年初 / 年末 / 闰年末', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1)
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365)
    expect(dayOfYear(new Date(2028, 11, 31))).toBe(366)
  })

  it('3 月 1 日：平年是第 60 天，闰年是第 61 天', () => {
    expect(dayOfYear(new Date(2026, 2, 1))).toBe(60)
    expect(dayOfYear(new Date(2028, 2, 1))).toBe(61)
  })

  it('当天几点几分不影响它是第几天（只看日历日）', () => {
    expect(dayOfYear(new Date(2026, 5, 1, 0, 0, 0))).toBe(dayOfYear(new Date(2026, 5, 1, 23, 59, 59)))
    expect(dayOfYear(new Date(2026, 5, 1, 0, 0, 0))).toBe(152)
  })
})

describe('progressOf：三个进度 + 两句人话', () => {
  it('年初零点：今天 0%、今年第 1 天、还剩 364 天、还剩 24 小时', () => {
    const p = progressOf(new Date(2026, 0, 1, 0, 0, 0, 0))
    expect(p.today).toBe(0)
    expect(p.dayOfYear).toBe(1)
    expect(p.daysInYear).toBe(365)
    expect(p.daysLeftYear).toBe(364)
    expect(p.hoursLeftToday).toBe(24)
    expect(formatPct(p.today)).toBe('0%')
  })

  it('正午整点：今天恰好一半；小时数向上取整（还剩 12）', () => {
    const p = progressOf(new Date(2026, 5, 1, 12, 0, 0, 0))
    expect(p.today).toBe(0.5)
    expect(p.hoursLeftToday).toBe(12)
  })

  it('23:30：今天 97.9%、还剩 1 小时（不是 0 —— 说"还剩 0 小时"是撒谎）', () => {
    const p = progressOf(new Date(2026, 5, 1, 23, 30, 0, 0))
    expect(p.today).toBeGreaterThan(0.97)
    expect(p.hoursLeftToday).toBe(1)
  })

  it('月进度按当月真实天数算：2 月 15 日过半一点，与 4 月 15 日不同', () => {
    const feb = progressOf(new Date(2026, 1, 15, 12, 0, 0, 0))
    const apr = progressOf(new Date(2026, 3, 15, 12, 0, 0, 0))
    expect(feb.month).toBeCloseTo((14 + 0.5) / 28, 6)
    expect(apr.month).toBeCloseTo((14 + 0.5) / 30, 6)
    expect(feb.month).toBeGreaterThan(apr.month)
  })

  it('年进度在闰年用 366 天做分母', () => {
    const p = progressOf(new Date(2028, 0, 1, 12, 0, 0, 0))
    expect(p.year).toBeCloseTo(0.5 / 366, 9)
    expect(p.daysInYear).toBe(366)
  })

  it('年末最后一秒：年进度逼近 1 但不超过', () => {
    const p = progressOf(new Date(2026, 11, 31, 23, 59, 59, 999))
    expect(p.year).toBeGreaterThan(0.9999)
    expect(p.year).toBeLessThanOrEqual(1)
    expect(p.daysLeftYear).toBe(0)
  })
})

describe('formatPct：取整并夹住，绝不出现 100.4% 这种', () => {
  it('常规四舍五入', () => {
    expect(formatPct(0.734)).toBe('73%')
    expect(formatPct(0)).toBe('0%')
  })
  it('超界夹住（坏输入不该画出格子的进度条）', () => {
    expect(formatPct(1.004)).toBe('100%')
    expect(formatPct(-0.2)).toBe('0%')
    expect(formatPct(Number.NaN)).toBe('0%')
  })
})
