/**
 * 固定整数位计算：发票 / 税点那类"乘一个率、留几位小数"的算术。
 *
 * 与 `ledger.ts` 同一个立场：**整数是主表示，小数只出现在显示上**。
 * 但这里的整数单位不是"分"而是**万分之一**（`×10000`）—— 税点 6%、折扣 2.5%、
 * 分摊到 3 位都需要四位精度，而"分"只有两位。
 *
 * 为什么不用 `calc.ts` 的表达式求值：那个引擎求的是任意表达式，用户输入千奇百怪；
 * 这一张卡的输入是**两个受控的数**（金额 + 率），把它塞进通用求值器等于给这张卡
 * 开了一个不受控的入口。
 *
 * 四舍五入用**整数半值比较**而不是 `Math.round`：`-0.5` 在 JS 里 `Math.round` 给 `-0`
 * （往 +∞ 取整），而财务口径的"四舍五入"在负数上是**远离零**，两者不一致会让一张
 * 退款单和一张发票对不上。
 */

/** 率的精度：万分之一 */
export const RATE_SCALE = 10_000

/** 金额精度：分 */
export const MONEY_SCALE = 100

export const MAX_RATE = 1_000_000 // 10000%，明显是敲错了
/**
 * 金额上限（约一亿元），与 `ledger.ts` 同值但**不共用同一个导出** ——
 * 两个模块都往 `index.ts` 汇出会撞名，而把一个财务上限定义成公共常量
 * 会让两块不相关的功能绑在一起。各留一份，注释指向对方。
 */
const MAX_CENTS = 10_000_000_000

/**
 * 解析"率"。规则只有一条，而且是**按数值大小**判的，不看写法：
 *
 * - `>= 1` → 已经是百分数：`6` = 6%，`6.5` = 6.5%，`600` = 600%
 * - `< 1`  → 是小数：`0.06` = 6%，`0.065` = 6.5%
 * - 带不带 `%` 都一样，`%` 只是给人看的提示
 *
 * 为什么这样而不是"不带小数点就乘 100"：那一版会把 `6` 读成 **600%**，
 * 在税率/折扣这种场景里差 100 倍，而且界面看不出错在哪。
 * 按数值大小判的版本对这一整类场景都是用户心里的那个意思，
 * 代价只有一个：`0.5` 会被读成 50% 而不是 0.5% —— 而后者几乎没人会写。
 */
export function parseRate(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const body = s.endsWith('%') ? s.slice(0, -1).trim() : s
  if (!/^\d+(\.\d+)?$/.test(body)) return null
  const n = Number(body)
  if (!Number.isFinite(n)) return null
  const permille = n < 1 ? n * RATE_SCALE : n * 100
  const rounded = Math.round(permille)
  return Number.isSafeInteger(rounded) && rounded >= 0 && rounded <= MAX_RATE ? rounded : null
}

/** 解析"金额"：与 `ledger.parseAmount` 同一套口径（整数分、至多两位小数） */
export function parseMoney(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const grouped = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)
  const plain = /^\d+(\.\d{1,2})?$/.test(s)
  if (!grouped && !plain) return null
  const [whole, frac = ''] = s.replace(/,/g, '').split('.')
  const cents = Number(whole) * MONEY_SCALE + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_CENTS ? cents : null
}

/** 财务口径的四舍五入：负数**远离零**（与 `Math.round` 不同，理由见文件头） */
export function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n)
}

/**
 * 金额 × 率，保留到「分」，中间不丢精度。
 *
 * `Math.round(cents * rate / 10000)` 里那个 `Math.round` 是 JS 的往 +∞ 取整，
 * 负数会偏，所以走 `roundHalfAwayFromZero`。
 */
export function applyRate(cents: number, rate: number): number | null {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) return null
  if (!Number.isSafeInteger(rate) || rate < 0 || rate > MAX_RATE) return null
  const raw = (cents * rate) / RATE_SCALE
  return roundHalfAwayFromZero(raw)
}

/** 按固定小数位格式化一个整数分（`dp` 位，0–4）；负数给出明确的负号 */
export function formatFixed(cents: number, dp = 2, symbol = '¥'): string {
  const n = Number.isFinite(cents) ? Math.trunc(cents) : 0
  const digits = Math.min(4, Math.max(0, Math.trunc(dp)))
  const factor = 10 ** digits
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const int = Math.floor(abs / factor)
  const frac = abs % factor
  const fracText = digits === 0 ? '' : `.${String(frac).padStart(digits, '0')}`
  return `${sign}${symbol}${int.toLocaleString('en-US')}${fracText}`
}

/**
 * 百分比显示：`600` → `6%`；用整数算，不用浮点。
 *
 * 率的单位是**万分之一**（RATE_SCALE = 10000），而百分比是**百分之一** ——
 * 所以这里要除 100 而不是 10000。写成除 10000 会把 6% 显示成 0.6%，
 * 那种错误不报错，只是让人以为自己填错了。
 */
export function formatRate(rate: number): string {
  const n = Number.isFinite(rate) ? Math.trunc(rate) : 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const int = Math.floor(abs / 100)
  const frac = abs % 100
  if (frac === 0) return `${sign}${int}%`
  return `${sign}${int}.${String(frac).replace(/0+$/, '')}%`
}

/** 常见场景的成套结果，一次算完给卡上显示 */
export interface FixedPlan {
  /** 基数（分） */
  base: number
  /** 率（万分之一） */
  rate: number
  /** 算出的小额（分），已按财务口径四舍五入 */
  result: number
  /** 含税 / 含费总额（分） */
  total: number
  /** 率（万分之一）取反后的净额 —— 用户常要的是"去掉这个比例后是多少" */
  net: number
}

/**
 * 一张成套的结果表。
 *
 * `net` 用**除法**而不是 `base - result`：`base - result` 会被四舍五入的误差放大
 * （基数 0.01、率 50% 时 result 会被舍成 0，net 却该是 0.005 → 1 分）。
 */
export function fixedPlan(base: number, rate: number): FixedPlan | null {
  const result = applyRate(base, rate)
  if (result === null) return null
  const net = rate >= RATE_SCALE ? null : roundHalfAwayFromZero((base * (RATE_SCALE - rate)) / RATE_SCALE)
  return { base, rate, result, total: base + result, net: net === null ? 0 : net }
}