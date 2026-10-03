import { describe, expect, it } from 'vitest'
import { rollDice, rollInts } from '@modulo/engine/random'

/** 固定序列的假 RNG：断言的是"怎么用 RNG"，不是"随机"本身 */
function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('rollInts：区间整数（含两端）', () => {
  it('区间、数量、顺序都由序列决定', () => {
    const r = rollInts({ min: 1, max: 6, count: 3, unique: false }, seqRng([0, 0.999, 0.5]))
    expect(r).toEqual([1, 6, 4])
  })

  it('负区间与跨零区间照常', () => {
    expect(rollInts({ min: -2, max: 2, count: 1, unique: false }, seqRng([0.5]))).toEqual([0])
    expect(rollInts({ min: -5, max: -1, count: 2, unique: false }, seqRng([0, 0.999]))).toEqual([-5, -1])
  })

  it('unique：用 Set 去重到数量足够', () => {
    // 序列 0.9, 0.9, 0.1 → 前两次都抽中同一个，第三次才换新 —— 去重后照样凑够 2 个
    const r = rollInts({ min: 1, max: 10, count: 2, unique: true }, seqRng([0.9, 0.9, 0.1]))
    expect(r).toHaveLength(2)
    expect(new Set(r).size).toBe(2)
  })

  it('unique 装不下：直接 null，绝不死循环（6 选 7 个）', () => {
    expect(rollInts({ min: 1, max: 6, count: 7, unique: true }, seqRng([0.5]))).toBeNull()
  })

  it('参数坏：min > max、count ≤ 0、非整数、非有限数', () => {
    expect(rollInts({ min: 5, max: 1, count: 1, unique: false }, seqRng([0.5]))).toBeNull()
    expect(rollInts({ min: 1, max: 6, count: 0, unique: false }, seqRng([0.5]))).toBeNull()
    expect(rollInts({ min: 1, max: 6, count: -1, unique: false }, seqRng([0.5]))).toBeNull()
    expect(rollInts({ min: 1.5, max: 6, count: 1, unique: false }, seqRng([0.5]))).toBeNull()
    expect(rollInts({ min: Number.NaN, max: 6, count: 1, unique: false }, seqRng([0.5]))).toBeNull()
  })
})

describe('rollDice：面数与颗数', () => {
  it('d6 与 d20', () => {
    expect(rollDice(6, 2, seqRng([0, 0.999]))).toEqual([1, 6])
    expect(rollDice(20, 1, seqRng([0.5]))).toEqual([11])
  })

  it('面数 < 2、颗数越界都拒', () => {
    expect(rollDice(1, 1, seqRng([0.5]))).toBeNull()
    expect(rollDice(6, 0, seqRng([0.5]))).toBeNull()
    expect(rollDice(6, 101, seqRng([0.5]))).toBeNull()
  })
})
