import { anyCollides, clamp, maxRow } from './geometry'
import type { Rect } from './types'
import { LOGICAL_COLS } from './types'

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
  return { x: cx, y: bottom, w, h }
}
