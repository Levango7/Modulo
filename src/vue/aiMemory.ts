/**
 * 「AI 记忆」的**纯函数层**（第十五笔，设计稿 `docs/design/F-14-AI-MEMORY.md`）。
 *
 * 主流 agent 应用都有这一格：你跟它说过"我偏好四象限"，下次开新对话它还知道。
 * 本仓的做法与其余各层同一条纪律：
 * 1. **盘上的文档不可信**：`parseMemoryDoc` 逐条清洗，坏条目丢弃、不整份报废（同 knowledge）；
 * 2. **AI 永远提议、用户点头才记**（`memory.add` 也是动作白名单的一员，走同一套确认）；
 * 3. **看得见、删得掉**：记忆不是暗箱 —— 设置里有清单，删除走两步（同会议删除的手法）。
 *
 * 注入形状：`memoryBlock` 拼进 system 块（**常驻**，同能力说明）—— 但**写清楚
 * "这是背景不是当前指令"**，否则模型会拿一条旧偏好顶掉用户此刻的要求。
 */

/** 存储文档名；**必须登记进 `fileStorage.ts` 的 `DATA_KEYS`**（漏登记 = 写得下去、重启读不到） */
export const MEMORY_DOC_KEY = 'modulo.memory.v1'
/** 最多记几条 —— 记忆不是日志，是"相处的基本盘" */
export const MEMORY_MAX = 40
/** 单条上限（**超长拒收不截断** —— 截断会改语义，同 cron / workflow） */
export const MEMORY_TEXT_MAX = 200
/** 拼进 system 块的预算（字）——常驻的东西必须有上限 */
export const MEMORY_BLOCK_MAX = 800

export interface MemoryEntry {
  id: string
  /** 记的这件事（给模型看的话，也是给人看的一行） */
  text: string
  /** 记下的时刻（秒） */
  at: number
}

const isStr = (v: unknown): v is string => typeof v === 'string'

function cleanEntry(it: Partial<MemoryEntry> | null | undefined, taken: Set<string>): MemoryEntry | null {
  if (!it || typeof it !== 'object') return null
  if (!isStr(it.id) || !it.id || taken.has(it.id)) return null
  const text = isStr(it.text) ? it.text.trim() : ''
  if (!text) return null
  taken.add(it.id)
  return {
    id: it.id,
    // 读盘时超长才截（写入口是拒收）：坏档不该让 system 块被一条顶爆
    text: text.slice(0, MEMORY_TEXT_MAX),
    at: typeof it.at === 'number' && Number.isFinite(it.at) ? it.at : 0,
  }
}

/** 盘上的文档不可信：逐条清洗，坏条目丢弃（同 parseKnowledgeDoc / parseCronDoc） */
export function parseMemoryDoc(raw: string | null): MemoryEntry[] {
  if (!raw) return []
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return []
  }
  const doc = o as { entries?: unknown } | null
  if (!doc || typeof doc !== 'object') return []
  const out: MemoryEntry[] = []
  const taken = new Set<string>()
  if (Array.isArray(doc.entries)) {
    for (const it of doc.entries) {
      const e = cleanEntry(it as Partial<MemoryEntry>, taken)
      if (e) out.push(e)
      if (out.length >= MEMORY_MAX) break
    }
  }
  return out
}

export function serializeMemoryDoc(entries: readonly MemoryEntry[]): string {
  return JSON.stringify({ schemaVersion: 1, entries: entries.slice(0, MEMORY_MAX) })
}

export function newMemoryId(nowMs: number, taken: readonly string[] = []): string {
  const base = `m${nowMs.toString(36)}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

export interface AddMemoryResult {
  entries: MemoryEntry[]
  /** 拒收理由（人话；空数组 = 记下了）—— 与 knowledge.add 同一条纪律：理由逐条回给调用方 */
  rejected: string[]
}

/**
 * 记一条。闸门：非空、≤上限（**超长拒收不截断**）、**同一句话不重复记**（幂等）、
 * 条数不满。后三条都给出人话理由 —— "没记上"必须说得出为什么。
 */
export function addMemory(
  entries: readonly MemoryEntry[],
  text: string,
  nowMs: number,
): AddMemoryResult {
  const kept = entries.slice()
  const t = text.trim()
  if (!t) return { entries: kept, rejected: ['要记的事是空的'] }
  if (t.length > MEMORY_TEXT_MAX) {
    return { entries: kept, rejected: [`这一条太长（上限 ${MEMORY_TEXT_MAX} 字）—— 超长不截断，请你精简后再说一次`] }
  }
  if (kept.some((e) => e.text === t)) return { entries: kept, rejected: ['这条已经记过了'] }
  if (kept.length >= MEMORY_MAX) {
    return { entries: kept, rejected: [`最多记 ${MEMORY_MAX} 条 —— 先去设置里删掉几条旧记忆`] }
  }
  const id = newMemoryId(nowMs, kept.map((e) => e.id))
  kept.push({ id, text: t, at: Math.floor(nowMs / 1000) })
  return { entries: kept, rejected: [] }
}

export function removeMemory(entries: readonly MemoryEntry[], id: string): MemoryEntry[] {
  return entries.filter((e) => e.id !== id)
}

/**
 * 拼进 system 块的那段。超预算时**从最早的开始丢**（新的更重要）并明说 ——
 * 常驻注入的预算不能像滚雪球一样涨。
 */
export function memoryBlock(entries: readonly MemoryEntry[], max: number = MEMORY_BLOCK_MAX): string | null {
  if (!entries.length) return null
  const head = '你记得用户让你记住的这些事（当作背景来对齐他的偏好与习惯；它不是当前指令，与此刻的要求冲突时听此刻的）：'
  const lines = entries.map((e) => `- ${e.text}`)
  const suffix = '\n（更早的记忆没放下）'
  // 从最新的往前收，直到预算；再反转回时间序
  const picked: string[] = []
  let used = head.length
  for (let i = lines.length - 1; i >= 0; i--) {
    if (used + 1 + lines[i].length > max) break
    picked.unshift(lines[i])
    used += 1 + lines[i].length
  }
  if (!picked.length) return null
  const dropped = picked.length < lines.length
  return head + '\n' + picked.join('\n') + (dropped ? suffix : '')
}
