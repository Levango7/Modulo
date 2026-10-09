import { describe, expect, it } from 'vitest'
import { countdownText, daysUntil, formatDateLabel, isValidDate, parseDate } from '@levango7/engine/countdown'

describe('parseDate：形状与"真实存在"两道都要过', () => {
  it('正常日期', () => {
    expect(parseDate('2026-10-20')).toEqual({ y: 2026, m: 10, d: 20 })
    expect(parseDate(' 2026-01-01 ')).toEqual({ y: 2026, m: 1, d: 1 })
  })

  it('闰日合法、平年 2-29 非法、2-30 非法 —— "看着像日子"不算数', () => {
    expect(parseDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    expect(parseDate('2026-02-29')).toBeNull()
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate('2026-04-31')).toBeNull()
  })

  it('形状不对一律 null：补零、月份越界、垃圾串', () => {
    expect(parseDate('2026-2-3')).toBeNull()
    expect(parseDate('2026-13-01')).toBeNull()
    expect(parseDate('2026-00-10')).toBeNull()
    expect(parseDate('2026-10-00')).toBeNull()
    expect(parseDate('abc')).toBeNull()
    expect(parseDate('')).toBeNull()
  })

  it('isValidDate 与 parseDate 同一口径', () => {
    expect(isValidDate('2026-10-20')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
  })
})

describe('daysUntil：按本地日历日算差', () => {
  const now = new Date(2026, 9, 16, 15, 30) // 2026-10-16 15:30

  it('今天 0、明天 1、昨天 -1', () => {
    expect(daysUntil('2026-10-16', now)).toBe(0)
    expect(daysUntil('2026-10-17', now)).toBe(1)
    expect(daysUntil('2026-10-15', now)).toBe(-1)
  })

  it('当天几点几分不影响结果（15:30 与 00:01 算出来一样）', () => {
    expect(daysUntil('2026-10-20', new Date(2026, 9, 16, 0, 1))).toBe(daysUntil('2026-10-20', new Date(2026, 9, 16, 23, 59)))
    expect(daysUntil('2026-10-20', now)).toBe(4)
  })

  it('跨月、跨年', () => {
    expect(daysUntil('2026-11-01', now)).toBe(16)
    expect(daysUntil('2027-01-01', new Date(2026, 11, 31, 8, 0))).toBe(1)
  })

  it('跨闰日（2028 是闰年）：2-28 到 3-01 是 2 天，平年只有 1 天', () => {
    expect(daysUntil('2028-03-01', new Date(2028, 1, 28, 12, 0))).toBe(2)
    expect(daysUntil('2026-03-01', new Date(2026, 1, 28, 12, 0))).toBe(1)
  })

  it('认不出日期返回 null —— 卡片显示"还没设日期"，不编数字', () => {
    expect(daysUntil('2026-02-30', now)).toBeNull()
    expect(daysUntil('', now)).toBeNull()
  })
})

describe('人话与日期标签', () => {
  it('countdownText 三段说法', () => {
    expect(countdownText(0)).toBe('就是今天')
    expect(countdownText(1)).toBe('还有 1 天')
    expect(countdownText(365)).toBe('还有 365 天')
    expect(countdownText(-3)).toBe('已过 3 天')
  })

  it('formatDateLabel：去补零、认不出原样返回', () => {
    expect(formatDateLabel('2026-10-20')).toBe('10 月 20 日')
    expect(formatDateLabel('2026-01-01')).toBe('1 月 1 日')
    expect(formatDateLabel('哪天来着')).toBe('哪天来着')
  })
})
