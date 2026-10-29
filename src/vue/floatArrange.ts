/**
 * 「按版面重摆浮窗位置」的**纯判定层**（F-08 的「定位」收官，2026-10-29）。
 *
 * 为什么单独成文件：与 `floatList.ts` 同款理由 —— 这段映射要满足**不开浏览器也能断言**
 * （本仓受测层的纳入判据，见 `vitest.config.ts` 文件头），而 Rust 侧只收坐标做搬运。
 *
 * 回答一个问题：**每张浮窗应该摆到屏幕的哪里？**
 *
 * 口径（刻意选最可解释的那种）：
 * - 版面里**全部条目**的包围盒（按外沿算）当作"版面的形状"——脱离卡的旧槽位也算，
 *   它在版面上的位置就是人对它的记忆；
 * - 每张浮窗左上角在包围盒里的相对位置（天然 0..1，无需夹取）映射到工作区：
 *   `x = wa.x + pad + nx * (wa.w - 2*pad - 自己的宽)`，y 同理 ——
 *   乘的是「工作区减自己」，靠右的卡才不会把窗推出屏幕右缘；
 * - 各窗保持自己当前的尺寸（那是用户拖出来的，重摆不碰）；包围盒退化（宽或高为 0）
 *   时相对位置取 0，不除零。
 *
 * 与本判定层无关的两件事：屏幕工作区由调用点读 `window.screen`（本文件不认识浏览器）；
 * 「把窗搬过去」是 Rust 侧的 `move_float`（纯前端拿不到别的窗口句柄）—— 这里只算坐标。
 */
import type { Placement } from '@levango7/engine'

export interface WorkArea {
  x: number
  y: number
  w: number
  h: number
}

export interface ArrangeTarget {
  id: string
  x: number
  y: number
}

/** sizes 缺某张窗时的兜底尺寸（Rust 侧建窗钳制的最小档同款） */
const DEFAULT_W = 180
const DEFAULT_H = 120

/**
 * @param items    版面条目（`store.doc.value.items`），**全部**参与包围盒
 * @param detached 在浮动的实例 id 集合（`useDetached()` 那一份）
 * @param sizes    实例 id → 当前窗口尺寸（点击时现场 `list_floats` 取的 w/h）
 * @param wa       工作区（逻辑像素；调用点从 `window.screen` 换来）
 * @param pad      工作区边距（默认 16）
 */
export function floatArrangeTargets(
  items: readonly Placement[],
  detached: ReadonlySet<string>,
  sizes: ReadonlyMap<string, { w: number; h: number }>,
  wa: WorkArea,
  pad = 16,
): ArrangeTarget[] {
  if (items.length === 0 || detached.size === 0) return []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of items) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x + p.w > maxX) maxX = p.x + p.w
    if (p.y + p.h > maxY) maxY = p.y + p.h
  }
  const bw = maxX - minX
  const bh = maxY - minY
  const out: ArrangeTarget[] = []
  for (const p of items) {
    if (!detached.has(p.id)) continue
    const s = sizes.get(p.id) ?? { w: DEFAULT_W, h: DEFAULT_H }
    const nx = bw > 0 ? (p.x - minX) / bw : 0
    const ny = bh > 0 ? (p.y - minY) / bh : 0
    const spanX = Math.max(wa.w - pad * 2 - s.w, 0)
    const spanY = Math.max(wa.h - pad * 2 - s.h, 0)
    out.push({
      id: p.id,
      x: Math.round(wa.x + pad + nx * spanX),
      y: Math.round(wa.y + pad + ny * spanY),
    })
  }
  return out
}
