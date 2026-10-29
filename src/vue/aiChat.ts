/**
 * AI 对话坞的**判定层**（F-12 二期，设计稿 `docs/design/F-12-AI-WIRING.md` §11）。
 *
 * 与一期 `aiSettings.ts` 同一条分工：这里全是"不开浏览器也能断言"的东西 ——
 * 流式增量的归并、`@卡片` 的触发词解析、引用块拼装、历史条目的人话时间、
 * 坞该不该出现的条件、Esc/Ctrl+J 的意图。组件那半（Channel、invoke、焦点）留给 E2E。
 *
 * 三条纪律：
 * 1. **流式状态只有一个写入口**（`applyChunk`）：Rust 侧 `AiChunk` 是
 *    `{delta, done, error}`，三种情况的优先级（error > delta > done）必须一处定死 ——
 *    分散在组件里就会出现"错误被下一秒的 delta 盖掉"这类只在慢网络下复现的毛病。
 * 2. **引用卡片只带真内容**：`excerptFor` 只读 `cardData` 里确实存在的字段，
 *    没写过的就是空 —— 不替用户编一句"这张卡里有……"。上限也在这里定（每张 400 字 /
 *    整块 2000 字），否则一张长便签就能把上下文撑爆。
 * 3. **历史是盘上的不可信输入**：`turnsFromHistory` 只认 user/assistant 两种角色，
 *    其余（含旧版可能留下的 system）一律不进气泡列表 —— 那是拼给模型的，不是给人看的。
 */

import type {
  CountdownSetting,
  ElapsedSetting,
  HabitSetting,
  InstanceData,
  LedgerRow,
  MatrixTodo,
  Note,
  PickItem,
  StoredBirthday,
  Todo,
} from './cardDataTypes'
import { stickyOf, todosOf } from './instanceData'

export type ChatRole = 'user' | 'assistant'

/** 发给 Rust 的一条消息（与 `ai/openai_compat.rs` 的 `Msg` 逐字段一致） */
export interface OutgoingMsg {
  role: ChatRole | 'system'
  content: string
}

/** 界面上的一个气泡。`status` 只在这里有 —— 后端不关心流式到哪了 */
export interface ChatTurn {
  role: ChatRole
  content: string
  status: 'streaming' | 'done' | 'error'
  /** 只在 `status === 'error'` 时有值；Rust 侧已经人话化过，直接展示 */
  error: string | null
  /** 一次性摘要结果（三期）：不写历史、刷新即消失，界面据此标「不保存」 */
  summary?: boolean
}

/** Rust `AiChunk`（camelCase，`error` 为 null 表示正常帧） */
export interface ChatChunk {
  delta: string
  done: boolean
  error: string | null
}

/** 历史条目（Rust `HistoryItem`，不带消息体） */
export interface HistoryItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

/** 历史详情里的一条（Rust `HistoryMsg`，camelCase） */
export interface HistoryMsg {
  role: string
  content: string
  ts: number
}

/** 「@卡片」的候选：label 是给人看的（同模块多实例带序号），id 是引用键 */
export interface CardChoice {
  id: string
  module: string
  title: string
  label: string
}

/** 单张卡引用进上下文的字数上限；再长就该用户自己贴了 */
export const EXCERPT_MAX = 400
/** 整个引用块的字符预算 —— 4 张卡各自顶格时正好用满，不无限膨胀 */
export const CONTEXT_MAX = 2000
/** 发给模型的历史条数上限（一问一答算两条）。长对话靠会话历史兜底，不靠无限上下文 */
export const HISTORY_MAX = 12
/** `@` 候选一次最多列几个（再多就没法用方向键选了） */
export const CHOICE_MAX = 6

/**
 * 版面 → 候选列表。同模块多实例（F-01）标题一样，所以 label 带序号 ——
 * 否则"@待办"选中哪一张只能靠猜。序号按版面顺序，与浮窗清单同一口径。
 */
