/**
 * 编辑事务的**纯判定**（2026-10-12 立的"进编辑器拍快照 / 保存确认 / 取消还原"那套）。
 *
 * 两件事被抽出来，因为它们都是"给定两份版面文档就能算"的，不该绑在组件的 ref 上：
 *  - `isEditDirty`：这次编辑到底改没改（确认框只在真改过时才弹）；
 *  - `countLayoutChanges`：「N 处改动"那个数。
 *
 * **这个数按版面差异数，不是按历史步数** —— 拖一步再拖回来在历史上是两步、
 * 在版面差异上却是 0 处，而用户看的是版面（对话框里写的就是"版面有 N 处改动"）。
 * 卡片与行分开数：两边各自"新增/修改/删除"都算一处。
 */

import type { LayoutDoc } from '@levango7/engine'

/** 这次的编辑有没有产生改动（快照为 null = 还没进过编辑器） */
export function isEditDirty(snapshot: LayoutDoc | null, current: LayoutDoc): boolean {
  if (snapshot === null) return false
  return JSON.stringify(snapshot) !== JSON.stringify(current)
}

/** 两份版面之间差几处：卡片增删改 + 行增删改 */
export function countLayoutChanges(a: LayoutDoc, b: LayoutDoc): number {
  let n = 0
  const am = new Map(a.items.map((p) => [p.id, p]))
  const bm = new Map(b.items.map((p) => [p.id, p]))
  for (const [id, p] of bm) if (!am.has(id) || JSON.stringify(am.get(id)) !== JSON.stringify(p)) n++
  for (const id of am.keys()) if (!bm.has(id)) n++
  const ar = new Map((a.rows ?? []).map((r) => [r.id, r]))
  const br = new Map((b.rows ?? []).map((r) => [r.id, r]))
  for (const [id, r] of br) if (!ar.has(id) || JSON.stringify(ar.get(id)) !== JSON.stringify(r)) n++
  for (const id of ar.keys()) if (!br.has(id)) n++
  return n
}
