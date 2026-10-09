import { describe, expect, it } from 'vitest'
import { contrastRatio, hslToRgb, parseHex, readableOn, rgbToHex, rgbToHsl } from '@levango7/engine/color'

describe('parseHex：#RGB 与 #RRGGBB 都认', () => {
  it('三位自动扩位，# 可省，大小写均可', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHex('000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHex('#FfAa00')).toEqual({ r: 255, g: 170, b: 0 })
    expect(parseHex('#e4572e')).toEqual({ r: 228, g: 87, b: 46 })
  })

  it('非法一律 null（长度不对、非十六进制字符）', () => {
    expect(parseHex('#ff')).toBeNull()
    expect(parseHex('#fffff')).toBeNull()
    expect(parseHex('#gggggg')).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})

describe('rgbToHex：夹到 0–255、四舍五入', () => {
  it('常规与边界', () => {
    expect(rgbToHex({ r: 228, g: 87, b: 46 })).toBe('#e4572e')
    expect(rgbToHex({ r: 255.4, g: -1, b: 300 })).toBe('#ff00ff')
    expect(rgbToHex({ r: Number.NaN, g: 0, b: 0 })).toBeNull()
  })
})

describe('HSL 往返与已知值', () => {
  it('红 = hsl(0,100%,50%)，白 = hsl(0,0%,100%)', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 })
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 })
  })

  it('HSL → RGB 往返（hue 取能被整数 RGB 量化保真的几档；359° 这类边界会丢一位色相 —— 整数 RGB 的固有精度）', () => {
    for (const hsl of [
      { h: 0, s: 100, l: 50 },
      { h: 90, s: 60, l: 40 },
      { h: 210, s: 60, l: 40 },
      { h: 300, s: 80, l: 60 },
    ]) {
      const rgb = hslToRgb(hsl)
      expect(rgbToHsl(rgb), JSON.stringify(hsl)).toEqual(hsl)
    }
  })

  it('灰阶没有色相：h 随便给，s=0 时结果一样', () => {
    expect(hslToRgb({ h: 0, s: 0, l: 50 })).toEqual(hslToRgb({ h: 200, s: 0, l: 50 }))
  })
})

describe('contrastRatio：WCAG 口径', () => {
  it('黑白 = 21（公式的理论上限）', () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 2)
  })

  it('同色 = 1；顺序无关（谁亮谁做分母是公式的一部分）', () => {
    const red = { r: 228, g: 87, b: 46 }
    const white = { r: 255, g: 255, b: 255 }
    expect(contrastRatio(red, red)).toBeCloseTo(1, 8)
    expect(contrastRatio(red, white)).toBe(contrastRatio(white, red))
  })

  it('readableOn：亮底推黑字、暗底推白字', () => {
    expect(readableOn({ r: 255, g: 255, b: 255 })).toBe('黑字')
    expect(readableOn({ r: 0, g: 0, b: 0 })).toBe('白字')
  })
})
