import { describe, expect, it } from 'vitest'
import * as E from '../../src/engine'
import type { ModuleRegistry, Placement } from '../../src/engine/types'

const REG: ModuleRegistry = ['a', 'b', 'c'].map((id) => ({
  id,
  title: id.toUpperCase(),
  defaultVariant: 'v',
  variants: [{ id: 'v', name: 'v', minW: 1, minH: 1, idealW: 4, idealH: 2 }],
}))

const at = (id: string, x: number, y: number, w: number, h: number, extra: Partial<Placement> = {}): Placement => ({
  id,
  variant: 'v',
  x,
  y,
  w,
  h,
  ...extra,
})
const d = (items: Placement[]): E.LayoutDoc => ({ schemaVersion: 1, cols: 12, items })
const get = (doc: E.LayoutDoc, id: string) => doc.items.find((p) => p.id === id)!

describe('fillRows 撑满', () => {
  it('一个行带里的卡片按原比例铺满整行', () => {
    const out = E.fillRows(d([at('a', 0, 0, 4, 2), at('b', 8, 0, 4, 2)]))
    expect(get(out, 'a')).toMatchObject({ x: 0, w: 6 })
    expect(get(out, 'b')).toMatchObject({ x: 6, w: 6 })
  })

  it('只变宽不变窄，形态最小尺寸天然继续成立', () => {
    const out = E.fillRows(d([at('a', 0, 0, 2, 2), at('b', 9, 0, 3, 2)]))
    for (const id of ['a', 'b']) {
      expect(get(out, id).w).toBeGreaterThanOrEqual(id === 'a' ? 2 : 3)
    }
    expect(get(out, 'a').w + get(out, 'b').w).toBe(12)
  })

  it('含锁定项的行带完全不动', () => {
    const src = d([at('a', 0, 0, 2, 2, { locked: true }), at('b', 9, 0, 3, 2)])
    expect(E.fillRows(src).items).toEqual(src.items)
  })

  it('已经铺满的行带不再处理', () => {
    const src = d([at('a', 0, 0, 6, 2), at('b', 6, 0, 6, 2)])
    expect(E.fillRows(src).items).toEqual(src.items)
  })

  it('不同行带各自独立撑满', () => {
    const out = E.fillRows(d([at('a', 0, 0, 3, 2), at('b', 6, 0, 3, 2), at('c', 0, 4, 4, 2)]))
    expect(get(out, 'a').w + get(out, 'b').w).toBe(12)
    expect(get(out, 'c').w).toBe(12)
  })
})

describe('spreadLayout 性质', () => {
  function lcg(seed: number) {
    let s = seed % 2147483647
    if (s <= 0) s += 2147483646
    return () => (s = (s * 16807) % 2147483647) / 2147483646
  }

  it('输出无重叠、不越界、卡片不减宽，且幂等', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = lcg(seed)
      let doc = E.emptyDoc()
      for (const m of REG) {
        doc = E.addItem(doc, REG, m.id, Math.floor(rnd() * 12), Math.floor(rnd() * 8)) ?? doc
      }
      const once = E.spreadLayout(doc)
      for (const p of once.items) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x + p.w).toBeLessThanOrEqual(12)
        expect(p.w).toBeGreaterThanOrEqual(get(doc, p.id).w)
      }
      for (let i = 0; i < once.items.length; i++) {
        for (let j = i + 1; j < once.items.length; j++) {
          expect(E.collides(once.items[i], once.items[j])).toBe(false)
        }
      }
      expect(E.spreadLayout(once).items).toEqual(once.items)
    }
  })

  it('撑满后行带覆盖宽度不低于撑满前', () => {
    const sparse = d([at('a', 4, 5, 2, 2), at('b', 9, 12, 3, 2), at('c', 0, 20, 4, 3)])
    const out = E.spreadLayout(sparse)
    const widest = (doc: E.LayoutDoc) => Math.max(...doc.items.map((p) => p.x + p.w))
    expect(widest(out)).toBe(12)
  })
})
