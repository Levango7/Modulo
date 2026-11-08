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
import { countdownOf, elapsedOf, habitOf, ledgerEntriesOf, matrixOf, notesOf, stickyOf, todosOf } from './instanceData'
// 单向依赖：knowledge 只从这边拿**类型**（`import type`，运行时擦除），这边从这里拿一个常量。
// 反过来 import 会成环 —— 别把 `docExcerpt` 挪进来。
import { KNOWLEDGE_EXCERPT_MAX } from './knowledge'
// 技能（PR-F3）：**同向的第二条**。skills 也只从这边拿 `CardChoice` 类型（运行时擦除），
// 这边从它拿一个上限常量（权限行显示用）。两处薄壳 `skillChoices` / `excerptWithSkills`
// 都定义在 `skills.ts`，别挪进来 —— 挪进来就是 `aiChat ↔ skills` 成环。
import { SKILL_TEXT_MAX } from './skills'

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
  /** 与 `todos` 同一条理由：按实例取数（`matrixOf`）要的是可变数组 */
  matrix: MatrixTodo[]
  /** 速记：2026-11-05 起按实例分（`notesOf`）—— 必填如旧（`CardData.notes` 就是必填），
   *  读路径在 `notesOf` 里 `?? []` 兜底（测试夹具与坏档不带它时不炸） */
  notes: readonly Note[]
  ledger: { symbol: string; entries: readonly LedgerRow[] }
  links: readonly { label: string; href: string }[]
  countdown: CountdownSetting
  elapsed: ElapsedSetting
  habit: HabitSetting
  birthdays: readonly StoredBirthday[]
  pickList: readonly PickItem[]
  /** 按实例分的那些字段（便签 / 待办 / 倒数日 / 正计时 / 记账条目 / 习惯 / 四象限 / 速记）的第二实例内容都在这张表里 */
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
      // 按实例取（F-01 阶段 2 合并序第七个字段）：第二张四象限卡读的是它自己那份清单 ——
      // 不这么取，引用第二张卡喂给模型的是第一张的条目，而界面上看着"引用成功了"。
      const list = matrixOf(data, choice.module, choice.id)
      const open = list.filter((t) => !t.done).map((t) => t.text.trim()).filter(Boolean)
      return cut(open.length ? `未完成：${open.slice(0, 8).join('、')}` : '', EXCERPT_MAX)
    }
    case 'notes': {
      // 按实例取（F-01 阶段 2 第八个、也是最后一个字段，2026-11-05）：第二张速记卡读的
      // 是它自己那份 —— 不这么取，引用第二张卡喂给模型的是第一张的速记，而界面上看着
      // "引用成功了"（§12.52 习惯、§12.47 记账同一条缝）。速记今天没有 UI 写入入口，
      // 这个 case 是"第二张真有了内容时正确"的那颗钉子。
      const list = notesOf(data, choice.module, choice.id)
      if (!list.length) return ''
      const lines = list
        .slice(0, 3)
        .map((n) => cut(`${n.title || '无标题'}：${n.body}`.replace(/\s+/g, ' ').trim(), 120))
      return cut(lines.join('\n'), EXCERPT_MAX)
    }
    case 'ledger': {
      // 条目按实例取（§12.48 点名"不越线、交给 F-12 线"的那一处）；**币种符号仍取顶层** ——
      // 那是偏好，两条账本共用一种货币，分了只会让人各设一遍同一个 ¥（§12.48 的口径）。
      const rows = ledgerEntriesOf(data, choice.module, choice.id).slice(-5)
      if (!rows.length) return ''
      const sym = data.ledger.symbol || ''
      const lines = rows.map((r) => `${r.date} ${r.category || '未分类'} ${r.note} ${(r.cents / 100).toFixed(2)}${sym}`)
      return cut(lines.join('\n'), EXCERPT_MAX)
    }
    case 'links':
      return cut(data.links.slice(0, 8).map((l) => `${l.label} ${l.href}`).join('\n'), EXCERPT_MAX)
    case 'countdown': {
      // 按实例取（与便签 / 待办同一条口径）：第二张倒数日卡报的是它自己的日子，
      // 不是第一张的 —— 读顶层的话，用户问"这个日子是什么时候"会拿到错的那张。
      const c = countdownOf(data, choice.module, choice.id)
      return cut(c.label && c.date ? `${c.label}：${c.date}` : '', EXCERPT_MAX)
    }
    case 'elapsed': {
      const e = elapsedOf(data, choice.module, choice.id)
      return cut(e.label && e.date ? `${e.label}：从 ${e.date} 起` : '', EXCERPT_MAX)
    }
    case 'habit': {
      // 按实例取（与便签 / 待办 / 倒数日 / 正计时 / 记账条目同一条口径）：第二张习惯卡报的是
      // 它自己的名字和天数。**不取 §12.50 的求和口径** —— 求和是给图表那种"看全部"的视图
      // 用的；`@` 的是具体某一张卡，用户问"这个习惯打了几天"要的是这张，不是两张之和。
      const h = habitOf(data, choice.module, choice.id)
      return cut(h.name ? `${h.name}：已打卡 ${h.days.length} 天` : '', EXCERPT_MAX)
    }
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
/**
 * 上下文预算的**当前用量**（E2 composer 控件）：把 chips 与其摘录换算成
 * "已用多少字 / 预算多少字"，composer 据此显示「已用 123 / 2000」并在超预算前预警。
 *
 * 为什么单独一个纯函数而不是在组件里拼：这个数字有三个消费者（控件显示 / 超预算
 * 预警 / 测试），而 `contextBlock` 的截断是**事后**的（拼完才发现超了）；
 * `contextUsage` 是**事前**的（还没拼出来就知道要给用户看什么）。两者必须同源 ——
 * 所以用量算法就是 contextBlock 算法的前半段（head + 每卡 `## label
摘录` 的
 * 总长 + 未计入预算的截断后缀），测试直接钉住两个数字对得上。
 */
