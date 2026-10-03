import { anyCollides, clamp, isInt } from './geometry.js'
import { findFreeSpot } from './spot.js'
import { LOGICAL_COLS, TITLE_MAX } from './types.js'
import type { LayoutDoc, ModuleRegistry, Placement } from './types.js'

export interface SanitizeResult {
  items: Placement[]
  warnings: string[]
}

/**
 * 不信任盘上数据：校验 id/坐标、按形态 min 钳制尺寸、归一失效 variant、截断标题、去重单实例，
 * 最后从上往下扫描逐项消解重叠（钳制放大老数据时产生的重叠）。
 */
export function sanitizeItems(raw: unknown, reg: ModuleRegistry, cols: number = LOGICAL_COLS): SanitizeResult {
  const warnings: string[] = []
  if (!Array.isArray(raw)) {
    warnings.push('layout items 不是数组，已回退空布局')
    return { items: [], warnings }
  }
  const seen = new Set<string>()
  const settled: Placement[] = []

  for (const entry of raw) {
    const e = entry as Partial<Placement> | null
    if (!e || typeof e.id !== 'string') {
      warnings.push('跳过缺少 id 的条目')
      continue
    }
    const mod = reg.find((m) => m.id === e.id)
    if (!mod) {
      warnings.push(`未知模块 ${e.id}，已跳过`)
      continue
    }
    if (seen.has(e.id)) {
      warnings.push(`模块 ${e.id} 重复出现，保留第一条`)
      continue
    }
    const rawX = e.x
    const rawY = e.y
    if (!isInt(rawX) || !isInt(rawY)) {
      warnings.push(`模块 ${e.id} 坐标非整数，已跳过`)
      continue
    }
    const v = mod.variants.find((x) => x.id === e.variant) ?? mod.variants.find((x) => x.id === mod.defaultVariant) ?? mod.variants[0]
    if (!v) {
      warnings.push(`模块 ${e.id} 没有可用形态，已跳过`)
      continue
    }
    if (v.id !== e.variant) warnings.push(`模块 ${e.id} 形态 ${String(e.variant)} 失效，归一为 ${v.id}`)

    const w = isInt(e.w) ? clamp(e.w, v.minW, cols) : v.idealW
    const h = isInt(e.h) ? Math.max(e.h, v.minH) : v.idealH
    const x = clamp(rawX, 0, Math.max(0, cols - w))
    const y = Math.max(0, rawY)

    const title = typeof e.title === 'string' && e.title.trim() ? e.title.trim().slice(0, TITLE_MAX) : undefined
    const hideTitle = typeof e.hideTitle === 'boolean' ? e.hideTitle : undefined
    const locked = e.locked === true ? true : undefined

    const rect = { x, y, w, h }
    const placed = anyCollides(settled, rect) ? findFreeSpot(settled, w, h, x, y, cols) : rect
    seen.add(e.id)
    settled.push({ id: e.id, variant: v.id, ...placed, ...(title ? { title } : {}), ...(hideTitle !== undefined ? { hideTitle } : {}), ...(locked ? { locked } : {}) })
  }
  return { items: settled, warnings }
}

export function toDoc(items: Placement[], cols: number = LOGICAL_COLS): LayoutDoc {
  return { schemaVersion: 1, cols, items }
}
