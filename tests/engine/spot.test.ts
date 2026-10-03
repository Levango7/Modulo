import { describe, expect, it } from 'vitest'
import { anyCollides } from '@modulo/engine/geometry'
import { findFreeSpot } from '@modulo/engine/spot'

describe('findFreeSpot', () => {
  it('空版面直接落位', () => {
    expect(findFreeSpot([], 2, 2, 3, 4)).toEqual({ x: 3, y: 4, w: 2, h: 2 })
  })

  it('目标被占时同列带向下找最近空位', () => {
    const obstacles = [{ x: 0, y: 0, w: 4, h: 3 }]
    const spot = findFreeSpot(obstacles, 2, 2, 0, 0)
    expect(spot.x).toBe(0)
    expect(spot.y).toBe(3)
    expect(anyCollides(obstacles, spot)).toBe(false)
  })

  it('x 超出右边界时向内收缩', () => {
    const spot = findFreeSpot([], 4, 2, 10, 0, 12)
    expect(spot.x).toBe(8)
  })

  it('整列带被填满时落到所有已放项之下（保证无碰撞）', () => {
    const obstacles = [
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 2, h: 1 },
      { x: 0, y: 2, w: 2, h: 1 },
    ]
    const spot = findFreeSpot(obstacles, 2, 1, 0, 0)
    expect(anyCollides(obstacles, spot)).toBe(false)
    expect(spot.y).toBeGreaterThanOrEqual(3)
  })

  it('负数 y 归零', () => {
    expect(findFreeSpot([], 2, 2, 0, -9).y).toBe(0)
  })
})
