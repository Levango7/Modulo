import { describe, expect, it } from 'vitest'
import { airUrl, aqiLevel, parseAir } from '@modulo/engine/air'
import { cityById } from '@modulo/engine/weather'

/** 真夹具：2026-10-04 03:00（当地）抓的上海空气质量响应 */
const REAL = {
  latitude: 31.200005,
  longitude: 121.5,
  timezone: 'Asia/Shanghai',
  current_units: { time: 'iso8601', interval: 'seconds', pm2_5: 'μg/m³', pm10: 'μg/m³', us_aqi: 'USAQI' },
  current: { time: '2026-10-04T06:00', interval: 3600, pm2_5: 12.0, pm10: 13.1, us_aqi: 71 },
}

describe('parseAir：与天气同一条纪律', () => {
  it('真响应收窄成快照', () => {
    const s = parseAir(REAL, 5)
    expect(s).toEqual({ aqi: 71, pm25: 12, pm10: 13.1, fetchedAt: 5 })
  })

  it('缺字段 / 类型错 / 形状不对一律 null（不半填）', () => {
    expect(parseAir({}, 0)).toBeNull()
    expect(parseAir({ current: {} }, 0)).toBeNull()
    expect(parseAir({ current: { us_aqi: 71, pm2_5: 12 } }, 0)).toBeNull()
    expect(parseAir({ current: { us_aqi: '71', pm2_5: 12, pm10: 13 } }, 0)).toBeNull()
    expect(parseAir(null, 0)).toBeNull()
  })

  it('URL 用天气卡的城市（两只卡同一个地方）', () => {
    const u = airUrl(cityById('shanghai'))
    expect(u).toContain('air-quality-api.open-meteo.com')
    expect(u).toContain('latitude=31.23')
    expect(u).toContain('us_aqi')
    expect(u).not.toContain('URLSearchParams')
  })
})

describe('aqiLevel：美国 AQI 六段的边界值逐个数', () => {
  it('每一段的上下边界', () => {
    expect(aqiLevel(0).label).toBe('优')
    expect(aqiLevel(50).label).toBe('优') // 边界归上一段
    expect(aqiLevel(51).label).toBe('良')
    expect(aqiLevel(100).label).toBe('良')
    expect(aqiLevel(101).label).toBe('轻度污染')
    expect(aqiLevel(150).label).toBe('轻度污染')
    expect(aqiLevel(151).label).toBe('中度污染')
    expect(aqiLevel(200).label).toBe('中度污染')
    expect(aqiLevel(201).label).toBe('重度污染')
    expect(aqiLevel(300).label).toBe('重度污染')
    expect(aqiLevel(301).label).toBe('严重污染')
    expect(aqiLevel(500).label).toBe('严重污染')
  })

  it('坏输入给"未知"而不是编一个档', () => {
    expect(aqiLevel(Number.NaN).label).toBe('未知')
    expect(aqiLevel(-1).label).toBe('未知')
  })

  it('kind 是给界面色的语义（六个不同的值）', () => {
    const kinds = [10, 80, 120, 180, 250, 400].map((v) => aqiLevel(v).kind)
    expect(new Set(kinds).size).toBe(6)
  })
})
