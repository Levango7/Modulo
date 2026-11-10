/**
 * 「技能」的**纯函数层**（改天换地 PR-F3，生态位第三格，2026-11-08）。
 *
 * 「技能」= 用户存下的一段**提示词模板**：本地存、聊天里 `@` 选中、全文展开进 system 块。
 * 不是可执行插件、不是 MCP 工具、也不是自动跑的任务（后者归 F2 定时，§12.67）。
 *
 * 与 F1「资料」同源的几条纪律，在两处有意分岔：
 * 1. **盘上的 JSON 不可信**：逐条清洗，坏条目丢弃（一条坏的不拖走另外几条）；
 *    盘上文本先 CRLF→LF 归一**再**判上限（与 `addSkills` 同口径，否则 CRLF 存的数据会被
 *    按 1.5 倍长算、静默整条丢掉）。
 * 2. **超长拒收、不截断**（§12.68 定死）：技能是要原样执行的**指令**，不是只读的参考
 *    素材。截断会把「请用 JSON 输出」这类尾部约束悄悄改掉，是最贵的沉默逻辑错误。
 *    所以整条拒收并回理由，绝不留下半份，也不设 `truncated` 字段。
 *    （F1 资料截断并明说、F2 定时提示词拒收 —— 技能与 F2 同取舍，理由相同。）
 * 3. **正文双闸门**：码点 ≤ `SKILL_TEXT_MAX` **且** UTF-16 单元 ≤ `SKILL_UNITS_MAX`。
 *    录入按码点（用户理解「1200 字」），引用块预算按 UTF-16（`contextUsage` 既有口径）；
 *    只编码点会让 1200 个 emoji 合法入库、却在引用层被 `.slice` 截断（QA B1 的真缺陷）。
 *    名字另设 40 码点上限 —— 它要进 `## ${label}`，挤的是正文的预算。
 * 4. **喂给模型的是全文不是摘录**：`skillExcerpt` 只 trim，不裁、不加「摘录到此」；
 *    整块仍由 `aiChat.contextBlock` 的 2000 字预算统一封顶（全通道一致，不是技能单独截断）。
 *
 * 成环防线（与 `knowledge.ts` **同向**）：`skillChoices()` / `excerptWithSkills()` 定义在
 * **这里**，不在 `aiChat.ts`；本文件对 `aiChat` 只 `import type`（运行时擦除），
 * 反向由 `aiChat.ts → skills.ts` 取一个常量（权限行显示上限）。方向反了就成环。
 */

import type { CardChoice } from './aiChat'

/**
 * 存储文档名（与资料、定时任务、卡片数据各占一格，互不覆盖）。
 * **必须登记进 `fileStorage.ts` 的 `DATA_KEYS`** —— 漏登记的症状不是报错，
 * 而是「写得下去、重启读不到」（E2E 用 `reload` 钉住）。
 */
export const SKILL_DOC_KEY = 'modulo.skills.v1'
/** 最多几条技能：再多就不是「随手存几句常用提示词」，是拿它当模板库灌 */
export const SKILL_MAX = 12
/**
 * 单条正文的码点上限。**超长拒收、不截断**。
 * 取 1200（与 F1 `KNOWLEDGE_EXCERPT_MAX` 对齐）：单条技能 + 引用块的 head 稳稳落在
 * `contextBlock` 的 2000 预算内，不会被总预算截掉尾巴 —— 那等于在引用层改了语义。
 */
export const SKILL_TEXT_MAX = 1200
/**
 * 单条正文的 **UTF-16 单元**上限（第二道闸门，与 `contextUsage` / `contextBlock` 的
 * `.length` 预算**同一口径**）。为什么要两道：录入按码点（用户理解「1200 字」），
 * 预算按 UTF-16；两者对中文 / 英文一致，对 emoji / 增补平面字符差 2 倍 —— 只编码点会让
 * 1200 个 emoji（码点 1200 / UTF-16 2400）**合法入库**、然后在引用层被 `.slice` 截断，
 * 与「入库后全文进块」的承诺自相矛盾（QA B1 的真缺陷）。两道都过才算合法：取更严者。
 */
