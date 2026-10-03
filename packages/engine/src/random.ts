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
