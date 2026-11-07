<script setup lang="ts">
/**
 * 左栏（改天换地 PR-D）：**会话列表一级化** —— 会话不再藏在坞的历史面板里。
 *
 * 三段（自上而下）：
 * ① 模式：工作台 / 布局编辑（既有 view 切换的两条路，只是进了栏）；
 * ② 会话：AI 对话的清单（`useAiSessions`，与坞共用同一份状态）——
 *    点击切进去（坞把 turns 换成那条）、「新对话」开新的、每条两步删除；
 * ③ 用户区：本地模式的事实说明（没有账号，数据在这台机器上）。
 *
 * 纪律：栏只"选"不"发"——发消息仍只有坞一个入口；两步删除的第一次点击只标记
 * （与会议详情删稿、坞原历史面板同一手法）。
 */
import { inject, onMounted, ref } from 'vue'
import { FilePlus, MessageSquarePlus, Trash2 } from 'lucide-vue-next'
import type { AiSessionsApi } from '../useAiSessions'
import type { KnowledgeApi } from '../useKnowledge'
import { charsLabel } from '../aiChat'
import {
  docExcerpt,
  KNOWLEDGE_EXCERPT_MAX,
  KNOWLEDGE_FILE_MAX_BYTES,
  type PickedDoc,
} from '../knowledge'

const props = defineProps<{ view: 'workbench' | 'chat' | 'edit' }>()
const emit = defineEmits<{ (e: 'select-view', v: 'workbench' | 'chat' | 'edit'): void }>()

const sessions = inject<AiSessionsApi>('aiSessions')!
const knowledge = inject<KnowledgeApi>('knowledge')!

/**
 * 「资料」这一节（PR-F1）。三条与坞里那套保持一致：
 * - 导入前先按体积拦（读进内存之前拦，才真省内存）；
 * - 拒收理由**逐条**回给用户（一次选五个文件要知道哪个没进、为什么）；
 * - 删除两步、预览显示的是**喂给模型的同一段摘录**（不是全文的另一种样子）。
 */
const fileEl = ref<HTMLInputElement | null>(null)
const openDoc = ref<string | null>(null)
const docNotice = ref<string | null>(null)
const confirmDoc = ref<string | null>(null)
/** 与 composer 的「＋ 文件」同一份扩展名提示（收不收由 `addDocs` 判，扩展名能骗人） */
const DOC_ACCEPT =
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.xml,.html,.css,.js,.ts,.vue,.py,.rs,.go,.java,.sh'

function pickDoc(): void {
  fileEl.value?.click()
}

async function onPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清 value：同一个文件再选一次也要能触发 change
  input.value = ''
  const read: PickedDoc[] = []
  const rejected: string[] = []
  for (const f of files) {
    if (f.size > KNOWLEDGE_FILE_MAX_BYTES) {
      rejected.push(`${f.name} 超过 ${Math.round(KNOWLEDGE_FILE_MAX_BYTES / 1000)}KB，先别入库`)
      continue
    }
    try {
      read.push({ name: f.name, text: await f.text() })
    } catch {
      rejected.push(`${f.name} 读不出来（可能不是文本文件）`)
    }
  }
  const why = [...rejected, ...knowledge.add(read)]
  docNotice.value = why.length ? why.join('；') : null
}

function toggleDoc(id: string): void {
  openDoc.value = openDoc.value === id ? null : id
  confirmDoc.value = null
}

/** 两步移除（与会话行、会议详情删稿同一手法） */
function dropDoc(id: string): void {
  if (confirmDoc.value !== id) {
    confirmDoc.value = id
    return
  }
  confirmDoc.value = null
  if (openDoc.value === id) openDoc.value = null
  knowledge.remove(id)
}

/** 两步删除：第一次点只标记，第二次点同一行才真删（与坞原历史面板同一手法） */
const confirmId = ref<string | null>(null)

function pick(id: string): void {
  if (confirmId.value) confirmId.value = null
  void sessions.load(id)
}

async function remove(id: string): Promise<void> {
  if (confirmId.value !== id) {
    confirmId.value = id
    return
  }
  confirmId.value = null
  await sessions.remove(id)
}

