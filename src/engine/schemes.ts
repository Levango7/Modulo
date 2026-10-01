import { LOGICAL_COLS, SCHEMA_VERSION, emptyDoc } from './types'
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
  // 空版面是合法状态（「新建空白版面」就靠它），所以只拒绝 doc 本身不可用的情况。
  // 早先这里是「items 为空就跳过」，会把用户刚建的空白方案在下次启动时悄悄吃掉。
  if (!raw.doc || typeof raw.doc !== 'object' || !Array.isArray(raw.doc.items)) {
    warnings.push(`方案「${raw.name ?? raw.id}」的 doc 不可用，已跳过`)
    return null
  }
  const items = sanitizeItems(raw.doc.items, reg).items
  // 本来有内容、清洗完一条不剩，说明进来的是不认识的模块 —— 这跟"用户故意建的空白版面"
  // 不是一回事，静默变成一个空方案比丢掉它更坏。
  if (raw.doc.items.length && !items.length) {
    warnings.push(`方案「${cleanName(raw.name)}」里的模块在当前库里都不存在，已跳过`)
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

/** 新建一个空白版面：给想要从零开始的用户，而不是逼他先清空当前版面再另存 */
export function createBlankScheme(book: SchemeBook, id: string, name: unknown, at: number): SchemeBook {
  return createScheme(book, id, cleanName(name, '空白版面'), emptyDoc(), at)
}

/**
 * 把 id 那条挪到 to 位置（目标下标，按"移除后"的数组算）。
 * 越界钳到两端；找不到或位置没变则原样返回同一个对象，好让上层能直接比较判空。
 */
export function moveScheme(book: SchemeBook, id: string, to: number): SchemeBook {
  const from = book.schemes.findIndex((s) => s.id === id)
  if (from < 0) return book
  const target = Math.max(0, Math.min(book.schemes.length - 1, Math.trunc(to) || 0))
  if (target === from) return book
  const schemes = [...book.schemes]
  const [moved] = schemes.splice(from, 1)
  schemes.splice(target, 0, moved)
  return { ...book, schemes }
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
