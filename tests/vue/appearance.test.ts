import { describe, expect, it } from 'vitest'
import {
  ACCENT_AUTO,
  DEFAULT_APPEARANCE,
  accentColor,
  parseAppearance,
  resolveTheme,
} from '../../src/vue/appearance'

describe('parseAppearance', () => {
  it('无存档时用默认值（默认皮肤 aurora、跟随系统、强调色跟随皮肤）', () => {
    expect(parseAppearance(null)).toEqual({ skin: 'aurora', mode: 'system', accent: ACCENT_AUTO })
    expect(DEFAULT_APPEARANCE.skin).toBe('aurora')
  })

  it('损坏 JSON 回退默认而不抛异常', () => {
    expect(parseAppearance('{坏')).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('null')).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('"str"')).toEqual(DEFAULT_APPEARANCE)
  })

  it('逐字段校验：非法字段回退默认，合法字段保留', () => {
    expect(parseAppearance(JSON.stringify({ skin: 'nope', mode: 'dark', accent: '#0d9488' }))).toEqual({
      skin: 'aurora',
      mode: 'dark',
      accent: '#0d9488',
    })
  })

  it('非十六进制的强调色被拒（防注入 style）', () => {
    expect(parseAppearance(JSON.stringify({ accent: 'red; } body { display:none' }))).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: ACCENT_AUTO,
    })
  })
})

describe('resolveTheme', () => {
  it('system 跟随系统偏好，显式模式覆盖它', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('accentColor', () => {
  it('auto 表示不覆盖皮肤默认强调色', () => {
    expect(accentColor(ACCENT_AUTO)).toBeNull()
    expect(accentColor('#5b5bf5')).toBe('#5b5bf5')
    expect(accentColor('#fff')).toBeNull()
    expect(accentColor('javascript:1')).toBeNull()
  })
})
