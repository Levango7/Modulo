import { LOGICAL_COLS } from './types'

export type EditorMode = 'canvas' | 'stack'

export interface BreakpointSpec {
  /** 容器宽 ≥ 该值即命中（表按 min 降序） */
  minContainerWidth: number
  cols: number
  rowMin: number
}

/** 与 docs/ARCHITECTURE.md §3.1 的断点表一一对应 */
export const BREAKPOINTS: readonly BreakpointSpec[] = [
  { minContainerWidth: 1200, cols: 12, rowMin: 36 },
  { minContainerWidth: 960, cols: 8, rowMin: 34 },
  { minContainerWidth: 720, cols: 6, rowMin: 32 },
  { minContainerWidth: 480, cols: 4, rowMin: 28 },
  { minContainerWidth: 0, cols: 1, rowMin: 0 },
]

export function physicalCols(containerWidth: number): number {
  const hit = BREAKPOINTS.find((b) => containerWidth >= b.minContainerWidth)
  return hit ? hit.cols : 1
}

export function rowMinHeight(containerWidth: number): number {
  const hit = BREAKPOINTS.find((b) => containerWidth >= b.minContainerWidth)
  return hit ? hit.rowMin : 0
}

/** 列数太少时画布会挤成一团（x-hub 实测 390px 下画布只剩 88px），改走堆叠编辑 */
export function editorMode(containerWidth: number): EditorMode {
  return physicalCols(containerWidth) >= 4 ? 'canvas' : 'stack'
}

export function scaleFactor(cols: number): number {
  return LOGICAL_COLS / cols
}
