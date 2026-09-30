import { anyCollides, clamp } from './geometry'
import { findFreeSpot } from './spot'
import { findModule, resolveVariant, TITLE_MAX } from './types'
import type { LayoutDoc, ModuleRegistry, Placement } from './types'

function withItems(doc: LayoutDoc, items: Placement[]): LayoutDoc {
  return { ...doc, items }
}

function replaceItem(doc: LayoutDoc, id: string, patch: Partial<Placement>): LayoutDoc {
  return withItems(
    doc,
    doc.items.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  )
}

function indexOf(doc: LayoutDoc, id: string): Placement | undefined {
  return doc.items.find((p) => p.id === id)
}

function others(doc: LayoutDoc, id: string): Placement[] {
  return doc.items.filter((p) => p.id !== id)
}

/** 拖入 = 按所选形态推荐尺寸落位；目标被占则同列带向下找最近空位（永不失败，除非模块已在版面上） */
export function addItem(
  doc: LayoutDoc,
  reg: ModuleRegistry,
  moduleId: string,
  x: number,
  y: number,
  variantId?: string,
): LayoutDoc | null {
  const mod = findModule(reg, moduleId)
  if (!mod) return null
  if (indexOf(doc, moduleId)) return null
  const v = resolveVariant(mod, variantId)
  if (!v) return null
  const spot = findFreeSpot(doc.items, v.idealW, v.idealH, x, y, doc.cols)
  return withItems(doc, [
    ...doc.items,
    { id: moduleId, variant: v.id, x: spot.x, y: spot.y, w: spot.w, h: spot.h },
  ])
}

export function removeItem(doc: LayoutDoc, id: string): LayoutDoc | null {
  if (!indexOf(doc, id)) return null
  return withItems(doc, others(doc, id))
}

export function removeMany(doc: LayoutDoc, ids: readonly string[]): LayoutDoc | null {
  const set = new Set(ids)
  if (!ids.length || !doc.items.some((p) => set.has(p.id))) return null
  return withItems(doc, doc.items.filter((p) => !set.has(p.id)))
}

/**
 * 成组平移（多选拖拽）。整组先夹到列范围内，再整体向下试位直到与"组外"的卡片不撞；
 * 试不出合法位置就拒绝（返回 null，由交互层回退）——与单卡缩放的拒绝语义一致。
 */
export function moveMany(
  doc: LayoutDoc,
  ids: readonly string[],
  dx: number,
  dy: number,
): LayoutDoc | null {
  const set = new Set(ids)
  const group = doc.items.filter((p) => set.has(p.id))
  if (!group.length) return null
  if (group.some((p) => p.locked)) return null
  const outside = doc.items.filter((p) => !set.has(p.id))

  const minX = Math.min(...group.map((p) => p.x))
  const maxX = Math.max(...group.map((p) => p.x + p.w))
  const minY = Math.min(...group.map((p) => p.y))
  let ox = dx
  let oy = dy
  if (minX + ox < 0) ox = -minX
  if (maxX + ox > doc.cols) ox = doc.cols - maxX
  if (minY + oy < 0) oy = -minY

  for (let attempt = 0; attempt <= doc.cols + 64; attempt++) {
    const moved: Placement[] = group.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy + attempt }))
    if (!moved.some((m) => anyCollides(outside, m))) {
      return withItems(
        doc,
        doc.items.map((p) => moved.find((m) => m.id === p.id) ?? p),
      )
    }
  }
  return null
}

/** 移动：目标被占时向下找最近空位，不弹回原位 */
export function moveItem(doc: LayoutDoc, id: string, x: number, y: number): LayoutDoc | null {
  const p = indexOf(doc, id)
  if (!p || p.locked) return null
  const rect = {
    x: clamp(x, 0, Math.max(0, doc.cols - p.w)),
    y: Math.max(0, Math.floor(y)),
    w: p.w,
    h: p.h,
  }
  const rest = others(doc, id)
  const placed = anyCollides(rest, rect)
    ? findFreeSpot(rest, rect.w, rect.h, rect.x, rect.y, doc.cols)
    : rect
  return replaceItem(doc, id, { x: placed.x, y: placed.y })
}

/**
 * 缩放：钳制到形态最小尺寸，宽不超过列数；结果与邻居重叠则拒绝（返回 null，由交互层回退）。
 * 右边界采用「先定宽再向左收缩 x」，因此 nw 始终 ≥ minW。
 */
export function resizeItem(
  doc: LayoutDoc,
  reg: ModuleRegistry,
  id: string,
  w: number,
  h: number,
): LayoutDoc | null {
  const p = indexOf(doc, id)
  if (!p || p.locked) return null
  const mod = findModule(reg, p.id)
  const v = resolveVariant(mod, p.variant)
  const minW = v?.minW ?? 1
  const minH = v?.minH ?? 1
  const nw = clamp(Math.round(w), minW, doc.cols)
  const nx = nw > doc.cols - p.x ? doc.cols - nw : p.x
  const nh = Math.max(Math.round(h), minH)
  const rect = { x: nx, y: p.y, w: nw, h: nh }
  if (anyCollides(others(doc, id), rect)) return null
  return replaceItem(doc, id, { x: nx, y: p.y, w: nw, h: nh })
}

/** 切形态：格子小于新形态最小尺寸时自动补足并就近让位 */
export function setVariant(
  doc: LayoutDoc,
  reg: ModuleRegistry,
  id: string,
  variantId: string,
): LayoutDoc | null {
  const p = indexOf(doc, id)
  const mod = p ? findModule(reg, p.id) : undefined
  const v = mod?.variants.find((x) => x.id === variantId)
  if (!p || !v) return null
  const nw = Math.min(Math.max(p.w, v.minW), doc.cols)
  const nx = nw > doc.cols - p.x ? doc.cols - nw : p.x
  const nh = Math.max(p.h, v.minH)
  const rect = { x: nx, y: p.y, w: nw, h: nh }
  const rest = others(doc, id)
  const placed = anyCollides(rest, rect)
    ? findFreeSpot(rest, nw, nh, nx, p.y, doc.cols)
    : rect
  return replaceItem(doc, id, { variant: v.id, ...placed })
}

/** title 传空 = 回落模块内置标题；hideTitle 三态（true/false 表态，null 清回默认） */
export function setItemTitle(
  doc: LayoutDoc,
  id: string,
  title?: string | null,
  hideTitle?: boolean | null,
): LayoutDoc | null {
  const p = indexOf(doc, id)
  if (!p) return null
  const t = typeof title === 'string' ? title.trim().slice(0, TITLE_MAX) : ''
  const patch: Partial<Placement> = { title: t || undefined }
  if (hideTitle === null) patch.hideTitle = undefined
  else if (typeof hideTitle === 'boolean') patch.hideTitle = hideTitle
  return replaceItem(doc, id, patch)
}

export function toggleLock(doc: LayoutDoc, id: string): LayoutDoc | null {
  const p = indexOf(doc, id)
  if (!p) return null
  return replaceItem(doc, id, { locked: !p.locked })
}

export function clearLayout(doc: LayoutDoc): LayoutDoc {
  return withItems(doc, [])
}