export function contextUsage(
  chips: readonly CardChoice[],
  excerptOf: (c: CardChoice) => string,
  max: number = CONTEXT_MAX,
): { used: number; max: number; cards: number; over: boolean } {
  const head =
    '用户在版面里引用了下面这些卡片，把它们当作已知内容来回答；不要编造卡片里没有的信息。'
  let used = head.length
  for (const c of chips) {
    const body = excerptOf(c).trim() || '（这张卡没有可引用的文字内容）'
    // 与 contextBlock 的拼接逐字符同源：head 之后接 '\n\n'，每张卡再各自接 '\n\n'
    used += 2 + `## ${c.label}\n${body}`.length
  }
  return { used, max, cards: chips.length, over: used > max }
}

/**
 * 控件行那句「本次可读 …」（E2 起；PR-F1 扩了资料那一档；PR-F3 扩了技能第三档）。
 *
 * 三个上限不同源：卡片摘录每张 ≤`EXCERPT_MAX`、资料每份 ≤`KNOWLEDGE_EXCERPT_MAX`、
 * 技能每条 ≤`SKILL_TEXT_MAX`；整块 2000 字的总预算三者共用（`contextBlock`）。
 * 只有卡片时**逐字保持** E2 的旧文案（E2E 钉着它）；**两参调用逐字保持 F1 的
 * 两档文案**（`aiChat.test.ts` 钉着）—— 只有真的带了技能（`skills > 0`）才追加第三档。
 * 不写清楚，用户会以为资料 / 技能也按 400 字喂给模型。
 */
export function permNote(cards: number, docs: number, skills: number = 0): string | null {
  if (!cards && !docs && !skills) return null
  const head = [
    cards ? `${cards} 张卡` : '',
    docs ? `${docs} 份资料` : '',
    skills ? `${skills} 份技能` : '',
  ].filter(Boolean).join(' + ')
  // 卡片那支的「张卡的内容」之间**没有空格** —— E2 的文案逐字如此，E2E 钉着它
  if (!docs && !skills) return `本次可读 ${head}的内容（各 ≤${EXCERPT_MAX} 字）`
  const caps = `卡片各 ≤${EXCERPT_MAX} 字、资料各 ≤${KNOWLEDGE_EXCERPT_MAX} 字`
  // skills === 0 → 逐字保持 F1 两档；带了技能才把第三档的上限也写出来
  if (!skills) return `本次可读 ${head}的内容（${caps}）`
  return `本次可读 ${head}的内容（${caps}、技能各 ≤${SKILL_TEXT_MAX} 字）`
}

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

