export interface SkinDef {
  id: string
  label: string
  desc: string
}

export const SKINS: readonly SkinDef[] = [
  { id: 'ink', label: '墨纸', desc: '高对比、无渐变、等宽数字，工具感' },
  { id: 'aurora', label: '柔光', desc: '淡彩渐变 + 玻璃表面' },
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
 * 出厂外观：**柔光 + 跟随系统 + 跟随皮肤强调色**。
 *
 * 默认皮肤原先是 `ink`（墨纸）。改的理由是"第一印象"：`ink` 的卡片底（近白）与页面底
 * （`#f7f7f5`）几乎同色，"卡片是一张卡"的层次感出不来 —— 而这个产品卖的就是"一张张卡"。
 * `aurora` 带柔光渐变与玻璃表面，层次一眼可见；它同时也是 `:root` 的隐含实现，
 * 于是**首屏连一次颜色切换都不需要**（没存偏好时，JS 挂载前后是同一套值）。
 * 另两套皮肤一个都没删，在「外观」里随时可换。
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
