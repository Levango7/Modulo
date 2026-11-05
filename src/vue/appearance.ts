export interface SkinDef {
  id: string
  label: string
  desc: string
}

export const SKINS: readonly SkinDef[] = [
  { id: 'ink', label: '墨纸', desc: '高对比、无渐变、等宽数字，工具感' },
  { id: 'aurora', label: '素纸', desc: '中性纸面、发丝线分层、单一强调（默认）' },
  { id: 'candy', label: '亮彩', desc: '暖底饱和、大圆角、厚实落影' },
]

export type ThemeMode = 'light' | 'dark' | 'system'
export const MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: 'light', label: '亮色' },
  { id: 'dark', label: '暗色' },
  { id: 'system', label: '跟随系统' },
]

/** auto = 不写 inline --accent，让当前 skin 自己的强调色生效 */
export const ACCENT_AUTO = 'auto'
export const ACCENTS: readonly { id: string; value: string; label: string }[] = [
  { id: ACCENT_AUTO, value: ACCENT_AUTO, label: '跟随皮肤' },
  { id: 'vermilion', value: '#e4572e', label: '朱砂' },
  { id: 'indigo', value: '#5b5bf5', label: '靛蓝' },
  { id: 'sky', value: '#0ea5e9', label: '天蓝' },
  { id: 'teal', value: '#0d9488', label: '青绿' },
  { id: 'green', value: '#16a34a', label: '草绿' },
  { id: 'amber', value: '#d97706', label: '琥珀' },
  { id: 'rose', value: '#e11d48', label: '玫红' },
  { id: 'violet', value: '#7c3aed', label: '紫罗兰' },
]

export interface Appearance {
  skin: string
  mode: ThemeMode
  accent: string
}

/**
 * 出厂外观：**素纸（默认令牌）+ 跟随系统 + 跟随皮肤强调色**。
 *
 * 2026-11-05 改天换地：默认皮从「柔光（环境光渐变 + 玻璃半透明）」重做为「素纸」
 * （暖白纸面 / 实色卡 / 发丝线分层 / 单一深林绿强调）。理由：agent 工作台的专业
 * 气质靠干净与可预期，不靠氛围光；id 仍是 `aurora`（不改 id = 不碰任何已存偏好），
 * 变的只是 `:root` 的令牌值。它同时是 `:root` 的隐含实现，**首屏连一次颜色切换
 * 都不需要**（没存偏好时，JS 挂载前后是同一套值）。另两套皮肤一个都没删，
 * 在「外观」里随时可换。
 */
export const DEFAULT_APPEARANCE: Appearance = { skin: 'aurora', mode: 'system', accent: ACCENT_AUTO }

const isMode = (v: unknown): v is ThemeMode => MODES.some((m) => m.id === v)
const isSkin = (v: unknown): v is string => SKINS.some((s) => s.id === v)
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
const isAccent = (v: unknown): v is string => v === ACCENT_AUTO || isHex(v)

/** 存储内容不可信：任何字段非法都回退默认值，不抛异常 */
export function parseAppearance(raw: string | null): Appearance {
  if (!raw) return { ...DEFAULT_APPEARANCE }
  let o: Partial<Appearance> | null = null
  try {
    o = JSON.parse(raw) as Partial<Appearance>
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
  if (!o || typeof o !== 'object') return { ...DEFAULT_APPEARANCE }
  return {
    skin: isSkin(o.skin) ? o.skin : DEFAULT_APPEARANCE.skin,
    mode: isMode(o.mode) ? o.mode : DEFAULT_APPEARANCE.mode,
    accent: isAccent(o.accent) ? o.accent : DEFAULT_APPEARANCE.accent,
  }
}

export function resolveTheme(mode: ThemeMode, systemIsDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return systemIsDark ? 'dark' : 'light'
  return mode
}

export function accentColor(accent: string): string | null {
  if (accent === ACCENT_AUTO) return null
  return isHex(accent) ? accent : null
}
