import { describe, expect, it } from 'vitest'
import { cellIntent, globalIntent, isEditableTarget, shouldPrevent, type KeyLike } from '../../src/vue/keyboard'
import type { Placement } from '@modulo/engine'

/** 造一个按键：只填我们关心的字段，其余与 KeyboardEvent 一致地缺省为 false */
function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods }
}

const clock: Placement = { id: 'clock', variant: 'big', x: 3, y: 2, w: 4, h: 3 }
const todo: Placement = { id: 'todo', variant: 'list', x: 8, y: 0, w: 4, h: 6 }

describe('cellIntent：裸方向 = 移动，Shift+方向 = 改尺寸', () => {
  it('四个方向各自的方向向量', () => {
    expect(cellIntent(key('ArrowLeft'), clock, [])).toMatchObject({ kind: 'move', x: 2, y: 2 })
    expect(cellIntent(key('ArrowRight'), clock, [])).toMatchObject({ kind: 'move', x: 4, y: 2 })
    expect(cellIntent(key('ArrowUp'), clock, [])).toMatchObject({ kind: 'move', x: 3, y: 1 })
    expect(cellIntent(key('ArrowDown'), clock, [])).toMatchObject({ kind: 'move', x: 3, y: 3 })
  })

  it('Shift 加方向改的是尺寸，位置不动', () => {
    expect(cellIntent(key('ArrowRight', { shiftKey: true }), clock, [])).toMatchObject({ kind: 'resize', id: 'clock', w: 5, h: 3 })
    expect(cellIntent(key('ArrowDown', { shiftKey: true }), clock, [])).toMatchObject({ kind: 'resize', w: 4, h: 4 })
  })

  it('多选时按方向动整组 —— 除非按着 Alt（那时只动当前格）', () => {
    const sel = ['clock', 'todo']
    const many = cellIntent(key('ArrowRight'), clock, sel)
    expect(many).toMatchObject({ kind: 'moveMany', dx: 1, dy: 0 })
    expect(many && 'ids' in many ? many.ids : null).toEqual(['clock', 'todo'])

    expect(cellIntent(key('ArrowRight', { altKey: true }), clock, sel)).toMatchObject({ kind: 'move', id: 'clock', x: 4, y: 2 })
  })

  it('Alt + Shift 组合 = 只动当前格的尺寸', () => {
    expect(cellIntent(key('ArrowRight', { altKey: true, shiftKey: true }), clock, ['clock', 'todo'])).toMatchObject({ kind: 'resize', w: 5 })
  })

  it('每条都带 mergeKey，且多选那条按 id 排序 —— 顺序不同会被当成两次输入', () => {
    const a = cellIntent(key('ArrowRight'), clock, ['todo', 'clock'])
    const b = cellIntent(key('ArrowRight'), clock, ['clock', 'todo'])
    expect(a && 'mergeKey' in a ? a.mergeKey : null).toBe('kbd:moveMany:clock,todo')
    expect(a && 'mergeKey' in a ? a.mergeKey : null).toBe(b && 'mergeKey' in b ? b.mergeKey : null)
    expect(cellIntent(key('ArrowDown'), clock, []) && 'mergeKey' in cellIntent(key('ArrowDown'), clock, [])!).toBeTruthy()
  })
})

