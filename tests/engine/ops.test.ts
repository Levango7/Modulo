import { describe, expect, it } from 'vitest'
import {
  addItem,
  clearLayout,
  moveItem,
  removeItem,
  resizeItem,
  setItemTitle,
  setVariant,
  toggleLock,
} from '@levango7/engine/ops'
import { emptyDoc } from '@levango7/engine/types'
import { REGISTRY, doc } from '../fixtures'

const clockAt = (x: number, y: number, w = 4, h = 3) => ({ id: 'clock', variant: 'big', x, y, w, h })

describe('addItem', () => {
  it('按所选形态推荐尺寸落位', () => {
    const next = addItem(emptyDoc(), REGISTRY, 'clock', 0, 0)
    expect(next?.items).toEqual([{ id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 }])
  })
  it('同一模块只能放一份', () => {
    const once = addItem(emptyDoc(), REGISTRY, 'clock', 0, 0)!
    expect(addItem(once, REGISTRY, 'clock', 6, 0)).toBeNull()
  })
  it('未知模块返回 null', () => {
    expect(addItem(emptyDoc(), REGISTRY, 'nope', 0, 0)).toBeNull()
  })
  it('目标被占时向下找空位而不是弹回或失败', () => {
    const first = addItem(emptyDoc(), REGISTRY, 'clock', 0, 0)!
    const second = addItem(first, REGISTRY, 'sticky', 0, 0)!
    expect(second.items[1]).toMatchObject({ id: 'sticky', x: 0, y: 3, w: 2, h: 2 })
  })
  it('不改动入参 doc', () => {
    const before = emptyDoc()
    addItem(before, REGISTRY, 'clock', 0, 0)
    expect(before.items).toHaveLength(0)
  })
})

describe('moveItem', () => {
  it('空格直接移动', () => {
    const d = doc([clockAt(0, 0), { id: 'sticky', variant: 'note', x: 0, y: 3, w: 2, h: 2 }])
    const next = moveItem(d, 'sticky', 10, 0)!
    expect(next.items[1]).toMatchObject({ x: 10, y: 0 })
  })
  it('目标被占时找最近空位，不弹回原位', () => {
    const d = doc([clockAt(0, 0), { id: 'sticky', variant: 'note', x: 8, y: 8, w: 2, h: 2 }])
    const next = moveItem(d, 'sticky', 0, 0)!
    expect(next.items[1].x).toBe(0)
    expect(next.items[1].y).toBeGreaterThan(2)
  })
  it('右边界向内收缩', () => {
    const d = doc([{ id: 'sticky', variant: 'note', x: 0, y: 0, w: 2, h: 2 }])
    expect(moveItem(d, 'sticky', 99, 0)!.items[0].x).toBe(10)
  })
  it('锁定项拒绝移动', () => {
    const d = doc([{ ...clockAt(0, 0), locked: true }])
    expect(moveItem(d, 'clock', 5, 5)).toBeNull()
  })
})

describe('resizeItem', () => {
  it('钳制到形态最小尺寸', () => {
    const d = doc([clockAt(0, 0)])
    const next = resizeItem(d, REGISTRY, 'clock', 1, 1)!
    expect(next.items[0]).toMatchObject({ w: 3, h: 3 })
  })
  it('撞邻居时拒绝（返回 null 让交互层回退）', () => {
    const d = doc([clockAt(0, 0), { id: 'sticky', variant: 'note', x: 4, y: 0, w: 2, h: 2 }])
    expect(resizeItem(d, REGISTRY, 'clock', 6, 3)).toBeNull()
  })
  it('贴右边界时先定宽再向左收缩 x，宽度不被压缩', () => {
    const d = doc([{ id: 'sticky', variant: 'note', x: 10, y: 0, w: 2, h: 2 }])
    const next = resizeItem(d, REGISTRY, 'sticky', 6, 2)!
    expect(next.items[0]).toMatchObject({ x: 6, w: 6 })
  })
  it('锁定项拒绝缩放', () => {
    const d = doc([{ ...clockAt(0, 0), locked: true }])
    expect(resizeItem(d, REGISTRY, 'clock', 6, 6)).toBeNull()
  })
})

describe('setVariant', () => {
  it('格子小于新形态最小尺寸时自动补足', () => {
    const d = doc([{ id: 'clock', variant: 'minimal', x: 0, y: 0, w: 2, h: 1 }])
    const next = setVariant(d, REGISTRY, 'clock', 'big')!
    expect(next.items[0]).toMatchObject({ variant: 'big', w: 3, h: 3 })
  })
  it('未知形态返回 null', () => {
    expect(setVariant(doc([clockAt(0, 0)]), REGISTRY, 'clock', 'nope')).toBeNull()
  })
})

describe('setItemTitle / toggleLock / remove / clear', () => {
  it('标题 trim 后为空视为回落默认', () => {
    const d = doc([clockAt(0, 0)])
    expect(setItemTitle(d, 'clock', '   ')!.items[0].title).toBeUndefined()
    expect(setItemTitle(d, 'clock', '  我的时钟  ')!.items[0].title).toBe('我的时钟')
  })
  it('超长标题截断到 TITLE_MAX', () => {
    const d = doc([clockAt(0, 0)])
    expect(setItemTitle(d, 'clock', 'x'.repeat(40))!.items[0].title).toHaveLength(24)
  })
  it('hideTitle 三态：null 清回跟随默认', () => {
    const d = doc([clockAt(0, 0)])
    const hidden = setItemTitle(d, 'clock', null, true)!
    expect(hidden.items[0].hideTitle).toBe(true)
    expect(setItemTitle(hidden, 'clock', null, null)!.items[0].hideTitle).toBeUndefined()
  })
  it('锁定可来回切换', () => {
    const d = doc([clockAt(0, 0)])
    const locked = toggleLock(d, 'clock')!
    expect(locked.items[0].locked).toBe(true)
    expect(toggleLock(locked, 'clock')!.items[0].locked).toBe(false)
  })
  it('移除与清空', () => {
    const d = doc([clockAt(0, 0)])
    expect(removeItem(d, 'clock')!.items).toHaveLength(0)
    expect(removeItem(d, 'nope')).toBeNull()
    expect(clearLayout(d).items).toHaveLength(0)
  })
})
