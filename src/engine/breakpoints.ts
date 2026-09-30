import { LOGICAL_COLS } from './types'

export type EditorMode = 'canvas' | 'stack'

export interface BreakpointSpec {
  /** 容器宽 ≥ 该值即命中（表按 min 降序） */
  minContainerWidth: number
  cols: number
  /** 固定行高（px）：版面贴合内容高度，超出由页面滚动承接，不再用 1fr 拉伸 */
  rowPx: number
}

/** 与 docs/ARCHITECTURE.md §3.1 的断点表一一对应 */
export const BREAKPOINTS: readonly BreakpointSpec[] = [
  { minContainerWidth: 1200, cols: 12, rowPx: 64 },
  { minContainerWidth: 960, cols: 8, rowPx: 60 },
  { minContainerWidth: 720, cols: 6, rowPx: 56 },
  { minContainerWidth: 480, cols: 4, rowPx: 52 },
  { minContainerWidth: 0, cols: 1, rowPx: 48 },
]

function spec(containerWidth: number): BreakpointSpec {
  return (
    BREAKPOINTS.find((b) => containerWidth >= b.minContainerWidth) ??
    BREAKPOINTS[BREAKPOINTS.length - 1]
  )
}

export function physicalCols(containerWidth: number): number {
  return spec(containerWidth).cols
}

export function rowHeight(containerWidth: number): number {
  return spec(containerWidth).rowPx
}

/** 列数太少时画布会挤成一团（x-hub 实测 390px 下画布只剩 88px），改走堆叠编辑 */
export function editorMode(containerWidth: number): EditorMode {
  return physicalCols(containerWidth) >= 4 ? 'canvas' : 'stack'
}

export function scaleFactor(cols: number): number {
  return LOGICAL_COLS / cols
}
