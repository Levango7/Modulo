/**
 * 「AI 动手」的**纯函数层**（改天换地第十二笔，设计稿 `docs/design/F-13-AI-ACTIONS.md`）。
 *
 * 这一层解决的是 README 第一支柱缺的那一半：AI 现在只会说，不会动。模型在回复里写
 * 动作行（`@@act {json}`）只是**提议**；解析、校验、"哪些能做 / 哪些看不懂"全在这里，
 * 真正的写在用户点「照做」之后（胶水层，走既有 store / cardData 写入口 ⇒ 全部进撤销栈）。
 *
 * 三条纪律（与 `aiChat.ts` 同一族）：
 * 1. **AI 永不直接写**：这一层连一个副作用都没有 —— 同一份文本进，同一份结论出。
 * 2. **看不懂的不静默丢**：坏 JSON / 未知动作 / 校验不过的行收进 `bad`，界面必须用人话
 *    说出来（"它想做一件我还不会的事"与"它什么都没想做"是两回事）。
 * 3. **白名单是封闭的**：v1 只有三个动作（`addCard` / `todo.add` / `ledger.add`），
 *    加动作 = 加一个 case + 一条测试；**没有删除类** —— 破坏性动作不进 v1。
 *
 * 为什么走文字约定而不是 tool-calling：各家网关对未知顶层字段的容忍度不同（E3 的教训：
 * 有的直接 400），本仓要同时伺候官方 / DeepSeek / 千问 / vLLM / Ollama。文字约定零协议
 * 面、零 Rust 改动，代价是模型可能写坏 —— 所以解析必须宽容、失败必须可见。
 */

import { MEMORY_TEXT_MAX } from './aiMemory'

/** 动作行的前缀（行首；前后允许空白与代码围栏的 `` ` ``） */
export const ACTION_PREFIX = '@@act'
/** 一次回复最多认几个动作（超出的不执行、列出来说明） */
export const ACTION_MAX_PER_REPLY = 5
/** 待办正文上限 */
export const ACTION_TEXT_MAX = 200
/** 记账分类上限 */
export const ACTION_CATEGORY_MAX = 20
/** 记账备注上限 */
export const ACTION_NOTE_MAX = 200
/** 金额上限（单位：分）—— 一千万元，够用且防手滑 */
export const ACTION_CENTS_MAX = 1_000_000_000
/** 倒数日名字上限（v1.1） */
export const ACTION_LABEL_MAX = 20
/** 读类动作带回的内容上限（字）—— 回喂文本里每条读只占这么多 */
export const ACTION_READ_MAX = 200

export type AiAction =
  | { type: 'addCard'; moduleId: string; variant?: string }
  | { type: 'todo.add'; text: string }
  | { type: 'ledger.add'; cents: number; category: string; note?: string; date: string }
  | { type: 'sticky.append'; text: string }
  | { type: 'countdown.set'; label: string; date: string }
  | { type: 'habit.check' }
  | { type: 'memory.add'; text: string }
  // 读类（第十六笔）：**不改任何东西** —— 看一眼版面清单，或某张卡里的内容
  | { type: 'context.read'; moduleId?: string }

export interface ActionContext {
  /** 已装的模块 id（`addCard` 的校验白名单 —— 注册表里没有的卡不许摆） */
  moduleIds: readonly string[]
  /** 缺省记账日期（今天，`YYYY-MM-DD`；`localDay` 的口径） */
  today: string
  /** 覆盖上限（测试用；默认 `ACTION_MAX_PER_REPLY`） */
  max?: number
}

export interface ParsedActions {
  /** 剥掉动作行之后的展示文本（连续空行折叠、尾部空白清掉） */
  clean: string
  /** 校验通过、可以执行的提议（按出现顺序） */
  actions: AiAction[]
  /** 看不懂 / 不合法 / 超量的行 —— 界面用人话说出来，不许静默丢 */
  bad: string[]
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}…`)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 行首判定：允许空白与代码围栏的反引号（模型爱把 JSON 包进 ``` 里） */
function actBody(line: string): string | null {
  const t = line.trim().replace(/^[`\s]+/, '')
  if (!t.startsWith(ACTION_PREFIX)) return null
  return t.slice(ACTION_PREFIX.length).trim().replace(/[`\s]+$/, '')
}

