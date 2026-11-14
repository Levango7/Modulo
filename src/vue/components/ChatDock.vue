<script setup lang="ts">
/**
 * 底部 AI 对话坞。两种形态同一个组件：
 * - **浮坞**（`view === 'workbench'`）：常驻页面正下方的一条输入条，聚焦或 `Ctrl+J`
 *   展开成浮在画布之上的面板，`Esc` 收起（F-12 二期）。
 * - **主轴**（`view === 'chat'`，`:full="true"`）：对话就是这一屏的主体，面板撑满内容列，
 *   右侧另有一块 `ArtifactPanel` 放版面（F-15 P0）。收起条与 Esc 在 full 下没有意义
 *   （左栏永远能切走），所以 App 传 `:expanded="true"` 并忽略 update 事件。
 *
 * 四条纪律：
 * 1. **判定全在 `aiChat.ts` / `aiActions.ts`**：流式三态、`@` 解析、引用块预算、历史气泡
 *    过滤、提议状态随时间线的映射 —— 这里只做 Channel / invoke / 焦点 / 滚动这些
 *    "必须活在组件里"的事。
 * 2. **不探测、不预加载**：provider 列表读的是启动时 hydrate 的 `ai-settings.v1` 镜像；
 *    发一条消息 = 一次 `ai_chat`。没配就当场提示并把入口指到「设置 → 实验室」。
 * 3. **历史由 Rust 单点落盘**：本组件只在流结束时刷新列表，不自己存一份。
 * 4. **附件不落历史**：文件正文只随这一轮请求发出去，历史里只留问答本身。
 *
 * 拆件（F-15 P0 §三.2）：时间线 / composer / 空态各自成组件（`ChatTimeline` /
 * `ChatComposer` / `ChatEmpty`）。这一层留的是**状态机本身** —— 发送、流式、token 作废、
 * 提议执行 —— 它仨互相咬合，拆成 composable 会在四份 ref 之间来回传，风险大于收益。
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
  applyEvent,
  applyToolEvent,
  settleToolSteps,
  normalizeEvent,
  toolRows,
  ATTACH_MAX_BYTES,
  addFiles,
  attachmentLine,
  buildMessages,
  contextUsage,
  cardChoices,
  excerptFor,
  filesSummary,
  filterChoices,
  fullContentFor,
  mentionQuery,
  permNote,
  stripMention,
  summaryText,
  turnsFromHistory,
  type CardChoice,
  type ChatTurn,
  type ToolState,
  type MountedFile,
  type PickedText,
} from '../aiChat'
import { docChoices, docExcerpt, excerptWithDocs } from '../knowledge'
import { skillChoices, excerptWithSkills, skillExcerpt } from '../skills'
import type { KnowledgeApi } from '../useKnowledge'
import type { MemoryApi } from '../useMemory'
import type { SkillsApi } from '../useSkills'
import {
  ACTION_READ_FULL_MAX,
  ACTION_READ_MAX,
  ACTION_SEARCH_MAX,
  ACTION_SEARCH_RADIUS,
  actionLabel,
  actionResultLines,
  actionResultText,
  actStepStatuses,
  isActionResult,
  parseActions,
  runActions,
  timelineRows,
  type ActStep,
} from '../aiActions'
import { localDay } from '../reminders'
import { habitOf, stickyOf, writeCountdown, writeHabit, writeSticky } from '../instanceData'
import ChatTimeline from './ChatTimeline.vue'
import ChatComposer from './ChatComposer.vue'
import ChatEmpty from './ChatEmpty.vue'

const props = defineProps<{ expanded: boolean; full?: boolean }>()
const emit = defineEmits<{ (e: 'update:expanded', v: boolean): void }>()

const storage = inject<StorageAdapter>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
const commandBus = inject<CommandBus>('commandBus')!
const sessions = inject<AiSessionsApi>('aiSessions')!
const knowledge = inject<KnowledgeApi>('knowledge')!
const memory = inject<MemoryApi>('memory')!
const skills = inject<SkillsApi>('skills')!

/**
 * 一轮对话。比 `ChatTurn` 多一样东西：**逐条执行状态**。
 *
 * 为什么加在本地类型上而不是 `aiChat.ts` 的 `ChatTurn` 里：① 契约 §三.4 划了"P0 不碰
 * aiChat.ts"（P1a 要往那儿加事件类型，同一个文件两人同时改必撞）；② 这是纯内存派生量，
 * 不落盘、不进历史，`turnsFromHistory` 也造不出来。
 *
 * 为什么不从 `actionsNote` 里正则抠"第 N 个没做成"：那是句人话，改一次文案就静默失效。
 * 状态的来源只能是执行那一刻的 `RunResult`（同一次 `runActions` 的返回值）。
 */