export const SKILL_UNITS_MAX = 1200
/**
 * 名字的码点上限。名字会进引用块的 `## ${label}\n`，**不受 `SKILL_TEXT_MAX` 管** ——
 * 900 字的名字配 1200 字正文一样能把 2000 预算挤爆（QA B1 反例②）。40 字够写清用途。
 */
export const SKILL_NAME_MAX = 40

/** v1 只有纯文本模板：没有参数化变量、没有执行体、没有 truncated 标记 */
export interface Skill {
  id: string
  name: string
  /** 提示词正文（入库时已按码点拒收超长，存下的就是全文） */
  text: string
  /** 实际存下的码点数 */
  chars: number
  /** 存入时刻（秒） */
  addedAt: number
}

export interface PickedSkill {
  name: string
  text: string
}

const isStr = (v: unknown): v is string => typeof v === 'string'
/** 按码点数（中文 1、emoji 1，不是 UTF-16 单元）—— 与 F1 cutPoints / E3 附件同一口径 */
const pointCount = (s: string): number => Array.from(s).length
/** 非文本判据：NUL 字节（图片 / 压缩包 / 坏档都会命中，同 F1 addDocs、E3 attachFile） */
const isBinary = (s: string): boolean => s.includes('\u0000')
/**
 * 正文的**双闸门**：码点 ≤ `SKILL_TEXT_MAX` **且** UTF-16 单元 ≤ `SKILL_UNITS_MAX`。
 * 前者是用户能理解的「字」，后者与引用块预算算法同源；任一超限整条拒收（不截断、不留半份）。
 * 纯 BMP 文本两道等价；emoji 密集时 UTF-16 先撞线 —— 600 个才是 emoji 的真实上限。
 */
const withinLimits = (s: string): boolean =>
  pointCount(s) <= SKILL_TEXT_MAX && s.length <= SKILL_UNITS_MAX

/**
 * 盘上的技能 → 清单。**不可信输入**：逐条清洗，坏条目丢弃而不是整份报废。
 * 判据与 `addSkills` **同源**：id 非空不重复、名字非空且 ≤`SKILL_NAME_MAX`、text 是字符串且
 * 不含 NUL、`\r\n` 先归一为 `\n` 再过**双闸门**（码点 + UTF-16）且非空；`chars` 一律按归一后
 * 的正文重算（不沿用盘上可能按旧口径记的值），`addedAt` 不是有限数时回落到 0。
 */
export function parseSkills(raw: string | null): Skill[] {
  if (!raw) return []
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (o as { skills?: unknown } | null)?.skills
  if (!Array.isArray(list)) return []
  const out: Skill[] = []
  const seen = new Set<string>()
  for (const it of list) {
    const s = it as Partial<Skill> | null
    if (!s || typeof s !== 'object') continue
    if (!isStr(s.id) || !s.id || seen.has(s.id)) continue
    if (!isStr(s.name) || !s.name.trim()) continue
    const name = s.name.trim()
    if (pointCount(name) > SKILL_NAME_MAX) continue
    if (!isStr(s.text) || isBinary(s.text)) continue
    // 盘上的文本先规整换行**再**判上限 —— 与 addSkills 同一口径。不归一会把 CRLF 存下的
    // 数据按 1.5 倍长算，静默整条丢掉（QA A1：写得下去、读不回来）
    const text = s.text.replace(/\r\n/g, '\n')
    if (!text.trim() || !withinLimits(text)) continue
    seen.add(s.id)
    out.push({
      id: s.id,
      name,
      text,
      // chars 一律按**归一后**的正文重算，不沿用盘上可能按旧口径记的值
      chars: pointCount(text),
      addedAt: typeof s.addedAt === 'number' && Number.isFinite(s.addedAt) ? s.addedAt : 0,
    })
    if (out.length >= SKILL_MAX) break
  }
  return out
}

export function serializeSkills(skills: readonly Skill[]): string {
  return JSON.stringify({ schemaVersion: 1, skills: skills.slice(0, SKILL_MAX) })
}

