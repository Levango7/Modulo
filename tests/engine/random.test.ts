import { describe, expect, it } from 'vitest'
import { pickWeighted, rollDice, rollInts } from '@levango7/engine/random'

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

describe('pickWeighted：加权抽一个', () => {
  it('权重相等时退化成均匀 —— 累计区间的边界落在每个点上', () => {
    const items = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]
    expect(pickWeighted(items, seqRng([0]))?.id).toBe('a')
    expect(pickWeighted(items, seqRng([0.34]))?.id).toBe('b')
    expect(pickWeighted(items, seqRng([0.99]))?.id).toBe('c')
  })

  it('权重决定区间宽度：3 : 1 意味着前三样吃掉 3/4 的取值范围', () => {
    const items = [
      { id: 'heavy', label: '重', weight: 3 },
      { id: 'light', label: '轻', weight: 1 },
    ]
    // roll 落在 [0.75, 1) 才抽到"轻"
    expect(pickWeighted(items, seqRng([0.7]))?.id).toBe('heavy')
    expect(pickWeighted(items, seqRng([0.8]))?.id).toBe('light')
    expect(pickWeighted(items, seqRng([0.0]))?.id).toBe('heavy')
    expect(pickWeighted(items, seqRng([0.749999]))?.id).toBe('heavy')
  })

  it('权重 0 = 永远抽不到，不是"等概率"', () => {
    const items = [
      { id: 'never', label: '不', weight: 0 },
      { id: 'always', label: '总', weight: 5 },
    ]
    for (const r of [0, 0.3, 0.6, 0.9, 0.999]) expect(pickWeighted(items, seqRng([r]))?.id).toBe('always')
  })

  it('空名单 → null（界面显示"没有可抽的"，不返回第一条）', () => {
    expect(pickWeighted([], seqRng([0.5]))).toBeNull()
  })

  it('全 0 权重 → null，不死循环也不返回第一条', () => {
    const items = [
      { id: 'a', label: 'A', weight: 0 },
      { id: 'b', label: 'B', weight: 0 },
    ]
    expect(pickWeighted(items, seqRng([0.5]))).toBeNull()
  })

  it('权重是 NaN 或负数 → 整份名单作废返回 null（一个坏权重不该让整张卡抽不出东西）', () => {
    expect(pickWeighted([{ id: 'a', label: 'A', weight: Number.NaN }], seqRng([0.5]))).toBeNull()
    expect(pickWeighted([{ id: 'a', label: 'A', weight: -1 }], seqRng([0.5]))).toBeNull()
  })

  it('rng 落在 [0,1) 之外也不崩：退到最后一个正权重项（那也是"抽到了"）', () => {
    const items = [
      { id: 'a', label: 'A', weight: 1 },
      { id: 'b', label: 'B', weight: 1 },
    ]
    expect(pickWeighted(items, seqRng([1]))?.id).toBe('b')
    expect(pickWeighted(items, seqRng([1.7]))?.id).toBe('b')
    expect(pickWeighted(items, seqRng([-0.2]))?.id).toBe('a')
  })

  it('原样返回列表里那一条（id 用来在界面上定位）', () => {
    const items = [{ id: 'x', label: '原始对象', weight: 1 }]
    expect(pickWeighted(items, seqRng([0.5]))).toBe(items[0])
  })
})
