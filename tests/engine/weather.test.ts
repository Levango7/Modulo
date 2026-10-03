import { describe, expect, it } from 'vitest'
import { DEFAULT_CITY_ID, WEATHER_CITIES, cityById, dayLabel, formatTemp, freshness, parseWeather, weatherKind, weatherText, weatherUrl } from '@modulo/engine/weather'

/**
 * 夹具是**真的**：2026-10-03 15:15 从 open-meteo 抓到的那份上海响应（截掉与卡片无关的
 * 顶层字段，daily 数组原样保留）。判据必须建立在真形状上 —— 编一个"我以为是"的响应，
 * 等于测自己的想象。
 */
const REAL = {
  current: { time: '2026-10-03T15:15', interval: 900, temperature_2m: 20.6, weather_code: 51 },
  daily: {
    time: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'],
    weather_code: [80, 81, 3, 1],
    temperature_2m_max: [22.9, 23.4, 22.5, 22.1],
    temperature_2m_min: [18.4, 19.5, 17.0, 13.8],
    sunrise: ['2026-10-03T05:48', '2026-10-04T05:49', '2026-10-05T05:49', '2026-10-06T05:50'],
    sunset: ['2026-10-03T17:37', '2026-10-04T17:35', '2026-10-05T17:34', '2026-10-06T17:33'],
  },
}

describe('parseWeather：只认自己画得出来的形状', () => {
  it('真响应收窄成快照：当前温度/天气码、今天高低温、日出日落、明天起 3 天', () => {
    const s = parseWeather(REAL, '上海', 1000)
    expect(s).not.toBeNull()
    expect(s!.temp).toBe(20.6)
    expect(s!.code).toBe(51)
    expect(s!.high).toBe(22.9)
    expect(s!.low).toBe(18.4)
    expect(s!.sunrise).toBe('05:48')
    expect(s!.sunset).toBe('17:37')
    expect(s!.days).toHaveLength(3)
    expect(s!.days[0]).toEqual({ date: '2026-10-04', code: 81, high: 23.4, low: 19.5 })
    expect(s!.fetchedAt).toBe(1000)
    expect(s!.place).toBe('上海')
  })

  it('永远不抛：不是对象 / 缺 current / 缺 daily / 数组不齐 / 混进字符串，一律 null', () => {
    expect(parseWeather(null, '上海', 0)).toBeNull()
    expect(parseWeather('字符串', '上海', 0)).toBeNull()
    expect(parseWeather({}, '上海', 0)).toBeNull()
    expect(parseWeather({ current: REAL.current }, '上海', 0)).toBeNull()
    expect(parseWeather({ daily: REAL.daily }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, time: ['只有一天'] } }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: { ...REAL.current, temperature_2m: '20' }, daily: REAL.daily }, '上海', 0)).toBeNull()
    // 高低温数组比 time 短 → 半张卡，不如不给
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, temperature_2m_max: [22.9] } }, '上海', 0)).toBeNull()
  })

  it('只有今天、没有明天（forecast_days=1 的服务端口径变化）也拒 —— 卡上那三格会空', () => {
    const one = { current: REAL.current, daily: { ...REAL.daily, time: ['2026-10-03'], weather_code: [80], temperature_2m_max: [22.9], temperature_2m_min: [18.4] } }
    expect(parseWeather(one, '上海', 0)).toBeNull()
  })

  it('日出日落拿不到时降级成 --:--，但不因此丢掉整张卡（这两格是配菜）', () => {
    const s = parseWeather({ current: REAL.current, daily: { ...REAL.daily, sunrise: [], sunset: undefined } }, '上海', 0)
    expect(s).not.toBeNull()
    expect(s!.sunrise).toBe('--:--')
    expect(s!.sunset).toBe('--:--')
  })

  /**
   * 防线细节。这些分支不常被真实响应走到，但它们就是"收窄"这两个字的分量 ——
   * 漏一条，坏数据就会以半张卡的形式出现在用户面前。
   */
  it('非有限数按"没有"处理（NaN / Infinity 都不当温度）', () => {
    expect(parseWeather({ current: { ...REAL.current, temperature_2m: Infinity }, daily: REAL.daily }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: { ...REAL.current, weather_code: NaN }, daily: REAL.daily }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: { ...REAL.current, weather_code: undefined }, daily: REAL.daily }, '上海', 0)).toBeNull()
  })

  it('低温和高温数组都能触发"长度不齐"的拒收（不是只看第一支）', () => {
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, temperature_2m_min: [18.4] } }, '上海', 0)).toBeNull()
  })

  it('日出串里没有 T（上游若改成裸日期）→ 降级 --:--，不丢卡', () => {
    const s = parseWeather({ current: REAL.current, daily: { ...REAL.daily, sunrise: ['2026-10-03'], sunset: ['2026-10-03'] } }, '上海', 0)
    expect(s).not.toBeNull()
    expect(s!.sunrise).toBe('--:--')
  })

  it('明天起某一天的字段坏了 → 整张拒（半张预报比没有更糟）', () => {
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, time: ['2026-10-03', 5, '2026-10-05', '2026-10-06'] } }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, temperature_2m_max: [22.9, 'x', 22.5, 22.1] } }, '上海', 0)).toBeNull()
    expect(parseWeather({ current: REAL.current, daily: { ...REAL.daily, temperature_2m_min: [18.4, 19.5, null, 13.8] } }, '上海', 0)).toBeNull()
  })

  it('weather_code 列缺失 / 短了 / 混进字符串：退成 0（显示"天气未知"），不拒整张', () => {
    const none = parseWeather({ current: REAL.current, daily: { ...REAL.daily, weather_code: undefined } }, '上海', 0)
    expect(none!.days.map((d) => d.code)).toEqual([0, 0, 0])
    const short = parseWeather({ current: REAL.current, daily: { ...REAL.daily, weather_code: [80, 81] } }, '上海', 0)
    expect(short!.days.map((d) => d.code)).toEqual([81, 0, 0])
    const mixed = parseWeather({ current: REAL.current, daily: { ...REAL.daily, weather_code: [80, '雨', 3, 1] } }, '上海', 0)
    expect(mixed!.days.map((d) => d.code)).toEqual([0, 3, 1])
  })
})