describe('cellIntent：非方向键的那几枚', () => {
  it('空格 = 切换选入', () => {
    expect(cellIntent(key(' '), clock, [])).toEqual({ kind: 'toggleSelect', id: 'clock' })
  })

  it('Enter = 循环切形态，L = 锁定', () => {
    expect(cellIntent(key('Enter'), clock, [])).toEqual({ kind: 'cycleVariant', id: 'clock' })
    expect(cellIntent(key('l'), clock, [])).toEqual({ kind: 'toggleLock', id: 'clock' })
    expect(cellIntent(key('L'), clock, [])).toEqual({ kind: 'toggleLock', id: 'clock' })
  })

  it('Delete 与 Backspace 等价：两个都删，Mac 上 Backspace 是常态', () => {
    expect(cellIntent(key('Delete'), clock, [])).toEqual({ kind: 'remove', id: 'clock' })
    expect(cellIntent(key('Backspace'), clock, [])).toEqual({ kind: 'remove', id: 'clock' })
  })

  it('不认识的键返回 null，交给浏览器（F5、Tab 等不能被吞）', () => {
    for (const k of ['F5', 'Tab', 'a', 'Shift', 'Control', 'ArrowUpLeft']) {
      expect(cellIntent(key(k), clock, []), k).toBeNull()
    }
  })

  it('Ctrl+方向仍然移动 —— 已知的粗糙点，如实记录而不是假装它被处理了', () => {
    // 现状：方向键只看 shiftKey / altKey，不看 ctrlKey。
    // 后果：在 Windows 上 Ctrl+方向有时被系统/WebView 当成别的快捷键吃掉，行为随环境漂。
    // 这条断言的作用是**钉住现状**，好让将来决定"要不要拦 Ctrl+方向"时看得见影响面，
    // 而不是让"Ctrl+方向不移动"这种从未实现过的行为混进文档与测试。
    expect(cellIntent(key('ArrowRight', { ctrlKey: true }), clock, [])).toMatchObject({ kind: 'move', x: 4, y: 2 })
  })
})

describe('globalIntent：全选 / 清选 / 批量删', () => {
  const items = [clock, todo]

  it('Esc 清选', () => {
    expect(globalIntent(key('Escape'), { items, selCount: 2 })).toEqual({ kind: 'clearSelection' })
  })

  it('Ctrl+A 与 Cmd+A 都全选', () => {
    expect(globalIntent(key('a', { ctrlKey: true }), { items, selCount: 0 })).toEqual({ kind: 'selectAll' })
    expect(globalIntent(key('a', { metaKey: true }), { items, selCount: 0 })).toEqual({ kind: 'selectAll' })
    expect(globalIntent(key('A', { ctrlKey: true }), { items, selCount: 0 })).toEqual({ kind: 'selectAll' })
  })

  it('只有选中多个时才走批量删；单个留给格子层（那儿管焦点落点）', () => {
    expect(globalIntent(key('Delete'), { items, selCount: 2 })).toEqual({ kind: 'deleteSelection' })
    expect(globalIntent(key('Delete'), { items, selCount: 1 })).toBeNull()
    expect(globalIntent(key('Delete'), { items, selCount: 0 })).toBeNull()
  })

  it('普通按键在这里没有意图', () => {
    expect(globalIntent(key('ArrowRight'), { items, selCount: 1 })).toBeNull()
    expect(globalIntent(key('z', { ctrlKey: true }), { items, selCount: 1 })).toBeNull()
  })
})

describe('isEditableTarget：输入框里的按键必须放行', () => {
  function el(tag: string, extra: Record<string, unknown> = {}) {
    return { tagName: tag, ...extra } as unknown as EventTarget
  }

  it('input / textarea / contenteditable 都算可编辑', () => {
    expect(isEditableTarget(el('INPUT'))).toBe(true)
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true)
    expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true)
  })

  it('普通元素与 null 都不算', () => {
    expect(isEditableTarget(el('DIV'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget({} as EventTarget)).toBe(false)
  })

  it('isContentEditable 为 undefined 时不算 —— 不能因为宽松比较把它当真', () => {
    expect(isEditableTarget(el('DIV', { isContentEditable: undefined }))).toBe(false)
  })
})

describe('shouldPrevent：哪些意图要拦默认行为', () => {
  it('会改文档结构的必须拦', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Delete', 'Backspace'] as const) {
      const i = cellIntent(key(k), clock, [])
      expect(shouldPrevent(i), k).toBe(true)
    }
    expect(shouldPrevent({ kind: 'selectAll' })).toBe(true)
    expect(shouldPrevent({ kind: 'deleteSelection' })).toBe(true)
  })

  it('切形态 / 锁定 / 空意图不拦', () => {
    expect(shouldPrevent(cellIntent(key('Enter'), clock, []))).toBe(false)
    expect(shouldPrevent(cellIntent(key('l'), clock, []))).toBe(false)
    expect(shouldPrevent(null)).toBe(false)
  })
})
