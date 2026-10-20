import { anyCollides, clamp, isInt } from './geometry.js'
import { findFreeSpot } from './spot.js'
import { LOGICAL_COLS, moduleIdOf, TITLE_MAX } from './types.js'
import type { LayoutDoc, ModuleRegistry, Placement, Row, StashedPlacement } from './types.js'

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
    // 实例 id 与模块 id 分离：多开实例的 id 是 `模块:2` 这类，模块仍要能查到
    const moduleId = moduleIdOf(e as { id: string; module?: string })
    const mod = reg.find((m) => m.id === moduleId)
    if (!mod) {
      warnings.push(`未知模块 ${moduleId}，已跳过`)
      continue
    }
    if (seen.has(e.id)) {
      warnings.push(`卡片 ${e.id} 重复出现，保留第一条`)
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
    // 行归属先原样带着，等 sanitizeRows 拿全行清单后再剥孤儿（见下）
    const row = typeof e.row === 'string' && e.row ? e.row : undefined

    const rect = { x, y, w, h }
    const placed = anyCollides(settled, rect) ? findFreeSpot(settled, w, h, x, y, cols) : rect
    seen.add(e.id)
    settled.push({
      id: e.id,
      ...(moduleId === e.id ? {} : { module: moduleId }),
      variant: v.id,
      ...placed,
      ...(title ? { title } : {}),
      ...(hideTitle !== undefined ? { hideTitle } : {}),
      ...(locked ? { locked } : {}),
      ...(row ? { row } : {}),
    })
  }
  return { items: settled, warnings }
}

/**
 * 行容器的清洗（盘上数据不可信的同一条线）：行 id 唯一非空、标题截断、y 非负整数、
 * stash 形状校验；随后**剥掉指向不存在行的孤儿引用**（条目留着、归属去掉 ——
 * 卡片是用户的东西，不因容器数据坏了就丢）。空行（无成员无现场）在 doc 组装后
 * 由 `pruneRows` 连同行头那一行一起收回。
 */
export function sanitizeRows(raw: unknown, items: readonly Placement[]): { rows: Row[]; items: Placement[]; warnings: string[] } {
  const warnings: string[] = []
  const rows: Row[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const e = entry as Partial<Row> | null
      if (!e || typeof e.id !== 'string' || !e.id) {
        warnings.push('跳过缺少 id 的行')
        continue
      }
      if (seen.has(e.id)) {
        warnings.push(`行 ${e.id} 重复出现，保留第一条`)
        continue
      }
      if (!isInt(e.y) || (e.y as number) < 0) {
        warnings.push(`行 ${e.id} 的 y 非法，已跳过`)
        continue
      }
      seen.add(e.id)
      const stashRaw = Array.isArray(e.stash) ? e.stash : []
      const stash: StashedPlacement[] = []
      for (const s of stashRaw as Partial<StashedPlacement>[]) {
        if (!s || typeof s.id !== 'string' || !isInt(s.x) || !isInt(s.dy) || !isInt(s.w) || !isInt(s.h)) continue
        stash.push({
          id: s.id,
          ...(typeof s.module === 'string' && s.module && s.module !== s.id ? { module: s.module } : {}),
          variant: typeof s.variant === 'string' ? s.variant : '',
          x: s.x as number,
          dy: s.dy as number,
          w: s.w as number,
          h: s.h as number,
        })
      }
      const autoRaw = e.auto as { per?: unknown; rowH?: unknown } | undefined
      const auto =
        autoRaw && typeof autoRaw.per === 'number' && typeof autoRaw.rowH === 'number'
          ? { per: Math.min(Math.max(Math.trunc(autoRaw.per) || 3, 1), 6), rowH: Math.min(Math.max(Math.trunc(autoRaw.rowH) || 3, 1), 8) }
          : undefined
      rows.push({
        id: e.id,
        title: typeof e.title === 'string' && e.title.trim() ? e.title.trim().slice(0, TITLE_MAX) : '新建行',
        y: e.y as number,
        ...(auto ? { auto } : {}),
        ...(e.collapsed === true ? { collapsed: true, stash } : {}),
      })
    }
  } else if (raw !== undefined && raw !== null) {
    warnings.push('layout rows 不是数组，已按空表处理')
  }
  const ids = new Set(rows.map((r) => r.id))
  let orphans = 0
  const fixed = items.map((p) => {
    if (p.row && !ids.has(p.row)) {
      orphans += 1
      const { row: _drop, ...rest } = p
      return rest as Placement
    }
    return p
  })
  if (orphans) warnings.push(`${orphans} 张卡引用了不存在的行，归属已剥除`)
  return { rows, items: fixed, warnings }
}

export function toDoc(items: Placement[], cols: number = LOGICAL_COLS): LayoutDoc {
  return { schemaVersion: 1, cols, items }
}
