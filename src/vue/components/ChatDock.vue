<script setup lang="ts">
/**
 * 底部 AI 对话坞（F-12 二期，设计稿 `docs/design/F-12-AI-WIRING.md` §11）。
 *
 * 形态照 cursor / codex / qoder / trae 那一类：**常驻页面正下方的一条输入条**，
 * 聚焦或 `Ctrl+J` 展开成浮在画布之上的面板（不挤压版面高度），`Esc` 收起。
 * 不做成卡片：注册表 55 种卡的尺寸契约、多实例、版面模板都会被牵动，而它本质是
 * "随时能叫出来的一层壳"，不是版面里的一块。
 *
 * 四条纪律（第 4 条是 E3 加的）：
 * 1. **判定全在 `aiChat.ts`**：流式三态、`@` 解析、引用块预算、历史气泡过滤 ——
 *    这里只做 Channel / invoke / 焦点 / 滚动这些"必须活在组件里"的事。
 * 2. **不探测、不预加载**：provider 列表读的是启动时 hydrate 的 `ai-settings.v1` 镜像；
 *    发一条消息 = 一次 `ai_chat`，不做"先探 N 个 provider 再发"。没配就当场提示，
 *    并把入口指到「设置 → 实验室」——这正是二期要消掉的那条死路。
 * 3. **历史由 Rust 单点落盘**：本组件只在流结束时刷新列表，不自己存一份 ——
 *    两份真相迟早对不上（一期 `ai-settings.v1` 的教训同理）。
 * 4. **附件不落历史**（E3）：文件正文只随这一轮请求发出去，历史里只留问答本身 ——
 *    8k 字贴进气泡只会把列表拖慢，而且在左栏列表里也回看不出意义来。
 */
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import * as E from '@levango7/engine'
import type { CardDataApi } from '../cardData'
import type { AiSessionsApi } from '../useAiSessions'
import type { CommandBus } from '../commandBus'
import type { LayoutStore, StorageAdapter } from '../store'
import { AI_DOC_KEY, parseAiDoc } from '../aiSettings'
import {
  applyChunk,
  ATTACH_CHARS_MAX,
  ATTACH_MAX_BYTES,
  ATTACH_MAX_FILES,
  addFiles,
  attachmentLine,
  buildMessages,
  contextUsage,
  cardChoices,
  excerptFor,
  filesSummary,
  filterChoices,
  mentionQuery,
  permNote,
  stripMention,
  summaryText,
  THINKING_LEVELS,
  turnsFromHistory,
  type CardChoice,
  type ChatChunk,
  type ChatTurn,
  type MountedFile,
  type PickedText,
} from '../aiChat'
import { docChoices, excerptWithDocs } from '../knowledge'
import type { KnowledgeApi } from '../useKnowledge'
import type { MemoryApi } from '../useMemory'
import { ACTION_READ_MAX, actionLabel, actionResultLines, actionResultText, isActionResult, parseActions, runActions } from '../aiActions'
import { localDay } from '../reminders'
import { habitOf, stickyOf, writeCountdown, writeHabit, writeSticky } from '../instanceData'

/**
 * `full`：嵌入全高模式（E1 的 chat 视图）。展开面板从"浮在画布上的 45vh 浮层"
 * 变成"撑满 chat-mode 容器的一块"—— 收起条、Esc 收起这些交互在 full 下没有意义
 * （左栏永远能切走），所以 full 时 App 传 `:expanded="true"` 且忽略 update 事件。
 */
const props = defineProps<{ expanded: boolean; full?: boolean }>()
const emit = defineEmits<{ (e: 'update:expanded', v: boolean): void }>()

const storage = inject<StorageAdapter>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
const commandBus = inject<CommandBus>('commandBus')!

/** 输入草稿：收起态那条 input 与展开后的 textarea 共用同一份，聚焦就展开不丢字 */
const draft = ref('')
const turns = ref<ChatTurn[]>([])
/**
 * 会话状态搬到共享层 `useAiSessions`（改天换地 PR-D）：左栏的 Session 列表与本坞
 * 共用同一份清单与 active id —— 此前历史面板是坞的私有实现，左栏再做一份就是
 * 两份清单。`conversationId` 是共享层 `activeId` 的本坞别名（发送/续聊照旧写它）。
 */
const sessions = inject<AiSessionsApi>('aiSessions')!
/** 资料（PR-F1）：坞里 `@` 能引用的另一半来源 —— 与左栏「资料」共用同一份（App provide） */
const knowledge = inject<KnowledgeApi>('knowledge')!
/** 「AI 记忆」（第十五笔）：每次请求常驻注入 system 块 —— 与设置面板里的清单同一份 */
const memory = inject<MemoryApi>('memory')!
const conversationId = sessions.activeId
/**
 * 栏里点了一条会话 ⇒ 把气泡换成那条的消息（system 不进界面，`turnsFromHistory` 管），
 * 顺手把坞展开 —— 从左栏点进来的用户要看见内容，而不是坞还收着。
 */
