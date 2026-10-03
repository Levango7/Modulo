/**
 * 习惯打卡：连续天数（streak）与最近一周的打卡位。
 *
 * streak 的口径是容易写错的那个点：**今天没打卡不能归零** —— 只要昨天是连着的，今天补上
 * streak 就该续上。所以锚点取"今天或昨天"，取更晚的那个。
 */

export interface HabitState {
  name: string
  /** 打过卡的日期，`YYYY-MM-DD` */
  days: string[]
}

function ymd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 最近 `n` 天（含今天）的打卡位，旧 → 新 */
export function lastNDays(days: readonly string[], now: Date, n = 7): { date: string; done: boolean }[] {
  const set = new Set(days)
  const out: { date: string; done: boolean }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = ymd(d)
    out.push({ date: key, done: set.has(key) })
  }
  return out
}

/**
 * 连续打卡天数。锚点是"今天或昨天"里更晚的那个：今天打了从今天数，
 * 今天还没打但从昨天数 —— 已过午夜而还没打卡不应该把 132 天归零。
 */
export function streakDays(days: readonly string[], now: Date): number {
  const set = new Set(days)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = day(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const anchor = set.has(ymd(today)) ? today : set.has(ymd(yesterday)) ? yesterday : null
  if (!anchor) return 0
  let streak = 0
  const cursor = new Date(anchor)
  while (set.has(ymd(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
