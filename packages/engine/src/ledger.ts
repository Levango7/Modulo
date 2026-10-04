/**
 * 记账：一串「日期 + 金额 + 分类」，报这个月花了多少、按类怎么分。
 *
 * **金额一律用「分」的整数**（`cents`），不用小数。这是这个模块唯一真正重要的决定：
 * `0.1 + 0.2 !== 0.3`，一个月几十笔加下来，浮点误差会让总额差出几分钱 ——
 * 而"账对不上"是这类工具唯一不可原谅的失败。所以：
 *
 * - 存储、传输、求和、比较全是整数分；
 * - 只有**显示**时才除以 100；
 * - 唯一的浮点入口是 `parseAmount`，它用**字符串切分**而不是 `parseFloat`，从根上绕开二进制小数。
 *
 * 分类用固定 8 类而不是自由文本：自由文本会让"按类汇总"退化成一堆只出现一次的类，
 * 而一张工作台卡片也不该替用户设计一套会计科目。要记账到科目级，那是另一个工具的事。
 */

/** 记账不猜币种：符号由用户自己填一次，全表跟着走 */
export const DEFAULT_CURRENCY_SYMBOL = '¥'

export const LEDGER_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他'] as const
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number]

export interface LedgerEntry {
  id: string
  /** `YYYY-MM-DD` */
  date: string
  /** 金额，单位「分」。整数，永不为负 */
  cents: number
  category: string
  note: string
}

/** 金额上限：约一亿元。超了说明用户敲错了，不该让一个数字撑爆布局或让求和失去意义 */
export const MAX_CENTS = 10_000_000_000

/**
 * 把用户敲的金额文本变成「分」。
 *
 * 走字符串切分而不是 `Number`：`"12.30"` 用 parseFloat 得到 12.3，再 `* 100 | 0` 会得到 1229.999…→1229，
 * 少一分钱；字符串切分给出 1230。**接受至多两位小数**，第三位开始直接拒收而不是四舍五入 ——
 * 记账场景下"我不知道该不该进位"比"这条输了"更糟。
 *
 * 接受的输入：`12`、`12.5`、`12.50`、`0.05`、` 12.5 `、`1,234`（千分位）。
 * 拒收：空、`abc`、`-5`（不记负数，要记退款就自己当收入另一套）、`12.345`、`1e3`、`.`。
 */
export function parseAmount(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  // 千分位**先验格式再剥**：直接 `replace(/,/g,'')` 会把 `12,34`（分组写错）变成合法的 `1234`，
  // 于是用户敲错的东西被悄悄当成另一个金额记进去 —— 账目对不上时没人知道自己敲错过。
  const grouped = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)
  const plain = /^\d+(\.\d{1,2})?$/.test(s)
  if (!grouped && !plain) return null
  const [whole, frac = ''] = s.replace(/,/g, '').split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_CENTS ? cents : null
}

/** 「分」→ 显示文本。负数给出明确的 `-`，不用括号（括号在窄卡里会被截） */
export function formatMoney(cents: number, symbol = DEFAULT_CURRENCY_SYMBOL): string {
  const n = Number.isFinite(cents) ? Math.trunc(cents) : 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const yuan = Math.floor(abs / 100)
  const rest = abs % 100
  const grouped = yuan.toLocaleString('en-US')
  return `${sign}${symbol}${grouped}.${rest < 10 ? '0' : ''}${rest}`
}

/**
 * 窄卡用的简写：整数元不带小数位（`¥1,235`），有零头才带两位（`¥1,234.56`）。
 * 千分位在**两种形态里都要在** —— 上面那个 `¥1234.56` 在窄卡上读起来比宽卡上的更费劲。
 */
export function formatMoneyShort(cents: number, symbol = DEFAULT_CURRENCY_SYMBOL): string {
  const n = Number.isFinite(cents) ? Math.trunc(cents) : 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const yuan = Math.floor(abs / 100)
  const rest = abs % 100
  const head = yuan.toLocaleString('en-US')
  return rest === 0 ? `${sign}${symbol}${head}` : `${sign}${symbol}${head}.${rest < 10 ? '0' : ''}${rest}`
}

export function sumCents(entries: readonly LedgerEntry[]): number {
  let total = 0
  for (const e of entries) total += Number.isFinite(e.cents) ? Math.trunc(e.cents) : 0
  return total
}

/** 落在指定年月里的条目。按日期倒序、同日按录入顺序（不打乱用户当天的记录顺序） */
export function monthEntries(entries: readonly LedgerEntry[], now: Date): LedgerEntry[] {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  return entries
    .filter((e) => {
      const got = localParts(e.date)
      return got !== null && got.y === y && got.m === m
    })
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? 1 : a.e.date > b.e.date ? -1 : a.i - b.i))
    .map((x) => x.e)
}

function localParts(date: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? { y: Number(m[1]), m: Number(m[2]) } : null
}

export interface CategoryTotal {
  category: string
  cents: number
  count: number
}

/**
 * 按类汇总，**按金额从大到小**。
 *
 * 为什么按金额排而不是按固定类目顺序：这张卡回答的问题是"钱去哪了"，
 * 排在前面的就该是花得最多的那一类。
 */
export function categoryTotals(entries: readonly LedgerEntry[]): CategoryTotal[] {
  const acc = new Map<string, { cents: number; count: number }>()
  for (const e of entries) {
    const key = e.category.trim() || '其他'
    const cur = acc.get(key) ?? { cents: 0, count: 0 }
    cur.cents += Number.isFinite(e.cents) ? Math.trunc(e.cents) : 0
    cur.count += 1
    acc.set(key, cur)
  }
  return [...acc.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category, 'zh-Hans-CN'))
}

export interface MonthSummary {
  label: string
  year: number
  month: number
  entries: LedgerEntry[]
  total: number
  /** 一天的平均花费；本月一条都没有时是 0（不是 NaN，界面上不能出现 "NaN"） */
  dailyAvg: number
  /** 这个月已经过了几天（1–31），用来算"按当前速度这个月会花多少" */
  dayOfMonth: number
  daysInMonth: number
  /** 按当前速度的整月预测；本月一条都没有时是 0 而不是 null —— 卡上要一句话，不是一个"无" */
  projected: number
}

export function monthSummary(entries: readonly LedgerEntry[], now: Date): MonthSummary {
  const inMonth = monthEntries(entries, now)
  const total = sumCents(inMonth)
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const avg = dayOfMonth > 0 ? Math.round(total / dayOfMonth) : 0
  return {
    label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    entries: inMonth,
    total,
    dailyAvg: total === 0 ? 0 : avg,
    dayOfMonth,
    daysInMonth,
    projected: total === 0 ? 0 : Math.round((total / dayOfMonth) * daysInMonth),
  }
}

/** 最近 n 天的每日合计，从早到晚 —— 给迷你趋势条用。没有数据的日期补 0，不留空洞 */
export function dailyTotals(entries: readonly LedgerEntry[], now: Date, days: number): { date: string; cents: number }[] {
  const n = Math.min(Math.max(Math.trunc(days) || 0, 1), 62)
  const out: { date: string; cents: number }[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ date: key, cents: sumCents(entries.filter((e) => e.date === key)) })
  }
  return out
}
