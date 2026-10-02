import { describe, expect, it } from 'vitest'
import { findFreeSpot } from '../../src/engine/spot'
import { LOGICAL_COLS, emptyDoc, findModule, resolveVariant, variantOf } from '../../src/engine/types'
import type { LayoutDoc, ModuleRegistry, Placement } from '../../src/engine/types'
import { sanitizeItems } from '../../src/engine/validate'
import { parseLayout } from '../../src/engine/serialize'
import { fitHeights } from '../../src/engine/fitHeight'
import { pickVariantForSize } from '../../src/engine/downgrade'
import { project, projectForWidth } from '../../src/engine/projection'
import { canRedo, canUndo, commit, createHistory, currentDoc, redo, undo } from '../../src/engine/history'
import { setVariant } from '../../src/engine/ops'

/**
 * 这批用例是 §8 那条「引擎分支覆盖 ≥90%」补出来的：覆盖率一跑，没走到的
 * 全是失败与兜底分支 —— 恰恰是最该有测试的地方（坏数据、装不下、空栈）。
 */
const REG: ModuleRegistry = [
  {
    id: 'clock',
    title: '时钟',
    defaultVariant: 'big',
    variants: [
      { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
      { id: 'mini', name: '小时钟', minW: 2, minH: 1, idealW: 2, idealH: 1 },
    ],
  },
  {
    id: 'sticky',
    title: '便签',
    defaultVariant: 'note',
    variants: [{ id: 'note', name: '便签', minW: 2, minH: 1, idealW: 3, idealH: 2 }],
  },
  // 一个形态都没有：所有「拿不到形态」的分支靠它触发
  { id: 'ghost', title: '空形态', defaultVariant: '', variants: [] },
]

const p = (id: string, x: number, y: number, w: number, h: number, variant: string): Placement => ({ id, variant, x, y, w, h })
const mkDoc = (...items: Placement[]): LayoutDoc => ({ schemaVersion: 1, cols: LOGICAL_COLS, items })

describe('findFreeSpot 的兜底路径', () => {
  it('负数 y 抬到 0，一路撞到底时落在 maxRow 兜底位', () => {
    const wall = [p('sticky', 0, 0, 12, 60, 'note')]
    const r = findFreeSpot(wall, 2, 1, 0, -5, 12)
    expect(r.y).toBe(60)
    expect(r.x).toBe(0)
  })

  it('同列带向下找最近空位，不会横着跑到别列去', () => {
    const blockers = [p('sticky', 0, 0, 2, 2, 'note')]
    expect(findFreeSpot(blockers, 2, 1, 0, 0, 12)).toMatchObject({ x: 0, y: 2 })
  })
})

describe('形态解析的三级回退', () => {
  it('mod 缺失 / variant 失效 / 没有任何形态', () => {
    expect(resolveVariant(undefined, 'big')).toBeUndefined()
    expect(resolveVariant(findModule(REG, 'clock'), 'nope')?.id).toBe('big')
    expect(resolveVariant(findModule(REG, 'ghost'), 'x')).toBeUndefined()
    expect(variantOf(REG, 'unknown', 'big')).toBeUndefined()
  })

  it('pickVariantForSize：装得下用偏好形态，都装不下给 null', () => {
    const clock = findModule(REG, 'clock')!
    expect(pickVariantForSize(clock, 'big', 4, 3)?.id).toBe('big')
    expect(pickVariantForSize(clock, 'nope', 2, 1)?.id).toBe('mini')
    expect(pickVariantForSize(clock, 'big', 1, 1)).toBeNull()
  })
})

describe('不信任盘上数据', () => {
  it('sanitizeItems 逐条拒绝坏条目，只留能用的', () => {
    const r = sanitizeItems(
      [
        null,
        { id: 42 },
        { id: 'nope', x: 0, y: 0 },
        { id: 'clock', x: 'a', y: 0 },
        { id: 'ghost', x: 0, y: 0 },
        { id: 'clock', x: 1, y: 1, w: 'x', h: 99 },
        { id: 'clock', x: 5, y: 5 },
      ],
      REG,
    )
    expect(r.items.map((i) => i.id)).toEqual(['clock'])
    expect(r.items[0].w).toBe(4)
    expect(r.warnings.length).toBeGreaterThanOrEqual(5)
  })

  it('parseLayout：坏 JSON / null / 非法 cols / 高版本 schemaVersion 都有交代', () => {
    expect(parseLayout('{', REG).warnings.join()).toContain('解析失败')
    expect(parseLayout('null', REG).doc.cols).toBe(LOGICAL_COLS)
    expect(parseLayout('{"cols":-3,"items":[]}', REG).doc.cols).toBe(LOGICAL_COLS)
    expect(parseLayout('{"cols":99,"items":[]}', REG).doc.cols).toBe(LOGICAL_COLS)
    expect(parseLayout('{"schemaVersion":3,"items":[]}', REG).warnings.join()).toContain('高于当前支持版本')
  })
})

describe('按内容降高的每一条跳过路径', () => {
  const d = mkDoc(p('clock', 0, 0, 4, 5, 'big'))

  it('NaN / 0 / 不小于当前 / 等于当前 都不改；低于 minH 的钳到 minH', () => {
    expect(fitHeights(d, REG, { clock: Number.NaN })).toBe(d)
    expect(fitHeights(d, REG, { clock: 0 })).toBe(d)
    expect(fitHeights(d, REG, { clock: 9 })).toBe(d)
    expect(fitHeights(d, REG, { clock: 5 })).toBe(d)
    expect(fitHeights(d, REG, { clock: 1 })!.items[0].h).toBe(3)
  })

  it('没测到某张卡时它原样保留', () => {
    const r = fitHeights(mkDoc(p('clock', 0, 0, 4, 5, 'big'), p('sticky', 0, 5, 3, 4, 'note')), REG, { clock: 3 })
    expect(r!.items.find((i) => i.id === 'sticky')!.h).toBe(4)
  })
})

describe('投影的收起与容器宽入口', () => {
  it('projectForWidth 与断点表一致', () => {
    const d = mkDoc(p('clock', 0, 0, 4, 3, 'big'))
    expect(projectForWidth(d, REG, 1440).cols).toBe(12)
    expect(projectForWidth(d, REG, 720).cols).toBe(6)
    expect(projectForWidth(d, REG, 390).cols).toBe(1)
  })

  it('一个形态都装不下 → 进 collapsed，不压成碎片', () => {
    const r = project(mkDoc(p('clock', 0, 0, 1, 1, 'big')), REG, 12)
    expect(r.rects).toHaveLength(0)
    expect(r.collapsed[0].reason).toBe('no-variant-fits')
  })
})

describe('历史栈的空侧与幂等', () => {
  it('空栈上 undo / redo 原地不动', () => {
    const h = createHistory(emptyDoc())
    expect(canUndo(h)).toBe(false)
    expect(undo(h)).toBe(h)
    expect(canRedo(h)).toBe(false)
    expect(redo(h)).toBe(h)
  })

  it('同一个 doc 重复提交不产生新步', () => {
    const h = createHistory(emptyDoc())
    expect(commit(h, currentDoc(h), { at: 1 })).toBe(h)
  })
})

describe('切形态撞上邻居时让位', () => {
  it('mini → big 变宽后与右邻重叠，则整块挪到最近空位而不是叠着', () => {
    const d = mkDoc(p('clock', 0, 0, 2, 1, 'mini'), p('sticky', 2, 0, 4, 3, 'note'))
    const next = setVariant(d, REG, 'clock', 'big')!
    const clock = next.items.find((i) => i.id === 'clock')!
    const sticky = next.items.find((i) => i.id === 'sticky')!
    expect(clock.w).toBeGreaterThanOrEqual(3)
    const overlap = clock.x < sticky.x + sticky.w && sticky.x < clock.x + clock.w && clock.y < sticky.y + sticky.h && sticky.y < clock.y + clock.h
    expect(overlap).toBe(false)
  })
})
