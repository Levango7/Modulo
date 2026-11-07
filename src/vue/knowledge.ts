/**
 * 「资料」的**纯函数层**（改天换地 PR-F1 知识库第一格）。
 *
 * 这里放的是「不开浏览器也能断言」的那些：入库清洗、上限与截断、摘录、引用候选。
 * 组件那半（文件选择框、栏里的清单、两步删除）留给 E2E。
 *
 * 三条纪律，与前两条线逐字同源：
 * 1. **盘上的 JSON 不可信**：可能是手改的、旧版的、写坏的 —— 逐条清洗，坏条目丢弃
 *    （一条坏的不能让另外三份资料一起消失，同 `aiSettings.parseAiDoc`）。
 * 2. **截断一定明说**：单份上限 20000 字，超了按字符裁并把 `truncated` 记在资料上，
 *    清单里要写出来（同 E3 附件那条：静默截断会让模型以为资料就到这儿）。
 * 3. **喂给模型的是摘录不是全文**：每份进上下文取前 1200 字，且整块仍受
 *    `contextBlock` 的 2000 字总预算约束 —— 两道闸门都在，别只留一道。
 */

import type { CardChoice } from './aiChat'

/**
 * 按**码点**取前 `max` 个（返回切片与实际码点数）。
 *
 * 为什么不复用 `aiChat.ts` 的 `cut`：那个按 UTF-16 单元切、只服务卡片摘录的展示；
 * 这里要报「这份资料共 N 字」，被切在 emoji 中间会让数字对不上。两处需求不同，
 * 各自一行、各自有测试 —— 也比让两个模块互相 import 成环强。
 */
function cutPoints(s: string, max: number): { text: string; truncated: boolean } {
  const points = Array.from(s)
  return points.length > max
    ? { text: points.slice(0, max).join(''), truncated: true }
    : { text: s, truncated: false }
}

/**
 * 存储文档名（与卡片数据、AI 配置、会话历史各占一格，互不覆盖）。
 * **必须登记进 `fileStorage.ts` 的 `DATA_KEYS`** —— 那张表是桌面 `get` 的唯一来源
 * （启动 hydrate 成内存镜像），漏登记的症状不是报错，而是"写得下去、重启读不到"。
 */
export const KNOWLEDGE_DOC_KEY = 'modulo.knowledge.v1'
/** 最多几份资料：再多就不是"带材料"，是拿资料库灌提示词 */
export const KNOWLEDGE_MAX_DOCS = 12
/** 单份资料的字符上限（超了截断并记账） */
export const KNOWLEDGE_CHARS_MAX = 20_000
/** 单份资料**进对话**时的摘录上限；整块总预算仍是 `contextBlock` 的 2000 字 */
export const KNOWLEDGE_EXCERPT_MAX = 1200
/**
 * 单个文件的体积上限：再大的文件读进内存只为留下前 20000 字，不值当。
 * 组件在 `File.text()` **之前**用它拦一道（读之前拦，才真的省下那次内存）。
 */
export const KNOWLEDGE_FILE_MAX_BYTES = 2_000_000

