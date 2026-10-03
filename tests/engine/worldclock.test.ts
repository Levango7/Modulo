import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORLD_CITY_IDS,
  MAX_WORLD_CITIES,
  WORLD_CITIES,
  cityClock,
  relativeLabel,
  sanitizeCityIds,
  tzOffsetMinutes,
  worldCityById,
} from '@modulo/engine/worldclock'

/**
 * 全部用**固定瞬间**（UTC 写死）+ **已知偏移**断言。偏移是这两条线的事实（含夏令时），
 * 所以测试既不依赖跑测机器的时区，也不需要联网。
 */
const winter = new Date('2026-01-15T00:00:00Z')
const summer = new Date('2026-07-15T00:00:00Z')

describe('tzOffsetMinutes：交给 ICU，但口径要自己钉住', () => {
  it('不实行夏令时的时区：全年一个值', () => {
    expect(tzOffsetMinutes('Asia/Shanghai', winter)).toBe(480)
    expect(tzOffsetMinutes('Asia/Shanghai', summer)).toBe(480)
    expect(tzOffsetMinutes('Asia/Tokyo', winter)).toBe(540)
  })

  it('半小时时区（印度 +5:30）也不能被抹成整天', () => {
    expect(tzOffsetMinutes('Asia/Kolkata', winter)).toBe(330)
  })

  it('实行夏令时的时区：冬夏各一个值，差一小时', () => {
    expect(tzOffsetMinutes('America/New_York', winter)).toBe(-300)
    expect(tzOffsetMinutes('America/New_York', summer)).toBe(-240)
    expect(tzOffsetMinutes('Europe/London', winter)).toBe(0)
    expect(tzOffsetMinutes('Europe/London', summer)).toBe(60)
  })

  it('南半球的夏令时方向相反（悉尼 1 月是夏天）', () => {
    expect(tzOffsetMinutes('Australia/Sydney', winter)).toBe(660)
    expect(tzOffsetMinutes('Australia/Sydney', summer)).toBe(600)
  })
})

describe('cityClock：某地此刻的 HH:mm 与日期', () => {
  it('东京：UTC 零点 = 当地 09:00，同一天', () => {
    const c = cityClock(worldCityById('tokyo')!, winter)
    expect(c.hhmm).toBe('09:00')
    expect(c.dateStr).toBe('01-15')
    expect(c.offsetMin).toBe(540)
  })

  it('洛杉矶：UTC 零点 = 前一天 16:00 —— 日期要跟着跨回去', () => {
    const c = cityClock(worldCityById('los-angeles')!, winter)
    expect(c.hhmm).toBe('16:00')
    expect(c.dateStr).toBe('01-14')
  })

  it('午夜显示 00:00，不显示 24:00（部分 ICU 版本会给 24 —— 实现里自己归一了）', () => {
    const c = cityClock(worldCityById('shanghai')!, new Date('2026-01-14T16:00:00Z'))
    expect(c.hhmm).toBe('00:00')
    expect(c.dateStr).toBe('01-15')
  })
})

describe('relativeLabel：纯函数，不依赖跑测机器的时区', () => {
  it('同时 / 早 / 晚', () => {
    expect(relativeLabel(480, 480)).toBe('与本地同时')
    expect(relativeLabel(480, 0)).toBe('早 8 小时')
    expect(relativeLabel(0, 480)).toBe('晚 8 小时')
  })

  it('半小时与带小数的小时', () => {
    expect(relativeLabel(330, 480)).toBe('晚 2.5 小时')
    expect(relativeLabel(345, 480)).toBe('晚 2.3 小时') // 尼泊尔 +5:45 这类
  })

  it('跨 12 小时的极端（洛杉矶 vs 上海）', () => {
    expect(relativeLabel(-480, 480)).toBe('晚 16 小时')
  })
})

describe('城市表与存储清洗', () => {
  it('id 唯一、默认城市都在表里、上限是个正数', () => {
    const ids = WORLD_CITIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of DEFAULT_WORLD_CITY_IDS) expect(ids).toContain(id)
    expect(MAX_WORLD_CITIES).toBeGreaterThanOrEqual(DEFAULT_WORLD_CITY_IDS.length)
  })

  it('不信任存储：去重、丢不认识的、砍到上限', () => {
    expect(sanitizeCityIds(['tokyo', 'tokyo', 'atlantis', 'london'])).toEqual(['tokyo', 'london'])
    expect(sanitizeCityIds(['shanghai', 'tokyo', 'london', 'paris', 'dubai', 'sydney'])).toHaveLength(MAX_WORLD_CITIES)
  })

  it('空数组 / 全是不认识的 → 回落到默认，卡片不会空着', () => {
    expect(sanitizeCityIds([])).toEqual([...DEFAULT_WORLD_CITY_IDS])
    expect(sanitizeCityIds(['atlantis', 'gotham'])).toEqual([...DEFAULT_WORLD_CITY_IDS])
  })

  it('worldCityById 认不出返回 null（界面据此跳过，不编一个城市出来）', () => {
    expect(worldCityById('shanghai')?.name).toBe('上海')
    expect(worldCityById('atlantis')).toBeNull()
  })
})
