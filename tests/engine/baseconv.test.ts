import { describe, expect, it } from 'vitest'
import { isValidInBase, toBase } from '@levango7/engine/baseconv'

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