watch(sessions.lastLoaded, (v) => {
  if (!v) return
  turns.value = turnsFromHistory(v.messages)
  chips.value = []
  files.value = []
  streamToken++
  busy.value = false
  streamConv.value = null
  expand()
  scrollDown()
})
/** 正在流式输出的那个会话 id —— 「停止」按的就是它 */
const streamConv = ref<string | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
/** 每次发送/新对话自增：上一轮的迟到帧按 token 丢弃，不会写进新会话 */
let streamToken = 0

const chips = ref<CardChoice[]>([])
const picker = ref<CardChoice[]>([])
const pickerIndex = ref(0)

/**
 * E3 的两件 composer 参数。分工不一样：
 * - `thinking` 是**偏好**：换会话也留着（用户的说话习惯不该每条对话重设一遍）；
 * - `files` 属于**这次对话**：新对话 / 从左栏切会话就清空 —— 文件正文不进历史
 *   （纪律 4），换到另一条对话还挂着上一份文件，只会让人以为它还在上下文里。
 */
const thinking = ref('off')
const files = ref<MountedFile[]>([])
const fileEl = ref<HTMLInputElement | null>(null)
/** 控件行上的附件摘要（没有文件时 null：不显示空信息） */
const filesNote = computed(() => filesSummary(files.value))
const thinkingHint = computed(
  () => THINKING_LEVELS.find((l) => l.id === thinking.value)?.hint ?? '',
)
/** 文件选择框的过滤提示。只是提示 —— 收不收由 `attachFile` 判（扩展名能骗人） */
const FILE_ACCEPT =
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.xml,.html,.css,.js,.ts,.vue,.py,.rs,.go,.java,.sh'


const inputEl = ref<HTMLTextAreaElement | null>(null)
const miniEl = ref<HTMLInputElement | null>(null)
const threadEl = ref<HTMLElement | null>(null)

/**
 * provider 列表：**每次发送时现读**而不是挂载时缓存 —— 用户可能刚在设置里加了服务，
 * 坞是常驻组件，缓存会让"加完回来还是不能用"。读的是启动时 hydrate 的镜像，零 IO。
 */
const providers = computed(() => parseAiDoc(storage.get(AI_DOC_KEY)))
const providerId = ref('')

/** 当前 provider 的展示名（composer 控件行第一个控件：模型是什么要说在明处） */
const providerModel = computed(() => {
  const p = providers.value.find((x) => x.id === providerId.value) ?? providers.value[0]
  return p ? p.model || p.id : '未配置模型'
})
/**
 * 上下文用量（E2 控件行）：事前算法（`contextUsage`），与 `contextBlock` 的事后截断
 * 同源 —— 测试钉两个数字对得上，控件才不是"看着玩的花架子"。
 */
/**
 * 引用摘录的**唯一入口**（PR-F1 加的这层薄壳）：资料走 `docExcerpt`、卡片走 `excerptFor`。
 * `contextUsage` / `contextBlock` / `buildMessages` / `summaryText` 四处拿到的是同一个函数 ——
 * 口径只有一份，才不会出现"控件说 300 字、请求其实早被截到 2000"那种各说各话。
 */
const excerptOf = (c: CardChoice): string =>
  excerptWithDocs(knowledge.docs.value, (x) => excerptFor(x, cardDataApi.state))(c)
/** 引用里资料占几份（卡片与资料的摘录上限不同源，界面要分开报） */
const chipsDocs = computed(() => chips.value.filter((c) => c.module === 'knowledge').length)

const usage = computed(() => contextUsage(chips.value, excerptOf))

/** 控件行那句「本次可读 …」（E2 起；F1 起把资料那档也写出来，两个上限不同源） */
const permLine = computed(() => permNote(chips.value.length - chipsDocs.value, chipsDocs.value))

/** 选中的 provider 掉了（被删）就回落到第一条，避免发出去必失败 */
watch(
  providers,
  (list) => {
    if (!list.some((p) => p.id === providerId.value)) providerId.value = list[0]?.id ?? ''
  },
  { immediate: true },
)

/**
 * `@` 能引用的东西：**资料在前、版面卡片在后**（PR-F1）。排前面的理由很实际 ——
 * 用户刚导入的那份资料通常就是这次要问的；两边的候选与 chip 同一形状
 * （`CardChoice`），所以选中/删除/预算那几条路一行都不用改。
 */
const choices = computed(() => [
  ...docChoices(knowledge.docs.value),
  ...cardChoices(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m),
])

