import { physicalCols, scaleFactor } from './breakpoints.js'
import { pickVariantForSize } from './downgrade.js'
import { anyCollides, clamp } from './geometry.js'
import { findFreeSpot } from './spot.js'
import { LOGICAL_COLS } from './types.js'
import type { LayoutDoc, ModuleRegistry, Rect } from './types.js'

export interface PhysicalRect extends Rect {
  id: string
  /** 投影后实际生效的形态，可能因宽度不足被降档 */
  variant: string
  downgraded: boolean
}

export interface CollapsedItem {
  id: string
  variant: string
  reason: 'unknown-module' | 'no-variant-fits'
  logical: Rect
}

export interface ProjectionResult {
  cols: number
  rects: PhysicalRect[]
  collapsed: CollapsedItem[]
}

/**
 * 逻辑 12 列 → 物理 N 列的只读投影（方案 A，见 docs/ARCHITECTURE.md §3）。
 * 四条不变量：I1 只读不回写；I2 幂等（按 y,x 稳定排序）；I3 输出互不重叠；I4 每个输出矩形都装得下它的形态。
 *
 * 注意单位：minW/minH 是**逻辑列**单位，而 pw 是**物理列**，两者不可直接比。
 * 因此形态是否够用按逻辑等效宽度 `round(pw * s)` 判断 —— 一个 4 逻辑列宽的模块
 * 在任何 N 下都占容器的 1/3，投影只改变"落在几个物理列上"，不改变它分到的比例。
 */
export function project(doc: LayoutDoc, reg: ModuleRegistry, cols: number): ProjectionResult {
  const n = clamp(Math.floor(cols), 1, LOGICAL_COLS)
  const s = scaleFactor(n)
  const rects: PhysicalRect[] = []
  const collapsed: CollapsedItem[] = []

  const ordered = [...doc.items].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const p of ordered) {
    const logical = { x: p.x, y: p.y, w: p.w, h: p.h }
    const mod = reg.find((m) => m.id === p.id)
    if (!mod) {
      collapsed.push({ id: p.id, variant: p.variant, reason: 'unknown-module', logical })
      continue
    }
    /**
     * 宽度向上取整、位置向下取整：宁可让卡片挤到一起（重叠交给下面的让位消解），
     * 也不要取整向下留出空洞 —— 实测 4 列档用 round 时，一个 4 逻辑列宽的卡会缩成
     * 1/4 容器宽（本该 1/3），版面中间开出一个洞。
     */
    const pw = clamp(Math.ceil(p.w / s), 1, n)
    const px = clamp(Math.floor(p.x / s), 0, n - pw)
    const v = pickVariantForSize(mod, p.variant, Math.round(pw * s), p.h)
    if (!v) {
      collapsed.push({ id: p.id, variant: p.variant, reason: 'no-variant-fits', logical })
      continue
    }
    const rect = { x: px, y: p.y, w: pw, h: p.h }
    const placed = anyCollides(rects, rect) ? findFreeSpot(rects, pw, p.h, px, p.y, n) : rect
    rects.push({ id: p.id, variant: v.id, ...placed, downgraded: v.id !== p.variant })
  }
  return { cols: n, rects, collapsed }
}

/** 容器宽直接投影 */
export function projectForWidth(doc: LayoutDoc, reg: ModuleRegistry, containerWidth: number): ProjectionResult {
  return project(doc, reg, physicalCols(containerWidth))
}
