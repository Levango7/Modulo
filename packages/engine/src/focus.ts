/**
 * 每日聚焦 / 月度统计：待办的两个读法。
 *
 * 这两张卡**不新增数据结构**，全部从 `cardData.todos` 读出来 —— 但月度统计读的是
 * `doneAt`（完成时刻），而 `Todo` 原先只有 `done: boolean`。一个布尔值回答不了
 * "这个月完成了多少"，所以 `doneAt` 是这次一起补上的字段（可选、向后兼容，见 §3）。
 *
 * 口径与 `countdown.daysUntil` 同源：**按本地日历日**判"这个月"，不用毫秒差 ——
 * 跨夏令时的机器上毫秒差会差一小时，月底那天就会被算到上个月去。
 */

export interface TodoLike {
  id: string
  text: string
  done: boolean
  /** 标记完成那一刻的毫秒时间戳；老数据 / 手动勾的旧条目可能没有 */
  doneAt?: number
}

/** 1–12 */
function monthOf(ms: number, now: Date): { y: number; m: number } | null {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  return { y, m }
}

/**
 * 下一件该做的事：按列表里**第一个没做完的**。
 *
 * 为什么不按"最短 / 最重要"排序：待办是用户自己排的顺序，替他重排等于替他做决定。
 * 想重排就让他拖 —— 这张卡的职责是"把第一件顶到眼前"，不是当任务管理器。
 */
export function nextUp(todos: readonly TodoLike[]): TodoLike | null {
  return todos.find((t) => !t.done) ?? null
}

/** 今天完成了多少 / 还剩几件。`doneAt` 缺失的完成条目**不算进今天**（它属于哪一天无从得知） */
export interface FocusToday {
  doneToday: number
  remaining: number
  total: number
  /** 0–1；没有待办时是 1（"没事可做"不是"完成度 0%"） */
  ratio: number
}

export function focusToday(todos: readonly TodoLike[], now: Date): FocusToday {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  let doneToday = 0
  let remaining = 0
  for (const t of todos) {
    if (!t.done) {
      remaining += 1
      continue
    }
    const got = typeof t.doneAt === 'number' ? monthOf(t.doneAt, now) : null
    if (got && got.y === y && got.m === m) doneToday += 1
  }
  const total = todos.length
  return { doneToday, remaining, total, ratio: total === 0 ? 1 : (total - remaining) / total }
}

export interface MonthStat {
  /** "2026 年 10 月" */
  label: string
  year: number
  month: number
  /** 本月完成的条数（按 `doneAt` 落月） */
  completed: number
  /** 本月仍未完成的条数 —— 不管它是几月写的，只要还没做完就算本月欠着 */
  outstanding: number
  /** 0–1；分母是"本月碰过的条目"（完成的 + 还欠着的） */
  ratio: number
}

/**
 * 这个月的完成情况。
 *
 * 分母不是"全部待办"：一条上月写、本月没碰的待办不该稀释本月的完成率。
 * 口径 = 本月完成的 + 本月还没做完的。
 */
export function monthStat(todos: readonly TodoLike[], now: Date): MonthStat {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  let completed = 0
  for (const t of todos) {
    if (!t.done) continue
    const got = typeof t.doneAt === 'number' ? monthOf(t.doneAt, now) : null
    if (got && got.y === y && got.m === m) completed += 1
  }
  const outstanding = todos.filter((t) => !t.done).length
  const touched = completed + outstanding
  return {
    label: `${y} 年 ${m} 月`,
    year: y,
    month: m,
    completed,
    outstanding,
    ratio: touched === 0 ? 1 : completed / touched,
  }
}