// ---- E3：思考档位与附件（composer 的两件新控件）----
//
// 两件参数到 Rust 侧都会折成文字（`protocol.rs` 的 `thinking_directive` /
// `fold_attachments`），这里只负责**界面这一半**：档位文案、读文件前的判断、
// 预算与去重。上限数字与 Rust 同口径，但**不是权威** —— 真正的闸门在 Rust
// （手搓的 invoke 也照那边的数裁），这边只负责"提前把话说清楚"。

/** 发给 Rust 的一份附件（与 `ai/protocol.rs` 的 `Attachment` 逐字段一致） */
export interface OutgoingAttachment {
  name: string
  content: string
}

/** 已挂到这次对话上的文件：`OutgoingAttachment` + 只有界面关心的用量 */
export interface MountedFile extends OutgoingAttachment {
  /** 实际带上的字符数（截断后） */
  chars: number
  /** 原文件比 `ATTACH_CHARS_MAX` 长，只带了前面一段 */
  truncated: boolean
}

/** 一次最多挂几个文件：再多就不是"带材料"，是拿文件灌提示词 */
export const ATTACH_MAX_FILES = 3
/** 单个文件的字数上限（同 Rust `ATTACH_CHARS_MAX`） */
export const ATTACH_CHARS_MAX = 8000
/** 所有附件合计的字数上限（同 Rust `ATTACH_TOTAL_MAX`） */
export const ATTACH_TOTAL_MAX = 16000
/**
 * 单个文件的体积上限。再大的文件读进内存只为取前 8000 字，不值当 ——
 * 组件在 `File.text()` 之前用它拦一道（读之前拦，才真的省下那次内存）。
 */
export const ATTACH_MAX_BYTES = 2_000_000

export interface ThinkingLevel {
  id: string
  label: string
  /** 悬停说明：每个档位实际做了什么，别让人以为这是"推理预算" */
  hint: string
}

/**
 * 四档。`off` 是默认 —— 不加任何指令，行为与 E2 之前逐字一致：
 * 新控件不该悄悄改掉所有人的回答风格。
 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  { id: 'off', label: '默认', hint: '不加思考指令，按模型本来的方式回答' },
  { id: 'low', label: '快', hint: '先给结论，理由一两句（适合改文案、问答）' },
  { id: 'medium', label: '细', hint: '先拆问题再答，结论在前、推理在后' },
  { id: 'high', label: '深', hint: '先列假设与边界，分步推理，不确定就说不确定' },
]

/** 档位的中文名；未知 id 回落「默认」（与 Rust「未知值不加指令」同一条口径） */
export function thinkingLabel(id: string): string {
  return THINKING_LEVELS.find((l) => l.id === id)?.label ?? THINKING_LEVELS[0].label
}