describe('WMO 码 → 语义与中文', () => {
  it('大类映射覆盖文档里的每一段，表外一律 unknown', () => {
    expect(weatherKind(0)).toBe('clear')
    expect(weatherKind(2)).toBe('partly')
    expect(weatherKind(3)).toBe('cloudy')
    expect(weatherKind(45)).toBe('fog')
    expect(weatherKind(51)).toBe('drizzle')
    expect(weatherKind(63)).toBe('rain')
    expect(weatherKind(80)).toBe('rain')
    expect(weatherKind(75)).toBe('snow')
    expect(weatherKind(86)).toBe('snow')
    expect(weatherKind(96)).toBe('storm')
    expect(weatherKind(1234)).toBe('unknown')
    expect(weatherKind(-1)).toBe('unknown')
  })

  it('中文短句：常见码都在表里，表外给"天气未知"而不是编一个', () => {
    expect(weatherText(0)).toBe('晴')
    expect(weatherText(51)).toBe('毛毛雨')
    expect(weatherText(95)).toBe('雷阵雨')
    expect(weatherText(1234)).toBe('天气未知')
  })

  it('温度取整加度号，负数不写成 +-3°', () => {
    expect(formatTemp(20.6)).toBe('21°')
    expect(formatTemp(0)).toBe('0°')
    expect(formatTemp(-3.4)).toBe('-3°')
    expect(formatTemp(-0.2)).toBe('0°')
  })

  it('日期 → 周几：按本地日期解析（`new Date("YYYY-MM-DD")` 是 UTC，跨时区会差一天）', () => {
    expect(dayLabel('2026-10-04')).toBe('周日')
    expect(dayLabel('2026-10-05')).toBe('周一')
    expect(dayLabel('2026-10-10')).toBe('周六')
    // 认不出的原样返回，不编一个
    expect(dayLabel('10-04')).toBe('10-04')
  })
})

describe('新鲜度：卡片上那句"多久之前"', () => {
  const t = 1_000_000_000_000
  it('分段给话：1 分钟内"刚刚"、小时内按分钟、24 小时内按小时、再往上按天', () => {
    expect(freshness(t, t + 30_000)).toBe('刚刚更新')
    expect(freshness(t, t + 5 * 60_000 + 1000)).toBe('5 分钟前更新')
    expect(freshness(t, t + 59 * 60_000)).toBe('59 分钟前更新')
    expect(freshness(t, t + 3 * 3600_000 + 1000)).toBe('3 小时前更新')
    expect(freshness(t, t + 26 * 3600_000)).toBe('1 天前更新')
  })
})

describe('城市表与请求 URL', () => {
  it('城市 id 唯一、默认城市在表里', () => {
    const ids = WEATHER_CITIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_CITY_ID)
  })

  it('认不出的 id 回落到默认城市（存档里的城市被删了不该让卡片空掉）', () => {
    expect(cityById('shanghai').name).toBe('上海')
    expect(cityById('atlantis').id).toBe(DEFAULT_CITY_ID)
  })

  it('URL 把坐标与口径都写全：forecast_days=4 —— 今天 + 明天起 3 天', () => {
    const u = weatherUrl(cityById('beijing'))
    expect(u).toContain('latitude=39.9')
    expect(u).toContain('longitude=116.41')
    expect(u).toContain('forecast_days=4')
    expect(u).toContain('timezone=Asia%2FShanghai')
    expect(u).toContain('sunrise')
  })
})