function expand(): void {
  if (!props.expanded) emit('update:expanded', true)
}
function collapse(): void {
  picker.value = []
  emit('update:expanded', false)
}

watch(
  () => props.expanded,
  (v) => {
    if (v) {
      void nextTick(() => inputEl.value?.focus())
      return
    }
    picker.value = []
    miniEl.value?.blur()
  },
)

/** 新内容一来就贴底：流式时用户看的永远是最后一行 */
function scrollDown(): void {
  void nextTick(() => {
    if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
  })
}

function onInput(e: Event): void {
  draft.value = (e.target as HTMLTextAreaElement).value
  const el = e.target as HTMLTextAreaElement
  const hit = mentionQuery(draft.value, el.selectionStart ?? draft.value.length)
  if (!hit) {
    picker.value = []
    return
  }
  pickerIndex.value = 0
  picker.value = filterChoices(choices.value, hit.query)
}

function choose(c: CardChoice): void {
  const el = inputEl.value
  const caret = el?.selectionStart ?? draft.value.length
  const hit = mentionQuery(draft.value, caret)
  if (hit) {
    const next = stripMention(draft.value, hit.start, caret)
    draft.value = next.text
    void nextTick(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }
  if (!chips.value.some((x) => x.id === c.id)) chips.value = [...chips.value, c]
  picker.value = []
}

function removeChip(id: string): void {
  chips.value = chips.value.filter((c) => c.id !== id)
}

/** 打开系统选择文件（原生 input 藏起来：它的外观跟这条控件行不搭） */
function pickFiles(): void {
  fileEl.value?.click()
}

/**
 * 读选中的文件 → 交给 `addFiles` 合并。**读之前**先按体积拦一道：
 * 一份 20MB 的日志读进内存只为取前 8000 字，不值当（`ATTACH_MAX_BYTES`）。
 *
 * 拒收理由逐条进 notice（一次选五个文件时，用户要知道哪个没进、为什么），
 * 成功挂上的不吭声 —— 文件 chip 本身就是回执。
 */
async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  // 清 value：同一个文件再选一次也要能触发 change
  input.value = ''
  const read: PickedText[] = []
  const rejected: string[] = []
  for (const f of picked) {
    if (f.size > ATTACH_MAX_BYTES) {
      rejected.push(`${f.name} 超过 ${Math.round(ATTACH_MAX_BYTES / 1000)}KB，先别带`)
      continue
    }
    try {
      read.push({ name: f.name, text: await f.text() })
    } catch {
      rejected.push(`${f.name} 读不出来（可能不是文本文件）`)
    }
  }
  const merged = addFiles(files.value, read)
  files.value = merged.files
  const why = [...rejected, ...merged.rejected]
  notice.value = why.length ? why.join('；') : null
}

function removeFile(name: string): void {
  files.value = files.value.filter((f) => f.name !== name)
}

/**
 * textarea 里的键：候选开着时方向键/回车/退出归候选；`Enter` 发送、`Shift+Enter` 换行。
 * 候选那支要 `stopPropagation` —— 否则 Esc 会同时被应用层级联看到，坞整个收起。
 */
