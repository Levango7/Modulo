import { anyCollides, clamp, maxRow } from './geometry.js'
import type { Rect } from './types.js'
import { LOGICAL_COLS } from './types.js'

/**
 * 在目标列带内从 y 向下找最近的无障碍空位；找不到就落到所有已放项之下。
 * y = maxRow 处必然无碰撞（所有项的 y+h ≤ maxRow），因此该函数保证返回矩形与 obstacles 不相交。
 */
export function findFreeSpot(
  obstacles: readonly Rect[],
  w: number,
  h: number,
  x: number,
  y: number,
  cols: number = LOGICAL_COLS,
): Rect {
  const cx = clamp(x, 0, Math.max(0, cols - w))
  const start = Math.max(0, Math.floor(y))
  const bottom = Math.max(maxRow(obstacles), start)
  const limit = bottom + h
  for (let yy = start; yy <= limit; yy++) {
    const rect: Rect = { x: cx, y: yy, w, h }
    if (!anyCollides(obstacles, rect)) return rect
  }
  // 兜底分支，理论上到不了：循环一定会在 yy = bottom = maxRow(obstacles) 处命中
  // （所有已放项都满足 y+h ≤ maxRow）。留着是因为 TS 要求每条路径都有返回值，
  // 而这里没有比"再返回一次 bottom"更合理的写法。覆盖率报告里它永远标红，不必为它编用例。
  return { x: cx, y: bottom, w, h }
}
