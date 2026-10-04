/**
 * 会议规划器：把一个**本地时间**的会，换算成每个参会城市当地几点、该不该这个点开会。
 *
 * 这张卡解决的是一个很具体的难受事："我说晚上 8 点开，你那边是几点？"
 * 因此它的输入只有**一个时刻**（本地墙上时间），输出是一张各城对照表 + 一句该不该开的话。
 * 不做"大家投票填空"那种会议调度 —— 那是日历产品的活，这里只做换算与判断。
 *
 * **偏移一行都不手写**：与 `worldclock` 同一条纪律，全部交给 `Intl`（夏令时、半小时时区、
 * 历史变更都在 ICU 数据里）。这个模块与 `worldclock.ts` 的分工是：
 * 那张卡答"某城现在几点"，这张卡答"我这个会在某城是几点、且合不合理"。
 */

import { cityClock, relativeLabel, tzOffsetMinutes, worldCityById, WORLD_CITIES, type WorldCity } from './worldclock.js'

/** 本地时区的偏移由界面层问（测试因此不依赖跑测机器的时区） */
export function localOffsetMinutes(now: Date): number {
  return -now.getTimezoneOffset()
}

/** 工作时间的判定口径。写死在这里而不是做成设置项 —— 加班文化差异太大，一个默认值总比一个假设置诚实 */
export const WORK_START_HOUR = 9
export const WORK_END_HOUR = 18

/** 参会城市上限。4 行是一张卡在 3 逻辑列里还能不截字的上限，与 `worldclock` 同一条 */
export const MAX_MEETING_CITIES = 4

export type SlotVerdict = 'work' | 'early' | 'evening' | 'sleep' | 'weekend'

export interface VerdictInfo {
  verdict: SlotVerdict
  label: string
}

const VERDICTS: Record<SlotVerdict, string> = {
  work: '工作时间',
  early: '太早了',
  evening: '下班后',
  sleep: '半夜',
  weekend: '周末',
}

/**
 * 这个点合不合适。判定顺序有讲究：
 * 1. **周末优先于时段** —— 周六上午 10 点在"工作时间"区间内，但它显然不是工作时间；
 * 2. 时段阈值从早到晚依次判，避免出现"永远走不到的分支"。
 *
 * 各段：00:00–04:59 半夜 / 05:00–08:59 太早 / 09:00–17:59 工作时间 / 18:00–21:59 下班后 / 22:00 之后 半夜。
 */
