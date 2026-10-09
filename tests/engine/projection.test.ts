import { describe, expect, it } from 'vitest'
import { collides } from '@levango7/engine/geometry'
import { project } from '@levango7/engine/projection'
import { LOGICAL_COLS } from '@levango7/engine/types'
import type { Placement } from '@levango7/engine/types'
import { REGISTRY, doc } from '../fixtures'

const items: Placement[] = [
  { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 },
  { id: 'sticky', variant: 'note', x: 0, y: 3, w: 2, h: 2 },
  { id: 'recent', variant: 'bar', x: 0, y: 12, w: 12, h: 3 },
]
const d = doc(items)

describe('project · I1 只读', () => {
  it('投影不改动输入 doc', () => {
    const snapshot = JSON.stringify(d)
    project(d, REGISTRY, 6)
    expect(JSON.stringify(d)).toBe(snapshot)
  })
})

describe('project · I2 幂等', () => {
  it('同输入同 N 结果完全一致', () => {
    for (const n of [12, 8, 6, 4, 1]) {
      expect(project(d, REGISTRY, n)).toEqual(project(d, REGISTRY, n))
    }
  })
})

describe('project · I3 无重叠', () => {
  it('各档列数下输出矩形两两不相交', () => {
    for (const n of [12, 8, 6, 4, 3, 2, 1]) {
      const { rects } = project(d, REGISTRY, n)
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(collides(rects[i], rects[j])).toBe(false)
        }
      }
    }
  })
})

describe('project · 几何映射', () => {
  it('N=12 时逐字段等同逻辑坐标', () => {
    const { rects } = project(d, REGISTRY, 12)
    expect(rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))).toEqual(
      items.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    )
    expect(rects.every((r) => !r.downgraded)).toBe(true)
  })

  it('N=6 时坐标与宽度按压缩因子折算', () => {
    const { rects } = project(d, REGISTRY, 6)
    expect(rects[0]).toMatchObject({ id: 'clock', x: 0, y: 0, w: 2 })
    expect(rects[2]).toMatchObject({ id: 'recent', w: 6 })
  })

  it('N=1 堆叠模式下每张卡都占满单列且仍装得下', () => {
    const { rects, collapsed } = project(d, REGISTRY, 1)
    expect(collapsed).toHaveLength(0)
    expect(rects.every((r) => r.w === 1)).toBe(true)
    expect(rects.every((r) => !r.downgraded)).toBe(true)
    expect([...rects].sort((a, b) => a.y - b.y).map((r) => r.id)).toEqual(['clock', 'sticky', 'recent'])
  })

  it('越界列数被夹到合法区间', () => {
    expect(project(d, REGISTRY, 0).cols).toBe(1)
    expect(project(d, REGISTRY, 99).cols).toBe(LOGICAL_COLS)
  })
})

describe('project · 未知模块', () => {
  it('注册表里没有的模块进 collapsed 而不是崩溃', () => {
    const { rects, collapsed } = project(doc([{ id: 'ghost', variant: 'v', x: 0, y: 0, w: 2, h: 2 }]), REGISTRY, 12)
    expect(rects).toHaveLength(0)
    expect(collapsed[0]).toMatchObject({ id: 'ghost', reason: 'unknown-module' })
  })
})

describe('降档让位：贴左首配（2026-10-10）', () => {
  /**
   * 半列取整的经典冲突：N=6 下两张 3 宽卡会一起挤到 col1（floor/ceil 各算各的）。
   * 旧策略把第二张留在原列带往下塞 —— 屏幕上就是"浮在中列、两边空"的孤岛；
   * 新策略贴左首配：同行有位置就落同行，落不下才整行下移。
   */
  it('同行还有空位时落回同一行（不再往下塞出孤岛）', () => {
    const d2 = doc([
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 3, h: 3 },
      { id: 'sticky', variant: 'note', x: 3, y: 0, w: 3, h: 3 },
    ])
    const { rects } = project(d2, REGISTRY, 6)
    expect(rects.find((r) => r.id === 'clock')).toMatchObject({ x: 0, y: 0, w: 2 })
    // 不留在 col1 与时钟压边、也不掉到下一行 —— 贴到 col2（旧策略这里会掉到 y=3）
    expect(rects.find((r) => r.id === 'sticky')).toMatchObject({ x: 2, y: 0, w: 2 })
  })

  it('同行放不下才整行下移，且下移后贴左', () => {
    const d3 = doc([
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 3, h: 3 },
      { id: 'sticky', variant: 'note', x: 3, y: 0, w: 3, h: 3 },
      { id: 'todo', variant: 'list', x: 6, y: 0, w: 3, h: 3 },
      { id: 'recent', variant: 'bar', x: 9, y: 0, w: 3, h: 3 },
    ])
    const { rects } = project(d3, REGISTRY, 6)
    // 前三张填满 col0-5；第四张放不下本行 → 下移一整行，并从 x=0 起（贴左，不悬中列）
    const b = rects.find((r) => r.id === 'recent')!
    expect([b.x, b.y]).toEqual([0, 3])
  })
})
