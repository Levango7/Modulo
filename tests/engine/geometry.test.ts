import { describe, expect, it } from 'vitest'
import { anyCollides, clamp, collides, maxRow } from '@levango7/engine/geometry'

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

describe('collides', () => {
  it('判定相交', () => {
    expect(collides(r(0, 0, 2, 2), r(1, 1, 2, 2))).toBe(true)
  })
  it('边贴边不算相交', () => {
    expect(collides(r(0, 0, 2, 2), r(2, 0, 2, 2))).toBe(false)
    expect(collides(r(0, 0, 2, 2), r(0, 2, 2, 2))).toBe(false)
  })
  it('完全包含算相交', () => {
    expect(collides(r(0, 0, 6, 6), r(2, 2, 1, 1))).toBe(true)
  })
  it('anyCollides 空列表恒 false', () => {
    expect(anyCollides([], r(0, 0, 1, 1))).toBe(false)
  })
})

describe('maxRow', () => {
  it('取最下沿；空列表为 0', () => {
    expect(maxRow([r(0, 0, 1, 2), r(0, 5, 1, 4)])).toBe(9)
    expect(maxRow([])).toBe(0)
  })
})

describe('clamp', () => {
  it('夹在区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
})
