import { describe, expect, it } from 'vitest'
import { UNITS, convert, unitName } from '@modulo/engine/convert'

describe('convert：长度 / 重量（系数表口径，硬事实钉住）', () => {
  it('1 英里 = 1609.344 米；1 海里 = 1852 米', () => {
    expect(convert(1, 'length', 'mile', 'm')).toBe(1609.344)
    expect(convert(1, 'length', 'nmi', 'm')).toBe(1852)
  })

  it('1 斤 = 500 克；1 磅 ≈ 453.59 克', () => {
    expect(convert(1, 'weight', 'jin', 'g')).toBe(500)
    expect(convert(1, 'weight', 'lb', 'g')).toBeCloseTo(453.59237, 5)
  })

  it('跨大单位：3 GB = 3 × 1024² KB（1024 口径写在表注释里）', () => {
    expect(convert(3, 'data', 'gb', 'kb')).toBe(3 * 1024 * 1024)
  })

  it('往返应回到原值（系数互为倒数）', () => {
    for (const u of UNITS.length) {
      const there = convert(123.456, 'length', 'm', u.id)!
      const back = convert(there, 'length', u.id, 'm')!
      expect(back, u.id).toBeCloseTo(123.456, 6)
    }
  })

  it('速度：1 m/s = 3.6 km/h；1 节 ≈ 0.514 m/s', () => {
    expect(convert(1, 'speed', 'ms', 'kmh')).toBeCloseTo(3.6, 10)
    expect(convert(1, 'speed', 'knot', 'ms')).toBeCloseTo(0.514444, 8)
  })

  it('面积：1 亩 = 2000/3 m²（666.67 那个数不许写死）', () => {
    expect(convert(1, 'area', 'mu', 'm2')).toBeCloseTo(666.6667, 3)
    expect(convert(1, 'area', 'ha', 'mu')).toBeCloseTo(15, 6)
  })
})

describe('convertTemperature：三条公式单列', () => {
  it('100°F = 37.78°C；0°C = 273.15K；-40 度两表相同', () => {
    expect(convert(100, 'temperature', 'f', 'c')).toBeCloseTo(37.7778, 4)
    expect(convert(0, 'temperature', 'c', 'k')).toBe(273.15)
    expect(convert(-40, 'temperature', 'f', 'c')).toBe(-40)
    expect(convert(-40, 'temperature', 'c', 'f')).toBe(-40)
  })

  it('绝对零度以下不做物理检查 —— 换算器只管换算，不管你想要多冷', () => {
    expect(convert(-500, 'temperature', 'c', 'k')).toBeCloseTo(-226.85, 4)
  })
})

describe('认不出的单位与类别：null，不编数', () => {
  it('未知单位 / 未知类别 / 非有限数', () => {
    expect(convert(1, 'length', 'parsec', 'm')).toBeNull()
    expect(convert(1, 'length', 'm', 'langtang')).toBeNull()
    expect(convert(1, 'currency' as never, 'usd', 'cny')).toBeNull()
    expect(convert(Number.NaN, 'length', 'm', 'km')).toBeNull()
  })

  it('unitName：给确认行用；认不出原样返回', () => {
    expect(unitName('weight', 'jin')).toBe('斤')
    expect(unitName('weight', 'nope')).toBe('nope')
  })
})
