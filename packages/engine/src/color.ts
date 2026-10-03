/**
 * 颜色工具：HEX ↔ RGB ↔ HSL，外加 WCAG 对比度。
 *
 * 全是纯算术（乘移位、三角函数），所以放引擎层直接单测；
 * 界面只负责取色器与把三个表示一起摆出来。
 */

export interface RGB {
  r: number
  g: number
  b: number
}
export interface HSL {
  h: number
  s: number
  l: number
}

/** `#RGB` 与 `#RRGGBB` 都认（大小写均可）；`#` 可省 */
export function parseHex(s: string): RGB | null {
  const t = s.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    return {
      r: Number.parseInt(t[0] + t[0], 16),
      g: Number.parseInt(t[1] + t[1], 16),
      b: Number.parseInt(t[2] + t[2], 16),
    }
  }
  if (/^[0-9a-fA-F]{6}$/.test(t)) {
    return {
      r: Number.parseInt(t.slice(0, 2), 16),
      g: Number.parseInt(t.slice(2, 4), 16),
      b: Number.parseInt(t.slice(4, 6), 16),
    }
  }
  return null
}

export function rgbToHex({ r, g, b }: RGB): string | null {
  for (const v of [r, g, b]) if (!Number.isFinite(v)) return null
  // 夹到 0–255 再四舍五入：换算链路上出现 254.7 / -0.2 是常态，界面要的是颜色不是报错
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = Math.min(100, Math.max(0, s)) / 100
  const ln = Math.min(100, Math.max(0, l)) / 100
  const k = (n: number) => (n + ((h % 360) / 30)) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) }
}

/** WCAG 相对亮度（sRGB 线性化） */
function luminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const n = v / 255
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 对比度（1–21）。谁的亮度大做分母是公式的一部分，不是排序技巧 */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** 帮人挑字色：在这个底色上，白字与黑字谁的对比度高就推荐谁 */
export function readableOn(bg: RGB): '白字' | '黑字' {
  const white = contrastRatio(bg, { r: 255, g: 255, b: 255 })
  const black = contrastRatio(bg, { r: 0, g: 0, b: 0 })
  return white >= black ? '白字' : '黑字'
}
