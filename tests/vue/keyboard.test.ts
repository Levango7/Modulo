import { describe, expect, it } from 'vitest'
import { appKeyIntent, cellIntent, globalIntent, isEditableTarget, isPaletteHotkey, isUndoHotkey, shouldPrevent, type KeyLike } from '../../src/vue/keyboard'
import type { Placement } from '@levango7/engine'

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

/**
 * 应用层的 Esc 级联与全局快捷键（2026-10-23 从 App.vue 的 `onGlobalKey` 抽出）。
 *
 * 这段级联此前七层 if-else 一条断言都没有，而它恰好最容易在加弹层时被改错：
 * 加一层忘插进级联 = 新弹层按 Esc 不关，用户只能点鼠标。所以顺序**逐字**钉住。
 *
 * 两个必须保住的语义：
 *  ① **编辑器先吃** —— 它手里有比"取消整场编辑"更局部的"退一步"（清选中）。
 *     否则选了卡按 Esc 会直接弹放弃确认。用 thunk 问它，所以"问了但它没吃"
 *     与"没问它"是两种不同结果，下面分别钉。
 *  ② Ctrl+K **不因为焦点在输入框而失效**（"任何地方唤出"的语义）。
 */
describe('appKeyIntent（Esc 级联）', () => {
  const base = {
    paletteOpen: false,
    cancelAskOpen: false,
    editorEscape: () => false,
    view: 'workbench' as const,
    arrangeOpen: false,
    templatesOpen: false,
    settingsOpen: false,
  }
  const esc: KeyLike = { key: 'Escape', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

  it('不是 Esc 就一概不管', () => {
    for (const k of ['a', 'Enter', 'ArrowLeft', 'z'] as const) {
      expect(appKeyIntent({ ...base, ...{ key: k } as KeyLike }, base), k).toBeNull()
    }
  })

  it('七层顺序逐字钉住：上一层开着时绝不落到下一层', () => {
    // 注意这里断言的是**整个返回值**：`null?.kind` 本身就是 undefined，
    // 用 `?.kind` 判 null 会永远失败（第一版就栽在这）。
    expect(appKeyIntent(esc, base)).toBeNull()
    expect(appKeyIntent(esc, { ...base, settingsOpen: true })?.kind).toBe('closeSettings')
    expect(appKeyIntent(esc, { ...base, settingsOpen: true, templatesOpen: true })?.kind).toBe('closeTemplates')
    expect(appKeyIntent(esc, { ...base, templatesOpen: true, arrangeOpen: true })?.kind).toBe('closeArrange')
    // 编辑态压过 arrange：取消整场编辑比关下拉更该先发生
    expect(appKeyIntent(esc, { ...base, arrangeOpen: true, view: 'edit' })?.kind).toBe('cancelEdit')
    // 编辑器自退压过"取消整场编辑"
    expect(appKeyIntent(esc, { ...base, view: 'edit', editorEscape: () => true })?.kind).toBe('editorEscape')
    expect(appKeyIntent(esc, { ...base, cancelAskOpen: true, view: 'edit', editorEscape: () => true })?.kind).toBe('closeCancelAsk')
    expect(appKeyIntent(esc, { ...base, paletteOpen: true, cancelAskOpen: true, editorEscape: () => true })?.kind).toBe('closePalette')
  })

  it('editorEscape 是 thunk：问到它的时候它才被调用', () => {
    let asked = 0
    const layers = { ...base, editorEscape: () => { asked++; return false } }
    appKeyIntent(esc, layers)
    expect(asked).toBe(1) // 走到这一层才问
    // 上面有层开着时压根不问 —— 否则会把编辑器本来能吃掉的 Esc 提前判死
    asked = 0
    appKeyIntent(esc, { ...layers, paletteOpen: true })
    expect(asked).toBe(0)
    appKeyIntent(esc, { ...layers, cancelAskOpen: true })
    expect(asked).toBe(0)
  })

  it('编辑器说"没得退"时才继续往下走', () => {
    expect(appKeyIntent(esc, { ...base, view: 'edit', editorEscape: () => false })?.kind).toBe('cancelEdit')
    expect(appKeyIntent(esc, { ...base, settingsOpen: true, editorEscape: () => false })?.kind).toBe('closeSettings')
  })
})

describe('全局快捷键判定', () => {
  const k = (o: Partial<KeyLike>): KeyLike => ({ key: 'k', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o })

  it('Ctrl+K / Cmd+K 都算唤出面板', () => {
    expect(isPaletteHotkey(k({ key: 'k', ctrlKey: true }))).toBe(true)
    expect(isPaletteHotkey(k({ key: 'K', metaKey: true }))).toBe(true)
    // 大小写不敏感；Shift 不影响
    expect(isPaletteHotkey(k({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('光有 K 不算（没有修饰键就不是全局键）', () => {
    expect(isPaletteHotkey(k({ key: 'k' }))).toBe(false)
    expect(isPaletteHotkey(k({ key: 'k', altKey: true }))).toBe(false)
    // 别的键 + Ctrl 也不算
    expect(isPaletteHotkey(k({ key: 'j', ctrlKey: true }))).toBe(false)
  })

  it('撤销/重做的四种形状', () => {
    expect(isUndoHotkey(k({ key: 'z', ctrlKey: true }))).toBe('undo')
    expect(isUndoHotkey(k({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(isUndoHotkey(k({ key: 'y', ctrlKey: true }))).toBe('redo')
    expect(isUndoHotkey(k({ key: 'z', metaKey: true }))).toBe('undo')
  })

  it('没有修饰键、或键不对，都返回 null', () => {
    expect(isUndoHotkey(k({ key: 'z' }))).toBeNull()
    expect(isUndoHotkey(k({ key: 'y', shiftKey: true }))).toBeNull()
    expect(isUndoHotkey(k({ key: 'x', ctrlKey: true }))).toBeNull()
    expect(isUndoHotkey(k({ key: 'z', altKey: true }))).toBeNull()
  })
})
