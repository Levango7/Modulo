import { LOGICAL_COLS } from './types'
import type { LayoutDoc, ModuleRegistry } from './types'
import { sanitizeItems } from './validate'

export interface ParseResult {
  doc: LayoutDoc
  warnings: string[]
}

export function docToJson(doc: LayoutDoc): string {
  return JSON.stringify(doc)
}

/** 解析布局 JSON；损坏数据回退空布局并给出 warning，绝不抛异常 */
export function parseLayout(raw: string, reg: ModuleRegistry): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { doc: { schemaVersion: 1, cols: LOGICAL_COLS, items: [] }, warnings: ['JSON 解析失败，已回退空布局'] }
  }
  const obj = (parsed ?? {}) as Partial<LayoutDoc>
  const cols = typeof obj.cols === 'number' && obj.cols > 0 ? Math.min(obj.cols, LOGICAL_COLS) : LOGICAL_COLS
  const { items, warnings } = sanitizeItems(obj.items, reg, cols)
  const version = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1
  if (version > 1) warnings.push(`schemaVersion ${version} 高于当前支持版本，按 v1 读取`)
  return { doc: { schemaVersion: 1, cols, items }, warnings }
}
