/**
 * 生日提醒：下一次生日还有几天，以及到那天时几岁。
 *
 * 为什么单独一个模块而不直接复用 `countdown.ts`：生日是**没有年**的（用户记的是"3 月 5 日"，
 * 不是"1988 年 3 月 5 日"），要算的是"下一次"而不是"距那天"。`countdown` 那套按 `YYYY-MM-DD`
 * 算差的逻辑在这里不成立 —— 硬塞进去就得在引擎里造一个"随便挑个平年"的假年份，
 * 那样闰日与年龄两个坑会一起被带进来。
 *
 * 三条口径写死在这里，界面只负责画：
 *
 * 1. **没有年就没有年龄**。用户只填月日时 `turns` 是 `null`，卡上不编一个数字出来。
 * 2. **2 月 29 日在平年落到 2 月 28 日**。这是社区里通行的做法（不过 29 日也不算错），
 *    但**必须由模块决定而不是让界面各自决定** —— 否则同一个人在两张卡上会看到两个日子。
 * 3. **按本地日历日算差**，理由与 `countdown.daysUntil` 同一条：用户问的是"还有几天"，
 *    不是"还有多少小时"。
 */

import { daysInMonth } from './calendar.js'
import { isLeapYear } from './progress.js'

export interface Birthday {
  /** 稳定标识。引擎自己不用它算任何东西，但**必须带出来** —— 界面删一条要按 id 找，
   *  如果引擎把 id 吞掉，界面就只能拿"月日 + 名字"去猜要删哪一条（同月同日同名就删错了） */
  id?: string
  /** 名字，用户写的 */
  name: string
  /** 1–12 */
  month: number
  /** 1–31；2 月 29 日合法，平年落到 28 日 */
  day: number
  /** 出生年，可选。填了才算年龄 */
  year?: number
}

const MD_RE = /^(\d{1,2})-(\d{1,2})$/

export interface BirthdayNext {
  b: Birthday
  /** 0 = 就是今天；1 = 明天 */
  days: number
  /** 下一次那天的 `YYYY-MM-DD`（平年闰日已落到 28 日） */
  date: string
  /** 到那天几岁；没填出生年是 `null` */
  turns: number | null
}

/** 严格校验：月份越界、日子超过当月天数一律 false；**2 月 29 日放行**（平年由 `nextBirthday` 落到 28） */
export function isValidBirthday(b: Pick<Birthday, 'month' | 'day'>): boolean {
  const { month, day } = b
  if (!Number.isInteger(month) || month < 1 || month > 12) return false
  if (!Number.isInteger(day) || day < 1) return false
  if (month === 2 && day === 29) return true
  // 其余按平年判上限（2 月 = 28 天），免得这里依赖"用哪一年查天数"
  return day <= (month === 2 ? 28 : daysInMonth(2023, month))
}

/** `3-5` / `03-05` → `{month:3, day:5}`；认不出返回 null（不猜、不补全） */
export function parseMonthDay(s: string): { month: number; day: number } | null {
  const m = MD_RE.exec(s.trim())
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { month, day }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/**
 * 下一个生日落在哪一天。
 *
 * 跨年判定只比"月日"大小，**不比今年还剩几天** —— 后者在 12 月 31 日和闰日附近会差一整天，
 * 前者与时区/夏令时都无关，也不会因为落进哪一年而改变答案。
 */
export function nextBirthday(b: Birthday, now: Date): BirthdayNext | null {
  if (!isValidBirthday(b)) return null
  const year = now.getFullYear()
  const todayM = now.getMonth() + 1
  const todayD = now.getDate()
  // 平年的 2 月 29 日落到 28 日：先按"今年"算日子，再夹回当年合法范围
  const resolvedDay = b.month === 2 && b.day === 29 && !isLeapYear(year) ? 28 : b.day

  const thisYear = new Date(year, b.month - 1, resolvedDay)
  const startOfToday = new Date(year, todayM - 1, todayD)
  // 今天就是生日 → days 0（不是 365），所以用"不早于今天"而不是"晚于今天"
  const target = thisYear.getTime() >= startOfToday.getTime() ? thisYear : new Date(year + 1, b.month - 1, resolvedDay)
  const days = Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000)

  const turns = typeof b.year === 'number' && Number.isInteger(b.year) && b.year > 0 && b.year <= year ? target.getFullYear() - b.year : null
  return {
    b,
    days,
    date: `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`,
    turns,
  }
}

/**
 * 把一批生日排成"最近的在最前"，同一天按名字排（不排就是输入顺序，界面上会跳）。
 * 认不出的条目丢掉，不占位。
 */
export function upcomingBirthdays(list: readonly Birthday[], now: Date): BirthdayNext[] {
  return list
    .map((b) => nextBirthday(b, now))
    .filter((n): n is BirthdayNext => n !== null)
    .sort((a, z) => a.days - z.days || a.b.name.localeCompare(z.b.name, 'zh-Hans-CN'))
}

/** 卡上那句人话：今天 / 明天 / N 天后，年龄单独一句（没年份就没有这句） */
export function birthdayText(next: BirthdayNext): { head: string; age: string | null } {
  const head = next.days === 0 ? '就是今天' : next.days === 1 ? '明天' : `还有 ${next.days} 天`
  return { head, age: next.turns === null ? null : `${next.turns} 岁` }
}
