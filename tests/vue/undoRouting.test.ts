/**
 * 撤销/重做的**路由**（2026-10-20 起 App.vue 里那段 if-else 的纯函数化）。
 *
 * 这套规则的原文在 App.vue 的注释里，这里逐字守住它的三条：
 *  ① 编辑态：只在改版面 ⇒ 永远撤版面；
 *  ② 工作台态：谁更近撤谁（内容改动通常更近），**平手时内容优先**；
 *  ③ 选中的那边没得撤就退到另一边（顺序里两半都在，调用方逐个试）。
 *
 * 最容易写错的是"平手算内容近"和"重做跟时间戳还是跟 lastUndoKind"这两处 ——
 * 重做**不跟时间戳**：撤销动了内容之后，时间戳上内容仍然更近，但重做该跟的是
 * "上一次实际动的是哪一份"。下面用一对对称的用例把这两处钉住。
 */
import { describe, expect, it } from 'vitest'
import { anyRedo, anyUndo, redoOrder, undoOrder, type UndoRoutingCaps } from '../../src/vue/undoRouting'

const caps = (o: Partial<UndoRoutingCaps> = {}): UndoRoutingCaps => ({
  layoutCanUndo: true,
  contentCanUndo: true,
  layoutCanRedo: true,
  contentCanRedo: true,
  layoutLastAt: 100,
  contentLastAt: 100,
  ...o,
})

describe('anyUndo / anyRedo（按钮可用态）', () => {
  it('两份历史任一份还能动就亮', () => {
    expect(anyUndo(caps({ layoutCanUndo: false, contentCanUndo: false }))).toBe(false)
    expect(anyUndo(caps({ layoutCanUndo: false, contentCanUndo: true }))).toBe(true)
    expect(anyUndo(caps({ layoutCanUndo: true, contentCanUndo: false }))).toBe(true)
    expect(anyRedo(caps({ layoutCanRedo: false, contentCanRedo: false }))).toBe(false)
    expect(anyRedo(caps({ layoutCanRedo: true, contentCanRedo: false }))).toBe(true)
  })
})

describe('undoOrder', () => {
  it('编辑态永远先撤版面（与拆分前行为一致）', () => {
    // 即便内容明显更近，编辑态也不撤内容 —— 编辑态只在改版面
    expect(undoOrder({ view: 'edit', lastUndoKind: 'content' }, caps({ contentLastAt: 999 }))).toEqual(['layout'])
  })

  it('工作台态：内容更近先试内容', () => {
    expect(undoOrder({ view: 'workbench', lastUndoKind: 'layout' }, caps({ contentLastAt: 200, layoutLastAt: 100 })))
      .toEqual(['content', 'layout'])
  })

  it('工作台态：版面更近先试版面', () => {
    expect(undoOrder({ view: 'workbench', lastUndoKind: 'content' }, caps({ layoutLastAt: 200, contentLastAt: 100 })))
      .toEqual(['layout', 'content'])
  })

  it('平手算内容近', () => {
    expect(undoOrder({ view: 'workbench', lastUndoKind: 'layout' }, caps({ layoutLastAt: 100, contentLastAt: 100 })))
      .toEqual(['content', 'layout'])
  })

  it('顺序永远含两半 —— 选中那边没得撤时要能退到另一边', () => {
    for (const view of ['workbench', 'edit'] as const) {
      for (const last of ['layout', 'content'] as const) {
        expect(undoOrder({ view, lastUndoKind: last }, caps())).toHaveLength(view === 'edit' ? 1 : 2)
      }
    }
  })
})

describe('redoOrder', () => {
  it('编辑态永远先重做版面', () => {
    expect(redoOrder({ view: 'edit', lastUndoKind: 'content' }, caps())).toEqual(['layout'])
  })

  it('工作台态跟着 lastUndoKind 走，不跟时间戳', () => {
    // 撤销动了内容 ⇒ 内容时间戳仍然更近，但重做该动的是内容
    expect(redoOrder({ view: 'workbench', lastUndoKind: 'content' }, caps({ contentLastAt: 300, layoutLastAt: 100 })))
      .toEqual(['content', 'layout'])
    expect(redoOrder({ view: 'workbench', lastUndoKind: 'layout' }, caps({ contentLastAt: 300, layoutLastAt: 100 })))
      .toEqual(['layout', 'content'])
  })

  it('默认（没撤过）先试版面', () => {
    expect(redoOrder({ view: 'workbench', lastUndoKind: 'layout' }, caps())).toEqual(['layout', 'content'])
  })
})
