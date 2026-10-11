import { describe, expect, it } from 'vitest'
import { barSlots, linePoints, scaleSeries } from '../../packages/engine/src/chart'

describe('scaleSeries：归一化', () => {
  it('空表与全 0：max 为 0、fracs 全 0（调用方据 max===0 显示「还没数据」）', () => {
    expect(scaleSeries([])).toEqual({ max: 0, fracs: [] })
    expect(scaleSeries([0, 0, 0])).toEqual({ max: 0, fracs: [0, 0, 0] })
  })
  it('按最大值归一，保留 3 位小数', () => {
    expect(scaleSeries([5, 0, 10])).toEqual({ max: 10, fracs: [0.5, 0, 1] })
    expect(scaleSeries([1, 3])).toEqual({ max: 3, fracs: [0.333, 1] })
  })
  it('负数与非有限值按 0 计（防御性夹逼，不抛错）', () => {
    expect(scaleSeries([-5, 5])).toEqual({ max: 5, fracs: [0, 1] })
    expect(scaleSeries([Number.NaN, 4])).toEqual({ max: 4, fracs: [0, 1] })
  })
})

describe('linePoints：折线坐标', () => {
  it('空表给空串；单点给视口中央', () => {
    expect(linePoints([])).toBe('')
    expect(linePoints([0.5])).toBe('50,50')
  })
  it('x 均分、y 反转（值越大越靠上），端点落在留白边界', () => {
    expect(linePoints([1, 0])).toBe('0,6 100,94')
    expect(linePoints([0, 0.5, 1])).toBe('0,94 50,50 100,6')
  })
  it('所有坐标都在 0..100 视口内，点数与输入一致', () => {
    const fracs = Array.from({ length: 30 }, (_, i) => (i % 7) / 7)
    const pts = linePoints(fracs).split(' ').map((p) => p.split(',').map(Number))
    expect(pts).toHaveLength(30)
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(100)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(100)
    }
  })
})

describe('barSlots：柱状槽位', () => {
  it('0 根给空表；1 根居中', () => {
    expect(barSlots(0)).toEqual([])
    expect(barSlots(1)).toEqual([{ x: 14, w: 72 }])
  })
  it('槽位不重叠、不出视口、数量与输入一致', () => {
    for (const n of [2, 7, 30, 62]) {
      const slots = barSlots(n)
      expect(slots).toHaveLength(n)
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x + s.w).toBeLessThanOrEqual(100)
        if (i > 0) expect(s.x).toBeGreaterThanOrEqual(slots[i - 1].x + slots[i - 1].w)
      }
    }
  })
  it('非法数量按 0 处理（防御，不抛）', () => {
    expect(barSlots(Number.NaN)).toEqual([])
    expect(barSlots(-3)).toEqual([])
  })
})
