import { LOGICAL_COLS, SCHEMA_VERSION } from './types'
import { sanitizeItems } from './validate'
import type { LayoutDoc, ModuleRegistry } from './types'

export interface Scheme {
  id: string
  name: string
  doc: LayoutDoc
  updatedAt: number
}

export interface SchemeBook {
  schemaVersion: 1
  activeId: string | null
  schemes: Scheme[]
}

export const NAME_MAX = 32
export const MAX_SCHEMES = 24

export function emptyBook(): SchemeBook {
  return { schemaVersion: 1, activeId: null, schemes: [] }
}

export function cleanName(name: unknown, fallback = '未命名版面'): string {
  const n = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : ''
  return n || fallback
}

function toScheme(raw: Partial<Scheme>, reg: ModuleRegistry, warnings: string[]): Scheme | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) {
    warnings.push('跳过缺少 id 的方案')
    return null
  }
  const items = sanitizeItems((raw.doc as LayoutDoc | undefined)?.items ?? [], reg).items
  if (!items.length) {
    warnings.push(`方案「${raw.name ?? raw.id}」没有有效模块，已跳过`)
    return null
  }
  return {
    id: raw.id,
    name: cleanName(raw.name),
    doc: { schemaVersion: SCHEMA_VERSION, cols: LOGICAL_COLS, items },
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/** 导入外部 JSON：逐条校验、非法条目丢弃并留 warning；整体损坏则回退空册，绝不抛异常 */
export function parseBook(raw: string, reg: ModuleRegistry): { book: SchemeBook; warnings: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { book: emptyBook(), warnings: ['JSON 解析失败'] }
  }
  const o = (parsed ?? {}) as Partial<SchemeBook>
  if (!Array.isArray(o.schemes)) return { book: emptyBook(), warnings: ['schemes 不是数组'] }
  const warnings: string[] = []
  const schemes: Scheme[] = []
  for (const entry of o.schemes) {
    const s = toScheme(entry as Partial<Scheme>, reg, warnings)
    if (s && !schemes.some((q) => q.id === s.id)) schemes.push(s)
  }
  const activeId = typeof o.activeId === 'string' && schemes.some((s) => s.id === o.activeId) ? o.activeId : null
  return { book: { schemaVersion: 1, activeId, schemes }, warnings }
}

export function bookToJson(book: SchemeBook): string {
  return JSON.stringify(book, null, 2)
}

export function createScheme(book: SchemeBook, id: string, name: unknown, doc: LayoutDoc, at: number): SchemeBook {
  const scheme: Scheme = { id, name: uniqueName(book, cleanName(name)), doc, updatedAt: at }
  const schemes = [scheme, ...book.schemes].slice(0, MAX_SCHEMES)
  return { ...book, activeId: id, schemes }
}

export function renameScheme(book: SchemeBook, id: string, name: unknown): SchemeBook {
  return { ...book, schemes: book.schemes.map((s) => (s.id === id ? { ...s, name: cleanName(name, s.name) } : s)) }
}

export function updateScheme(book: SchemeBook, id: string, doc: LayoutDoc, at: number): SchemeBook {
  return { ...book, schemes: book.schemes.map((s) => (s.id === id ? { ...s, doc, updatedAt: at } : s)) }
}

export function removeScheme(book: SchemeBook, id: string): SchemeBook {
  const schemes = book.schemes.filter((s) => s.id !== id)
  return { ...book, schemes, activeId: book.activeId === id ? (schemes[0]?.id ?? null) : book.activeId }
}

function uniqueName(book: SchemeBook, base: string): string {
  if (!book.schemes.some((s) => s.name === base)) return base
  let i = 2
  while (book.schemes.some((s) => s.name === `${base} ${i}`)) i++
  return `${base} ${i}`
}

/** 合并导入：id 或名称冲突时给进来的那份改名/换 id 后缀，不覆盖用户已有的方案 */
export function mergeBooks(target: SchemeBook, incoming: SchemeBook): SchemeBook {
  let out = target
  const takenIds = new Set(target.schemes.map((s) => s.id))
  for (const s of [...incoming.schemes].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (out.schemes.length >= MAX_SCHEMES) break
    let id = s.id
    while (takenIds.has(id)) id = `${id}#`
    takenIds.add(id)
    out = createScheme(out, id, s.name, s.doc, s.updatedAt)
  }
  return { ...out, activeId: target.activeId }
}
