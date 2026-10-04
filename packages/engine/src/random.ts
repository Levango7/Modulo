/**
 * 随机数：区间整数 / 骰子。
 *
 * **RNG 注入**而不是在引擎里摸 `crypto`：一是不让引擎碰环境全局（包构建的 lib 里没有它），
 * 二是测试用一颗固定的假 RNG 就能把"区间、数量、去重"钉死 —— 真随机没法断言。
 * 卡片层才把 `crypto.getRandomValues` 包成一个 `() => number` 递进来。
 */

export interface RandomSpec {
  min: number
  max: number
  /** 抽几个 */
  count: number
  /** 不重复（区间太小装不下时返回 null，而不是死循环） */
  unique: boolean
}

function intIn(rng: () => number, min: number, max: number): number {
  // floor(rng * span) 有极小的模偏差，对骰子和抽号完全够用；真要密码学强度不在这层
  return min + Math.floor(rng() * (max - min + 1))
}

/** 区间整数（含两端）。参数坏（min > max / count ≤ 0 / unique 装不下）返回 null */
export function rollInts(spec: RandomSpec, rng: () => number): number[] | null {
  const { min, max, count, unique } = spec
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isInteger(min) || !Number.isInteger(max)) return null
  if (min > max || !Number.isInteger(count) || count < 1) return null
  const span = max - min + 1
  if (unique && count > span) return null
  if (unique) {
    const picked = new Set<number>()
    while (picked.size < count) picked.add(intIn(rng, min, max))
    return [...picked]
  }
  return Array.from({ length: count }, () => intIn(rng, min, max))
}

/** 掷骰子：`count` 个 `sides` 面骰（sides ≥ 2） */
export function rollDice(sides: number, count: number, rng: () => number): number[] | null {
  if (!Number.isInteger(sides) || sides < 2 || !Number.isInteger(count) || count < 1 || count > 100) return null
  return Array.from({ length: count }, () => intIn(rng, 1, sides))
}

export interface PickItem {
  /** 稳定标识：抽签要能报出"抽中的是哪一条"，所以不能只给下标 */
  id: string
  label: string
  /** 权重，≥ 0。0 = 永远抽不到（不是"等概率"） */
  weight?: number
}

/**
 * 加权抽一个。
 *
 * 为什么用"累计 + 线性扫描"而不是别名表（alias method）：名单只有几十条，一次 O(n) 可以忽略，
 * 而别名表要预计算一份状态、多一个能写错的地方。**权重相等时退化成均匀**，这是最常见的用法。
 *
 * 全 0 权重 / 空名单 / 权重是 NaN → 返回 null（界面显示"没有可抽的"，不返回第一条）。
 */
export function pickWeighted<T extends PickItem>(items: readonly T[], rng: () => number): T | null {
  let total = 0
  for (const it of items) {
    const w = it.weight ?? 1
    if (typeof w !== 'number' || Number.isNaN(w) || w < 0) return null
    total += w
  }
  if (items.length === 0 || total <= 0) return null
  // rng() 取 [0,1)，乘 total 后落进累计区间；取不到就退到最后一个正权重项，
  // 免得 rng 恰好返回 1（或因浮点误差落在 total 上）时返回 null —— 那是"抽到了"，不是"抽不了"
  let roll = rng() * total
  if (!(roll >= 0)) roll = 0
  let acc = 0
  let lastPositive: T | null = null
  for (const it of items) {
    const w = it.weight ?? 1
    if (w > 0) lastPositive = it
    acc += w
    if (roll < acc) return it
  }
  return lastPositive
}