function onKey(e: KeyboardEvent): void {
  if (picker.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      pickerIndex.value = (pickerIndex.value + 1) % picker.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      pickerIndex.value = (pickerIndex.value - 1 + picker.value.length) % picker.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      choose(picker.value[pickerIndex.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      picker.value = []
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function openSettings(): void {
  commandBus.dispatch('app.settings')
}

/** 发送前的最后一道：没配 provider 就当场说清去哪配，并给一个能点的入口 */
function missingProvider(): boolean {
  if (providerId.value) return false
  notice.value = '还没有可用的模型服务：先去「设置 → 实验室」添加一个并点「测试连接」'
  return true
}

/**
 * 真正发出一轮（用户手打的 `send` 与「照做」之后的自动续轮共用）。
 * 引用与附件都是**调用方在那一刻的快照**：发出去之后用户再删，不改已发出的请求；
 * 续轮沿用产生那批动作的那一轮的引用快照（`usedChips` 存在助手占位上）—— @卡片 的
 * 上下文不在中途丢掉。
 */
async function runTurn(text: string, usedChips: CardChoice[], usedFiles: MountedFile[]): Promise<void> {
  if (!text || busy.value) return
  if (missingProvider()) return
  turns.value = [
    ...turns.value,
    { role: 'user', content: text, status: 'done', error: null },
    { role: 'assistant', content: '', status: 'streaming', error: null, usedChips },
  ]
  busy.value = true
  const token = ++streamToken
  const idx = turns.value.length - 1
  scrollDown()

  const ch = new Channel<ChatChunk>()
  ch.onmessage = (c) => {
    if (token !== streamToken) return
    turns.value[idx] = applyChunk(turns.value[idx], c)
    scrollDown()
    if (c.done) {
      // 「AI 动手」（第十二笔）：正常收尾才解析动作（错误帧没有正文可解析）
      if (!c.error) attachActions(idx)
      busy.value = false
      streamConv.value = null
      void sessions.refresh()
    }
  }

  try {
    const messages = buildMessages(turns.value, usedChips, excerptOf, memory.entries.value)
    const r = await invoke<{ conversationId: string }>('ai_chat', {
      providerId: providerId.value,
      conversationId: conversationId.value,
      messages,
      // E3：两件 composer 参数。名字与 Rust 命令形参一致（snake_case 由 tauri 映射，
      // 这两个词本来就单词，不需要驼峰改写）—— 附件只交正文，不交路径
      thinking: thinking.value,
      attachments: usedFiles.map((f) => ({ name: f.name, content: f.content })),
      onChunk: ch,
    })
    if (token !== streamToken) return
    conversationId.value = r.conversationId
    streamConv.value = r.conversationId
  } catch (err) {
    if (token !== streamToken) return
    turns.value[idx] = { ...turns.value[idx], status: 'error', error: String(err) }
    busy.value = false
    streamConv.value = null
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || busy.value) return
  // 引用块与附件都用这一轮开始时的快照：发出去之后用户再删，不改已发出的请求
  const usedChips = chips.value.slice()
  const usedFiles = files.value.slice()
  draft.value = ''
  chips.value = []
  picker.value = []
  notice.value = ''
  await runTurn(text, usedChips, usedFiles)
}

/** 卡的中文名（提议列表里的人话）；查不到落回 id */
const titleOf = (id: string): string | undefined => store.reg.find((m) => m.id === id)?.title

/**
 * 实例 id → 人话（第十八笔）：定点动作的前缀里要让人看清是哪一张。
 * 板上找不到（刚被删）就落回 id 本身。
 */
const instanceLabelOf = (id: string): string => {
  const it = store.doc.value.items.find((x) => x.id === id)
  const title = it ? titleOf(it.module ?? it.id) : undefined
  return title ? `${title}（${id}）` : id
}

/**
 * 读类动作的执行体（第十六笔起；第十八笔起可带 instanceId 定点读第二实例）：
 * **只取不写**，走与 `@卡片` 同一套读路径。
 * 无 moduleId / instanceId = 版面清单（有哪些卡、实例 id 是多少）；有 instanceId =
 * 那一张实例的摘录；有 moduleId 无 instanceId = 那张卡第一实例的摘录（同 `excerptFor`
 * 口径，单条封顶 `ACTION_READ_MAX`）。版面上没有那张卡 ⇒ 抛（首败即停会把它写进结果）。
 */
function readContext(moduleId?: string, instanceId?: string): string {
  const cards = cardChoices(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m)
  if (!moduleId && !instanceId) {
    return cards.length ? cards.map((c) => `${c.label}（id ${c.id}）`).join('、') : '版面上没有卡'
  }
  const c = instanceId ? cards.find((x) => x.id === instanceId) : cards.find((x) => x.module === moduleId)
  if (!c) throw new Error(`版面上没有「${titleOf(moduleId ?? instanceId ?? '') ?? instanceId ?? moduleId}」这张卡`)
  const text = excerptFor(c, cardDataApi.state).trim()
  if (!text) return `${c.label}：这张卡里没有可读的文字内容`
  return text.length > ACTION_READ_MAX ? `${text.slice(0, ACTION_READ_MAX)}…` : text
}

/**
 * 「AI 动手」（第十二笔）：流正常收尾时把动作行解析出来。剥掉动作行之后的正文才是
 * 给人看的；坏行也要留着 —— 界面说给用户听（与 `aiActions.ts` 的纪律 2 同源）。
 */
function attachActions(i: number): void {
  const t = turns.value[i]
  if (!t || t.role !== 'assistant' || !t.content) return
  const r = parseActions(t.content, {
    moduleIds: store.reg.map((m) => m.id),
    today: localDay(new Date()),
    // 多实例定点（第十八笔）：版面上每张 item 都是一张可定点的实例
    instances: store.doc.value.items.map((it) => ({ id: it.id, module: it.module ?? it.id })),
  })
  if (!r.actions.length && !r.bad.length) return
  turns.value[i] = { ...t, content: r.clean, actions: r.actions, badActions: r.bad, actionsState: 'pending' }
}

/** 提议块顶上一句话（按状态变；只有坏行时单独一句 —— 别写成"等你点头"） */
function actsHead(t: ChatTurn): string {
  if (!t.actions?.length) return '它想做点事，但这一版还照做不了：'
  if (t.actionsState === 'done') return '它想这么做 —— 已照做：'
  if (t.actionsState === 'dismissed') return '它想这么做 —— 已忽略：'
  return '它想这么做（等你点头）：'
}

/**
 * 「照做」：顺次执行（首败即停），全部走既有写入口 —— `store.add` 进版面历史、
 * `cardData` 的写进内容历史 ⇒ **Ctrl+Z 撤得掉**。往哪写在这里，"能不能做"在纯层。
 */
function runActs(i: number): void {
  const t = turns.value[i]
  if (!t?.actions?.length || t.actionsState !== 'pending') return
  const r = runActions(t.actions, (a) => {
    // 多实例定点（第十八笔）：instanceId 先解析成板上那个 item 的 (module, instance)，走既有
    // 写入口；找不到（板刚被改过）就如实报错 —— 不静默写去第一张
    const instId = 'instanceId' in a ? a.instanceId : undefined
    const inst = instId ? store.doc.value.items.find((it) => it.id === instId) : undefined
    if (instId && !inst) throw new Error(`它想定点写到「${instId}」，但版面上没有这张卡（可能刚被删了）`)
    const mId = inst ? inst.module ?? inst.id : undefined
    if (a.type === 'addCard') store.add(a.moduleId, 0, 0, a.variant)
    else if (a.type === 'todo.add') cardDataApi.addTodo(a.text, mId, instId)
    else if (a.type === 'ledger.add') cardDataApi.addLedger(a.date, a.cents, a.category, a.note ?? '', mId, instId)
    else if (a.type === 'sticky.append') {
      // 追加不覆盖（v1.1）—— 便签是用户的原文，AI 只往上添，不改写
      const cur = stickyOf(cardDataApi.state, mId, instId)
      writeSticky(cardDataApi.state, mId, instId, cur ? `${cur}\n${a.text}` : a.text)
    } else if (a.type === 'countdown.set') {
      writeCountdown(cardDataApi.state, mId, instId, { label: a.label, date: a.date })
    } else if (a.type === 'habit.check') {
      // 幂等：今天已打过就不重复加（days 是去重后的日历日清单）
      const h = habitOf(cardDataApi.state, mId, instId)
      writeHabit(cardDataApi.state, mId, instId, {
        name: h.name,
        days: [...new Set([...h.days, localDay(new Date())])].sort(),
      })
    } else if (a.type === 'memory.add') {
      // 拒收理由（空 / 超长 / 重复 / 满）当失败抛出 —— 首败即停会把原话带进结果
      const rejected = memory.add(a.text)
      if (rejected.length) throw new Error(rejected.join('；'))
    } else if (a.type === 'context.read') {
      // 读类（第十六笔）：只取不写 —— 产出随结果回喂给模型（第十八笔起可定点读第二实例）
      return readContext(a.moduleId, a.instanceId)
    }
  })
  const note = r.ok
    ? '做完了 —— Ctrl+Z 可以撤销'
    : r.done > 0
      ? `做了一半：第 ${r.done + 1} 个没做成（${r.error}）；前面 ${r.done} 个已经生效 —— Ctrl+Z 可以撤销`
      : `没做成：${r.error}`
  turns.value[i] = { ...t, actionsState: 'done', actionsNote: note }
  // v1.2（agent 循环）：把逐条结果回喂给模型，让它接着往下办 —— 用户点「照做」的语义
  // 就是"办吧"，办完不汇报等于让 agent 断在半路。**只续这一轮**：它再提议，还是要等
  // 下一次点头（循环由"确认"这件事自然限流，不是无限自动跑）。
  void runTurn(
    actionResultText(actionResultLines(t.actions, r, (a) => actionLabel(a, titleOf, instanceLabelOf))),
    t.usedChips ?? [],
    [],
  )
}

/** 「算了」：只是把提议标掉，不写任何东西 */
function skipActs(i: number): void {
  const t = turns.value[i]
  if (!t || t.actionsState !== 'pending') return
  turns.value[i] = { ...t, actionsState: 'dismissed' }
}

/** 收起态里直接回车：先把面板展开再发 —— 答案得让人看得见 */
function sendFromBar(): void {
  expand()
  void send()
}

/** 「摘要」可用条件：有引用卡片，或输入框里有字（与 `summaryText` 的空判定同源） */
const canSummarize = computed(() => chips.value.length > 0 || draft.value.trim().length > 0)

/**
 * 一次性摘要（F-12 三期）：走 `ai_summarize` 的 `plain` 档，没有 Channel。
 * 结果**不写历史**（只有 `ai_chat` 落盘）：气泡标「不保存」，刷新即消失。
 */
async function summarize(): Promise<void> {
  if (busy.value || !canSummarize.value) return
  if (missingProvider()) return
  const text = summaryText(chips.value, draft.value, excerptOf)
  if (!text) return
  const asked = draft.value.trim()
  turns.value = [
    ...turns.value,
    ...(asked ? [{ role: 'user' as const, content: asked, status: 'done' as const, error: null }] : []),
    { role: 'assistant' as const, content: '', status: 'streaming' as const, error: null, summary: true },
  ]
  draft.value = ''
  chips.value = []
  picker.value = []
  notice.value = ''
  busy.value = true
  const token = ++streamToken
  const idx = turns.value.length - 1
  scrollDown()

  try {
    const r = await invoke<{ summary: string }>('ai_summarize', {
      providerId: providerId.value,
      text,
      style: 'plain',
    })
    if (token !== streamToken) return
    turns.value[idx] = { ...turns.value[idx], content: r.summary, status: 'done' }
  } catch (err) {
    if (token !== streamToken) return
    turns.value[idx] = { ...turns.value[idx], status: 'error', error: String(err) }
  } finally {
    // 新对话/卸载会让 token 前移：那时这轮已作废，别再动 busy（它属于下一轮）
    if (token === streamToken) busy.value = false
  }
}

async function stop(): Promise<void> {
  const id = streamConv.value
  if (!id) return
  try {
    await invoke('ai_chat_cancel', { conversationId: id })
  } catch (err) {
    notice.value = String(err)
  }
}

function newConversation(): void {
  if (busy.value) void stop()
  streamToken++
  turns.value = []
  chips.value = []
  // 附件属于"这次对话"：新开一条就该清空（思考档位是偏好，留着）
  files.value = []
  conversationId.value = null
  streamConv.value = null
  busy.value = false
  notice.value = ''
  void nextTick(() => inputEl.value?.focus())
}




/** 删除两步：第一次点击只是「待确认」，第二次同一行才真删（与会议详情删稿同一手法） */



onBeforeUnmount(() => {
  // 组件被撤掉（切编辑/开设置）还在流式：**不自动取消** —— 用户只是打开了设置，
  // 回来时回答应该还在。迟到的帧由 token 挡住写入（组件已卸载，写进 ref 也无害）。
  streamToken++
})
</script>

<template>
  <div class="dock" :data-open="expanded ? '1' : '0'" :data-full="full ? '1' : '0'">
    <section v-if="expanded" class="panel" data-chat-panel aria-label="AI 对话">
      <header class="head">
        <span class="tag">AI</span>
        <select
          v-if="providers.length > 1"
          v-model="providerId"
          class="provider"
          data-chat-provider
          aria-label="模型服务"
        >
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.model || p.id }}</option>
        </select>
        <span v-else-if="providers.length === 1" class="provider-name" data-chat-provider-name>
          {{ providers[0].model || providers[0].id }}
        </span>
        <span class="grow" />
        <button class="link" data-chat-new title="开一段新对话" @click="newConversation">新对话</button>
        <button class="link" data-chat-collapse title="收起（Esc）" @click="collapse">收起</button>
      </header>

      <div ref="threadEl" class="thread" data-chat-thread>
        <p v-if="!turns.length" class="empty" data-chat-empty>
          问点什么。输入 <code>@</code> 可以引用版面里的卡片，答案会带上那张卡的内容。
        </p>
        <div
          v-for="(t, i) in turns"
          :key="i"
          class="msg"
          :data-role="t.role"
          :data-status="t.status"
          :data-kind="t.summary ? 'summary' : undefined"
        >
          <p v-if="t.role === 'user' && isActionResult(t.content)" class="tool-note" data-chat-tool-note>
            工具结果已回喂给模型（它接着往下办）
          </p>
          <p v-else class="bubble">
            <span v-if="t.summary" class="summary-tag" data-chat-summary-tag>摘要 · 不保存</span>
            <span v-if="t.content">{{ t.content }}</span>
            <span v-else-if="t.status === 'streaming'" class="muted">{{ t.summary ? '摘要中…' : '…' }}</span>
          </p>
          <p v-if="t.error" class="err" data-chat-error>{{ t.error }}</p>
          <div v-if="t.actions?.length || t.badActions?.length" class="acts" data-ai-acts>
            <p class="acts-head">{{ actsHead(t) }}</p>
            <ul v-if="t.actions?.length" class="acts-list">
              <li v-for="(a, k) in t.actions" :key="k" data-ai-act>{{ actionLabel(a, titleOf, instanceLabelOf) }}</li>
            </ul>
            <p v-if="t.badActions?.length" class="acts-bad" data-ai-act-bad>{{ t.badActions.join('；') }}</p>
            <div v-if="t.actionsState === 'pending' && t.actions?.length" class="acts-btns">
              <button type="button" class="acts-btn" data-ai-act-run @click="runActs(i)">照做</button>
              <button type="button" class="acts-btn acts-ghost" data-ai-act-skip @click="skipActs(i)">算了</button>
            </div>
            <p v-else-if="t.actionsState === 'done'" class="acts-note" data-ai-acts-note>{{ t.actionsNote }}</p>
          </div>
        </div>
      </div>


      <div v-if="chips.length" class="chips" data-chat-chips>
        <button
          v-for="c in chips"
          :key="c.id"
          class="chip"
          :data-chip="c.id"
          :title="`不再引用「${c.label}」`"
          @click="removeChip(c.id)"
        >
          @{{ c.label }} ×
        </button>
      </div>

      <!-- E3 附件：与卡片 chip 属于同一类（"这次对话能读到的内容"），所以挨着放；
           区别在文件正文不落历史（纪律 4），点一下即移除 -->
      <div v-if="files.length" class="files" data-chat-files>
        <button
          v-for="f in files"
          :key="f.name"
          class="file"
          :data-file="f.name"
          :title="`${attachmentLine(f)}（点一下从这次对话里移除）`"
          @click="removeFile(f.name)"
        >
          {{ f.name }} ×
        </button>
      </div>

      <!--
        composer 控件行（E2 起）：模型名 / 上下文用量 / 权限说明；E3 加思考档位、
        附件摘要与「＋文件」。上下文用量走 `contextUsage`（事前算法，与 contextBlock
        同源 —— 测试钉住两个数字对得上）；超预算时数字转红并**提前**说，而不是等
        拼完才截断。权限说明把"引用卡片"翻译成用户语言：本次可读 N 张卡、各 ≤400 字。
      -->
      <div class="controls" data-chat-controls>
        <span class="ctl model" data-chat-model :title="`当前模型服务：${providerModel}`">
          {{ providerModel }}
        </span>
        <label class="ctl think" :title="`思考等级：${thinkingHint}`">
          思考
          <select v-model="thinking" data-chat-thinking aria-label="思考等级">
            <option v-for="l in THINKING_LEVELS" :key="l.id" :value="l.id">{{ l.label }}</option>
          </select>
        </label>
        <span v-if="usage.cards" class="ctl ctx" :class="{ over: usage.over }" data-chat-ctx>
          上下文 {{ usage.used }}/{{ usage.max }}
        </span>
        <span v-if="permLine" class="ctl perm" data-chat-perm>{{ permLine }}</span>
        <span v-if="filesNote" class="ctl file-note" data-chat-files-note>{{ filesNote }}</span>
        <button
          class="ctl add"
          data-chat-attach
          :title="`带文本文件进来：最多 ${ATTACH_MAX_FILES} 个、单个 ${ATTACH_CHARS_MAX} 字`"
          @click="pickFiles"
        >
          ＋ 文件
        </button>
        <input
          ref="fileEl"
          type="file"
          multiple
          class="file-input"
          data-chat-file
          :accept="FILE_ACCEPT"
          @change="onFilesPicked"
        />
      </div>

      <div class="composer">
        <ul v-if="picker.length" class="picker" data-chat-picker>
          <li v-for="(c, i) in picker" :key="c.id">
            <button
              class="pick"
              :data-pick="c.id"
              :data-active="i === pickerIndex ? '1' : '0'"
              @click="choose(c)"
            >
              {{ c.label }}
            </button>
          </li>
        </ul>
        <textarea
          ref="inputEl"
          v-model="draft"
          data-chat-input
          rows="2"
          placeholder="问点什么…（Enter 发送，Shift+Enter 换行，@ 引用卡片）"
          @input="onInput"
          @keydown="onKey"
        />
        <template v-if="busy && streamConv">
          <button class="send stop" data-chat-stop @click="stop">停止</button>
        </template>
        <template v-else>
          <button
            class="send secondary"
            data-chat-summarize
            :disabled="busy || !canSummarize"
            title="把引用的卡片 / 这段文字总结成 3~5 句（不保存）"
            @click="summarize"
          >
            {{ busy ? '摘要中…' : '摘要' }}
          </button>
          <button class="send" data-chat-send :disabled="busy || !draft.trim()" @click="send">发送</button>
        </template>
      </div>

      <p v-if="notice" class="notice" data-chat-notice>
        {{ notice }}
        <button class="link" data-chat-goto-settings @click="openSettings">打开设置</button>
      </p>
    </section>

    <div v-else class="bar" data-chat-bar @click="expand">
      <span class="tag">AI</span>
      <input
        ref="miniEl"
        v-model="draft"
        class="mini"
        data-chat-mini
        placeholder="问我点什么…"
        aria-label="问 AI（回车展开并发送）"
        @focus="expand"
        @keydown.enter.prevent="sendFromBar"
      />
      <span class="kbd">Ctrl+J</span>
    </div>
  </div>
</template>

<style scoped>
.dock {
  position: relative;
  flex: none;
  /* 收起条与展开面板共用这 46px：展开时若把它撤掉，画布会在开合之间上下跳一下 */
  height: 46px;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 46px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 14%, transparent);
  cursor: text;
}
.bar:hover {
  border-color: var(--accent);
}
.tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.mini {
  flex: 1;
  border: 0;
  background: none;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.kbd {
  font-size: 11px;
  color: var(--text-3);
}
.panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 45vh;
  /* E1 全高模式（chat 视图）：面板从浮层变成撑满容器的一块 */
  .dock[data-full='1'] & {
    position: static;
    max-height: none;
    height: 100%;
    box-shadow: none;
    border-radius: var(--radius-lg);
  }
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--panel-bg, var(--bg-1, #fff));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  z-index: 30;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.provider,
.provider-name {
  font-size: 12px;
  color: var(--text-3);
}
.provider {
  padding: 2px var(--space-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
}
.thread {
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 92%;
}
.msg[data-role='user'] {
  align-self: flex-end;
}
.bubble {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 22%, transparent);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg[data-role='user'] .bubble {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.msg[data-status='error'] .bubble {
  border: 1px solid color-mix(in srgb, var(--c-red) 40%, transparent);
}
.err {
  margin: 0;
  font-size: 12px;
  color: var(--c-red);
}
/* 「AI 动手」的提议块（第十二笔）：一张小单据 —— 动作列表 + 照做/算了 */
.acts {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 14%, transparent);
  max-width: 100%;
}
.acts-head {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-3);
}
.acts-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-1);
}
.acts-bad {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--c-red);
}
.acts-btns {
  display: flex;
  gap: var(--space-2);
  margin-top: 6px;
}
.acts-btn {
  font: inherit;
  font-size: 13px;
  padding: 2px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.acts-btn:hover {
  border-color: var(--accent);
}
.acts-ghost {
  color: var(--text-3);
}
.acts-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
/* 「工具结果」回喂的合成消息（v1.2）：不是用户说的话，渲染成一条小注而不是气泡 */
.tool-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
  font-style: italic;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
.row .title {
  flex: 1;
  border: 0;
  background: none;
  color: var(--text-1);
  text-align: left;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.meta {
  font-size: 11px;
  color: var(--text-3);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3) 0;
}
.chip {
  padding: 2px var(--space-2);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.composer {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  /* E2 时这行没有左右内边距，药丸贴着面板边框、与上面的 chips / 下面的输入框都不齐；
     E3 控件变多后这处不齐特别显眼，补上 */
  padding: 0 var(--space-3);
}
.ctl {
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 7px;
  border-radius: var(--radius-pill, 999px);
  background: color-mix(in srgb, var(--border-soft) 18%, transparent);
  white-space: nowrap;
}
/* E3：label / button 形状的控件（思考档位、＋文件）要和 span 药丸长得一样 */
.ctl.think,
.ctl.add {
  border: 0;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}
.ctl.think {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ctl.think select {
  border: 0;
  padding: 0 1px;
  background: none;
  color: var(--accent);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  outline: none;
}
.ctl.think:hover,
.ctl.add:hover {
  color: var(--text-2);
}
.file-input {
  display: none;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3) 0;
}
/* 虚线边框：卡片 chip 是实线（长期引用），文件是一次对话里的材料，视觉上轻一档 */
.file {
  padding: 2px var(--space-2);
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 999px;
  background: none;
  color: var(--text-2);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.file:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.ctl.over {
  color: var(--c-red);
  font-weight: 600;
}
.composer textarea {
  flex: 1;
  resize: none;
  padding: 6px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
}
.send {
  padding: 6px var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.5;
  cursor: default;
}
.send.stop {
  background: none;
  color: var(--c-red);
  border-color: color-mix(in srgb, var(--c-red) 50%, transparent);
}
/* 三期：摘要是次要动作 —— 比「发送」轻一档，减少误点（误点 = 白花一次调用） */
.send.secondary {
  background: none;
  color: var(--text-2);
  border-color: var(--border-soft);
}
.summary-tag {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  color: var(--text-3);
}
.picker {
  position: absolute;
  left: var(--space-3);
  bottom: calc(100% + 2px);
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  min-width: 220px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--panel-bg, var(--bg-1, #fff));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  z-index: 2;
}
.pick {
  display: block;
  width: 100%;
  padding: 4px var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-1);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.pick[data-active='1'] {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
button.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
button.link.danger {
  color: var(--c-red);
}
.notice {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  font-size: 12px;
  color: var(--c-amber);
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: 11px;
}
</style>
