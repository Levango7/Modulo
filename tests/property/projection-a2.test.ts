import { describe, expect, it } from 'vitest'
import * as E from '../../src/engine'
import type { ModuleRegistry, Rect } from '../../src/engine/types'

/* ---- A2 方案实现：只活在这个对照实验里，产品层不引（结论见 docs/ARCHITECTURE.md §3.4） ---- */
function columnBoundaries(cols: number, logical = 12): number[] {
  const n = Math.max(1, Math.min(cols, logical))
  const b: number[] = []
  for (let j = 0; j <= n; j++) b.push(Math.round((j * logical) / n))
  b[n] = logical
  return b
}
function bandOf(b: number[], logicalCol: number): number {
  for (let j = 0; j < b.length - 1; j++) if (logicalCol >= b[j] && logicalCol < b[j + 1]) return j
  return b.length - 2
}
function weightedLogicalRange(rect: Rect, cols: number): [number, number] {
  const b = columnBoundaries(cols)
  return [b[rect.x] ?? 0, b[Math.min(rect.x + rect.w, b.length - 1)] ?? 12]
}
function projectWeighted(items: Rect[], cols: number): Rect[] {
  const placed: Rect[] = []
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const start = bandOf(columnBoundaries(cols), Math.max(0, Math.min(11, it.x)))
    const end = bandOf(columnBoundaries(cols), Math.max(0, Math.min(11, it.x + it.w - 1)))
    const r = { x: start, y: it.y, w: Math.max(1, end - start + 1), h: it.h }
    placed.push(E.anyCollides(placed, r) ? E.findFreeSpot(placed, r.w, r.h, r.x, r.y, cols) : r)
  }
  return placed
}
/* ---- 实验实现到此为止 ---- */

/**
 * A1（等分物理列 + ceil 取整 + 让位）vs A2（加权列带 + 让位）对照实验。
 * 两个指标都在「逻辑格」口径下算，因此与物理列数无关、可直接互比：
 *  - inflation：投影后覆盖的逻辑格总面积 / 原始逻辑格面积（>1 = 卡片被撑宽）
 *  - holeRatio：版面使用行带内未被任何卡片覆盖的逻辑格占比（越大 = 中间开洞越多）
 *  - displaced ：因让位而改变 y 的卡片数（越大 = 版面被推得越乱）
 */
const REG: ModuleRegistry = [
  { id: 'a', title: 'A', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 1, idealW: 4, idealH: 3 }] },
  { id: 'b', title: 'B', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 1, idealW: 2, idealH: 3 }] },
  { id: 'c', title: 'C', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 1, idealW: 3, idealH: 2 }] },
  { id: 'd', title: 'D', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 1, idealW: 12, idealH: 2 }] },
]

function lcg(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function randomLayout(seed: number): E.LayoutDoc {
  const rnd = lcg(seed)
  let d = E.emptyDoc()
  for (let i = 0; i < 4; i++) {
    const ids = ['a', 'b', 'c', 'd']
    d = E.addItem(d, REG, ids[i], Math.floor(rnd() * 12), Math.floor(rnd() * 8)) ?? d
  }
  for (let i = 0; i < 4; i++) {
    const p = d.items[i]
    if (!p) continue
    d = E.resizeItem(d, REG, p.id, 2 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 4)) ?? d
  }
  return d
}

function coverage(rects: Rect[], cols: number, weighted: boolean): { covered: number; maxRow: number } {
  const rows = new Map<number, Set<number>>()
  let maxRow = 0
  for (const r of rects) {
    const [from, to] = weighted ? weightedLogicalRange(r, cols) : [r.x * (12 / cols), (r.x + r.w) * (12 / cols)]
    const lo = Math.floor(from)
    const hi = Math.min(12, Math.ceil(to))
    for (let y = r.y; y < r.y + r.h; y++) {
      maxRow = Math.max(maxRow, y + 1)
      const set = rows.get(y) ?? new Set<number>()
      for (let x = lo; x < hi; x++) set.add(x)
      rows.set(y, set)
    }
  }
  let covered = 0
  for (const set of rows.values()) covered += set.size
  return { covered, maxRow }
}