/** 新技能的 id：时间戳 + 序号（前缀 s 与资料的 k 区分），够短也够不撞 */
export function newSkillId(nowMs: number, idx: number, taken: readonly string[] = []): string {
  const base = `s${nowMs.toString(36)}${idx}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

/**
 * 把选中的技能并进清单。守住：同名不重复、份数不超、名字 ≤`SKILL_NAME_MAX`、
 * 正文过**双闸门**（码点 + UTF-16，**超长整条拒收、不截断**）、只收文本。
 * 拒收理由**逐条**回给调用方（`rejected`）—— 一次存几条，用户要知道哪条没进、为什么
 * （与 F1 `addDocs` 同一条）。
 */
export function addSkills(
  skills: readonly Skill[],
  picked: readonly PickedSkill[],
  nowMs: number,
): { skills: Skill[]; rejected: string[] } {
  const out = skills.slice()
  const rejected: string[] = []
  for (const [i, p] of picked.entries()) {
    const name = p.name.trim()
    if (!name) {
      rejected.push('有一条没有名字，先没存')
      continue
    }
    if (pointCount(name) > SKILL_NAME_MAX) {
      // 名字太长同样整条拒收：它要进引用块的 `## ${label}`，挤占的是正文的预算
      rejected.push(`「${name.slice(0, 10)}…」名字太长（上限 ${SKILL_NAME_MAX} 字），请改短再存`)
      continue
    }
    if (out.some((s) => s.name === name)) {
      rejected.push(`「${name}」已经有这条技能了`)
      continue
    }
    if (out.length >= SKILL_MAX) {
      rejected.push(`最多 ${SKILL_MAX} 条技能，「${name}」先没存`)
      continue
    }
    // CRLF → LF：Windows 上贴进来的文本常带 CRLF，不统一的话两种系统下字数不同
    const body = p.text.replace(/\r\n/g, '\n')
    if (!body.trim()) {
      rejected.push(`「${name}」是空的，没有可存的内容`)
      continue
    }
    if (isBinary(body)) {
      rejected.push(`「${name}」不像文本（读到了二进制内容）`)
      continue
    }
    const chars = pointCount(body)
    if (!withinLimits(body)) {
      // 两道闸门共用一句「太长」：用户不必区分码点与 UTF-16，只需要知道存不进去
      rejected.push(`「${name}」太长（上限 ${SKILL_TEXT_MAX} 字），请改短再存`)
      continue
    }
    out.push({
      id: newSkillId(nowMs, i, out.map((s) => s.id)),
      name,
      text: body,
      chars,
      addedAt: Math.floor(nowMs / 1000),
    })
  }
  return { skills: out, rejected }
}

export function removeSkill(skills: readonly Skill[], id: string): Skill[] {
  return skills.filter((s) => s.id !== id)
}

/**
 * 一条技能**进对话**时的正文：全文（trim 后），不摘录、不截断、不加后缀。
 * 技能是给模型的指令，不是只读素材；整块的 2000 字预算由 `contextBlock` 统一管。
 * 空正文回空串（界面负责说「没有可引用的内容」，模型侧不编）。
 */
export function skillExcerpt(s: Skill): string {
  return s.text.trim()
}

/**
 * 坞里用的摘录入口：技能走 `skillExcerpt`，其余（资料 / 卡片）原样交回注入的函数。
 * 与 F1 `excerptWithDocs` 逐字同构，定义**在这里**而非 `aiChat.ts` —— 那样会让
 * `aiChat` 反向 import 本模块成环。两层薄壳可叠加（技能 → 资料 → 卡片）仍是单一入口，
 * 卡片 / 资料 / 技能共用同一条 `@` 通道、同一个 `contextBlock`，不出现第二个上下文块。
 */
export function excerptWithSkills(
  skills: readonly Skill[],
  otherExcerpt: (c: CardChoice) => string,
): (c: CardChoice) => string {
  return (c) => {
    if (c.module !== 'skills') return otherExcerpt(c)
    const s = skills.find((x) => x.id === c.id)
    // 技能被删了但 chip 还挂着：不替它编内容，如实回空（同 F1「资料被删」口径）
    return s ? skillExcerpt(s) : ''
  }
}

/** 技能 → `@` 候选。与卡片 / 资料候选同一形状，坞里的列表、chip、移除一行都不用改 */
export function skillChoices(skills: readonly Skill[]): CardChoice[] {
  return skills.map((s) => ({ id: s.id, module: 'skills', title: s.name, label: s.name }))
}