export interface KnowledgeDoc {
  id: string
  name: string
  text: string
  /** 实际存下的字符数（截断后） */
  chars: number
  /** 导入时写进去的时间戳（秒） */
  addedAt: number
  /** 原文件比上限长，只留了前面一段 */
  truncated: boolean
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/**
 * 盘上的文档 → 资料清单。**不可信输入**：逐条清洗，坏条目丢弃而不是整份报废。
 * 判据只有四条：id 是非空字符串且不重复、name 是非空字符串、text 是字符串、chars 是有限数。
 */
export function parseKnowledge(raw: string | null): KnowledgeDoc[] {
  if (!raw) return []
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (o as { docs?: unknown } | null)?.docs
  if (!Array.isArray(list)) return []
  const out: KnowledgeDoc[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const d = it as Partial<KnowledgeDoc> | null
    if (!d || typeof d !== 'object') continue
    if (!isStr(d.id) || !d.id || seen.has(d.id)) continue
    if (!isStr(d.name) || !d.name.trim()) continue
    if (!isStr(d.text)) continue
    seen.add(d.id)
    out.push({
      id: d.id,
      name: d.name.trim(),
      text: d.text,
      chars: typeof d.chars === 'number' && Number.isFinite(d.chars) ? d.chars : d.text.length,
      addedAt: typeof d.addedAt === 'number' && Number.isFinite(d.addedAt) ? d.addedAt : 0,
      truncated: d.truncated === true,
    })
    if (out.length >= KNOWLEDGE_MAX_DOCS) break
  }
  return out
}

export function serializeKnowledge(docs: readonly KnowledgeDoc[]): string {
  return JSON.stringify({ schemaVersion: 1, docs: docs.slice(0, KNOWLEDGE_MAX_DOCS) })
}

/** 新资料的 id：时间戳 + 序号，够短也够不撞（同一次导入里 idx 递增） */
export function newDocId(nowMs: number, idx: number, taken: readonly string[] = []): string {
  const base = `k${nowMs.toString(36)}${idx}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

export interface PickedDoc {
  name: string
  text: string
}

/**
 * 把选中的文件并进资料清单。守住三条：同名不重复、份数不超、单份截断明说。
 *
 * 拒收理由**逐条**回给用户（`rejected`）—— 一次选五个文件，用户要知道哪个没进、为什么
 * （与 E3 `addFiles` 同一条）。
 */
export function addDocs(
  docs: readonly KnowledgeDoc[],
  picked: readonly PickedDoc[],
  nowMs: number,
): { docs: KnowledgeDoc[]; rejected: string[] } {
  const out = docs.slice()
  const rejected: string[] = []
  for (const [i, p] of picked.entries()) {
    const name = p.name.trim()
    if (!name) {
      rejected.push('有一份没有文件名，先没入库')
      continue
    }
    if (out.some((d) => d.name === name)) {
      rejected.push(`「${name}」已经在资料里了`)
      continue
    }
    if (out.length >= KNOWLEDGE_MAX_DOCS) {
      rejected.push(`最多 ${KNOWLEDGE_MAX_DOCS} 份资料，「${name}」先没入库`)
      continue
    }
    // CRLF → LF：Windows 上选的 txt 全是 CRLF，不统一的话同一份资料两种系统下字数不同
    const body = p.text.replace(/\r\n/g, '\n')
    if (!body.trim()) {
      rejected.push(`「${name}」是空的，没有可入库的内容`)
      continue
    }
    if (body.includes('\u0000')) {
      rejected.push(`「${name}」不像文本文件（读到了二进制内容）`)
      continue
    }
    // 按码点算（与 docExcerpt / E3 附件同一个口径）：中文与 emoji 的字数才不会各算一套
    const { text, truncated } = cutPoints(body, KNOWLEDGE_CHARS_MAX)
    out.push({
      id: newDocId(nowMs, i, out.map((d) => d.id)),
      name,
      text,
      chars: Array.from(text).length,
      addedAt: Math.floor(nowMs / 1000),
      truncated,
    })
  }
  return { docs: out, rejected }
}

export function removeDoc(docs: readonly KnowledgeDoc[], id: string): KnowledgeDoc[] {
  return docs.filter((d) => d.id !== id)
}

/**
 * 一份资料**进对话**时的摘录：前 1200 字；被截了就在末尾说明还剩多少 ——
 * 模型据此知道"这不是全部"，用户也看得见自己引用进去的是哪一段。
 */
export function docExcerpt(doc: KnowledgeDoc, max: number = KNOWLEDGE_EXCERPT_MAX): string {
  const text = doc.text.trim()
  if (!text) return ''
  // 截没截，判据与"怎么截"必须同一个口径（都按码点）—— 否则 1200 个 emoji 会被
  // 判成超限（UTF-16 长度 2400），于是整段留下却挂一句"摘录到此"
  const { text: head, truncated } = cutPoints(text, max)
  if (!truncated) return text
  return `${head}\n…（摘录到此，这份资料共 ${doc.chars} 字）`
}

/**
 * 坞里用的摘录入口：资料走 `docExcerpt`，其余原样交给卡片摘录（由调用方注入）。
 *
 * 为什么单独一层而不是把 `knowledge` 塞进 `aiChat.excerptFor` 的 switch：那样
 * `aiChat.ts` 就要 import 这个模块（或反过来），两边成环；这层薄壳既保住了
 * 「判定在纯函数里」，也让卡片那条路一个字符都不用改。
 */
export function excerptWithDocs(
  docs: readonly KnowledgeDoc[],
  cardExcerpt: (c: CardChoice) => string,
): (c: CardChoice) => string {
  return (c) => {
    if (c.module !== 'knowledge') return cardExcerpt(c)
    const d = docs.find((x) => x.id === c.id)
    // 资料被删了但 chip 还挂着：不替它编内容，如实回空
    // （与「这张卡没有可引用的文字内容」同一条口径：界面负责说清，模型侧不编）
    return d ? docExcerpt(d) : ''
  }
}

/**
 * 资料 → `@` 候选。与卡片候选同一形状（`CardChoice`），所以坞里的候选列表、
 * chip、删除路径一行都不用改 —— 差别只在 `module='knowledge'` 与摘录来源。
 */
export function docChoices(docs: readonly KnowledgeDoc[]): CardChoice[] {
  return docs.map((d) => ({ id: d.id, module: 'knowledge', title: d.name, label: d.name }))
}
