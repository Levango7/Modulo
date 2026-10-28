import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_AUTO,
  DEFAULT_APPEARANCE,
  SKINS,
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

/**
 * 首屏防闪脚本与外观定义的同源（2026-10-29）。
 *
 * `index.html` 里那段同步 IIFE 在 **Vue 挂载之前**跑，读同一个 localStorage、写同一组
 * `data-*` 属性；它的注释明写「这里的回退值必须与 src/vue/appearance.ts 的 DEFAULT_APPEARANCE
 * 保持一致」，但此前**没有任何门**看着这件事。加一种皮肤而忘了改 html，用户首次访问就会
 * 先看到 aurora 再跳过去 —— 正是那段脚本本来要消除的一帧跳变；而且只在「没存过偏好」这条
 * 最常见路径上出现，本地开发（存过值）几乎发现不了。
 */
describe('首屏防闪脚本与外观定义同源', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')

  it('皮肤白名单逐项一致（增删皮肤必须同时改 index.html）', () => {
    const chain = SKINS.map((s) => `a.skin === '${s.id}'`).join(' || ')
    expect(html, `index.html 的皮肤白名单要与 SKINS 逐项相同：${chain}`).toContain(chain)
  })

  it('兜底皮肤与 DEFAULT_APPEARANCE.skin 一致', () => {
    expect(html, '首屏脚本的兜底皮肤要等于 DEFAULT_APPEARANCE.skin').toContain(`: '${DEFAULT_APPEARANCE.skin}'`)
  })

  it('读的是同一个存储键', () => {
    expect(html, '首屏脚本与 useAppearance 必须是同一个键，否则两边各读各的').toContain(
      "localStorage.getItem('modulo.appearance.v1')",
    )
  })
})
