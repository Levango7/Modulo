import { anyCollides, maxRow } from './geometry.js'
import type { LayoutDoc, Placement } from './types.js'

function pack(doc: LayoutDoc, allowLeft: boolean): Placement[] {
  const pinned = doc.items.filter((p) => p.locked)
  const movable = [...doc.items.filter((p) => !p.locked)].sort((a, b) => a.y - b.y || a.x - b.x)
  const settled: Placement[] = [...pinned]
  for (const p of movable) {
    let placed: Placement | null = null
    outer: for (let y = 0; y <= p.y; y++) {
      for (let x = allowLeft ? 0 : p.x; x <= p.x; x++) {
        const r = { ...p, x, y }
        if (!anyCollides(settled, r)) {
          placed = r
          break outer
        }
      }
    }
    /** 原位上方与左方都被占：落到所有已放项之下，那一行必然空闲 */
    settled.push(placed ?? { ...p, y: maxRow(settled) })
  }
  return settled
}

function rowsOf(items: readonly Placement[]): number {
  return items.reduce((m, p) => Math.max(m, p.y + p.h), 0)
}

function applyPositions(doc: LayoutDoc, placed: Placement[]): LayoutDoc {
  const byId = new Map(placed.map((p) => [p.id, p]))
  return { ...doc, items: doc.items.map((p) => byId.get(p.id) ?? p) }
}

/**
 * 按需整理：把稀疏版面按重力聚拢，消除自由排版留下的空洞。
 *
 * 刻意做成**用户主动触发 + 可撤销**的一步，而不是自动贪心压实 ——
 * 自动压实会让"删掉中间一块"引发整屏跳动（x-hub 明确避开了这件事，我们沿用它的判断）。
 * 锁定项永远不动，其余卡片绕开它们重新落位。
 *
 * 两个候选都算一遍取更矮的：只"上聚"会把行带让给横向空隙，只"上+左聚"则可能把窄卡挤到
 * 下一列反而抬高总高（实测推荐布局 11 行 → 12 行）。取更矮者保证整理永远不会让版面变差。
 */
function tidyOnce(doc: LayoutDoc): LayoutDoc {
  if (!doc.items.some((p) => !p.locked)) return doc
  const upOnly = pack(doc, false)
  const upLeft = pack(doc, true)
  return applyPositions(doc, rowsOf(upLeft) <= rowsOf(upOnly) ? upLeft : upOnly)
}

export function tidyLayout(doc: LayoutDoc): LayoutDoc {
  let cur = doc
  /** 迭代到不动点：单次整理可能让两个候选的优劣互换，反复跑到不再变化才保证幂等 */
  for (let i = 0; i < 8; i++) {
    const next = tidyOnce(cur)
    if (JSON.stringify(next.items) === JSON.stringify(cur.items)) return cur
    cur = next
  }
  return cur
}

/** 版面使用行带内未被覆盖的逻辑格占比；用于量化"整理到底有没有效果" */
export function holeRatio(doc: LayoutDoc): number {
  if (!doc.items.length) return 0
  const rows = rowsOf(doc.items)
  const cells = new Set<string>()
  for (const p of doc.items) {
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) cells.add(`${x},${y}`)
    }
  }
  return 1 - cells.size / (rows * doc.cols)
}

export function usedRows(doc: LayoutDoc): number {
  return rowsOf(doc.items)
}