type Turn = ChatTurn & {
  actSteps?: ActStep[]
  /**
   * 结构化工具事件摊成的时间线状态（P1a）。**与 `actSteps` 各存一份**：
   * 一个来自「照做」的 `RunResult`，一个来自流里的 `toolStart`/`toolEnd`，
   * 合成一份就会出现"照做之后工具那几行被冲掉"。
   */
  tools?: ToolState
}

const draft = ref('')
const turns = ref<Turn[]>([])
const conversationId = sessions.activeId
/** 正在流式输出的那个会话 id —— 「停止」按的就是它 */
const streamConv = ref<string | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
/** 每次发送/新对话自增：上一轮的迟到帧按 token 丢弃，不会写进新会话 */
let streamToken = 0

const chips = ref<CardChoice[]>([])
const picker = ref<CardChoice[]>([])
const pickerIndex = ref(0)
/** 思考档位是**偏好**：换会话也留着（用户的说话习惯不该每条对话重设一遍） */
const thinking = ref('off')
/** 附件属于**这次对话**：新对话 / 切会话就清空（文件正文不进历史） */
const files = ref<MountedFile[]>([])

const miniEl = ref<HTMLInputElement | null>(null)
const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null)
const threadEl = ref<HTMLElement | null>(null)

/** provider 列表**每次发送时现读**（用户可能刚在设置里加了服务；读的是镜像，零 IO） */
const providers = computed(() => parseAiDoc(storage.get(AI_DOC_KEY)))
const providerId = ref('')
const providerModel = computed<string>(() => {
  const p = providers.value.find((x) => x.id === providerId.value) ?? providers.value[0]
  /* model 与 id 都可能为空（用户新建了服务但没填模型名）——兜到一句人话，界面不出现空白控件 */
  return p?.model || p?.id || '未配置模型'
})

/** 引用摘录的**唯一入口**：技能 → 资料 → 卡片三层薄壳叠成一个函数，四处的口径因此同源 */
const excerptOf = (c: CardChoice): string =>
  excerptWithSkills(
    skills.skills.value,
    excerptWithDocs(knowledge.docs.value, (x) => excerptFor(x, cardDataApi.state)),
  )(c)
const chipsDocs = computed(() => chips.value.filter((c) => c.module === 'knowledge').length)
const chipsSkills = computed(() => chips.value.filter((c) => c.module === 'skills').length)
const usage = computed(() => contextUsage(chips.value, excerptOf))
const permLine = computed(() =>
  permNote(chips.value.length - chipsDocs.value - chipsSkills.value, chipsDocs.value, chipsSkills.value),
)
const filesNote = computed(() => filesSummary(files.value))

/** 选中的 provider 掉了（被删）就回落到第一条，避免发出去必失败 */
watch(
  providers,
  (list) => {
    if (!list.some((p) => p.id === providerId.value)) providerId.value = list[0]?.id ?? ''
  },
  { immediate: true },
)

