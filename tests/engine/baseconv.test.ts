import { describe, expect, it } from 'vitest'
import { isValidInBase, MAX_VALUE_LEN, toBase } from '@levango7/engine/baseconv'

describe('toBase：2–36 进制互转', () => {
  it('日常口径各来一例', () => {
    expect(toBase('255', 10, 16)).toBe('ff')
    expect(toBase('ff', 16, 10)).toBe('255')
    expect(toBase('1010', 2, 10)).toBe('10')
    expect(toBase('10', 10, 2)).toBe('1010')
    expect(toBase('777', 8, 10)).toBe('511')
  })

  it('大小写不敏感，输出一律小写', () => {
    expect(toBase('FF', 16, 10)).toBe('255')
    expect(toBase('AbC', 16, 2)).toBe(toBase('abc', 16, 2))
  })

  it('BigInt 挡住精度丢失：2^53 + 1 这种 Number 数不准的数照样对', () => {
    // 9007199254740993 = 2^53 + 1：Number 会显示成 2^53（丢 1），BigInt 不会
    const big = '9007199254740993'
    expect(toBase(big, 10, 16)).toBe('20000000000001')
    expect(toBase(toBase(big, 10, 16)!, 16, 10)).toBe(big)
  })

  it('负号跟着走', () => {
    expect(toBase('-255', 10, 16)).toBe('-ff')
    expect(toBase('-1010', 2, 10)).toBe('-10')
  })

  it('零与空', () => {
    expect(toBase('0', 10, 2)).toBe('0')
    expect(toBase('0', 10, 36)).toBe('0')
    expect(toBase('', 10, 2)).toBeNull()
  })

  it('非法：位越界（2 进制里的 2）、base 越界（1 或 37）', () => {
    expect(toBase('102', 2, 10)).toBeNull()
    expect(toBase('zz', 10, 10)).toBeNull()
    expect(toBase('10', 1, 10)).toBeNull()
    expect(toBase('10', 10, 37)).toBeNull()
    expect(toBase('10', 10, 1.5)).toBeNull()
  })
})

describe('isValidInBase：只验位，不验大小', () => {
  it('与 toBase 同一口径（界面用它提前灰掉按钮）', () => {
    expect(isValidInBase('1F', 16)).toBe(true)
    expect(isValidInBase('2', 2)).toBe(false)
    expect(isValidInBase('', 10)).toBe(false)
    expect(isValidInBase('-', 10)).toBe(false)
  })
})

/**
 * 输入长度上限（2026-10-11 补）。
 *
 * 修前 `toBase` 是 O(n²)：实测 16000 位（36 进制）耗时 1101 ms，输入翻倍耗时约 3.7 倍。
 * 而 `BaseCard.vue` 把 `toBase` 放在 **computed** 里（依赖用户输入），于是**每敲一个字符
 * 就重跑一次** —— 粘贴一段长哈希就能让界面同步冻结（50 万位外推约 18 分钟，实测跑不完）。
 */
describe('输入长度上限：超长直接拒，不尝试转换', () => {
  it('超过上限返回 null / false，而不是花十几分钟去算', () => {
    const over = 'z'.repeat(MAX_VALUE_LEN + 1)
    expect(toBase(over, 36, 2)).toBeNull()
    expect(isValidInBase(over, 36)).toBe(false)
  })

  it('上限之内照常转换，且耗时在合理量级', () => {
    const atLimit = 'z'.repeat(MAX_VALUE_LEN)
    expect(isValidInBase(atLimit, 36)).toBe(true)
    const t0 = Date.now()
    const r = toBase(atLimit, 36, 2)
    const dt = Date.now() - t0
    expect(r, '上限之内的输入不该被拒').not.toBeNull()
    // 4096 位实测约 80 ms。余量给到 1000 ms —— 只挡「数量级不对」的回归，不锁死机器性能。
    expect(dt, `4096 位耗时 ${dt} ms`).toBeLessThan(1000)
  })

  it('负号不计入长度（与 isValidInBase 剥负号的口径一致）', () => {
    expect(isValidInBase('-' + 'z'.repeat(MAX_VALUE_LEN), 36)).toBe(true)
    expect(isValidInBase('-' + 'z'.repeat(MAX_VALUE_LEN + 1), 36)).toBe(false)
  })
})