/** 单行 → 动作或一条"为什么不行"。**不抛** —— 坏行是常态，不是异常 */
function parseLine(raw: string, ctx: ActionContext): AiAction | { bad: string } {
  const body = actBody(raw) ?? ''
  let o: unknown = null
  try {
    o = JSON.parse(body)
  } catch {
    return { bad: `有一行动作没看懂（JSON 不合法）：${clip(raw.trim(), 60)}` }
  }
  if (!isRec(o)) return { bad: `有一行动作没看懂（不是对象）：${clip(raw.trim(), 60)}` }
  const type = str(o.type)
  if (type === 'addCard') {
    const moduleId = str(o.moduleId).trim()
    if (!moduleId) return { bad: '它想摆一张卡，但没写 moduleId' }
    if (!ctx.moduleIds.includes(moduleId)) {
      return { bad: `它想摆一张「${clip(moduleId, 24)}」卡，但注册表里没有这张卡` }
    }
    const variant = str(o.variant).trim()
    return { type: 'addCard', moduleId, ...(variant ? { variant } : {}) }
  }
  if (type === 'todo.add') {
    const text = str(o.text).trim()
    if (!text) return { bad: '它想加一条待办，但没写内容' }
    if (text.length > ACTION_TEXT_MAX) return { bad: `待办太长（超过 ${ACTION_TEXT_MAX} 字）—— 这一条没有执行` }
    return { type: 'todo.add', text }
  }
  if (type === 'ledger.add') {
    const cents = o.cents
    if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0 || cents > ACTION_CENTS_MAX) {
      return { bad: '它想记一笔账，但金额不是正的整数分（12.34 元要写成 1234）—— 这一条没有执行' }
    }
    const category = str(o.category).trim()
    if (!category) return { bad: '它想记一笔账，但没写分类' }
    if (category.length > ACTION_CATEGORY_MAX) {
      return { bad: `记账分类太长（超过 ${ACTION_CATEGORY_MAX} 字）—— 这一条没有执行` }
    }
    const note = str(o.note).trim()
    if (note.length > ACTION_NOTE_MAX) {
      return { bad: `记账备注太长（超过 ${ACTION_NOTE_MAX} 字）—— 这一条没有执行` }
    }
    let date = ctx.today
    const asked = str(o.date).trim()
    if (asked) {
      if (!DATE_RE.test(asked)) {
        return { bad: `它想按「${clip(asked, 20)}」这个日期记账，但日期写法看不懂（要 YYYY-MM-DD）—— 这一条没有执行` }
      }
      date = asked
    }
    return { type: 'ledger.add', cents, category, ...(note ? { note } : {}), date }
  }
  if (type === 'sticky.append') {
    const text = str(o.text).trim()
    if (!text) return { bad: '它想往便签里加内容，但没写要加什么' }
    if (text.length > ACTION_TEXT_MAX) return { bad: `便签那一段太长（超过 ${ACTION_TEXT_MAX} 字）—— 这一条没有执行` }
    return { type: 'sticky.append', text }
  }
  if (type === 'countdown.set') {
    const label = str(o.label).trim()
    if (!label) return { bad: '它想设倒数日，但没写名字（label）' }
    if (label.length > ACTION_LABEL_MAX) {
      return { bad: `倒数日名字太长（超过 ${ACTION_LABEL_MAX} 字）—— 这一条没有执行` }
    }
    const date = str(o.date).trim()
    if (!DATE_RE.test(date)) {
      return { bad: '它想设倒数日，但日期写法看不懂（要 YYYY-MM-DD）—— 这一条没有执行' }
    }
    return { type: 'countdown.set', label, date }
  }
  if (type === 'habit.check') {
    return { type: 'habit.check' }
  }
  if (type === 'memory.add') {
    const text = str(o.text).trim()
    if (!text) return { bad: '它想记住一件事，但没写要记什么' }
    if (text.length > MEMORY_TEXT_MAX) {
      return { bad: `要记的事太长（超过 ${MEMORY_TEXT_MAX} 字）—— 这一条没有执行` }
    }
    return { type: 'memory.add', text }
  }
  if (type === 'context.read') {
    const moduleId = str(o.moduleId).trim()
    if (moduleId && !ctx.moduleIds.includes(moduleId)) {
      return { bad: `它想看一张「${clip(moduleId, 24)}」卡的内容，但注册表里没有这张卡` }
    }
    return moduleId ? { type: 'context.read', moduleId } : { type: 'context.read' }
  }
  return { bad: `它想做「${clip(type || '（没写 type）', 24)}」这件事 —— 这一版还不会` }
}

