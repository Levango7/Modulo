import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { addItem, resizeItem, setVariant } from '@levango7/engine/ops'
import { collides } from '@levango7/engine/geometry'
import { project } from '@levango7/engine/projection'
import { LOGICAL_COLS } from '@levango7/engine/types'
import type { LayoutDoc } from '@levango7/engine/types'
import { REGISTRY } from '../fixtures'

/** 确定性 PRNG：失败时可凭 seed 复现 */
function lcg(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function buildDoc(seed: number): LayoutDoc {
  const rnd = lcg(seed)
  let d: LayoutDoc = { schemaVersion: 1, cols: LOGICAL_COLS, items: [] }
  const count = 1 + Math.floor(rnd() * REGISTRY.length)
  for (let i = 0; i < count; i++) {
    const mod = REGISTRY[Math.floor(rnd() * REGISTRY.length)]
    const v = mod.variants[Math.floor(rnd() * mod.variants.length)]
    d = addItem(d, REGISTRY, mod.id, Math.floor(rnd() * 12), Math.floor(rnd() * 10), v.id) ?? d
  }
  for (let i = 0; i < 6; i++) {
    const p = d.items[Math.floor(rnd() * d.items.length)]
    if (!p) continue
    const next = resizeItem(d, REGISTRY, p.id, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 8))
    if (next) d = next
    const mod = REGISTRY.find((m) => m.id === p.id)!
    d = setVariant(d, REGISTRY, p.id, mod.variants[Math.floor(rnd() * mod.variants.length)].id) ?? d
  }
  return d
}

const COLS = [12, 8, 6, 4, 3, 2, 1]

describe('投影不变量（property）', () => {
  it('I1 只读：投影不回写逻辑坐标', () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: COLS.length - 1 }), (seed, ci) => {
        const d = buildDoc(seed)
        const snapshot = JSON.stringify(d)
        project(d, REGISTRY, COLS[ci])
        expect(JSON.stringify(d)).toBe(snapshot)
      }),
      { numRuns: 200 },
    ))

  it('I2 幂等：同输入同结果', () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: COLS.length - 1 }), (seed, ci) => {
        const d = buildDoc(seed)
        expect(project(d, REGISTRY, COLS[ci])).toEqual(project(d, REGISTRY, COLS[ci]))
      }),
      { numRuns: 200 },
    ))

  it('I3 无重叠：输出矩形两两不相交', () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: COLS.length - 1 }), (seed, ci) => {
        const { rects } = project(buildDoc(seed), REGISTRY, COLS[ci])
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            expect(collides(rects[i], rects[j])).toBe(false)
          }
        }
      }),
      { numRuns: 200 },
    ))

  it('I4 尺寸充分：输出矩形的逻辑等效宽度/高度都 ≥ 生效形态的 min', () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: COLS.length - 1 }), (seed, ci) => {
        const n = COLS[ci]
        const s = LOGICAL_COLS / n
        const { rects } = project(buildDoc(seed), REGISTRY, n)
        for (const r of rects) {
          const v = REGISTRY.find((m) => m.id === r.id)!.variants.find((x) => x.id === r.variant)!
          expect(Math.round(r.w * s)).toBeGreaterThanOrEqual(v.minW)
          expect(r.h).toBeGreaterThanOrEqual(v.minH)
          expect(r.w).toBeGreaterThanOrEqual(1)
          expect(r.x + r.w).toBeLessThanOrEqual(n)
        }
      }),
      { numRuns: 200 },
    ))

  it('分区完整：每张卡要么可见要么被收起，不重复不丢失', () =>
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: COLS.length - 1 }), (seed, ci) => {
        const d = buildDoc(seed)
        const { rects, collapsed } = project(d, REGISTRY, COLS[ci])
        const ids = [...rects.map((r) => r.id), ...collapsed.map((c) => c.id)]
        expect(ids).toHaveLength(d.items.length)
        expect(new Set(ids).size).toBe(d.items.length)
      }),
      { numRuns: 200 },
    ))
})
