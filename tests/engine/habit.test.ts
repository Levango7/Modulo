import { describe, expect, it } from 'vitest'
import { lastNDays, streakDays } from '@modulo/engine/habit'

const now = new Date(2026, 9, 16, 12) // 2026-10-16（周五）中午

describe('lastNDays：最近 7 天的打卡位', () => {
  it('旧 → 新，最后一天是今天', () => {
    const week = lastNDays(['2026-10-16', '2026-10-14'], now)
    expect(week).toHaveLength(7)
    expect(week[6]).toEqual({ date: '2026-10-16', done: true })
    expect(week[4]).toEqual({ date: '2026-10-14', done: true })
    expect(week[0].done).toBe(false)
  })

  it('空记录也给出完整一周的 false 位（界面画格子用）', () => {
    const week = lastNDays([], now)
    expect(week).toHaveLength(7)
    expect(week.every((x) => !x.done)).toBe(true)
  })
})

describe('streakDays：锚点取"今天或昨天"里更晚的那个', () => {
  it('今天打了：从今天往前数', () => {
    const days = ['2026-10-16', '2026-10-15', '2026-10-14']
    expect(streakDays(days, now)).toBe(3)
  })

  it('今天还没打：从昨天往前数 —— 已过午夜没打卡不该把纪录归零', () => {
    const days = ['2026-10-15', '2026-10-14', '2026-10-13']
    expect(streakDays(days, now)).toBe(3)
  })

  it('中间断一天：只数后面那段', () => {
    const days = ['2026-10-16', '2026-10-15', '2026-10-13', '2026-10-12']
    expect(streakDays(days, now)).toBe(2)
  })

  it('完全没有记录：0（不是负数、不是异常）', () => {
    expect(streakDays([], now)).toBe(0)
  })

  it('断得太久（昨天也没打）：归零', () => {
    const days = ['2026-10-01', '2026-10-02']
    expect(streakDays(days, now)).toBe(0)
  })

  it('乱序输入也要算对（用户补打卡会把旧日期插进去）', () => {
    const days = ['2026-10-14', '2026-10-16', '2026-10-15']
    expect(streakDays(days, now)).toBe(3)
  })
})
