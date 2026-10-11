/**
 * 行容器（单层分组）：把卡片按横向段分组，行头是版面上的一条整宽带。
 *
 * ## 插入式行头（与"坐标不动"的一处偏离，如实记）
 * 行头要占真实的一行 —— `groupIntoRow` 把成员与其下方内容整体下移 1 行、行头落在
 * 腾出的那一行上；`ungroupRow` 收回。所以成员坐标在成组/解组时会整体 ±1 行，
 * 换到的是**渲染零覆盖**（行头不与任何卡片抢空间）与**可逆的整段位移**。
 * "成员坐标不动"因此要读作"成员的**相对**布局不动"。
 *
 * ## 折叠的坐标系（唯一需要想清楚的地方）
 * 折叠时成员从 `items` 整体移出、按**相对偏移**（`dy` 相对成员区顶部 `row.y + 1`）
 * 存进 `stash`。任何整段位移都会同步平移行头 `y`，于是嵌套折叠自洽：折叠上面的
 * 行 A 会带着下面折叠行 B 的 y 一起上移，B 的 stash 是相对量、不需要跟着动，
 * 展开 B 时锚定 B **当前**的 `y + 1` 还原即可。
 *
 * ## 已知边界（v1 如实记）
 * - 成员区里混进**非成员**卡（病态输入：手动把卡拖进别人行的中间）时不特殊处理 ——
 *   折叠按成员跨度平移，那张卡可能与被折叠区重叠；解组/展开后用户可再整理。
 * - 已属于某行的卡不能再被 `groupIntoRow` 收走（要先解组）—— 避免一次操作里
 *   多段位移叠加的语义歧义。
 *
 * 全部纯函数：doc 进、新 doc 出；非法输入返回 `null`。
 */

import { anyCollides } from './geometry.js'
import { findFreeSpot } from './spot.js'
import { LOGICAL_COLS, TITLE_MAX, type LayoutDoc, type Placement, type Row, type StashedPlacement } from './types.js'

function rowsOf(doc: LayoutDoc): Row[] {
  return doc.rows ?? []
}

function membersOf(doc: LayoutDoc, rowId: string): Placement[] {
  return doc.items.filter((p) => p.row === rowId)
}

/** 成员区高度（成员区顶部到最底成员下沿）。没有成员时 0（防御性） */
function memberSpan(members: readonly Placement[], top: number): number {
  let max = top
  for (const m of members) max = Math.max(max, m.y + m.h)
  return max - top
}

export interface RowView {
  row: Row
  /** 成员 id（折叠时来自 stash 现场） */
  members: string[]
  /** 整段高度（含行头那一行）；折叠时 = 1 */
  h: number
}

/** 编辑层用的行视图（按 y 排序）：行头位置 + 成员 + 总高 —— UI 据此画行头与围合框 */
export function rowsBands(doc: LayoutDoc): RowView[] {
  const out: RowView[] = []
  for (const row of rowsOf(doc)) {
    const members = row.collapsed
      ? (row.stash ?? []).filter((s) => !s.guest).map((s) => s.id)
      : membersOf(doc, row.id).map((m) => m.id)
    const h = row.collapsed ? 1 : 1 + memberSpan(membersOf(doc, row.id), row.y + 1)
    out.push({ row, members, h })
  }
  return out.sort((a, b) => a.row.y - b.row.y)
}

/** 新建行 id：r1、r2… 跳过已占用的 */
function nextRowId(doc: LayoutDoc): string {
  const used = new Set(rowsOf(doc).map((r) => r.id))
  for (let i = 1; ; i += 1) {
    const id = `r${i}`
    if (!used.has(id)) return id
  }
}

/** 把 `fromY`（含）以下的一切整体平移 dy：卡片与行头；stash 是相对量、不动 */
function shiftBelow(doc: LayoutDoc, fromY: number, dy: number): { items: Placement[]; rows: Row[] } {
  if (dy === 0) return { items: doc.items, rows: rowsOf(doc) }
  return {
    items: doc.items.map((p) => (p.y >= fromY ? { ...p, y: p.y + dy } : p)),
    rows: rowsOf(doc).map((r) => (r.y >= fromY ? { ...r, y: r.y + dy } : r)),
  }
}

/**
 * 成组为行。`ids` 必须都是存在且**不属于任何行**的卡；行头插在成员最顶处的上方
 * （成员与其下方内容下移 1 行）。非法输入（空表、重复 id、已属行、未知 id）返回 null。
 */
export function groupIntoRow(doc: LayoutDoc, ids: readonly string[], title = ''): LayoutDoc | null {
  const unique = [...new Set(ids)]
  if (!unique.length || unique.length !== ids.length) return null
  const members = doc.items.filter((p) => unique.includes(p.id))
  if (members.length !== unique.length) return null
  if (members.some((m) => m.row)) return null
  const top = members.reduce((acc, m) => Math.min(acc, m.y), Number.POSITIVE_INFINITY)
  const id = nextRowId(doc)
  const row: Row = { id, title: (title.trim() || '新建行').slice(0, TITLE_MAX), y: top }
  const shifted = shiftBelow(doc, top, 1)
  return {
    ...doc,
    items: shifted.items.map((p) => (unique.includes(p.id) ? { ...p, row: id } : p)),
    rows: [...shifted.rows, row],
  }
}

