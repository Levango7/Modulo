/**
 * 参数化一键自动重排（阶段 C）。
 *
 * ## 定位：**一键、参数化、可撤销**，不是连续自动
 * Grafana 的 auto grid 会跟着加卡/改窗连续重排；这里刻意不做 —— 这版面上的卡很多是
 * 手工微调过尺寸的，偷偷重排会与手工意图打架（用户拍过板：不偷覆盖手工坐标）。
 * 所以这是一个**显式动作**：选参数、点一下、跑一次、Ctrl+Z 能退回。
 *
 * ## 目标与范围
 * - `target = { row }`：重排某个行的成员（按 (y,x) 保阅读序）；
 * - `target = { top: true }`：重排全部**无行**卡片（行的成员与行头都不动）。
 * - 落位后对**全表**做一次确定性消叠：重排区之外被压到的卡走同列带向下首配
 *   （与 `validate.ts` 的消叠同思路）——不重叠是全仓的不变量，不因一次重排破掉。
 *
 * ## 格子的算法（写清楚，因为数字都能手验）
 * - 每行 `per` 张：宽 = `floor(12 / per)`，余数 `r = 12 - per·floor(12/per)` 分给
 *   前 r 张（每张 +1 列）；**任何卡的宽都不小于自己形态的 minW** —— 小于就取 minW，
 *   超出 12 列的顺延到下一格行（不是硬塞）。
 * - 高 = 统一行高 `max(rowH, 该格行内最大 minH)`：宁可格子高一点，不让任何卡低于 min。
 * - 幂等：同输入同输出（分行与分配都确定）——重复点"重排"版面不动。
 */

import { anyCollides } from './geometry.js'
import { findFreeSpot } from './spot.js'
import { LOGICAL_COLS, resolveVariant, type LayoutDoc, type ModuleRegistry, type Placement } from './types.js'

export interface AutoParams {
  /** 每行几张（1–6，出界夹回） */
  per: number
  /** 行高（逻辑行，1–8，出界夹回） */
  rowH: number
}

export const DEFAULT_AUTO: AutoParams = { per: 3, rowH: 3 }

function clampParams(p: Partial<AutoParams> | undefined): AutoParams {
  const per = Math.min(Math.max(Math.trunc(p?.per ?? DEFAULT_AUTO.per) || DEFAULT_AUTO.per, 1), 6)
  const rowH = Math.min(Math.max(Math.trunc(p?.rowH ?? DEFAULT_AUTO.rowH) || DEFAULT_AUTO.rowH, 1), 8)
  return { per, rowH }
}

/** 分配一轮宽度：floor(12/per)，余数给前 r 张各 +1 列 */
function widthsOf(count: number, per: number): number[] {
  const base = Math.floor(LOGICAL_COLS / per)
  const r = LOGICAL_COLS - base * per
  return Array.from({ length: count }, (_, i) => base + (i < r ? 1 : 0))
}

export type AutoTarget = { row: string } | { top: true }

/**
 * 重排。非法目标（行不存在 / 折叠中）与空目标（没有成员 / 没有无行卡）返回 null ——
 * "没动的 doc" 与 "不该动的调用" 让调用方分不清，宁可不提交历史。
 */
export function autoLayout(doc: LayoutDoc, reg: ModuleRegistry, target: AutoTarget, params?: Partial<AutoParams>): LayoutDoc | null {
  const { per, rowH } = clampParams(params)

  let members: Placement[]
  let originY: number
  if ('row' in target) {
    const row = (doc.rows ?? []).find((r) => r.id === target.row)
    if (!row || row.collapsed) return null // 折叠的行没有可见的成员区可排
    members = doc.items.filter((p) => p.row === row.id)
    originY = row.y + 1
  } else {
    members = doc.items.filter((p) => !p.row)
    if (!members.length) return null
    originY = members.reduce((m, p) => Math.min(m, p.y), Number.POSITIVE_INFINITY)
  }
  if (!members.length) return null

  const order = [...members].sort((a, b) => a.y - b.y || a.x - b.x)
  const widths = widthsOf(order.length, per)
  const minOf = order.map((p) => {
    const v = resolveVariant(
      reg.find((m) => m.id === p.id),
      p.variant,
    )
    return { minW: v?.minW ?? 1, minH: v?.minH ?? 1 }
  })

  // 第一趟：分行（宽不小于 minW；放不下顺延到下一格行）
  type Cell = { p: Placement; w: number; minH: number }
  const lines: Cell[][] = []
  let line: Cell[] = []
  let x = 0
  for (let i = 0; i < order.length; i += 1) {
    const w = Math.max(widths[i], minOf[i].minW)
    if (line.length && x + w > LOGICAL_COLS) {
      lines.push(line)
      line = []
      x = 0
    }
    line.push({ p: order[i], w, minH: minOf[i].minH })
    x += w
  }
  // 循环结束时 line 必然非空（每张卡要么开新行要么进当前行）—— 不需要空行守卫，
  // 那种守卫的分支永远覆盖不到，只会是覆盖率账本上的一个假洞
  lines.push(line)

  // 第二趟：按行落位，统一行高 = max(rowH, 该格行最大 minH)
  const placed: Placement[] = []
  let y = originY
  for (const ln of lines) {
    const hRow = Math.max(rowH, ...ln.map((c) => c.minH))
    let lx = 0
    for (const c of ln) {
      placed.push({ ...c.p, x: lx, y, w: c.w, h: hRow })
      lx += c.w
    }
    y += hRow
  }

  // 确定性消叠：非目标卡若与重排结果相撞 → 同列带向下首配（保持全仓"不重叠"不变量）
  const memberIds = new Set(members.map((p) => p.id))
  let settled: Placement[] = doc.items.filter((p) => !memberIds.has(p.id))
  for (const p of placed) {
    const hit = anyCollides(settled, p)
    settled = [...settled, hit ? { ...p, ...findFreeSpot(settled, p.w, p.h, p.x, p.y, LOGICAL_COLS) } : p]
  }
  // 保持原 items 的顺序骨架（重排卡在原位置序列上换值）——顺序稳定更好 diff
  const byId = new Map(settled.map((p) => [p.id, p]))
  const items = doc.items.map((p) => byId.get(p.id)!).filter(Boolean)
  return { ...doc, items }
}

/** 所有行各按自己的参数重排一遍（行按 y 顺序；未设参数的行用 fallback）。无行可排返回 null */
export function autoLayoutAllRows(doc: LayoutDoc, reg: ModuleRegistry, fallback: Partial<AutoParams> = {}): LayoutDoc | null {
  const rows = [...(doc.rows ?? [])].filter((r) => !r.collapsed).sort((a, b) => a.y - b.y)
  if (!rows.length) return null
  let d = doc
  let touched = false
  for (const row of rows) {
    const next = autoLayout(d, reg, { row: row.id }, { ...fallback, ...row.auto })
    if (next) {
      d = next
      touched = true
    }
  }
  return touched ? d : null
}
