/**
 * 月相：按朔望月周期算相位（**纯本地、不联网**）。
 *
 * 口径：以 2000-01-06 18:14 UTC 的已知新月为锚点，除以朔望月长度 29.530588853 天取小数部分。
 * 这是"平朔望"近似（真实月相因轨道摄动有 ±0.5 天上下的偏差），卡片上因此写 **≈** ——
 * 要精确到小时那是天文年历的事，不是一张桌面卡该承担的。
 */

const SYNODIC_DAYS = 29.530588853
/** 2000-01-06 18:14 UTC —— 一个被广泛使用的已知新月时刻 */
const ANCHOR_MS = Date.UTC(2000, 0, 6, 18, 14)

export interface MoonInfo {
  /** 0–1：0/1 = 新月，0.5 = 满月 */
  phase: number
  /** 被照亮的比例 0–1 */
  illum: number
  name: string
}

/** 八相命名（按相位八等分） */
export function moonPhaseName(phase: number): string {
  const p = ((phase % 1) + 1) % 1
  if (p < 0.0625 || p >= 0.9375) return '新月'
  if (p < 0.1875) return '娥眉月'
  if (p < 0.3125) return '上弦月'
  if (p < 0.4375) return '盈凸月'
  if (p < 0.5625) return '满月'
  if (p < 0.6875) return '亏凸月'
  if (p < 0.8125) return '下弦月'
  return '残月'
}

export function moonPhase(at: Date): MoonInfo {
  const days = (at.getTime() - ANCHOR_MS) / 86_400_000
  const phase = ((days / SYNODIC_DAYS) % 1 + 1) % 1
  // 照亮比例 = (1 - cos(2π·phase)) / 2：新月 0、满月 1、上下弦 0.5
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2
  return { phase, illum, name: moonPhaseName(phase) }
}

/** 距离下一个满月还有几天（卡片上一句"≈ 满月还有 N 天"用） */
export function daysToFullMoon(at: Date): number {
  const { phase } = moonPhase(at)
  const toFull = phase <= 0.5 ? 0.5 - phase : 1.5 - phase
  return toFull * SYNODIC_DAYS
}

export const SYNODIC_MONTH_DAYS = SYNODIC_DAYS
