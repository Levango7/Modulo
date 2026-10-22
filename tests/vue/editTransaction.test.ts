/**
 * 编辑事务的两条纯判定（2026-10-12 立的"快照 / 保存 / 取消还原"那套）。
 *
 * 钉住的是两处**口径**，不是实现：
 *  ① `isEditDirty` 的快照为 null = 还没进过编辑器 ⇒ 一律算"没改过"。
 *     这条看着多余，实际是确认框的第一道闸：没进过编辑器就绝不该弹"放弃这次编辑？"。
 *  ② `countLayoutChanges` 数的是**版面差异**，不是历史步数 —— 拖一步再拖回来
 *     在历史上是两步、在版面差异上是 0 处，而对话框里写的就是"版面有 N 处改动"。
 */
import { describe, expect, it } from 'vitest'
import { countLayoutChanges, isEditDirty } from '../../src/vue/editTransaction'
import type { LayoutDoc, Placement } from '@levango7/engine'

function doc(items: Placement[], rows: LayoutDoc['rows'] = []): LayoutDoc {
  // schemaVersion / cols 是 LayoutDoc 的必填项；这两个判定都只看 items 与 rows，
  // 所以固定用一组值，别让它们在用例里变成变量。
  return { schemaVersion: 1, cols: 12, items, rows }
}

const item = (o: Partial<Placement> = {}): Placement =>
  ({ id: 'a', module: 'clock', x: 0, y: 0, w: 4, h: 3, ...o }) as Placement

describe('isEditDirty', () => {
  it('快照为 null = 没进过编辑器，一律算没改过', () => {
    expect(isEditDirty(null, doc([item()]))).toBe(false)
    // 哪怕"当前"是空版面也不算脏 —— 没有快照就没有"这次编辑"
    expect(isEditDirty(null, doc([]))).toBe(false)
  })

  it('内容一致算没改过（键序不同也不算改）', () => {
    const a = doc([item()])
    const b = doc([item({ w: 4, h: 3, x: 0, y: 0 })])
    expect(isEditDirty(a, b)).toBe(false)
  })

  it('任何一处不同就算脏', () => {
    expect(isEditDirty(doc([item()]), doc([item({ w: 6 })]))).toBe(true)
    expect(isEditDirty(doc([item()]), doc([]))).toBe(true)
    expect(isEditDirty(doc([]), doc([item()]))).toBe(true)
  })
})

describe('countLayoutChanges', () => {
  it('完全相同 = 0 处', () => {
    expect(countLayoutChanges(doc([item()]), doc([item()]))).toBe(0)
  })

  it('改一张卡算一处（改几个字段都算一处）', () => {
    expect(countLayoutChanges(doc([item()]), doc([item({ x: 3, w: 6, h: 4 })]))).toBe(1)
  })

  it('加一张算一处、删一张算一处', () => {
    expect(countLayoutChanges(doc([item()]), doc([item(), item({ id: 'b' })]))).toBe(1)
    expect(countLayoutChanges(doc([item(), item({ id: 'b' })]), doc([item()]))).toBe(1)
  })

  it('一加一删同时发生算两处', () => {
    const a = doc([item({ id: 'a' }), item({ id: 'b' })])
    const b = doc([item({ id: 'a' }), item({ id: 'c' })])
    expect(countLayoutChanges(a, b)).toBe(2)
  })

  it('行也单独数：增 / 删 / 改各算一处', () => {
    const row = { id: 'r1', items: ['a'] } as unknown as NonNullable<LayoutDoc['rows']>[number]
    const row2 = { id: 'r1', items: ['a', 'b'] } as unknown as NonNullable<LayoutDoc['rows']>[number]
    expect(countLayoutChanges(doc([], [row]), doc([], [row]))).toBe(0)
    expect(countLayoutChanges(doc([], [row]), doc([], [row2]))).toBe(1)
    expect(countLayoutChanges(doc([], []), doc([], [row]))).toBe(1)
    expect(countLayoutChanges(doc([], [row]), doc([], []))).toBe(1)
  })

  it('卡片与行分开累加', () => {
    const row = { id: 'r1', items: [] } as unknown as NonNullable<LayoutDoc['rows']>[number]
    const a = doc([item()], [])
    const b = doc([item({ w: 6 })], [row])
    expect(countLayoutChanges(a, b)).toBe(2)
  })

  it('拖一步再拖回来 = 0 处（这正是"按差异数不按历史步数"的意义）', () => {
    const a = doc([item()])
    const moved = doc([item({ x: 3 })])
    const back = doc([item({ x: 0 })])
    expect(countLayoutChanges(a, moved)).toBe(1)
    expect(countLayoutChanges(a, back)).toBe(0)
  })

  it('旧档没有 rows 字段时按空表处理（`?? []` 兜底是真实分支，不是防御）', () => {
    // LayoutDoc.rows 是**可选加法字段**（types.ts：旧档没有它时按空表处理）——
    // 所以缺键的 doc 是契约内真实输入，`?? []` 必须被断言钉住。
    // 注意不能走 doc(items, undefined)：默认参数会把 undefined 换成 []，
    // 构造出的是"显式空数组"而不是"缺键的旧档"，两个分支都测不到。
    const legacy = (): LayoutDoc => ({ schemaVersion: 1, cols: 12, items: [] })
    const row = { id: 'r1', items: [] } as unknown as NonNullable<LayoutDoc['rows']>[number]
    expect(countLayoutChanges(legacy(), legacy())).toBe(0) // 两侧都缺键：空表 vs 空表
    expect(countLayoutChanges(legacy(), doc([], [row]))).toBe(1) // 缺键那侧按空表算 → 多出一行
    expect(countLayoutChanges(doc([], [row]), legacy())).toBe(1) // 反向同理
  })
})
