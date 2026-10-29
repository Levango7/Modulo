<script setup lang="ts">
/**
 * 底部 AI 对话坞（F-12 二期，设计稿 `docs/design/F-12-AI-WIRING.md` §11）。
 *
 * 形态照 cursor / codex / qoder / trae 那一类：**常驻页面正下方的一条输入条**，
 * 聚焦或 `Ctrl+J` 展开成浮在画布之上的面板（不挤压版面高度），`Esc` 收起。
 * 不做成卡片：注册表 55 种卡的尺寸契约、多实例、版面模板都会被牵动，而它本质是
 * "随时能叫出来的一层壳"，不是版面里的一块。
 *
 * 三条纪律：
 * 1. **判定全在 `aiChat.ts`**：流式三态、`@` 解析、引用块预算、历史气泡过滤 ——
 *    这里只做 Channel / invoke / 焦点 / 滚动这些"必须活在组件里"的事。
 * 2. **不探测、不预加载**：provider 列表读的是启动时 hydrate 的 `ai-settings.v1` 镜像；
 *    发一条消息 = 一次 `ai_chat`，不做"先探 N 个 provider 再发"。没配就当场提示，
 *    并把入口指到「设置 → 实验室」——这正是二期要消掉的那条死路。
 * 3. **历史由 Rust 单点落盘**：本组件只在流结束时刷新列表，不自己存一份 ——
 *    两份真相迟早对不上（一期 `ai-settings.v1` 的教训同理）。
 */
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import * as E from '@levango7/engine'
import type { CardDataApi } from '../cardData'
import type { CommandBus } from '../commandBus'
import type { LayoutStore, StorageAdapter } from '../store'
import { AI_DOC_KEY, parseAiDoc } from '../aiSettings'
import {
  applyChunk,
  buildMessages,
  cardChoices,
  excerptFor,
  filterChoices,
  historyWhen,
  mentionQuery,
  stripMention,
  turnsFromHistory,
  type CardChoice,
  type ChatChunk,
  type ChatTurn,
  type HistoryItem,
  type HistoryMsg,
} from '../aiChat'

const props = defineProps<{ expanded: boolean }>()
const emit = defineEmits<{ (e: 'update:expanded', v: boolean): void }>()

const storage = inject<StorageAdapter>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
const commandBus = inject<CommandBus>('commandBus')!

/** 输入草稿：收起态那条 input 与展开后的 textarea 共用同一份，聚焦就展开不丢字 */
const draft = ref('')
const turns = ref<ChatTurn[]>([])
/** 当前会话 id（Rust 生成的 conv-xxx）。新对话时清空，下一条消息由后端再生成 */
const conversationId = ref<string | null>(null)
/** 正在流式输出的那个会话 id —— 「停止」按的就是它 */
const streamConv = ref<string | null>(null)
const busy = ref(false)
const notice = ref<string | null>(null)
/** 每次发送/新对话自增：上一轮的迟到帧按 token 丢弃，不会写进新会话 */
let streamToken = 0

const chips = ref<CardChoice[]>([])
const picker = ref<CardChoice[]>([])
const pickerIndex = ref(0)

const historyOpen = ref(false)
const historyItems = ref<HistoryItem[]>([])
const historyError = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)
const confirmClear = ref(false)

const inputEl = ref<HTMLTextAreaElement | null>(null)
const miniEl = ref<HTMLInputElement | null>(null)
const threadEl = ref<HTMLElement | null>(null)

/**
 * provider 列表：**每次发送时现读**而不是挂载时缓存 —— 用户可能刚在设置里加了服务，
 * 坞是常驻组件，缓存会让"加完回来还是不能用"。读的是启动时 hydrate 的镜像，零 IO。
 */
const providers = computed(() => parseAiDoc(storage.get(AI_DOC_KEY)))
const providerId = ref('')

/** 选中的 provider 掉了（被删）就回落到第一条，避免发出去必失败 */
watch(
  providers,
  (list) => {
    if (!list.some((p) => p.id === providerId.value)) providerId.value = list[0]?.id ?? ''
  },
  { immediate: true },
)

