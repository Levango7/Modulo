/**
 * 把卡片脱离成桌面浮窗时的**几何计算**（App.vue `detachCard` 里那几行的纯函数化）。
 *
 * 首次脱离的窗口尺寸取该卡在**当前形态下的理想格数**换算成像素，口径与浏览态一致：
 * 12 列等分舞台宽、列间 gap 从总宽里先扣掉。之后由用户拖出来/缩出来的几何记忆在
 * Rust 侧，这里只管第一次。
 *
 * 下限是硬编码的：宽 240、高 160（+24 是标题栏高度，**在 round 之外** ——
 * 拆出来时逐字保留原表达式，别"顺手整理"成 round(h + 24)，那会改变进位）。
 */

export interface DetachGeometryInput {
  /** 该卡当前形态的理想格数（缺失时按 4×3 兜底，与拆分前一致） */
  idealW?: number
  idealH?: number
}

export interface StageGeometry {
  stageW: number
  cols: number
  gap: number
  rowPx: number
}

/** 算脱离窗口的像素尺寸（已按 round 取整，调用方直接交给 floatCard） */
export function detachGeometry(v: DetachGeometryInput | undefined, g: StageGeometry): { w: number; h: number } {
  const colW = Math.max(40, (g.stageW - g.gap * (g.cols - 1)) / g.cols)
  const w = (v?.idealW ?? 4) * (colW + g.gap) - g.gap
  const h = (v?.idealH ?? 3) * (g.rowPx + g.gap)
  return { w: Math.round(Math.max(240, w)), h: Math.round(Math.max(160, h)) + 24 }
}
