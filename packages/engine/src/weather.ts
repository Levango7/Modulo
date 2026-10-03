/**
 * 天气卡的数据层：把 open-meteo 的响应**收窄**成卡片真正要画的那几个数。
 *
 * 为什么放在引擎里：这一步全是纯函数（不碰网络、不碰 DOM），而"远端返回的不是我们以为的形状"
 * 是这条链路上唯一会真的出错的地方 —— 它必须能被单测直接压。网络、缓存与城市选择在
 * `src/vue/useWeather.ts`（片刻意不 import 浏览器 API，所以能在这里被 node 环境测）。
 *
 * 数据源选 open-meteo 就三条理由：**不要 key**、**CORS 是 `*`**（网页版同样能用）、
 * 一个请求里连日出日落都给（够画整张卡，不用第二次请求）。
 *
 * 收窄的纪律与 `parseLayout` / `parseBackup` 一致：**永不抛异常**，形状不对就返回 null，
 * 由调用方决定给用户看什么（"取不到"也是合法状态）。
 */

/** 一个城市 + 它给 open-meteo 的坐标。默认上海（本项目作者的所在地）。 */
export interface WeatherCity {
  id: string
  name: string
  lat: number
  lon: number
}

export const WEATHER_CITIES: readonly WeatherCity[] = [
  { id: 'shanghai', name: '上海', lat: 31.23, lon: 121.47 },
  { id: 'beijing', name: '北京', lat: 39.9, lon: 116.41 },
  { id: 'shenzhen', name: '深圳', lat: 22.54, lon: 114.06 },
  { id: 'hangzhou', name: '杭州', lat: 30.27, lon: 120.16 },
  { id: 'nanjing', name: '南京', lat: 32.06, lon: 118.8 },
  { id: 'suzhou', name: '苏州', lat: 31.3, lon: 120.58 },
  { id: 'guangzhou', name: '广州', lat: 23.13, lon: 113.26 },
  { id: 'chengdu', name: '成都', lat: 30.57, lon: 104.07 },
  { id: 'wuhan', name: '武汉', lat: 30.59, lon: 114.31 },
  { id: 'xian', name: '西安', lat: 34.34, lon: 108.94 },
]

export const DEFAULT_CITY_ID = 'shanghai'

/** 认不出 id 时回落到默认城市 —— 存档里的城市被删掉不该让卡片空掉 */
export function cityById(id: string): WeatherCity {
  return WEATHER_CITIES.find((c) => c.id === id) ?? WEATHER_CITIES.find((c) => c.id === DEFAULT_CITY_ID)!
}

/** 天气的"大类"。为什么不在这里塞 emoji：图标是界面的事，引擎只该给语义。 */
export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' | 'unknown'

/** WMO weather code → 大类。表来自 open-meteo 文档；表外的一律 unknown，别猜。 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return 'clear'
  if (code === 1 || code === 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  // 显式列举而不是 `>= 95`：写开区间的话，表外的大数（将来的新码）会被当成雷暴 —— 单测抓到过
  if (code === 95 || code === 96 || code === 99) return 'storm'
  return 'unknown'
}

const TEXT: Record<number, string> = {
  0: '晴',
  1: '少云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '冻雾',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  56: '冻毛毛雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷雨伴冰雹',
  99: '强雷雨伴冰雹',
}

/** WMO code → 中文短句。表外给"天气未知"，不编造。 */
export function weatherText(code: number): string {
  return TEXT[code] ?? '天气未知'
}

/** 温度：取整加度号。负数别写成 "+-3°"。 */
export function formatTemp(celsius: number): string {
  return `${Math.round(celsius)}°`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** `YYYY-MM-DD` → `周四`。字符串解析不经过时区（`new Date('2026-10-04')` 会被当 UTC，跨时区会差一天）。 */
export function dayLabel(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return date
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return WEEKDAYS[d.getDay()]
}

/**
 * "多久之前取的"。卡片上必须有人话的时间戳：一份不显示新鲜度的天气数据比没有更糟
 * （用户会以为窗外就是那样）。
 */
export function freshness(fetchedAt: number, now: number): string {
  const min = Math.floor((now - fetchedAt) / 60_000)
  if (min < 1) return '刚刚更新'
  if (min < 60) return `${min} 分钟前更新`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前更新`
  return `${Math.floor(hours / 24)} 天前更新`
}

export interface WeatherDay {
  /** `YYYY-MM-DD`，直接用上游给的（不再自己格式化一次，少一个漂移点） */
  date: string
  code: number
  high: number
  low: number
}

export interface WeatherSnapshot {
  place: string
  temp: number
  code: number
  high: number
  low: number
  /** `HH:mm` */
  sunrise: string
  sunset: string
  /** 明天起的预报（今天的高低温已经在 high/low 里了） */
  days: WeatherDay[]
  fetchedAt: number
}

/** 请求 URL：参数写死在这里，改口径只改一处；`forecast_days=4` = 今天 + 明天起 3 天 */
export function weatherUrl(city: WeatherCity): string {
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    timezone: 'Asia/Shanghai',
    forecast_days: '4',
  })
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `2026-10-03T05:48` → `05:48`（上游给的是当地时间，不是 UTC，别再过一次 Date） */
function hhmm(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const m = iso.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : null
}

/**
 * 收窄 open-meteo 的响应。形状不对（少字段、类型错、数组长度不齐）一律返回 null ——
 * **不做部分填充**：一张只画了一半的天气卡会让人误读窗外。
 */
export function parseWeather(payload: unknown, place: string, now: number): WeatherSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as { current?: unknown; daily?: unknown }
  if (typeof p.current !== 'object' || p.current === null) return null
  if (typeof p.daily !== 'object' || p.daily === null) return null

  const cur = p.current as Record<string, unknown>
  const daily = p.daily as Record<string, unknown>
  const temp = num(cur.temperature_2m)
  const code = num(cur.weather_code)
  const time = daily.time
  const highs = daily.temperature_2m_max
  const lows = daily.temperature_2m_min
  if (temp === null || code === null) return null
  if (!Array.isArray(time) || !Array.isArray(highs) || !Array.isArray(lows)) return null
  if (time.length !== highs.length || time.length !== lows.length || time.length < 2) return null

  const high = num(highs[0])
  const low = num(lows[0])
  if (high === null || low === null) return null

  const sunrise = hhmm(Array.isArray(daily.sunrise) ? daily.sunrise[0] : null)
  const sunset = hhmm(Array.isArray(daily.sunset) ? daily.sunset[0] : null)

  const days: WeatherDay[] = []
  for (let i = 1; i < time.length; i++) {
    const d = num(highs[i])
    const n = num(lows[i])
    const c = Array.isArray(daily.weather_code) ? num(daily.weather_code[i]) : 0
    if (typeof time[i] !== 'string' || d === null || n === null) return null
    days.push({ date: time[i] as string, code: c ?? 0, high: d, low: n })
  }

  return {
    place,
    temp,
    code,
    high,
    low,
    sunrise: sunrise ?? '--:--',
    sunset: sunset ?? '--:--',
    days,
    fetchedAt: now,
  }
}
