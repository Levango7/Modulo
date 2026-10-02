/** 只按修饰键不构成快捷键，等真正的按键落下来再说；这些 code 直接忽略 */
const MODIFIER_ONLY = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$|^(ContextMenu|CapsLock|NumLock|ScrollLock)$/

/**
 * 拼成 Rust 认的写法：字母数字用单字符（Ctrl+Alt+M），其余沿用 event.code（ArrowUp / F5）。
 * 没修饰键一律返回 null —— 全局快捷键吞掉裸键会毁掉整机输入，所以宁可录不进去。
 */
export function toChord(e: KeyboardEvent): string | null {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  if (mods.length === 0 || MODIFIER_ONLY.test(e.code)) return null
  const letter = /^Key([A-Z])$/.exec(e.code)
  const digit = /^Digit(\d)$/.exec(e.code)
  const key = letter?.[1] ?? digit?.[1] ?? e.code
  return [...mods, key].join('+')
}

/**
 * 录制态里裸 Esc = 取消，但**只限裸按**：全局快捷键必须带修饰键，
 * 所以带修饰的 Esc（Ctrl+Alt+Esc，global-hotkey 认 "ESCAPE"|"ESC"）也是一种合法和弦，
 * 一刀切按 key==='Escape' 取消就等于永远录不进它。
 */
export function isCancelEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
}
