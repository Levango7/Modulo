import { describe, expect, it } from 'vitest'
import { isCancelEscape, toChord } from '../../src/vue/chord'

/** 只填录制器真正读的六个字段，别的都是噪音 */
function key(init: {
  code: string
  key?: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}): KeyboardEvent {
  return {
    code: init.code,
    key: init.key ?? init.code,
    ctrlKey: !!init.ctrl,
    altKey: !!init.alt,
    shiftKey: !!init.shift,
    metaKey: !!init.meta,
  } as unknown as KeyboardEvent
}

describe('toChord', () => {
  it('字母用单字符，与 Rust 默认档写法一致', () => {
    expect(toChord(key({ code: 'KeyM', ctrl: true, alt: true }))).toBe('Ctrl+Alt+M')
  })

  it('数字剥掉 Digit 前缀', () => {
    expect(toChord(key({ code: 'Digit3', ctrl: true, shift: true }))).toBe('Ctrl+Shift+3')
  })

  it('其余键沿用 event.code', () => {
    expect(toChord(key({ code: 'ArrowUp', ctrl: true }))).toBe('Ctrl+ArrowUp')
    expect(toChord(key({ code: 'F13', ctrl: true, alt: true, shift: true }))).toBe('Ctrl+Alt+Shift+F13')
  })

  it('Cmd 记成 Super（Rust 侧 SUPER/CMD/COMMAND 都认，前端只发一种）', () => {
    expect(toChord(key({ code: 'KeyT', meta: true }))).toBe('Super+T')
  })

  it('没有修饰键一律不录：吞掉裸键会毁掉整机输入', () => {
    expect(toChord(key({ code: 'KeyM' }))).toBeNull()
    expect(toChord(key({ code: 'Escape' }))).toBeNull()
  })

  it('只按修饰键不构成快捷键，等真按键落下', () => {
    expect(toChord(key({ code: 'ControlLeft', key: 'Control', alt: true }))).toBeNull()
    expect(toChord(key({ code: 'AltRight', key: 'Alt' }))).toBeNull()
  })

  /** 这条就是本轮修的东西：带修饰的 Esc 是一枚合法和弦，不该被当成噪音 */
  it('带修饰键的 Esc 能录成和弦', () => {
    expect(toChord(key({ code: 'Escape', key: 'Escape', ctrl: true, alt: true, shift: true }))).toBe(
      'Ctrl+Alt+Shift+Escape',
    )
  })
})

describe('isCancelEscape', () => {
  it('裸 Esc 才是取消', () => {
    expect(isCancelEscape(key({ code: 'Escape', key: 'Escape' }))).toBe(true)
  })

  it('带任何一个修饰键的 Esc 都不算取消，要交给 toChord', () => {
    expect(isCancelEscape(key({ code: 'Escape', key: 'Escape', ctrl: true }))).toBe(false)
    expect(isCancelEscape(key({ code: 'Escape', key: 'Escape', alt: true }))).toBe(false)
    expect(isCancelEscape(key({ code: 'Escape', key: 'Escape', shift: true }))).toBe(false)
    expect(isCancelEscape(key({ code: 'Escape', key: 'Escape', meta: true }))).toBe(false)
  })

  it('别的键一律不是取消', () => {
    expect(isCancelEscape(key({ code: 'KeyM', ctrl: true, alt: true }))).toBe(false)
  })
})
