import { findModule, resolveVariant } from './types.js'
import type { LayoutDoc, ModuleRegistry } from './types.js'

/**
 * 按内容收紧高度：只把卡片改矮，绝不改高（变高才可能撞邻居，这里不需要）。
 * wantedRows 由 UI 层实测得到（卡片体的自然高度 ÷ 单行像素），
 * 引擎只负责守住"不得低于形态最小尺寸"这条不变量。
 */
export function fitHeights(
  doc: LayoutDoc,
  reg: ModuleRegistry,
  wantedRows: Record<string, number>,
): LayoutDoc {
  let changed = false
  const items = doc.items.map((p) => {
    const want = wantedRows[p.id]
    // 非正数/NaN 视为「没有测量数据」，不参与收紧；大于当前高度则是「不用变」，两者都跳过
    if (typeof want !== 'number' || !Number.isFinite(want) || want < 1 || want >= p.h) return p
    const minH = resolveVariant(findModule(reg, p.id), p.variant)?.minH ?? 1
    const h = Math.max(Math.round(want), minH, 1)
    if (h === p.h) return p
    changed = true
    return { ...p, h }
  })
  return changed ? { ...doc, items } : doc
}
