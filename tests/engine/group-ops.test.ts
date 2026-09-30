import { describe, expect, it } from 'vitest'
import { moveMany, removeMany } from '../../src/engine/ops'
import { collides } from '../../src/engine/geometry'
import type { Placement } from '../../src/engine/types'
import { doc } from '../fixtures'

const A: Placement = { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 }
const B: Placement = { id: 'sticky', variant: 'note', x: 4, y: 0, w: 2, h: 2 }
const C: Placement = { id: 'todo', variant: 'list', x: 8, y: 0, w: 3, h: 3 }

describe('moveMany 成组平移', () => {
  it('整组按同一偏移量移动，组内相对关系不变', () => {
    const next = moveMany(doc([A, B, C]), ['clock', 'sticky'], 1, 5)!
    const a = next.items.find((p) => p.id === 'clock')!
    const b = next.items.find((p) => p.id === 'sticky')!
    expect([a.x, a.y]).toEqual([1, 5])
    expect([b.x, b.y]).toEqual([5, 5])
  })

  it('组贴左边界时整组夹回，不出现负坐标', () => {
    const next = moveMany(doc([A, B, C]), ['clock', 'sticky'], -9, 0)!
    const moved = next.items.filter((p) => p.id === 'clock' || p.id === 'sticky')
    expect(Math.min(...moved.map((p) => p.x))).toBe(0)
    expect(moved.every((p) => p.x >= 0)).toBe(true)
  })

  it('组贴右边界时整组夹回，不越 12 列', () => {
    const next = moveMany(doc([A, B, C]), ['clock', 'sticky'], 99, 0)!
    const moved = next.items.filter((p) => p.id === 'clock' || p.id === 'sticky')
    expect(Math.max(...moved.map((p) => p.x + p.w))).toBeLessThanOrEqual(12)
  })

  it('组外有卡片挡路时整体向下让位，且不与组外重叠', () => {
    const blocker: Placement = { id: 'notes', variant: 'overview', x: 0, y: 4, w: 6, h: 3 }
    const next = moveMany(doc([A, B, blocker]), ['clock', 'sticky'], 0, 4)!
    const group = next.items.filter((p) => p.id === 'clock' || p.id === 'sticky')
    expect(group.every((g) => !collides(g, blocker))).toBe(true)
    expect(Math.min(...group.map((g) => g.y))).toBeGreaterThan(3)
  })

  it('组内有锁定项则整组拒绝', () => {
    expect(moveMany(doc([{ ...A, locked: true }, B]), ['clock', 'sticky'], 1, 0)).toBeNull()
  })

  it('空选择返回 null', () => {
    expect(moveMany(doc([A]), [], 1, 1)).toBeNull()
  })
})

describe('removeMany', () => {
  it('批量移除；一个都没命中时返回 null', () => {
    expect(removeMany(doc([A, B, C]), ['clock', 'todo'])!.items.map((p) => p.id)).toEqual(['sticky'])
    expect(removeMany(doc([A]), ['nope'])).toBeNull()
  })
})