export function slotVerdict(hour: number, weekday: number): VerdictInfo {
  if (weekday === 0 || weekday === 6) return { verdict: 'weekend', label: VERDICTS.weekend }
  if (hour < 5) return { verdict: 'sleep', label: VERDICTS.sleep }
  if (hour < WORK_START_HOUR) return { verdict: 'early', label: VERDICTS.early }
  if (hour < WORK_END_HOUR) return { verdict: 'work', label: VERDICTS.work }
  if (hour < 22) return { verdict: 'evening', label: VERDICTS.evening }
  return { verdict: 'sleep', label: VERDICTS.sleep }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 某时区里的星期几（0 = 周日）。同样交给 Intl，不自己从 `MM-DD` 推 */
export function weekdayInTz(tz: string, at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

export interface MeetingSlot {
  city: WorldCity
  /** 该城当地 `HH:mm` */
  hhmm: string
  /** 该城当地日期 `MM-DD` */
  dateStr: string
  weekday: number
  weekdayLabel: string
  offsetMin: number
  /** 与本地同时 / 早 8 小时 / 晚 2.5 小时 */
  relative: string
  info: VerdictInfo
  /** 当地是不是"另一天"（跨日会议的典型情况，界面要标出来） */
  otherDay: boolean
}

/** 一次会议在某个城市的当地读数 */
export function meetingSlot(city: WorldCity, at: Date, localOffMin: number, localDateStr: string): MeetingSlot {
  const clock = cityClock(city, at)
  const weekday = weekdayInTz(city.tz, at)
  return {
    city,
    hhmm: clock.hhmm,
    dateStr: clock.dateStr,
    weekday,
    weekdayLabel: WEEKDAYS[weekday],
    offsetMin: clock.offsetMin,
    relative: relativeLabel(clock.offsetMin, localOffMin),
    info: slotVerdict(Number(clock.hhmm.slice(0, 2)), weekday),
    otherDay: clock.dateStr !== localDateStr,
  }
}

/**
 * 一整场会的对照表，按"离本地时差从小到大"排 —— 与本地同时的排最前，
 * 因为那是最不需要操心的那个。时差相同按城市名排，保证顺序稳定不跳。
 */
export function meetingSlots(cities: readonly WorldCity[], at: Date, localOffMin: number, localDateStr: string): MeetingSlot[] {
  return cities
    .map((c) => meetingSlot(c, at, localOffMin, localDateStr))
    .sort((a, b) => Math.abs(a.offsetMin - localOffMin) - Math.abs(b.offsetMin - localOffMin) || a.city.name.localeCompare(b.city.name, 'zh-Hans-CN'))
}

/**
 * 参会名单清洗：去掉不认识的、去掉重复的、砍到上限。
 * 复用 `worldclock` 的候选城市表 —— 会议规划器不该维护第二份城市表，
 * 两份表迟早不一致，而不一致之后没人知道哪份对。
 */
export function sanitizeMeetingCityIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id) || !worldCityById(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.slice(0, MAX_MEETING_CITIES)
}

/** 按 id 取候选城市；认不出来的返回 null（调用方 filter 掉，不给它编一个） */
export function meetingCityById(id: string): WorldCity | null {
  return worldCityById(id)
}

/** 时长的人话：`90` → "1 小时 30 分"；`45` → "45 分"；`60` → "1 小时" */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.trunc(Number.isFinite(minutes) ? minutes : 0))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} 分`
  if (rest === 0) return `${h} 小时`
  return `${h} 小时 ${rest} 分`
}

/**
 * 把任何能认的 `H:mm` / `HH:mm` / `HHmm` 归一成 `HH:mm`，认不出返回 null。
 *
 * 为什么不直接 `padStart(5, '0')`：`'9:5'` 只有 3 个字符，补零会得到 `'009:5'` ——
 * 一个比非法输入更糟的东西（它看着像时间）。归一化必须**按小时与分钟分别补**。
 * 存在的理由是外来数据（手改过的备份、旧版本）可能不补零；而 `<input type="time">`
 * 自己永远是 `HH:mm`，所以这条只服务于"不信任的输入"。
 */
export function normalizeHhmm(input: string): string | null {
  const s = input.trim()
  // 带冒号时分钟可 1–2 位（`9:5`），不带冒号时必须正好 2 位（否则 `905` 与 `95` 没法区分）
  const withColon = /^(\d{1,2}):(\d{1,2})$/.exec(s)
  const bare = /^(\d{1,2})(\d{2})$/.exec(s)
  const m = withColon ?? bare
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** `HH:mm` → 从此刻起还有多少分钟；认不出返回 null（不编一个数字） */
export function minutesUntil(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59) return null
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h % 24, min, 0, 0).getTime()
  return Math.round((target - now.getTime()) / 60_000)
}

/** 这几城里"最不能接受"的一个 —— 卡上用它给一句总的建议，而不是让人自己扫六行 */
export function worstSlot(slots: readonly MeetingSlot[]): MeetingSlot | null {
  if (slots.length === 0) return null
  const rank: Record<SlotVerdict, number> = { work: 0, evening: 1, early: 2, weekend: 3, sleep: 4 }
  return [...slots].sort((a, b) => rank[b.info.verdict] - rank[a.info.verdict] || a.city.name.localeCompare(b.city.name, 'zh-Hans-CN'))[0] ?? null
}

/** 给一句总评。`worst` 是 sleep / weekend 时才值得说"要不换时间"，其余说清楚现状即可 */
export function meetingAdvice(worst: MeetingSlot | null): string {
  if (!worst) return '先挑几个参会城市'
  if (worst.info.verdict === 'sleep' || worst.info.verdict === 'weekend') return `${worst.city.name}那边${worst.info.label}，换时间更体面`
  if (worst.info.verdict === 'early') return `${worst.city.name}那边${worst.info.label}，有人要早起`
  if (worst.info.verdict === 'evening') return `${worst.city.name}那边已经${worst.info.label}，注意别太长`
  return '这几点大家都还行'
}

export { WORLD_CITIES, tzOffsetMinutes }
