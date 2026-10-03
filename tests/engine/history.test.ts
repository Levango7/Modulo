import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, createHistory, currentDoc, redo, undo } from '@modulo/engine/history'
import type { LayoutDoc } from '@modulo/engine/types'
import { doc, clockItem } from '../fixtures'

const d0 = doc([clockItem(0)])
const d1 = doc([clockItem(1)])
const d2 = doc([clockItem(2)])
const d3 = doc([clockItem(3)])

describe('history', () => {
  it('初始不可撤销', () => {
    const h = createHistory(d0)
    expect(canUndo(h)).toBe(false)
    expect(currentDoc(h)).toBe(d0)
  })

  it('提交后可撤销与重做', () => {
    let h = commit(createHistory(d0), d1, { at: 10 })
    expect(currentDoc(h)).toBe(d1)
    h = undo(h)
    expect(currentDoc(h)).toBe(d0)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(currentDoc(h)).toBe(d1)
    expect(canRedo(h)).toBe(false)
  })

  it('同一 doc 引用重复提交不产生历史', () => {
    const h = commit(createHistory(d0), d0, { at: 1 })
    expect(h.past).toHaveLength(0)
  })

  it('同 mergeKey 且落在窗口内折叠为一步', () => {
    let h = commit(createHistory(d0), d1, { at: 100, mergeKey: 'drag:clock' })
    h = commit(h, d2, { at: 150, mergeKey: 'drag:clock' })
    h = commit(h, d3, { at: 180, mergeKey: 'drag:clock' })
    expect(h.past).toHaveLength(1)
    expect(currentDoc(h)).toBe(d3)
    expect(currentDoc(undo(h))).toBe(d0)
  })

  it('超出合并窗口则另起一步', () => {
    let h = commit(createHistory(d0), d1, { at: 0, mergeKey: 'k' })
    h = commit(h, d2, { at: 5000, mergeKey: 'k' })
    expect(h.past).toHaveLength(2)
  })

  it('新提交清空重做栈', () => {
    let h = commit(createHistory(d0), d1, { at: 1 })
    h = undo(h)
    h = commit(h, d2, { at: 2 })
    expect(canRedo(h)).toBe(false)
  })

  it('历史条数不超过 limit', () => {
    let h = createHistory(d0, 3)
    for (const [i, d] of [d1, d2, d3].entries()) h = commit(h, d, { at: i + 1 })
    h = commit(h, doc([clockItem(9)]) as LayoutDoc, { at: 9 })
    expect(h.past.length).toBeLessThanOrEqual(3)
  })
})
