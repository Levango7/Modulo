/**
 * 世界时钟：几个城市的当前时间、各自的 UTC 偏移、以及与本地相差多少。
 *
 * **偏移表一行都不手写**：夏令时、半小时时区（+5:30）、历史变更全在 ICU 数据里，
 * 手写的表迟早错，而错了还没有人会立刻发现 —— 交给 `Intl`。
 *
 * 工程上的分层（这条决定了它能不能被测）：
 * - 引擎返回**绝对事实** —— 某地在某瞬间的 `hh:mm`、日期、偏移分钟；
 * - "与本地相差多少"拆成 `relativeLabel(cityOffsetMin, localOffsetMin)` —— 纯函数，
 *   本地时区由界面层去问，**测试因此不依赖跑测机器的时区**。
 */

export interface WorldCity {
  id: string
  name: string
  /** IANA 时区名 */
  tz: string
}

export const WORLD_CITIES: readonly WorldCity[] = [
  { id: 'shanghai', name: '上海', tz: 'Asia/Shanghai' },
  { id: 'tokyo', name: '东京', tz: 'Asia/Tokyo' },
  { id: 'singapore', name: '新加坡', tz: 'Asia/Singapore' },
  { id: 'dubai', name: '迪拜', tz: 'Asia/Dubai' },
  { id: 'london', name: '伦敦', tz: 'Europe/London' },
  { id: 'paris', name: '巴黎', tz: 'Europe/Paris' },
  { id: 'new-york', name: '纽约', tz: 'America/New_York' },
  { id: 'los-angeles', name: '洛杉矶', tz: 'America/Los_Angeles' },
  { id: 'sydney', name: '悉尼', tz: 'Australia/Sydney' },
]

export const DEFAULT_WORLD_CITY_IDS: readonly string[] = ['shanghai', 'london', 'new-york']
export const MAX_WORLD_CITIES = 4

export function worldCityById(id: string): WorldCity | null {
  return WORLD_CITIES.find((c) => c.id === id) ?? null
}

/**
 * 存储里的城市列表**不信任**：去重、丢掉不认识的、砍到上限、空的话回落到默认 ——
 * 与 `sanitizeItems` 同一套纪律（盘上的数据可能来自旧版本或别的机器）。
 */
export function sanitizeCityIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    if (!worldCityById(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.length ? out.slice(0, MAX_WORLD_CITIES) : [...DEFAULT_WORLD_CITY_IDS]
}

function partsInTz(tz: string, at: Date): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]))
}

/** 该时区在某瞬间的 UTC 偏移（分钟）。用"同一瞬间在目标时区与 UTC 各读一次表"求差 —— ICU 是唯一权威。 */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = partsInTz(tz, at)
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  )
  // 格式化只到秒：先把毫秒抹掉再比，差值是整分钟
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

export interface CityClock {
  /** 该城市的当前时间，`HH:mm` */
  hhmm: string
  /** 该城市的当前日期，`MM-DD`（与本地不同日时界面才显示它） */
  dateStr: string
  offsetMin: number
}

export function cityClock(city: WorldCity, at: Date): CityClock {
  const p = partsInTz(city.tz, at)
  // hour12:false 在部分 ICU 版本里把午夜给成 "24" —— 自己归一，不赌
  const hh = String(Number(p.hour) % 24).padStart(2, '0')
  return {
    hhmm: `${hh}:${p.minute}`,
    dateStr: `${p.month}-${p.day}`,
    offsetMin: tzOffsetMinutes(city.tz, at),
  }
}

/** "与本地同时" / "早 8 小时" / "晚 2.5 小时" —— 半小时时区（印度 +5:30）也说得出来 */
export function relativeLabel(cityOffsetMin: number, localOffsetMin: number): string {
  const diff = cityOffsetMin - localOffsetMin
  if (diff === 0) return '与本地同时'
  const hours = Math.abs(diff) / 60
  const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
  return `${diff > 0 ? '早' : '晚'} ${text} 小时`
}
