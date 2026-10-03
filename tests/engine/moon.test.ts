import { describe, expect, it } from 'vitest'
import { SYNODIC_MONTH_DAYS, daysToFullMoon, moonPhase, moonPhaseName } from '@modulo/engine/moon'

/** 锚点：2000-01-06 18:14 UTC（已知新月）—— 按定义它必须是相位 0/1 与"新月" */
const ANCHOR = new Date(Date.UTC(2000, 0, 6, 18, 14))
const DAY = 86_400_000

describe('moonPhase：朔望月口径', () => {
  it('锚点 = 新月（相位 0/1、照亮 0）', () => {
    const m = moonPhase(ANCHOR)
    expect(Math.min(m.phase, 1 - m.phase)).toBeLessThan(1e-6)
    expect(m.name).toBe('新月')
    expect(m.illum).toBeCloseTo(0, 6)
  })

  it('半个朔望月后 = 满月（照亮 1）', () => {
    const half = new Date(ANCHOR.getTime() + (SYNODIC_MONTH_DAYS / 2) * DAY)
    const m = moonPhase(half)
    expect(m.phase).toBeCloseTo(0.5, 6)
    expect(m.name).toBe('满月')
    expect(m.illum).toBeCloseTo(1, 6)
  })

  it('1/4 与 3/4：上弦 / 下弦（照亮都是 0.5，看相位分先后）', () => {
    const q1 = moonPhase(new Date(ANCHOR.getTime() + (SYNODIC_MONTH_DAYS / 4) * DAY))
    const q3 = moonPhase(new Date(ANCHOR.getTime() + ((3 * SYNODIC_MONTH_DAYS) / 4) * DAY))
    expect(q1.name).toBe('上弦月')
    expect(q3.name).toBe('下弦月')
    expect(q1.illum).toBeCloseTo(0.5, 3)
    expect(q3.illum).toBeCloseTo(0.5, 3)
  })

  it('每天前进 1/29.53 个周期（相位单调走，不跳）', () => {
    const a = moonPhase(new Date(ANCHOR.getTime() + 3 * DAY)).phase
    const b = moonPhase(new Date(ANCHOR.getTime() + 4 * DAY)).phase
    expect(b - a).toBeCloseTo(1 / SYNODIC_MONTH_DAYS, 6)
  })

  it('周期边界连续：锚点前后一天跨过整 1 时应回到接近 0/1', () => {
    const before = moonPhase(new Date(ANCHOR.getTime() - DAY)).phase
    expect(before).toBeCloseTo(1 - 1 / SYNODIC_MONTH_DAYS, 6)
  })

  it('锚点之前的时间也算得对（相位始终在 0–1）', () => {
    const m = moonPhase(new Date(Date.UTC(1999, 0, 1)))
    expect(m.phase).toBeGreaterThanOrEqual(0)
    expect(m.phase).toBeLessThan(1)
  })
})

describe('moonPhaseName：八相划分的边界', () => {
  it('每一相的中心值', () => {
    expect(moonPhaseName(0)).toBe('新月')
    expect(moonPhaseName(0.125)).toBe('娥眉月')
    expect(moonPhaseName(0.25)).toBe('上弦月')
    expect(moonPhaseName(0.375)).toBe('盈凸月')
    expect(moonPhaseName(0.5)).toBe('满月')
    expect(moonPhaseName(0.625)).toBe('亏凸月')
    expect(moonPhaseName(0.75)).toBe('下弦月')
    expect(moonPhaseName(0.875)).toBe('残月')
  })

  it('边界归上一相；超出 0–1 的输入先取模（坏输入不炸）', () => {
    expect(moonPhaseName(0.999)).toBe('新月')
    expect(moonPhaseName(1.5)).toBe('满月')
    expect(moonPhaseName(-0.25)).toBe('下弦月')
  })
})

describe('daysToFullMoon：给卡片那句"≈ 满月还有 N 天"', () => {
  it('新月时约 14.8 天；满月时约 0（或下一个周期）', () => {
    expect(daysToFullMoon(ANCHOR)).toBeCloseTo(14.77, 1)
    const full = new Date(ANCHOR.getTime() + (SYNODIC_MONTH_DAYS / 2) * DAY)
    expect(daysToFullMoon(full)).toBeCloseTo(0, 6)
  })

  it('永远落在 0 到一整个朔望月之间（刚过满月时"下一次满月"是 ~29.5 天后，不是 0）', () => {
    for (let d = 0; d < 40; d++) {
      const v = daysToFullMoon(new Date(ANCHOR.getTime() + d * DAY))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(SYNODIC_MONTH_DAYS + 1e-9)
    }
    // 满月刚过：下一次满月约一个朔望月之后（这条是上面那个公式的分支边界，值得钉住）
    const justAfter = new Date(ANCHOR.getTime() + (SYNODIC_MONTH_DAYS / 2 + 0.2) * DAY)
    expect(daysToFullMoon(justAfter)).toBeGreaterThan(SYNODIC_MONTH_DAYS - 1)
  })
})