function when(at: number): string {
  const d = Math.floor((Date.now() - at) / 60000)
  if (d < 1) return '刚刚'
  if (d < 60) return `${d} 分钟前`
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`
  return `${Math.floor(d / 1440)} 天前`
}

onMounted(() => void sessions.refresh())
</script>

<template>
  <aside class="rail" aria-label="会话栏">
    <nav class="modes" aria-label="视图">
      <button :data-active="view === 'chat'" data-mode="chat" title="和 AI 说话，让它来布置这一屏" @click="emit('select-view', 'chat')">
        聊天
      </button>
      <button :data-active="view === 'workbench'" data-mode="workbench" @click="emit('select-view', 'workbench')">
        工作台
      </button>
      <button :data-active="view === 'edit'" data-mode="edit" @click="emit('select-view', 'edit')">布局编辑</button>
    </nav>

    <div class="sessions" role="group" aria-label="AI 会话">
      <div class="sessions-head">
        <span class="label">会话</span>
        <button class="new" title="新对话" aria-label="新对话" data-new-chat @click="sessions.startNew()">
          <MessageSquarePlus :size="14" />
        </button>
      </div>
      <p v-if="sessions.error.value" class="err">{{ sessions.error.value }}</p>
      <p v-else-if="!sessions.items.value.length" class="empty">还没有会话。点右下角说第一句话，它就会出现在这里。</p>
      <ul v-else class="list">
        <li v-for="s in sessions.items.value" :key="s.id">
          <button class="item" :data-active="sessions.activeId.value === s.id" :data-session="s.id" @click="pick(s.id)">
            <span class="t">{{ s.title || '未命名对话' }}</span>
            <span class="m">{{ when(s.updatedAt) }} · {{ s.messageCount }} 条</span>
          </button>
          <button
            class="del"
            :title="confirmId === s.id ? '再点一次确认删除' : '删除会话'"
            :aria-label="`删除会话：${s.title || '未命名对话'}`"
            :data-confirm="confirmId === s.id"
            @click.stop="remove(s.id)"
          >
            <Trash2 :size="13" />
          </button>
        </li>
      </ul>
    </div>

    <!-- PR-F1：资料（本地文档 → 聊天里 @ 引用）。放会话下面：两者都是"这次要用什么" -->
    <div class="docs" role="group" aria-label="资料">
      <div class="sessions-head">
        <span class="label">资料</span>
        <button class="new" title="导入资料（文本文件）" aria-label="导入资料" data-add-doc @click="pickDoc">
          <FilePlus :size="14" />
        </button>
        <input
          ref="fileEl"
          type="file"
          multiple
          class="file-input"
          data-doc-file
          :accept="DOC_ACCEPT"
          @change="onPicked"
        />
      </div>
      <p v-if="docNotice" class="err" data-doc-notice>{{ docNotice }}</p>
      <p v-if="!knowledge.docs.value.length" class="empty">导入 Markdown / txt 等文本，聊天里用 @ 引用它。</p>
      <ul v-else class="doc-list">
        <li v-for="d in knowledge.docs.value" :key="d.id">
          <div class="doc-line">
            <button
              class="item"
              :data-doc="d.id"
              :data-open="openDoc === d.id"
              :title="`${d.name}`"
              @click="toggleDoc(d.id)"
            >
              <span class="t">{{ d.name }}</span>
              <span class="m">{{ charsLabel(d.chars) }}{{ d.truncated ? ' · 已截断' : '' }}</span>
            </button>
            <button
              class="del"
              :data-confirm="confirmDoc === d.id"
              :title="confirmDoc === d.id ? '再点一次确认移除' : '移除资料'"
              :aria-label="`移除资料：${d.name}`"
              @click.stop="dropDoc(d.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="openDoc === d.id" class="preview-wrap">
            <p class="preview-hint">喂给模型的就是这一段（摘录上限 {{ KNOWLEDGE_EXCERPT_MAX }} 字）</p>
            <pre class="preview" data-doc-preview>{{ docExcerpt(d) }}</pre>
          </div>
        </li>
      </ul>
    </div>

    <div class="user">
      <span class="name">本地模式</span>
      <span class="hint">数据在这台机器上</span>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  width: 224px;
  flex: 0 0 224px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.modes {
  display: flex;
  gap: 4px;
}
.modes button {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
}
.modes button[data-active='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
  color: var(--text-1);
  font-weight: 600;
}
.sessions {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sessions-head {
  display: flex;
  align-items: center;
}
.label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.new {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--radius-sm);
}
.new:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.list li {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
}
.item[data-active='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
}
.item .t {
  width: 100%;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item .m {
  font-size: 11px;
  color: var(--text-3);
}
.del {
  border: none;
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  opacity: 0;
}
.list li:hover .del,
.del[data-confirm='true'] {
  opacity: 1;
}
.del:hover {
  color: var(--c-red);
}
.del[data-confirm='true'] {
  color: var(--c-red);
  background: var(--bg-card-soft);
}
.err,
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}
.err {
  color: var(--c-red);
}
/* PR-F1 资料：与会话同一套行样式，只是清单自己滚动、预览就挂在行下面 */
.docs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 34vh;
  min-height: 0;
}
.doc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.doc-line {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.doc-line .item[data-open='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
}
.doc-line:hover .del,
.doc-line .del[data-confirm='true'] {
  opacity: 1;
}
.file-input {
  display: none;
}
.preview-wrap {
  padding: 2px 4px 6px;
}
.preview-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--text-3);
}
.preview {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
.user {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-soft);
}
.name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.hint {
  font-size: 11px;
  color: var(--text-3);
}
</style>
