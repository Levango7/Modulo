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

/**
 * 降档投影专用的让位策略：**贴左首配**（先在自己这一行从 x=0 往右找，找不到再下移一行）。
 *
 * 与 `findFreeSpot`（留在原列带、向下找）的区别就是"要不要横着挪"：
 * - 逻辑层（`ops` / `validate`）要保用户的横位意图 → 只能向下，用 `findFreeSpot`；
 * - 降档投影（n < 12）横位本来就是投影自己的取整结果，不是用户排的 → 统一左对齐，
 *   同一行从左边填起。旧策略实测会在 4/6 列档留下"浮在中列、两边空"的岛（屏幕上像没排好），
 *   新策略把折行变成"贴左 + 右侧留白"，与阅读习惯一致，也不再出现中列孤岛。
 *
 * 终止性同 `findFreeSpot`：`y = maxRow` 处必然无碰撞。
 */
export function findLeftFit(
  obstacles: readonly Rect[],
  w: number,
  h: number,
  fromY: number,
  cols: number = LOGICAL_COLS,
): Rect {
  const width = clamp(w, 1, cols)
  const start = Math.max(0, Math.floor(fromY))
  const bottom = Math.max(maxRow(obstacles), start)
  const limit = bottom + h
  for (let yy = start; yy <= limit; yy++) {
    for (let xx = 0; xx <= cols - width; xx++) {
      const rect: Rect = { x: xx, y: yy, w: width, h }
      if (!anyCollides(obstacles, rect)) return rect
    }
  }
  return { x: 0, y: bottom, w: width, h }
}