function metrics(seed: number, cols: number) {
  const doc = randomLayout(seed)
  const original = doc.items.reduce((s, p) => s + p.w * p.h, 0) || 1
  const a1 = E.project(doc, REG, cols).rects
  const a2 = projectWeighted(doc.items, cols)
  /** A1 每物理列等分容器 = 12/N 逻辑列；A2 每列按其列带宽度 */
  const spanA1 = (rects: Rect[]) => rects.reduce((s, r) => s + (r.w * 12) / cols * r.h, 0)
  const spanA2 = (rects: Rect[]) =>
    rects.reduce((s, r) => {
      const [from, to] = weightedLogicalRange(r, cols)
      return s + (to - from) * r.h
    }, 0)
  const displaced = (rects: Rect[]) => rects.filter((r) => !doc.items.some((p) => p.x === r.x && p.y === r.y)).length
  const hole = (c: { covered: number; maxRow: number }) => (c.maxRow ? 1 - c.covered / (c.maxRow * 12) : 0)
  return {
    a1: { inflation: spanA1(a1) / original, hole: hole(coverage(a1, cols, false)), displaced: displaced(a1) },
    a2: { inflation: spanA2(a2) / original, hole: hole(coverage(a2, cols, true)), displaced: displaced(a2) },
  }
}

const COLS = [12, 8, 6, 4, 3, 2]

describe('A1 vs A2 投影对照实验', () => {
  it('两种方案都不得产生重叠', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const cols of COLS) {
        const doc = randomLayout(seed)
        const rects = projectWeighted(doc.items, cols)
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) expect(E.collides(rects[i], rects[j])).toBe(false)
        }
      }
    }
  })

  it('打印两方案的量化对比（决策依据，见 docs/ARCHITECTURE.md §3.4）', () => {
    const rows: string[] = []
    const acc = { a1h: 0, a2h: 0, a1i: 0, a2i: 0, a1d: 0, a2d: 0, n: 0 }
    for (const cols of COLS) {
      let a1h = 0
      let a2h = 0
      let a1i = 0
      let a2i = 0
      let a1d = 0
      let a2d = 0
      for (let seed = 1; seed <= 60; seed++) {
        const m = metrics(seed, cols)
        a1h += m.a1.hole
        a2h += m.a2.hole
        a1i += m.a1.inflation
        a2i += m.a2.inflation
        a1d += m.a1.displaced
        a2d += m.a2.displaced
      }
      const k = 60
      rows.push(
        `N=${String(cols).padEnd(2)} 空洞率 A1=${(a1h / k).toFixed(3)} A2=${(a2h / k).toFixed(3)} | 撑宽比 A1=${(a1i / k).toFixed(2)} A2=${(a2i / k).toFixed(2)} | 位移 A1=${(a1d / k).toFixed(2)} A2=${(a2d / k).toFixed(2)}`,
      )
      acc.a1h += a1h / k
      acc.a2h += a2h / k
      acc.a1i += a1i / k
      acc.a2i += a2i / k
      acc.a1d += a1d / k
      acc.a2d += a2d / k
      acc.n += 1
    }
    rows.push(
      `平均     空洞率 A1=${(acc.a1h / acc.n).toFixed(3)} A2=${(acc.a2h / acc.n).toFixed(3)} | 撑宽比 A1=${(acc.a1i / acc.n).toFixed(2)} A2=${(acc.a2i / acc.n).toFixed(2)} | 位移 A1=${(acc.a1d / acc.n).toFixed(2)} A2=${(acc.a2d / acc.n).toFixed(2)}`,
    )
    console.log('\n' + rows.join('\n'))
    expect(rows.length).toBeGreaterThan(0)
  })
})