export function cardChoices(
  items: readonly { id: string; module?: string }[],
  titleOf: (module: string) => string,
): CardChoice[] {
  const total = new Map<string, number>()
  for (const it of items) {
    const module = it.module ?? it.id
    total.set(module, (total.get(module) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return items.map((it) => {
    const module = it.module ?? it.id
    const title = titleOf(module)
    const n = (seen.get(module) ?? 0) + 1
    seen.set(module, n)
    // 这张表是用同一份 items 建的，查不到是不可能的 —— 不做一条永远走不到的兜底分支
    const label = (total.get(module) as number) > 1 ? `${title}（${n}）` : title
    return { id: it.id, module, title, label }
  })
}

/**
 * 光标前是不是一个没写完的 `@查询`。
 *
 * 三条边界都是有来由的：
 * - `@` 前面必须是行首或空白 —— 否则 `a@b.com` 这种正文会突然弹出卡片列表；
 * - 中间出现空白/第二个 `@` 就结束（`@待 办` 不是一个查询）；
 * - 超出 caret 的部分不看 —— 光标在中间时，右边已经写好的字不该参与筛选。
 */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const end = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, end)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/[\s@]/.test(query)) return null
  return { query, start: at }
}

/** 候选筛选：空查询列前几个；匹配用标题与 label 的不区分大小写子串，保持版面顺序 */
export function filterChoices(
  choices: readonly CardChoice[],
  query: string,
  max: number = CHOICE_MAX,
): CardChoice[] {
  const q = query.trim().toLowerCase()
  const out: CardChoice[] = []
  for (const c of choices) {
    if (q && !c.label.toLowerCase().includes(q) && !c.title.toLowerCase().includes(q)) continue
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

/** 选中候选后把 `@查询` 从正文里擦掉（卡片进 chip 区，正文不残留半截命令） */
export function stripMention(text: string, start: number, caret: number): { text: string; caret: number } {
  const end = Math.max(start, Math.min(caret, text.length))
  return { text: text.slice(0, start) + text.slice(end), caret: start }
}

/**
 * 流式增量的唯一归并点。
 *
 * 优先级是**错误压过一切**：出错时已经收到的增量要留着（用户看到的是"写了一半然后报错"，
 * 而不是整段消失），但状态必须是 error，不能被随后的 done 帧洗成"完成"。
 * 空增量 + 未结束 = SSE 的空行/心跳，原样返回（不产生新对象，省一次重渲染）。
 */
export function applyChunk(turn: ChatTurn, chunk: ChatChunk): ChatTurn {
  // 已经出错的这一轮是终态：后端在 error 帧之后还会补一个 done 帧，
  // 不挡住的话状态会被洗成"完成"，用户看到一起失败的回复却没有任何失败痕迹
  if (turn.status === 'error') return turn
  if (chunk.error !== null && chunk.error !== undefined) {
    return { ...turn, status: 'error', error: chunk.error }
  }
  if (chunk.delta) {
    return { ...turn, content: turn.content + chunk.delta, status: 'streaming' }
  }
  if (chunk.done) return { ...turn, status: 'done' }
  return turn
}

/** 一条待发消息：从气泡列表里取"已经说完的"，流式中的占位与出错的整轮都不发 */
export function outgoingFromTurns(turns: readonly ChatTurn[], max: number = HISTORY_MAX): OutgoingMsg[] {
  const done = turns.filter((t) => t.status === 'done' && t.content.trim() !== '')
  return done.slice(Math.max(0, done.length - max)).map((t) => ({ role: t.role, content: t.content }))
}

/** 引用块要用到的卡片内容来源（组件那半从 `cardData` 现取，这里只声明形状） */
export interface ExcerptSource {
  sticky: string
  /** 按实例取数（todosOf）要的是可变数组 —— 这里与 cardData 的真实形状一致 */
  todos: Todo[]
  matrix: readonly MatrixTodo[]
  notes: readonly Note[]
  ledger: { symbol: string; entries: readonly LedgerRow[] }
  links: readonly { label: string; href: string }[]
  countdown: CountdownSetting
  elapsed: ElapsedSetting
  habit: HabitSetting
  birthdays: readonly StoredBirthday[]
  pickList: readonly PickItem[]
  byInstance?: Record<string, InstanceData>
}

const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s)

/**
 * 一张卡能提供什么文字。**没有可引用内容的模块返回空串**，
 * 由 `contextBlock` 如实写成"（这张卡没有可引用的文字内容）"，不替它编。
 *
 * 只覆盖"用户自己写进去"的内容卡；联网卡/计算卡读的是机器采来的数据，
 * 要么过期要么是别人接口的内容，不该被当成"板上写的字"喂给模型。
 */
export function excerptFor(choice: CardChoice, data: ExcerptSource): string {
  switch (choice.module) {
    case 'sticky':
      return cut(stickyOf(data, choice.module, choice.id).trim(), EXCERPT_MAX)
    case 'todo': {
      // 按实例取（F-01 阶段 2 第二个字段）：第二张待办卡读的是它自己那份清单
      const list = todosOf(data, choice.module, choice.id)
      const open = list.filter((t) => !t.done).map((t) => t.text.trim()).filter(Boolean)
      const doneCount = list.length - open.length
      if (!open.length && !doneCount) return ''
      const head = open.length ? `未完成：${open.slice(0, 8).join('、')}` : '没有未完成的条目'
      return cut(doneCount ? `${head}（另有 ${doneCount} 条已完成）` : head, EXCERPT_MAX)
    }
    case 'matrix': {
      const open = data.matrix.filter((t) => !t.done).map((t) => t.text.trim()).filter(Boolean)
      return cut(open.length ? `未完成：${open.slice(0, 8).join('、')}` : '', EXCERPT_MAX)
    }
    case 'notes': {
      if (!data.notes.length) return ''
      const lines = data.notes
        .slice(0, 3)
        .map((n) => cut(`${n.title || '无标题'}：${n.body}`.replace(/\s+/g, ' ').trim(), 120))
      return cut(lines.join('\n'), EXCERPT_MAX)
    }
    case 'ledger': {
      const rows = data.ledger.entries.slice(-5)
      if (!rows.length) return ''
      const sym = data.ledger.symbol || ''
      const lines = rows.map((r) => `${r.date} ${r.category || '未分类'} ${r.note} ${(r.cents / 100).toFixed(2)}${sym}`)
      return cut(lines.join('\n'), EXCERPT_MAX)
    }
    case 'links':
      return cut(data.links.slice(0, 8).map((l) => `${l.label} ${l.href}`).join('\n'), EXCERPT_MAX)
    case 'countdown':
      return cut(data.countdown.label && data.countdown.date ? `${data.countdown.label}：${data.countdown.date}` : '', EXCERPT_MAX)
    case 'elapsed':
      return cut(data.elapsed.label && data.elapsed.date ? `${data.elapsed.label}：从 ${data.elapsed.date} 起` : '', EXCERPT_MAX)
    case 'habit':
      return cut(data.habit.name ? `${data.habit.name}：已打卡 ${data.habit.days.length} 天` : '', EXCERPT_MAX)
    case 'birthday':
      return cut(data.birthdays.slice(0, 8).map((b) => `${b.name}：${b.month} 月 ${b.day} 日`).join('\n'), EXCERPT_MAX)
    case 'pick':
      return cut(data.pickList.slice(0, 12).map((p) => p.label).join('、'), EXCERPT_MAX)
    default:
      return ''
  }
}

/**
 * 引用块（system 消息）。整块有预算：卡片多了按顺序截断，并在末尾明说被截了 ——
 * 静默截断会让模型以为"就这些"，那比不带上下文更糟。
 */
export function contextBlock(
  chips: readonly CardChoice[],
  excerptOf: (c: CardChoice) => string,
  max: number = CONTEXT_MAX,
): string | null {
  if (!chips.length) return null
  const head =
    '用户在版面里引用了下面这些卡片，把它们当作已知内容来回答；不要编造卡片里没有的信息。'
  const parts = chips.map((c) => {
    const body = excerptOf(c).trim()
    return `## ${c.label}\n${body || '（这张卡没有可引用的文字内容）'}`
  })
  const block = `${head}\n\n${parts.join('\n\n')}`
  if (block.length <= max) return block
  // 总量条硬顶（含那句"被截断"）：超长上下文会让请求直接被服务端拒，留一半也没用
  const suffix = '\n（引用内容过长，已截断）'
  return block.slice(0, Math.max(0, max - suffix.length)) + suffix
}

/**
 * 一次摘要请求的正文（三期的 `ai_summarize` 只吃一段 `text`，没有消息结构）。
 *
 * 引用块与对话共用同一条 `contextBlock` 预算（每卡 400 / 整块 2000 字）：
 * 「喂给模型多少字」的定价不该因为入口不同而变。差别只在顺序 —— 卡片在前、
 * 输入框那段在后，因为后者往往是对前者的指令（"只留待办"）。
 *
 * 返回 `null` = 没有任何可摘要的内容（按钮保持禁用）。
 */
export function summaryText(
  chips: readonly CardChoice[],
  draft: string,
  excerptOf: (c: CardChoice) => string,
  max: number = CONTEXT_MAX,
): string | null {
  const parts = [contextBlock(chips, excerptOf, max), draft.trim()].filter((s): s is string => !!s)
  if (!parts.length) return null
  const text = parts.join('\n\n')
  if (text.length <= max) return text
  // 卡片块可能已经贴着 max，再加输入框那段就超了：整段二次封顶，明说截断（理由同 contextBlock）
  const suffix = '\n（内容过长，已截断）'
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix
}

/**
 * 组装一次请求。引用块永远在最前（system），历史只取最近 `HISTORY_MAX` 条 ——
 * 长对话不靠把全部记录塞给模型，长期上下文归会话历史，这条边界写在这里而不是组件里。
 */
export function buildMessages(
  turns: readonly ChatTurn[],
  chips: readonly CardChoice[],
  excerptOf: (c: CardChoice) => string,
): OutgoingMsg[] {
  const history = outgoingFromTurns(turns)
  const block = contextBlock(chips, excerptOf)
  return block ? [{ role: 'system', content: block }, ...history] : history
}

/** 历史详情 → 气泡。只认 user/assistant：system 是拼给模型的，不该出现在界面里 */
export function turnsFromHistory(messages: readonly HistoryMsg[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (!m.content.trim()) continue
    out.push({ role: m.role, content: m.content, status: 'done', error: null })
  }
  return out
}

/**
 * 历史条目的时间：今天/昨天只说时分，更早才带日期 —— 列表里绝大多数是最近两天的，
 * 每条都写全日期反而是噪声。
 */
export function historyWhen(updatedAt: number, nowMs: number): string {
  const then = new Date(updatedAt * 1000)
  const now = new Date(nowMs)
  const hm = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(then, now)) return `今天 ${hm}`
  const yesterday = new Date(now.getTime())
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(then, yesterday)) return `昨天 ${hm}`
  const md = `${String(then.getMonth() + 1).padStart(2, '0')}-${String(then.getDate()).padStart(2, '0')}`
  if (then.getFullYear() === now.getFullYear()) return `${md} ${hm}`
  return `${then.getFullYear()}-${md}`
}

/**
 * 坞的出场条件（设计稿 §9 那三条 + 全屏遮罩）。
 *
 * 布局编辑要拖卡片、浮窗是独立窗口、设置/模板/命令面板/首启向导都是全屏遮罩 ——
 * 这几种情况下坞留在屏幕上，要么挡住操作，要么和遮罩抢 Esc。
 */
export interface DockVisibility {
  desktop: boolean
  view: 'workbench' | 'edit'
  /** 已脱离成浮窗的卡数（>0 = 用户正在别的窗口里） */
  floats: number
  settingsOpen: boolean
  templatesOpen: boolean
  paletteOpen: boolean
  onboardingOpen: boolean
}

export function canShowDock(s: DockVisibility): boolean {
  return (
    s.desktop &&
    s.view === 'workbench' &&
    s.floats === 0 &&
    !s.settingsOpen &&
    !s.templatesOpen &&
    !s.paletteOpen &&
    !s.onboardingOpen
  )
}
