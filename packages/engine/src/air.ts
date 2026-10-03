/**
 * 空气质量：解析 open-meteo 的 air-quality 响应 + 美国 AQI 分档。
 *
 * 与天气卡用**同一个城市**（读 `modulo.weather.v1` 的 `cityId`）—— 用户已经选了城市，
 * 再问一遍是骚扰。分档按美国 AQI 的六段（0–50 优 … 301+ 严重），边界值有单测。
 */

import { query } from './weather.js'
import type { WeatherCity } from './weather.js'

export interface AirSnapshot {
  aqi: number
  pm25: number
  pm10: number
  fetchedAt: number
}

export type AirKind = 'good' | 'ok' | 'light' | 'moderate' | 'heavy' | 'severe'

export interface AirLevel {
  label: string
  kind: AirKind
}

/** 美国 AQI 六段；边界取"到该值为止"（50 仍是优） */
export function aqiLevel(aqi: number): AirLevel {
  if (!Number.isFinite(aqi) || aqi < 0) return { label: '未知', kind: 'ok' }
  if (aqi <= 50) return { label: '优', kind: 'good' }
  if (aqi <= 100) return { label: '良', kind: 'ok' }
  if (aqi <= 150) return { label: '轻度污染', kind: 'light' }
  if (aqi <= 200) return { label: '中度污染', kind: 'moderate' }
  if (aqi <= 300) return { label: '重度污染', kind: 'heavy' }
  return { label: '严重污染', kind: 'severe' }
}

export function airUrl(city: WeatherCity): string {
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${query({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: 'pm2_5,pm10,us_aqi',
    timezone: 'Asia/Shanghai',
  })}`
}

/** 与天气同一条纪律：形状不对就 null，不半填 */
export function parseAir(payload: unknown, now: number): AirSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const current = (payload as { current?: unknown }).current
  if (typeof current !== 'object' || current === null) return null
  const c = current as Record<string, unknown>
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const aqi = num(c.us_aqi)
  const pm25 = num(c.pm2_5)
  const pm10 = num(c.pm10)
  if (aqi === null || pm25 === null || pm10 === null) return null
  return { aqi, pm25, pm10, fetchedAt: now }
}