/** 折叠多余空行（剥掉动作行之后容易留下两条连着） */
const tidy = (s: string): string => s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trimEnd()

/** 把一段文本里所有动作行剥掉（历史回填的展示口径 —— 解析都不做，只去行） */
export function stripActionLines(text: string): string {
  return tidy(text.split('\n').filter((l) => actBody(l) === null).join('\n'))
}

/**
 * 从一段回复文本里解析动作。返回剥干净之后的展示文本 + 可执行提议 + 坏行说明。
 * 没有动作行时 `clean` 与原文一致（只做尾空白整理）。
 */
export function parseActions(text: string, ctx: ActionContext): ParsedActions {
  const max = ctx.max ?? ACTION_MAX_PER_REPLY
  const keep: string[] = []
  const actions: AiAction[] = []
  const bad: string[] = []
  let overflow = 0
  for (const line of text.split('\n')) {
    if (actBody(line) === null) {
      keep.push(line)
      continue
    }
    const r = parseLine(line, ctx)
    if ('bad' in r) {
      bad.push(r.bad)
      continue
    }
    if (actions.length >= max) {
      overflow++
      continue
    }
    actions.push(r)
  }
  if (overflow) bad.push(`动作超过 ${max} 个，多出来的 ${overflow} 个没有执行`)
  return { clean: tidy(keep.join('\n')), actions, bad }
}

/** 一条提议的人话（界面列表用）。`titleOf` 给卡的中文名，给不了就落回 id */
export function actionLabel(a: AiAction, titleOf?: (id: string) => string | undefined): string {
  switch (a.type) {
    case 'addCard':
      return `摆一张「${titleOf?.(a.moduleId) || a.moduleId}」卡`
    case 'todo.add':
      return `加一条待办：${a.text}`
    case 'ledger.add':
      return `记一笔：¥${(a.cents / 100).toFixed(2)} · ${a.category}${a.note ? ` · ${a.note}` : ''}`
    case 'sticky.append':
      return `往便签里加一段：${a.text}`
    case 'countdown.set':
      return `把倒数日设成「${a.label} · ${a.date}」`
    case 'habit.check':
      return '给习惯卡打上今天的卡'
    case 'memory.add':
      return `记住：${a.text}`
    case 'context.read':
      return a.moduleId ? `看一眼「${titleOf?.(a.moduleId) || a.moduleId}」卡` : '看一眼版面清单'
  }
}

export interface RunResult {
  ok: boolean
  /** 成功执行了几个（失败时它也是"前几个已经生效"的数） */
  done: number
  /** 第一个失败的原因（人话，直接展示） */
  error?: string
  /** 每个成功动作的产出（人话；**读类动作靠它把看到的内容带进回喂文本**） */
  values?: (string | undefined)[]
}

/**
 * 「工具结果」回喂（v1.2 的 agent 循环）：动作执行完之后，把结果作为一条**合成 user 消息**
 * 发回给模型，让它接着干（继续提议或收尾）—— 主流 agent 应用里这叫 tool result，
 * 本仓协议只有 user / assistant / system 三种角色，所以用这条带标记的 user 消息承载。
 *
 * 两个后果都要照顾到：① 界面按标记把它渲染成"工具结果"小条，而不是用户气泡
 * （用户没说过这句话）；② 它会被 Rust 单点落盘进历史（role=user 照存）——
 * 回填时同一条标记规则让它的样子保持一致。
 */
export const ACTION_RESULT_MARK = '（工具结果）'

/** 逐条执行结果的人话行（成功 / 失败 / 因前一步失败而没执行） */
export function actionResultLines(
  actions: readonly AiAction[],
  run: RunResult,
  label: (a: AiAction) => string,
): string[] {
  return actions.map((a, i) => {
    if (i < run.done) {
      // 读类动作把看到的内容带回去；写类动作没有产出，就写「成功」
      const v = run.values?.[i]
      return v ? `${label(a)}：${v}` : `${label(a)}：成功`
    }
    if (i === run.done && !run.ok) return `${label(a)}：失败（${run.error ?? '原因未知'}）`
    return `${label(a)}：没有执行（前一步失败了）`
  })
}

