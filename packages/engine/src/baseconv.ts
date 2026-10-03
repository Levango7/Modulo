/**
 * 进制转换：2–36 进制互转。
 *
 * 用 `BigInt` 而不是 Number：`Number` 在 2^53 以上丢精度，转换器恰恰最常被人拿来转
 * 大数（哈希、ID、地址）—— 丢一位就是错的。
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 校验 `value` 的每个位都小于 `base`（大小写不敏感，输出一律小写） */
export function isValidInBase(value: string, base: number): boolean {
  if (!Number.isInteger(base) || base < 2 || base > 36) return false
  const t = value.trim().toLowerCase()
  if (!t) return false
  const body = t.startsWith('-') ? t.slice(1) : t
  if (!body) return false
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