/** 折叠：成员**与带内非成员**一起存现场并移出 items，下方整体上移；行头留下 */
function collapse(doc: LayoutDoc, row: Row): LayoutDoc {
  const top = row.y + 1
  const members = membersOf(doc, row.id)
  const memberBottom = members.reduce((m, p) => Math.max(m, p.y + p.h), top)
  const span = memberBottom - top

  const rel = (p: Placement): StashedPlacement => ({
    id: p.id,
    variant: p.variant,
    x: p.x,
    dy: p.y - top,
    w: p.w,
    h: p.h,
    ...(p.title === undefined ? {} : { title: p.title }),
    ...(p.hideTitle === undefined ? {} : { hideTitle: p.hideTitle }),
    ...(p.locked === undefined ? {} : { locked: p.locked }),
  })
  const stash: StashedPlacement[] = members.map(rel)

  // 带内非成员（常见：五张卡的版面里组了上半带，而待办卡纵向横跨这段 ——
  // 便签/速记就"住在"它的跨度里）。折叠后留不下它们：移出到带下方并**一起进现场**，
  // 展开时按同样的相对锚点还原、但不设归属。没有这一步，往返一次它们就会漂走
  // （实测：塌了 +6 行）——这条是 E2E 抓出来的，不是推演出来的。
  const guests = doc.items.filter((p) => p.row !== row.id && p.y < memberBottom && p.y + p.h > top)
  for (const g of guests) stash.push({ ...rel(g), guest: true })

  const removed = new Set<string>([...members.map((p) => p.id), ...guests.map((p) => p.id)])
  const shifted = shiftBelow({ ...doc, items: doc.items.filter((p) => !removed.has(p.id)) }, memberBottom, -span)
  let items = shifted.items
  for (const g of guests) {
    // 折叠后它们排在行头下方（同列带首配，确定性落点）
    items = [...items, { ...g, ...findFreeSpot(items, g.w, g.h, g.x, row.y + 1, LOGICAL_COLS) }]
  }
  return { ...doc, items, rows: shifted.rows.map((r) => (r.id === row.id ? { ...r, collapsed: true, stash } : r)) }
}

/** 展开：现场（成员 + 带内非成员）按当前行头位置整体还原并让位；还原位撞上他卡时同列带向下让位 */
function expand(doc: LayoutDoc, row: Row): LayoutDoc {
  const stash = row.stash ?? []
  const top = row.y + 1
  const span = stash.reduce((acc, s) => Math.max(acc, s.dy + s.h), 0)
  // 先清掉折叠期间被移到带下方的 guest 副本（按现场 id 认领），再让位、统一还原
  const ids = new Set(stash.map((s) => s.id))
  const shifted = shiftBelow({ ...doc, items: doc.items.filter((p) => !ids.has(p.id)) }, top, span)
  let items = shifted.items
  for (const s of stash) {
    const p: Placement = {
      id: s.id,
      variant: s.variant,
      x: s.x,
      y: top + s.dy,
      w: s.w,
      h: s.h,
      ...(s.guest ? {} : { row: row.id }),
      ...(s.title === undefined ? {} : { title: s.title }),
      ...(s.hideTitle === undefined ? {} : { hideTitle: s.hideTitle }),
      ...(s.locked === undefined ? {} : { locked: s.locked }),
    }
    const others = items.filter((q) => q.id !== p.id)
    // findFreeSpot 返回 Rect：展开合并回 Placement（id/variant/row 都要保留）
    const placed: Placement = anyCollides(others, p) ? { ...p, ...findFreeSpot(others, p.w, p.h, p.x, p.y, LOGICAL_COLS) } : p
    items = [...others, placed]
  }
  return {
    ...doc,
    items,
    rows: shifted.rows.map((r) => (r.id === row.id ? { ...r, collapsed: undefined, stash: undefined } : r)),
  }
}

/** 解组：折叠中的行先展开（回到成员可见态），再收回行头那一行 */
export function ungroupRow(doc: LayoutDoc, rowId: string): LayoutDoc | null {
  const row = rowsOf(doc).find((r) => r.id === rowId)
  if (!row) return null
  const d = row.collapsed ? expand(doc, row) : doc
  const live = d.rows!.find((r) => r.id === rowId)!
  const shifted = shiftBelow(d, live.y + 1, -1)
  const rows = shifted.rows.filter((r) => r.id !== rowId)
  return {
    ...d,
    items: shifted.items.map((p) => (p.row === rowId ? { ...p, row: undefined } : p)),
    rows: rows.length ? rows : undefined,
  }
}

export function setRowTitle(doc: LayoutDoc, rowId: string, title: string): LayoutDoc | null {
  const row = rowsOf(doc).find((r) => r.id === rowId)
  if (!row) return null
  const t = title.trim().slice(0, TITLE_MAX)
  return { ...doc, rows: doc.rows!.map((r) => (r.id === rowId ? { ...r, title: t || r.title } : r)) }
}

export function toggleRowCollapsed(doc: LayoutDoc, rowId: string): LayoutDoc | null {
  const row = rowsOf(doc).find((r) => r.id === rowId)
  if (!row) return null
  return row.collapsed ? expand(doc, row) : collapse(doc, row)
}

/**
 * 空行剪除：行里既没有成员也没有折叠现场 → 连行头那一行一起收回。
 * 由 `removeItem` / `removeMany` 在删卡后调用 —— "最后一张卡被移走 = 行没了"。
 */
export function pruneRows(doc: LayoutDoc): LayoutDoc {
  let d = doc
  for (const row of [...rowsOf(d)].sort((a, b) => a.y - b.y)) {
    const live = d.rows!.find((r) => r.id === row.id)
    if (!live) continue
    const hasMembers = d.items.some((p) => p.row === live.id)
    const hasStash = (live.stash?.length ?? 0) > 0
    if (hasMembers || hasStash) continue
    const shifted = shiftBelow(d, live.y + 1, -1)
    const remaining = shifted.rows.filter((r) => r.id !== live.id)
    d = { ...d, items: shifted.items, rows: remaining.length ? remaining : undefined }
  }
  return d
}
