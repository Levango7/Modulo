/**
 * 单位换算：长度 / 重量 / 温度 / 面积 / 速度 / 数据量。
 *
 * 全部走"基准单位 + 系数"的表（温度除外 —— 它是非线性的，三条公式单列）。
 * 表在这里的好处：加一个单位 = 加一行，`convert` 与界面都不用动；
 * 而每一个系数都能被单测拿"1 英里 = 1609.344 米"这类硬事实钉住。
 */

export type UnitCategory = 'length' | 'weight' | 'temperature' | 'area' | 'speed' | 'data'

export interface UnitDef {
  id: string
  name: string
  /** 相对基准单位的系数（温度除外） */
  factor: number
}

export const UNITS: Record<UnitCategory, readonly UnitDef[]> = {
  length: [
    { id: 'km', name: '千米', factor: 1000 },
    { id: 'm', name: '米', factor: 1 },
    { id: 'cm', name: '厘米', factor: 0.01 },
    { id: 'mm', name: '毫米', factor: 0.001 },
    { id: 'mile', name: '英里', factor: 1609.344 },
    { id: 'nmi', name: '海里', factor: 1852 },
    { id: 'foot', name: '英尺', factor: 0.3048 },
    { id: 'inch', name: '英寸', factor: 0.0254 },
  ],
  weight: [
    { id: 't', name: '吨', factor: 1000 },
    { id: 'kg', name: '千克', factor: 1 },
    { id: 'jin', name: '斤', factor: 0.5 },
    { id: 'g', name: '克', factor: 0.001 },
    { id: 'lb', name: '磅', factor: 0.45359237 },
    { id: 'oz', name: '盎司', factor: 0.028349523125 },
  ],
  temperature: [
    { id: 'c', name: '°C', factor: 1 },
    { id: 'f', name: '°F', factor: 1 },
    { id: 'k', name: 'K', factor: 1 },
  ],
  area: [
    { id: 'km2', name: '平方千米', factor: 1_000_000 },
    { id: 'ha', name: '公顷', factor: 10_000 },
    { id: 'mu', name: '亩', factor: 2000 / 3 },
    { id: 'm2', name: '平方米', factor: 1 },
    { id: 'ft2', name: '平方英尺', factor: 0.09290304 },
  ],
  speed: [
    { id: 'kmh', name: '千米/时', factor: 1 / 3.6 },
    { id: 'ms', name: '米/秒', factor: 1 },
    { id: 'mph', name: '英里/时', factor: 0.44704 },
    { id: 'knot', name: '节', factor: 0.514444 },
  ],
  data: [
    // 口径写死：1 KB = 1024 B（口语里的 KB/MB/GB，不是 KiB 的严格记法）
    { id: 'gb', name: 'GB', factor: 1024 ** 3 },
    { id: 'mb', name: 'MB', factor: 1024 ** 2 },
    { id: 'kb', name: 'KB', factor: 1024 },
    { id: 'b', name: 'B', factor: 1 },
  ],
}

export function unitName(category: UnitCategory, id: string): string {
  return UNITS[category].find((u) => u.id === id)?.name ?? id
}

/** 温度三条公式单列：°C 是枢纽 */
function convertTemperature(v: number, from: string, to: string): number | null {
  const toC = from === 'c' ? v : from === 'f' ? ((v - 32) * 5) / 9 : from === 'k' ? v - 273.15 : null
  if (toC === null || !Number.isFinite(toC)) return null
  if (to === 'c') return toC
  if (to === 'f') return (toC * 9) / 5 + 32
  if (to === 'k') return toC + 273.15
  return null
}

/** 换算。类别/单位认不出返回 `null`（界面显示"—），不编一个数 */
export function convert(value: number, category: UnitCategory, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null
  if (category === 'temperature') return convertTemperature(value, from, to)
  const table = UNITS[category]
  if (!table) return null
  const f = table.find((u) => u.id === from)
  const t = table.find((u) => u.id === to)
  if (!f || !t) return null
  return (value * f.factor) / t.factor
}
