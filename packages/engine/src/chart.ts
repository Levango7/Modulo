/**
 * 迷你图表的纯几何：把一串数变成 0..1 的比例与 0..100 视口坐标。
 *
 * **数据侧不新造**：记账日序列有 `ledger.dailyTotals`（无数据的日期补 0），
 * 打卡序列有 `habit.lastNDays`（0/1）。这里只回答三件事：比例怎么归一、
 * 折线的点落在哪、柱子摆在哪。
 *
 * 视口约定 `0..100 × 0..100`：组件用 `viewBox="0 0 100 100"` +
 * `preserveAspectRatio="none"` 把 SVG 拉伸到卡面（随卡片连续缩放，与 cq 单位同思路），
 * 线条加 `vector-effect: non-scaling-stroke` 防拉伸变粗。
 */

export interface SeriesScale {
  /** 序列最大值；空表或全 0 时为 0 —— 调用方据此显示「还没数据」 */
  max: number
  /** 归一化到 0..1，四舍五入 3 位小数（SVG 坐标用不了更高精度） */
  fracs: number[]
}

/**
 * 归一化：每项 ÷ 最大值。负数按 0 计 —— 记账/打卡口径里不该出现负数，
 * 防御性夹逼而不是抛错；`NaN/Infinity` 同样按 0（持久化数据不可信是本仓惯例）。
 */
export function scaleSeries(values: readonly number[]): SeriesScale {
  let max = 0
  for (const v of values) if (Number.isFinite(v) && v > max) max = v
  const fracs = values.map((v) => (Number.isFinite(v) && v > 0 && max > 0 ? Math.round((v / max) * 1000) / 1000 : 0))
  return { max, fracs }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 折线上下留白 6%：最大值不至于顶到边框，0 也不至于贴底被描边吃掉 */
const PAD = 6

/**
 * 折线的 `points`（给 `<polyline>`）：x 均分 0..100，y 反转（值越大越靠上）。
 * 空表返回空串；单点没有"线"可言，给视口中央一个点，让组件自己决定要不要画。
 */
export function linePoints(fracs: readonly number[]): string {
  const n = fracs.length
  if (n === 0) return ''
  if (n === 1) return '50,50'
  const usable = 100 - PAD * 2
  return fracs.map((f, i) => `${round2((i / (n - 1)) * 100)},${round2(100 - PAD - f * usable)}`).join(' ')
}

/**
 * n 根柱的横向槽位（0..100 视口）：柱宽占槽 72%、两侧留缝。
 * 高度比例直接用 `scaleSeries().fracs`（y = 100 − frac × (100 − 2·PAD)）。
 */
export function barSlots(count: number): { x: number; w: number }[] {
  const n = Math.min(Math.max(Math.trunc(count) || 0, 0), 200)
  if (n === 0) return []
  const slot = 100 / n
  const w = slot * 0.72
  return Array.from({ length: n }, (_, i) => ({ x: round2(i * slot + (slot - w) / 2), w: round2(w) }))
}