/** 版面上有哪些卡可以引用（同模块多实例带序号，见 aiChat.cardChoices） */
const choices = computed(() =>
  cardChoices(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m),
)

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
    confirmClear.value = false
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

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || busy.value) return
  if (missingProvider()) return
  // 引用块用这一轮开始时的快照：发出去之后用户再删 chip，不改已发出的请求
  const usedChips = chips.value.slice()
  turns.value = [
    ...turns.value,
    { role: 'user', content: text, status: 'done', error: null },
    { role: 'assistant', content: '', status: 'streaming', error: null },
  ]
  draft.value = ''
  chips.value = []
  picker.value = []
  notice.value = ''
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
      busy.value = false
      streamConv.value = null
      if (historyOpen.value) void loadHistory()
    }
  }

  try {
    const messages = buildMessages(turns.value, usedChips, (c) => excerptFor(c, cardDataApi.state))
    const r = await invoke<{ conversationId: string }>('ai_chat', {
      providerId: providerId.value,
      conversationId: conversationId.value,
      messages,
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

/** 收起态里直接回车：先把面板展开再发 —— 答案得让人看得见 */
function sendFromBar(): void {
  expand()
  void send()
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
  conversationId.value = null
  streamConv.value = null
  busy.value = false
  notice.value = ''
  historyOpen.value = false
  void nextTick(() => inputEl.value?.focus())
}

async function loadHistory(): Promise<void> {
  historyError.value = null
  try {
    historyItems.value = await invoke<HistoryItem[]>('ai_history_list')
  } catch (err) {
    historyError.value = String(err)
  }
}

function toggleHistory(): void {
  historyOpen.value = !historyOpen.value
  confirmDelete.value = null
  confirmClear.value = false
  if (historyOpen.value) void loadHistory()
}

async function pickHistory(item: HistoryItem): Promise<void> {
  if (busy.value) return
  try {
    const d = await invoke<{ id: string; messages: HistoryMsg[] }>('ai_history_get', { id: item.id })
    turns.value = turnsFromHistory(d.messages)
    conversationId.value = d.id
    chips.value = []
    historyOpen.value = false
    scrollDown()
  } catch (err) {
    historyError.value = String(err)
  }
}

/** 删除两步：第一次点击只是「待确认」，第二次同一行才真删（与会议详情删稿同一手法） */
async function deleteHistory(item: HistoryItem): Promise<void> {
  if (confirmDelete.value !== item.id) {
    confirmDelete.value = item.id
    confirmClear.value = false
    return
  }
  confirmDelete.value = null
  try {
    await invoke('ai_history_delete', { id: item.id })
    if (conversationId.value === item.id) newConversation()
    await loadHistory()
  } catch (err) {
    historyError.value = String(err)
  }
}

async function clearHistory(): Promise<void> {
  if (!confirmClear.value) {
    confirmClear.value = true
    confirmDelete.value = null
    return
  }
  confirmClear.value = false
  try {
    await invoke('ai_history_clear')
    newConversation()
    await loadHistory()
  } catch (err) {
    historyError.value = String(err)
  }
}

const when = (sec: number): string => historyWhen(sec, Date.now())

onBeforeUnmount(() => {
  // 组件被撤掉（切编辑/开设置）还在流式：**不自动取消** —— 用户只是打开了设置，
  // 回来时回答应该还在。迟到的帧由 token 挡住写入（组件已卸载，写进 ref 也无害）。
  streamToken++
})
</script>

<template>
  <div class="dock" :data-open="expanded ? '1' : '0'">
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
        <button class="link" data-chat-history-toggle :data-active="historyOpen ? '1' : '0'" @click="toggleHistory">
          历史
        </button>
        <button class="link" data-chat-collapse title="收起（Esc）" @click="collapse">收起</button>
      </header>

      <div ref="threadEl" class="thread" data-chat-thread>
        <p v-if="!turns.length && !historyOpen" class="empty" data-chat-empty>
          问点什么。输入 <code>@</code> 可以引用版面里的卡片，答案会带上那张卡的内容。
        </p>
        <div v-for="(t, i) in turns" :key="i" class="msg" :data-role="t.role" :data-status="t.status">
          <p class="bubble">
            <span v-if="t.content">{{ t.content }}</span>
            <span v-else-if="t.status === 'streaming'" class="muted">…</span>
          </p>
          <p v-if="t.error" class="err" data-chat-error>{{ t.error }}</p>
        </div>
      </div>

      <div v-if="historyOpen" class="history" data-chat-history>
        <p v-if="historyError" class="err" data-chat-history-error>{{ historyError }}</p>
        <p v-if="!historyItems.length" class="muted small" data-chat-history-empty>还没有对话记录。</p>
        <ul v-else class="rows">
          <li v-for="h in historyItems" :key="h.id" class="row" :data-history="h.id">
            <button class="title" :title="h.title" @click="pickHistory(h)">{{ h.title }}</button>
            <span class="meta">{{ h.messageCount }} 条 · {{ when(h.updatedAt) }}</span>
            <button class="link danger" data-chat-history-delete @click="deleteHistory(h)">
              {{ confirmDelete === h.id ? '确定删除？' : '删除' }}
            </button>
          </li>
        </ul>
        <button v-if="historyItems.length" class="link danger" data-chat-history-clear @click="clearHistory">
          {{ confirmClear ? '确定清空全部？' : '清空全部' }}
        </button>
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
        <button v-if="busy" class="send stop" data-chat-stop @click="stop">停止</button>
        <button v-else class="send" data-chat-send :disabled="!draft.trim()" @click="send">发送</button>
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
.history {
  border-top: 1px solid var(--border-soft);
  max-height: 30vh;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
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