/** 执行结果 → 回喂文本（纯函数，逐字可测） */
export function actionResultText(lines: readonly string[]): string {
  return [
    `${ACTION_RESULT_MARK}刚才你提议的动作已经按用户的点头执行了：`,
    ...lines.map((l) => `- ${l}`),
    '如果还有需要做的，继续按格式提议（不要重复已经做过的）；都完成了就用一两句话收尾。',
  ].join('\n')
}

/** 这条 user 消息是不是工具结果（界面渲染与回填都用它） */
export function isActionResult(content: string): boolean {
  return content.trimStart().startsWith(ACTION_RESULT_MARK)
}

/**
 * 顺次执行提议。**首败即停**（与工作流同一条纪律）：后面几条的前提可能依赖前面，
 * 前一条没落成还往下走，只会留下一串半成品。已执行的不回滚 —— 撤销是用户的事
 * （所有动作都经过既有写入口，Ctrl+Z 撤得掉）。
 */
export function runActions(
  actions: readonly AiAction[],
  apply: (a: AiAction) => string | void | undefined,
): RunResult {
  const values: (string | undefined)[] = []
  for (let i = 0; i < actions.length; i++) {
    try {
      values.push(apply(actions[i]) ?? undefined)
    } catch (err) {
      return { ok: false, done: i, error: String(err), values }
    }
  }
  return { ok: true, done: actions.length, values }
}

/** 常用卡 id：写进指令的"词汇表"。校验仍按注册表全表来 —— 这个清单只是提示 */
const CURATED_IDS = [
  'todo',
  'sticky',
  'notes',
  'ledger',
  'countdown',
  'elapsed',
  'habit',
  'matrix',
  'clock',
  'calendar',
  'chart',
  'meeting',
] as const

/**
 * 拼进 system 块的那段能力说明（纯函数 —— 逐字可测，也方便将来按注册表动态化）。
 * 三句：格式、边界（提议不是执行）、词汇表。
 */
export function actionPrompt(): string {
  return [
    `你可以在需要时动手改版面：在正文之后另起一行，一行一个动作。格式是 \`${ACTION_PREFIX} {"type":"…",…}\`，可用的三种：`,
    `- \`${ACTION_PREFIX} {"type":"addCard","moduleId":"todo","variant":"可选"}\` —— 把一张卡摆上版面；`,
    `- \`${ACTION_PREFIX} {"type":"todo.add","text":"…"}\` —— 往待办里加一条；`,
    `- \`${ACTION_PREFIX} {"type":"ledger.add","cents":1234,"category":"餐饮","note":"可选"}\` —— 记一笔账（金额用整数分：12.34 元 = 1234）；`,
    `- \`${ACTION_PREFIX} {"type":"sticky.append","text":"…"}\` —— 往便签里追加一段（不覆盖原有内容）；`,
    // 示例值要和 E2E 夹具的词条错开：这段字**整体进 system 块**，而 chat-dock 的
    // 「@第二张卡」用例钉着系统块里不许出现第一张卡的内容（'发版' / '团建餐' / '跑步'）。
    // 实测逃逸样本：v1.1 初版这里写了 "label":"发版" ⇒ 那条断言当场红（整跑 11 分钟才看见）。
    `- \`${ACTION_PREFIX} {"type":"countdown.set","label":"纪念日","date":"2026-12-01"}\` —— 设一张倒数日（名字 + 日期）；`,
    `- \`${ACTION_PREFIX} {"type":"habit.check"}\` —— 给习惯卡打上今天的卡；`,
    `- \`${ACTION_PREFIX} {"type":"memory.add","text":"…"}\` —— 记住一件关于用户的事（跨对话有效，用户可在设置里删）；`,
    `- \`${ACTION_PREFIX} {"type":"context.read"}\` —— 看一眼版面清单（有哪些卡）；\`${ACTION_PREFIX} {"type":"context.read","moduleId":"todo"}\` —— 看一眼某张卡里的内容（**只读**，不会改任何东西；看到的内容会随执行结果回给你）。`,
    `一次最多 ${ACTION_MAX_PER_REPLY} 个。动作只是提议 —— 用户点「照做」才会生效，所以正文里照常把你要做的事说清楚；不需要动手就不要写动作行。`,
    `动作执行之后，系统会把结果以一条「${ACTION_RESULT_MARK}」开头的消息发回来 —— 收到它就接着干：还有要做的继续按格式提议（别重复已经做过的），都完成了就用一两句话收尾。`,
    `常用卡 id：${CURATED_IDS.join(' / ')}（其它卡也能摆，摆不上会说明）。`,
  ].join('\n')
}
