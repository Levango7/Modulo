/**
 * 进制转换：2–36 进制互转。
 *
 * 用 `BigInt` 而不是 Number：`Number` 在 2^53 以上丢精度，转换器恰恰最常被人拿来转
 * 大数（哈希、ID、地址）—— 丢一位就是错的。
 *
 * ## 输入长度上限（2026-10-11 补）
 *
 * 逐位累加 `n = n * base + d` 的代价随 `n` 的位数增长，所以整条是 **O(n²)**。
 * 实测（node 22，36 进制输入转 2 进制）：
 *
 * | 输入位数 | 耗时 |
 * |---|---|
 * | 1 000 | 11 ms |
 * | 4 000 | 79 ms |
 * | 8 000 | 298 ms |
 * | 16 000 | **1 101 ms** |
 *
 * 输入翻倍、耗时约 3.7 倍。而调用方 `BaseCard.vue` 把 `toBase` 放在 **computed** 里
 * （依赖用户输入），于是**每敲一个字符就重跑一次** —— 粘贴一段长哈希就能让界面
 * 同步冻结（50 万位外推约 18 分钟；实测直接把进程挂住，跑不完）。
 *
 * 所以设上限：超过 `MAX_VALUE_LEN` 直接拒，**不尝试转换**。4096 位对真实用途
 * （哈希 256 位十六进制 = 256 个字符）绰绰有余，而它约 80 ms —— 一次性粘贴可接受。
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * 输入值的位数上限（不含正负号）。见文件头「输入长度上限」。
 *
 * 导出是给界面用的：它要能**区分**「位非法」与「太长」两种拒因 —— 否则会把一个
 * 完全合法、只是太长的输入提示成「有的位不属于 N 进制」，那是在骗用户。
 */
export const MAX_VALUE_LEN = 4096

/** 校验 `value` 的每个位都小于 `base`（大小写不敏感，输出一律小写） */
export function isValidInBase(value: string, base: number): boolean {
  if (!Number.isInteger(base) || base < 2 || base > 36) return false
  const t = value.trim().toLowerCase()
  if (!t) return false
  const body = t.startsWith('-') ? t.slice(1) : t
  if (!body) return false
  // 长度上限在这里收口：`toBase` 内部第一句就是它，界面也直接用它提前灰按钮 ——
  // 一处拦住，两条路径都拦得住。见文件头「输入长度上限」。
  if (body.length > MAX_VALUE_LEN) return false
  for (const ch of body) {
    const d = DIGITS.indexOf(ch)
    if (d < 0 || d >= base) return false
  }
  return true
}

/** `from` 进制 → `to` 进制。形状/位非法返回 `null`；支持负号；大数用 BigInt 不丢精度 */
export function toBase(value: string, from: number, to: number): string | null {
  if (!isValidInBase(value, from)) return null
  if (!Number.isInteger(to) || to < 2 || to > 36) return null
  const t = value.trim().toLowerCase()
  const negative = t.startsWith('-')
  const body = negative ? t.slice(1) : t
  let n = 0n
  for (const ch of body) n = n * BigInt(from) + BigInt(DIGITS.indexOf(ch))
  let out = n === 0n ? '0' : ''
  while (n > 0n) {
    out = DIGITS[Number(n % BigInt(to))] + out
    n /= BigInt(to)
  }
  return (negative && out !== '0' ? '-' : '') + out
}
