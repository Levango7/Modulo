import { describe, expect, it } from 'vitest'
import * as E from '../../src/engine'
import type { ModuleRegistry, Placement } from '../../src/engine/types'

const REG: ModuleRegistry = [
  { id: 'a', title: 'A', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 1, minH: 1, idealW: 2, idealH: 2 }] },
  { id: 'b', title: 'B', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 1, minH: 1, idealW: 3, idealH: 2 }] },
  { id: 'c', title: 'C', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 1, minH: 1, idealW: 4, idealH: 3 }] },
]

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
const pos = (doc: E.LayoutDoc, id: string) => {
  const p = doc.items.find((q) => q.id === id)!
  return [p.x, p.y]
}

describe('tidyLayout 按需整理', () => {
  it('左聚拢消除同一行带里的水平空洞', () => {
    const out = E.tidyLayout(d([at('a', 0, 0, 2, 2), at('b', 8, 0, 3, 2)]))
    expect(pos(out, 'a')).toEqual([0, 0])
    expect(pos(out, 'b')).toEqual([2, 0])
  })

  it('上聚拢消除卡片上方的空行', () => {
    const out = E.tidyLayout(d([at('a', 0, 6, 2, 2)]))
    expect(pos(out, 'a')).toEqual([0, 0])
  })

  it('锁定项一动不动，其余卡片绕开它重新落位', () => {
    const out = E.tidyLayout(
      d([at('a', 0, 0, 2, 2, { locked: true }), at('b', 0, 4, 12, 1), at('c', 6, 6, 4, 3)]),
    )
    expect(pos(out, 'a')).toEqual([0, 0])
    // b 通栏被抬到 a 下方第一行可用处，且不得与 a 重叠
    expect(out.items.find((p) => p.id === 'b')!.y).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < out.items.length; i++) {
      for (let j = i + 1; j < out.items.length; j++) {
        expect(E.collides(out.items[i], out.items[j])).toBe(false)
      }
    }
  })

  it('幂等：整理两次与整理一次结果相同', () => {
    const once = E.tidyLayout(d([at('a', 5, 3, 2, 2), at('b', 0, 8, 3, 2), at('c', 9, 0, 4, 3)]))
    expect(E.tidyLayout(once).items).toEqual(once.items)
  })

  it('聚拢把版面高度压到内容实际需要的行数，空洞率随之下降', () => {
    const sparse = d([at('a', 4, 5, 2, 2), at('b', 9, 12, 3, 2), at('c', 0, 20, 4, 3)])
    expect(E.usedRows(sparse)).toBe(23)
    const out = E.tidyLayout(sparse)
    /** 三张卡合计宽 9 ≤ 12，重力把它们全塞进第一行带：23 行压到 3 行，空洞率 0.92 → 0.39 */
    expect(E.usedRows(out)).toBe(3)
    expect(E.holeRatio(out)).toBeLessThan(E.holeRatio(sparse))
  })

  it('空版面直接返回原引用', () => {
    const empty = d([])
    expect(E.tidyLayout(empty)).toBe(empty)
  })
})

describe('tidyLayout 随机版面性质', () => {
  function lcg(seed: number) {
    let s = seed % 2147483647
    if (s <= 0) s += 2147483646
    return () => (s = (s * 16807) % 2147483647) / 2147483647
  }

  it('任意输入都不产生重叠、不越列界、不出现负坐标', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = lcg(seed)
      let doc = E.emptyDoc()
      for (const m of REG) {
        doc = E.addItem(doc, REG, m.id, Math.floor(rnd() * 12), Math.floor(rnd() * 10)) ?? doc
      }
      if (rnd() > 0.5 && doc.items.length) {
        doc = E.toggleLock(doc, doc.items[0].id) ?? doc
      }
      const out = E.tidyLayout(doc)
      expect(out.items).toHaveLength(doc.items.length)
      for (const p of out.items) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.x + p.w).toBeLessThanOrEqual(12)
      }
      for (let i = 0; i < out.items.length; i++) {
        for (let j = i + 1; j < out.items.length; j++) {
          expect(E.collides(out.items[i], out.items[j])).toBe(false)
        }
      }
      const locked = doc.items.filter((p) => p.locked).map((p) => `${p.id}@${p.x},${p.y}`)
      const stillLocked = out.items.filter((p) => p.locked).map((p) => `${p.id}@${p.x},${p.y}`)
      expect(stillLocked).toEqual(locked)
    }
  })

  it('整理永远不会让版面变高', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed)
      let doc = E.emptyDoc()
      for (const m of REG) {
        doc = E.addItem(doc, REG, m.id, Math.floor(rnd() * 12), Math.floor(rnd() * 10)) ?? doc
      }
      doc = E.resizeItem(doc, REG, 'c', 1 + Math.floor(rnd() * 8), 1 + Math.floor(rnd() * 4)) ?? doc
      expect(E.usedRows(E.tidyLayout(doc))).toBeLessThanOrEqual(E.usedRows(doc))
    }
  })
})