/** 字数的短写法：界面上要的是量级，不是精确到个位的数字 */
export function charsLabel(n: number): string {
  if (n < 1000) return `${n} 字`
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k 字`
}

/**
 * 把选中文件读出来的文本变成可挂的附件。只做判断，不碰 DOM（可单测）。
 *
 * 三条拒收都有来由：空文件挂上去只会换来一句"文件是空的"；NUL 字节是
 * "这不是文本"的可靠判据（图片 / PDF / 压缩包都会命中）；超长文件按**码点**
 * 截断并把"截断过"记在对象上，界面据此显示"已截断"，不装成全文。
 *
 * 调用方保证只把 ≤ `ATTACH_MAX_BYTES` 的文本交进来（组件在读之前拦）。
 */
export function attachFile(
  name: string,
  text: string,
): { ok: true; file: MountedFile } | { ok: false; reason: string } {
  // CRLF → LF：Windows 上选的 txt 全是 CRLF，不统一的话同一个文件两种系统下字数不同
  const body = text.replace(/\r\n/g, '\n')
  if (!body.trim()) return { ok: false, reason: `${name} 是空的，没有可带上的内容` }
  if (body.includes('\u0000')) {
    return { ok: false, reason: `${name} 不像文本文件（读到了二进制内容）` }
  }
  // 按码点算：与 Rust 的 chars() 同一口径，emoji 不会被劈成两个半截
  const points = Array.from(body)
  const truncated = points.length > ATTACH_CHARS_MAX
  return {
    ok: true,
    file: {
      name,
      content: truncated ? points.slice(0, ATTACH_CHARS_MAX).join('') : body,
      chars: truncated ? ATTACH_CHARS_MAX : points.length,
      truncated,
    },
  }
}

export interface PickedText {
  name: string
  text: string
}

/**
 * 把新选的文件并进已挂的那批，守住三条：同名不重复、个数不超、合计不超。
 *
 * 拒收理由要**逐条**回给用户（`rejected`），不能只留最后一个 —— 一次拖五个文件
 * 进来，用户需要知道哪几个进了、哪几个为什么没进。
 */
export function addFiles(
  existing: readonly MountedFile[],
  incoming: readonly PickedText[],
): { files: MountedFile[]; rejected: string[] } {
  const files = existing.slice()
  const rejected: string[] = []
  for (const it of incoming) {
    if (files.some((f) => f.name === it.name)) {
      rejected.push(`「${it.name}」已经挂上了`)
      continue
    }
    if (files.length >= ATTACH_MAX_FILES) {
      rejected.push(`一次最多带 ${ATTACH_MAX_FILES} 个文件，「${it.name}」先没带`)
      continue
    }
    const one = attachFile(it.name, it.text)
    if (!one.ok) {
      rejected.push(one.reason)
      continue
    }
    const used = files.reduce((n, f) => n + f.chars, 0)
    if (used + one.file.chars > ATTACH_TOTAL_MAX) {
      rejected.push(`附件合计最多 ${ATTACH_TOTAL_MAX} 字，「${it.name}」先没带`)
      continue
    }
    files.push(one.file)
  }
  return { files, rejected }
}

/** 控件行上的附件摘要；没有文件返回 null（不占地方，不显示空信息） */
export function filesSummary(files: readonly MountedFile[]): string | null {
  if (!files.length) return null
  const chars = files.reduce((n, f) => n + f.chars, 0)
  const cut = files.some((f) => f.truncated) ? ' · 有截断' : ''
  return `${files.length} 个文件 · ${charsLabel(chars)}${cut}`
}

/** 单个附件的悬停说明：文件名 + 实际带上多少字（截断的要说） */
export function attachmentLine(f: MountedFile): string {
  return `${f.name} · ${charsLabel(f.chars)}${f.truncated ? '（原文件更长，已截断）' : ''}`
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
  /** 改天换地 E1：chat 是并列的第三种视图（左栏三 tab），坞在其中要全高常驻 */
  view: 'workbench' | 'chat' | 'edit'
  /** 已脱离成浮窗的卡数（>0 = 用户正在别的窗口里） */
  floats: number
  settingsOpen: boolean
  templatesOpen: boolean
  paletteOpen: boolean
  onboardingOpen: boolean
}

/**
 * 坞什么时候该在。E1 起 `view` 有三态：`workbench`（底部常驻条）/ `chat`（**全高面板**，
 * 聊天任脊柱）/ `edit`（编辑器里不挡拖拽，同旧）。
 * `desktop` 那条不动：AI 后端是 Tauri IPC，web 版没有脊梁骨 —— 但 `view==='chat'` 时
 * web 也有话要说（占位面板），那句话不归这里管，归 App 的 chat-mode 分支。
 */
export function canShowDock(s: DockVisibility): boolean {
  return (
    s.desktop &&
    (s.view === 'workbench' || s.view === 'chat') &&
    s.floats === 0 &&
    !s.settingsOpen &&
    !s.templatesOpen &&
    !s.paletteOpen &&
    !s.onboardingOpen
  )
}
