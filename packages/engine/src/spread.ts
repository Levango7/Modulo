import { anyCollides } from './geometry.js'
import { tidyLayout } from './tidy.js'
import type { LayoutDoc, Placement } from './types.js'

/** 按顶边 y 分组；组内必须两两横向不相交，否则重排 x 会破坏它们 */
function rowsOf(items: readonly Placement[]): Placement[][] {
  const byY = new Map<number, Placement[]>()
  for (const p of [...items].sort((a, b) => a.x - b.x)) {
    const list = byY.get(p.y) ?? []
    list.push(p)
    byY.set(p.y, list)
  }
  return [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list)
    .filter((list) =>
      list.every((a, i) => !list.slice(i + 1).some((b) => a.x < b.x + b.w && a.x + a.w > b.x)),
    )
}

/**
 * 撑满：把每一行（顶边相同、横向互不相交的卡片集合）按原比例放大到铺满整行宽度。
 *
 * 只做"变宽"不做"变窄"，所以形态的 minW 天然继续成立；
 * 含锁定项的行跳过（不跟用户钉住的东西较劲）；
 * 放大后若与行外的卡片相撞，整行放弃 —— 宁可不动也不制造重叠。
 */
export function fillRows(doc: LayoutDoc): LayoutDoc {
  const positions = new Map(doc.items.map((p) => [p.id, { ...p }]))
  for (const row of rowsOf([...positions.values()])) {
    if (row.some((p) => p.locked)) continue
    const used = row.reduce((s, p) => s + p.w, 0)
    if (used === 0 || used >= doc.cols) continue

    const scale = doc.cols / used
    const grown = row.map((p) => ({ id: p.id, w: Math.max(1, Math.floor(p.w * scale)) }))
    let remainder = doc.cols - grown.reduce((s, g) => s + g.w, 0)
    while (remainder > 0) {
      grown.sort((a, b) => a.w - b.w)[grown.length - 1].w += 1
      remainder--
    }

    let x = 0
    const next = new Map<string, Placement>()
    for (const p of [...row].sort((a, b) => a.x - b.x)) {
      const w = grown.find((g) => g.id === p.id)!.w
      next.set(p.id, { ...p, x, w })
      x += w
    }

    const others = [...positions.values()].filter((p) => !next.has(p.id))
    if ([...next.values()].some((p) => anyCollides(others, p))) continue
    for (const [id, p] of next) positions.set(id, p)
  }
  return { ...doc, items: doc.items.map((p) => positions.get(p.id) ?? p) }
}

/** 先聚拢再撑满：单独撑满会保留纵向空档，组合起来才是"版面铺满" */
export function spreadLayout(doc: LayoutDoc): LayoutDoc {
  return fillRows(tidyLayout(doc))
}