/** `@` 能引用的东西：资料 / 技能在前、版面卡片在后（三者同一形状，选择/删除/预算一条路） */
const choices = computed(() => [
  ...docChoices(knowledge.docs.value),
  ...skillChoices(skills.skills.value),
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
    if (v) return void nextTick(() => composerRef.value?.focus())
    picker.value = []
    miniEl.value?.blur()
  },
)
/** 栏里点了一条会话 ⇒ 把气泡换成那条的消息（system 不进界面），顺手展开 */
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

/** 新内容一来就贴底：流式时用户看的永远是最后一行 */
function scrollDown(): void {
  void nextTick(() => {
    if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
  })
}

function onInput(e: Event): void {
  const el = e.target as HTMLTextAreaElement
  draft.value = el.value
  const hit = mentionQuery(draft.value, el.selectionStart ?? draft.value.length)
  if (!hit) {
    picker.value = []
    return
  }
  pickerIndex.value = 0
  picker.value = filterChoices(choices.value, hit.query)
}

function choose(c: CardChoice): void {
  const caret = composerRef.value?.caret() ?? draft.value.length
  const hit = mentionQuery(draft.value, caret)
  if (hit) {
    const next = stripMention(draft.value, hit.start, caret)
    draft.value = next.text
    void nextTick(() => composerRef.value?.setCaret(next.caret))
  }
  if (!chips.value.some((x) => x.id === c.id)) chips.value = [...chips.value, c]
  picker.value = []
}

function removeChip(id: string): void {
  chips.value = chips.value.filter((c) => c.id !== id)
}

/**
 * 读选中的文件 → 交给 `addFiles` 合并。**读之前**先按体积拦一道（20MB 日志读进内存
 * 只为取前 8000 字不值当）。拒收理由逐条进 notice，成功挂上的不吭声 —— file chip 就是回执。
 */
async function onFilesPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
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
 * 续轮沿用产生那批动作的那一轮的引用快照（`usedChips` 存在助手占位上）。
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

  /**
   * 流的分发口。**这里只做分发，不做归并**：
   * 气泡状态交给 `applyEvent`、时间线状态交给 `applyToolEvent`（两个纯函数，各有单测），
   * 组件这层只剩"哪一帧归哪一半"。
   *
   * 收尾**只认 `done`**（契约 §2.2 的不变量）：`error` 只是"这条通道破了"，
   * 它后面一定还跟着 `done{reason:'error'}` —— 在那儿收尾，停止按钮与忙碌态才不会漏清。
   */
  const ch = new Channel<unknown>()
  ch.onmessage = (raw) => {
    if (token !== streamToken) return
    for (const ev of normalizeEvent(raw)) {
      const cur = turns.value[idx]
      if (ev.t === 'toolStart' || ev.t === 'toolEnd' || ev.t === 'round') {
        turns.value[idx] = { ...cur, tools: applyToolEvent(cur.tools, ev) }
        continue
      }
      turns.value[idx] = applyEvent(cur, ev)
      if (ev.t !== 'done') continue
      const t = turns.value[idx]
      // 还在 running 的行结掉：流结束了就没有"还在干活"这回事（`settleToolSteps` 的注释）
      turns.value[idx] = { ...t, tools: settleToolSteps(t.tools) }
      if (t.status !== 'error') attachActions(idx)
      busy.value = false
      streamConv.value = null
      void sessions.refresh()
    }
    scrollDown()
  }

  try {
    const messages = buildMessages(turns.value, usedChips, excerptOf, memory.entries.value)
    const r = await invoke<{ conversationId: string }>('ai_chat', {
      providerId: providerId.value,
      conversationId: conversationId.value,
      messages,
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
  const usedChips = chips.value.slice()
  const usedFiles = files.value.slice()
  draft.value = ''
  chips.value = []
  picker.value = []
  notice.value = ''
  await runTurn(text, usedChips, usedFiles)
}

/** 空态那条引子：**只填进输入框，不发送**（发出去就花了钱、也替用户把话说了） */
function pickIdea(text: string): void {
  draft.value = text
  void nextTick(() => composerRef.value?.focus())
}

/** 卡的中文名（提议列表里的人话）；查不到落回 id */
const titleOf = (id: string): string | undefined => store.reg.find((m) => m.id === id)?.title
/**
 * 动作人话的 id → 名字（第二十三笔起）：卡 / 资料 / 技能三类共用一条解析 ——
 * `actionLabel` 只收一个回调，谁的名字归谁管在这里分（卡名查不到落回 id）。
 */
const idLabel = (id: string): string | undefined =>
  titleOf(id) ?? knowledge.docs.value.find((d) => d.id === id)?.name ?? skills.skills.value.find((s) => s.id === id)?.name

/** 实例 id → 人话：定点动作的前缀里要让人看清是哪一张 */
const instanceLabelOf = (id: string): string => {
  const it = store.doc.value.items.find((x) => x.id === id)
  const title = it ? titleOf(it.module ?? it.id) : undefined
  return title ? `${title}（${id}）` : id
}

/** 找卡片段：关键词前后各留 `ACTION_SEARCH_RADIUS` 字，超出两端画省略号 */
function snippetAround(text: string, at: number, len: number): string {
  const from = Math.max(0, at - ACTION_SEARCH_RADIUS)
  const to = Math.min(text.length, at + len + ACTION_SEARCH_RADIUS)
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`
}

/** 一条可搜的东西（v1.7）：来源前缀 + 名字 + 全文 */
interface Searchable {
  /** 展示名（资料名 / 技能名 / 卡名） */
  label: string
  /** 来源前缀：「资料」/「技能」；卡片留空（卡名本身已经说明了） */
  source: string
  /** 全文 —— 匹配用 */
  text: string
}

/**
 * 按内容找东西（v1.6 找卡 → v1.7 找我的东西）：**卡片 / 资料 / 技能**三类一起搜，
 * 多个词**全部命中**才算（AND，大小写不敏感）；每条给「来源 + 名字 + 关键词前后一小段」。
 * 最多 `ACTION_SEARCH_MAX` 条，超了明说还有几条没列 —— 找东西是为了定位，不是读完。
 * **只读**：与读类其他分支一样不写任何东西。
 */
function searchMine(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const cards = cardChoices(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m)
  const all: Searchable[] = [
    ...knowledge.docs.value.map((d) => ({ label: d.name, source: '资料', text: d.text })),
    ...skills.skills.value.map((s) => ({ label: s.name, source: '技能', text: s.text })),
    ...cards.map((c) => ({ label: c.label, source: '', text: fullContentFor(c, cardDataApi.state) })),
  ]
  const hits: string[] = []
  for (const it of all) {
    const hay = it.text.toLowerCase()
    const name = it.label.toLowerCase()
    // 每个词都要出现（内容里或名字里，大小写不敏感）
    if (!words.every((w) => hay.includes(w) || name.includes(w))) continue
    // 片段锚点取最早出现的那个词（只在名字里对上时用说明句）
    let at = -1
    let len = 0
    for (const w of words) {
      const i = hay.indexOf(w)
      if (i >= 0 && (at < 0 || i < at)) {
        at = i
        len = w.length
      }
    }
    const snippet = at >= 0 ? snippetAround(it.text, at, len) : '（名字对得上，里面没有可读正文）'
    hits.push(`${it.source ? `${it.source}「${it.label}」` : it.label}：「${snippet}」`)
  }
  const shown = hits.slice(0, ACTION_SEARCH_MAX)
  if (hits.length > shown.length) shown.push(`（另有 ${hits.length - shown.length} 条也提到了，没列出来）`)
  return shown
}

/**
 * 读类动作的执行体（第十六笔起；第十八笔起可带 instanceId 定点读第二实例；
 * 第十九笔起可带 moduleIds 一次读一组、full 读全卡不截断；第二十笔起可带 query 按内容找东西；
 * 第二十三笔起可带 docId / skillId 单读一份资料 / 一条技能）：
 * **只取不写**，走与 `@卡片` 同一套读路径。
 * query = 按内容找东西（卡片 / 资料 / 技能，多词全部命中才算）；无 query / moduleId /
 * instanceId / moduleIds / docId / skillId = 版面清单（卡 / 资料 / 技能三类，各带 id）；
 * 有 moduleIds = 一组卡（一条结果消息逐张列出）；有 instanceId = 那一张实例的摘录；
 * 有 moduleId 无 instanceId = 那张卡第一实例的摘录；有 docId / skillId = 那份资料 / 那条技能
 * （资料走 `docExcerpt` 同口径、技能走 `skillExcerpt` 全文）。默认走 `excerptFor`（单条封顶
 * `ACTION_READ_MAX`）；`full` 走 `fullContentFor` / `ACTION_READ_FULL_MAX`（超长注明全文字数）。
 * 版面上没有那张卡 / 那份资料 / 那条技能 ⇒ 抛（首败即停会把它写进结果）。
 */
function readContext(a: {
  moduleId?: string
  instanceId?: string
  moduleIds?: string[]
  full?: boolean
  query?: string
  docId?: string
  skillId?: string
}): string {
  const cards = cardChoices(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m)
  // v1.7 按内容找东西：三类来源一起搜，与「读某一张」互斥，回喂一条
  if (a.query) return searchMine(a.query).join('\n') || `卡片、资料、技能里都没有写到「${a.query}」的`
  // v1.8 单读资料 / 技能：与读卡互斥（纯层已拦），id 是资料 / 技能自己的 id
  if (a.docId) {
    const d = knowledge.docs.value.find((x) => x.id === a.docId)
    if (!d) throw new Error(`版面上没有「${a.docId}」这份资料（可能刚被删了）`)
    const text = docExcerpt(d, a.full ? ACTION_READ_FULL_MAX : ACTION_READ_MAX).trim()
    return text || '这份资料里没有可读的文字内容'
  }
  if (a.skillId) {
    const s = skills.skills.value.find((x) => x.id === a.skillId)
    if (!s) throw new Error(`版面上没有「${a.skillId}」这条技能（可能刚被删了）`)
    const text = skillExcerpt(s).trim()
    if (!text) return '这条技能里没有可读的文字内容'
    return text.length > ACTION_READ_FULL_MAX ? `${text.slice(0, ACTION_READ_FULL_MAX)}…（全文共 ${text.length} 字）` : text
  }
  if (!a.moduleId && !a.instanceId && !a.moduleIds) {
    // v1.8 版面清单三类一起列：卡 / 资料 / 技能，各带 id（读资料用 docId、读技能用 skillId）
    const lines: string[] = []
    if (cards.length) lines.push(`卡：${cards.map((c) => `${c.label}（id ${c.id}）`).join('、')}`)
    const docs = knowledge.docs.value
    if (docs.length) lines.push(`资料：${docs.map((d) => `「${d.name}」（id ${d.id}）`).join('、')}`)
    const sk = skills.skills.value
    if (sk.length) lines.push(`技能：${sk.map((x) => `「${x.name}」（id ${x.id}）`).join('、')}`)
    return lines.length ? lines.join('\n') : '版面上没有卡，也没有资料和技能'
  }
  const cap = a.full ? ACTION_READ_FULL_MAX : ACTION_READ_MAX
  const readOne = (c: CardChoice): string => {
    const text = (a.full ? fullContentFor(c, cardDataApi.state) : excerptFor(c, cardDataApi.state)).trim()
    if (!text) return `${c.label}：这张卡里没有可读的文字内容`
    return text.length > cap ? `${text.slice(0, cap)}…（全卡共 ${text.length} 字）` : text
  }
  if (a.moduleIds) {
    return a.moduleIds
      .map((id) => {
        const c = cards.find((x) => x.module === id)
        if (!c) throw new Error(`版面上没有「${titleOf(id) ?? id}」这张卡`)
        return `${titleOf(id) ?? id}：${readOne(c)}`
      })
      .join('\n')
  }
  const c = a.instanceId ? cards.find((x) => x.id === a.instanceId) : cards.find((x) => x.module === a.moduleId)
  if (!c) throw new Error(`版面上没有「${titleOf(a.moduleId ?? a.instanceId ?? '') ?? a.instanceId ?? a.moduleId}」这张卡`)
  return readOne(c)
}

/** 流正常收尾时把动作行解析出来；剥掉动作行之后的正文才是给人看的（坏行也留着，界面要说） */
function attachActions(i: number): void {
  const t = turns.value[i]
  if (!t || t.role !== 'assistant' || !t.content) return
  const r = parseActions(t.content, {
    moduleIds: store.reg.map((m) => m.id),
    today: localDay(new Date()),
    instances: store.doc.value.items.map((it) => ({ id: it.id, module: it.module ?? it.id })),
    docIds: knowledge.docs.value.map((d) => d.id),
    skillIds: skills.skills.value.map((x) => x.id),
  })
  if (!r.actions.length && !r.bad.length) return
  turns.value[i] = { ...t, content: r.clean, actions: r.actions, badActions: r.bad, actionsState: 'pending' }
}

/** 提议块顶上一句话（按状态变；只有坏行时单独一句 —— 别写成"等你点头"） */
function actsHead(t: Turn): string {
  if (!t.actions?.length) {
    // 只有坏行 ⇒ 那句"这一版还照做不了"；**只有工具行 ⇒ 不写标题**（工具块自带轮次标题）
    return t.badActions?.length ? '它想做点事，但这一版还照做不了：' : ''
  }
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
    // 多实例定点：instanceId 先解析成板上那个 item 的 (module, instance)，找不到就如实报错
    const instId = 'instanceId' in a ? a.instanceId : undefined
    const inst = instId ? store.doc.value.items.find((it) => it.id === instId) : undefined
    if (instId && !inst) throw new Error(`它想定点写到「${instId}」，但版面上没有这张卡（可能刚被删了）`)
    const mId = inst ? inst.module ?? inst.id : undefined
    if (a.type === 'addCard') store.add(a.moduleId, 0, 0, a.variant)
    else if (a.type === 'todo.add') cardDataApi.addTodo(a.text, mId, instId)
    else if (a.type === 'ledger.add') cardDataApi.addLedger(a.date, a.cents, a.category, a.note ?? '', mId, instId)
    else if (a.type === 'sticky.append') {
      // 追加不覆盖：便签是用户的原文，AI 只往上添
      const cur = stickyOf(cardDataApi.state, mId, instId)
      writeSticky(cardDataApi.state, mId, instId, cur ? `${cur}\n${a.text}` : a.text)
    } else if (a.type === 'countdown.set') {
      writeCountdown(cardDataApi.state, mId, instId, { label: a.label, date: a.date })
    } else if (a.type === 'habit.check') {
      // 幂等：今天已打过就不重复加
      const h = habitOf(cardDataApi.state, mId, instId)
      writeHabit(cardDataApi.state, mId, instId, {
        name: h.name,
        days: [...new Set([...h.days, localDay(new Date())])].sort(),
      })
    } else if (a.type === 'memory.add') {
      const rejected = memory.add(a.text)
      if (rejected.length) throw new Error(rejected.join('；'))
    } else if (a.type === 'context.read') {
      return readContext(a)
    }
  })
  const note = r.ok
    ? '做完了 —— Ctrl+Z 可以撤销'
    : r.done > 0
      ? `做了一半：第 ${r.done + 1} 个没做成（${r.error}）；前面 ${r.done} 个已经生效 —— Ctrl+Z 可以撤销`
      : `没做成：${r.error}`
  turns.value[i] = { ...t, actionsState: 'done', actionsNote: note, actSteps: actStepStatuses(t.actions, r) }
  // v1.2（agent 循环）：把逐条结果回喂给模型，让它接着往下办。**只续这一轮** ——
  // 它再提议，还是要等下一次点头（循环由"确认"这件事自然限流）。
  void runTurn(
    actionResultText(actionResultLines(t.actions, r, (a) => actionLabel(a, idLabel, instanceLabelOf))),
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

/** 这一轮的时间线行。`following` = 它已经照做、而回喂那轮还在流式（末尾补一行「执行中」） */
function rowsOf(t: Turn, i: number): ReturnType<typeof timelineRows> {
  return timelineRows({
    labels: (t.actions ?? []).map((a) => actionLabel(a, idLabel, instanceLabelOf)),
    state: t.actionsState,
    steps: t.actSteps,
    following: busy.value && t.actionsState === 'done' && i === turns.value.length - 1,
  })
}

/** 收起态里直接回车：先把面板展开再发 —— 答案得让人看得见 */
function sendFromBar(): void {
  expand()
  void send()
}

/** 「摘要」可用条件：有引用卡片，或输入框里有字（与 `summaryText` 的空判定同源） */
const canSummarize = computed(() => chips.value.length > 0 || draft.value.trim().length > 0)

/** 一次性摘要：走 `ai_summarize` 的 `plain` 档，无 Channel。结果**不写历史** */
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
  void nextTick(() => composerRef.value?.focus())
}

onBeforeUnmount(() => {
  // 组件被撤掉（切视图/开设置）还在流式：**不自动取消** —— 用户只是打开了设置，
  // 回来时回答应该还在。迟到的帧由 token 挡住写入。
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
        <button v-if="!full" class="link" data-chat-collapse title="收起（Esc）" @click="collapse">收起</button>
      </header>

      <div ref="threadEl" class="thread" data-chat-thread>
        <ChatEmpty v-if="!turns.length" @pick="pickIdea" />
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
          <ChatTimeline
            v-if="t.actions?.length || t.badActions?.length || t.tools?.steps.length"
            :rows="rowsOf(t, i)"
            :tools="toolRows(t.tools)"
            :head="actsHead(t)"
            :bad-text="t.badActions?.join('；')"
            :state="t.actionsState"
            :note="t.actionsNote"
            @run="runActs(i)"
            @skip="skipActs(i)"
          />
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
      <!-- 附件与卡片 chip 同一类（"这次对话能读到的内容"）；区别在文件正文不落历史 -->
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

      <ChatComposer
        ref="composerRef"
        :draft="draft"
        :picker="picker"
        :picker-index="pickerIndex"
        :busy="busy"
        :streaming="streamConv"
        :thinking="thinking"
        :provider-model="providerModel"
        :usage="usage"
        :perm-line="permLine"
        :files-note="filesNote"
        :can-summarize="canSummarize"
        :notice="notice"
        @update:draft="draft = $event"
        @update:thinking="thinking = $event"
        @input="onInput"
        @keydown="onKey"
        @pick="choose"
        @hover="pickerIndex = $event"
        @files-picked="onFilesPicked"
        @send="send"
        @stop="stop"
        @summarize="summarize"
        @open-settings="openSettings"
      />
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
  /* 主轴形态（chat 视图）：面板从浮层变成撑满容器的一块，composer 因此贴底 */
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
/* 对话区吃掉剩下的高度并自己滚：composer 因此永远贴在面板底部（§1.3） */
.thread {
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
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
/* 「工具结果」回喂的合成消息：不是用户说的话，渲染成一条小注而不是气泡 */
.tool-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
  font-style: italic;
}
.chips,
.files {
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
.summary-tag {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  color: var(--text-3);
}
button.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
.muted {
  color: var(--text-3);
}
</style>
