<script setup lang="ts">
/**
 * 速记的「详情」半张卡：按 id 自取转写（`meeting_get`），摘要（`meeting_summarize`）
 * 与删除（`meeting_delete`）也自持在这里 —— 与 `MinutesHistory` 同一分工：
 * 两个半边各管各的 IPC，卡本体只做「列表 ↔ 详情」的路由。
 *
 * **摘要的口径（D-15）**：契约只给 `id`，Rust 取第一个 ready 的 provider；
 * **存过摘要的再调一次只会拿回存值**（后端短路），所以「已有摘要」时不再摆
 * 「重新生成」按钮 —— 摆一个不会重新生成的按钮是在骗点击。
 *
 * **删除是两步确认**（同列表那半）：详情里没有第二行可挪，武装态就是本条；
 * 换一场速记（id 变了）自动解除武装。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ArrowLeft, Check, Sparkles, Trash2 } from 'lucide-vue-next'
import { formatDuration } from '../minutesLive'
import { formatMeetingWhen, wordCountOf, type MeetingTranscript } from '../meetings'
import MinutesTranscript from './MinutesTranscript.vue'

const props = defineProps<{
  id: string
  /** 列表项带来的标题（Rust `title_of` 的口径），详情头沿用，不在前端重算一遍 */
  title: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** 摘要生成 / 删除成功后通知父卡：列表的徽标与条目要回读落盘值 */
  (e: 'changed'): void
}>()

const t = ref<MeetingTranscript | null>(null)
const loadError = ref('')
const loading = ref(false)
/** 摘要生成 / 删除进行中（两件事共用一条忙线：同一个详情里它们不该并发） */
const busy = ref(false)
const error = ref('')
const armed = ref(false)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    t.value = await invoke<MeetingTranscript>('meeting_get', { id: props.id })
  } catch (err) {
    loadError.value = String(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(
  () => props.id,
  () => {
    armed.value = false
    void load()
  },
)

/** 「现在」在挂载时取一次：详情停留期间跨天，标签错到返回列表才修正，可接受 */
const when = computed(() => (t.value ? formatMeetingWhen(t.value.createdAt, Date.now()) : ''))
const words = computed(() => (t.value ? wordCountOf(t.value) : 0))

async function onSummarize(): Promise<void> {
  if (!t.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await invoke<{ summary: string }>('meeting_summarize', { id: t.value.id })
    // 就地替换触发响应式；列表的「摘要」徽标走 changed → 父卡 reload 回读落盘值
    t.value = { ...t.value, summary: r.summary }
    emit('changed')
  } catch (err) {
    // 空转写 / 没配 provider 的原话都是给人看的，原样摆出
    error.value = String(err)
  } finally {
    busy.value = false
  }
}

async function onDel(): Promise<void> {
  if (!armed.value) {
    armed.value = true
    return
  }
  armed.value = false
  if (!t.value) return
  busy.value = true
  error.value = ''
  try {
    await invoke('meeting_delete', { id: t.value.id })
    emit('changed')
    emit('close')
  } catch (err) {
    error.value = String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mdetail">
    <div class="bar">
      <button class="back" @click="emit('close')"><ArrowLeft :size="12" />返回</button>
      <span class="t" :title="title">{{ title }}</span>
    </div>

    <p v-if="loadError" class="hint" data-tone="error">打开失败：{{ loadError }}</p>
    <p v-else-if="!t" class="hint">正在打开…</p>
    <template v-else>
      <p class="meta">
        <span v-if="when">{{ when }}</span>
        <span>{{ formatDuration(t.durationMs) }}</span>
        <span>{{ words }} 字</span>
        <span>{{ t.segments.length }} 句</span>
      </p>

      <div v-if="t.summary" class="summary">
        <span class="scap"><Sparkles :size="12" /> 摘要</span>
        <p>{{ t.summary }}</p>
      </div>
      <button v-else class="sbtn" :disabled="busy" @click="onSummarize">
        <Sparkles :size="12" />{{ busy ? '正在生成…' : '生成摘要' }}
      </button>
      <p v-if="error" class="hint" data-tone="error">{{ error }}</p>

      <MinutesTranscript :segments="t.segments" :active="false" idle-text="这场速记没有转写出内容（或全为空白）" />

      <button class="del" :data-armed="armed" :disabled="busy" @click="onDel">
        <Trash2 v-if="!armed" :size="12" />
        <Check v-else :size="12" />
        {{ armed ? '确认删除这场速记' : '删除' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.mdetail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-block-size: 0;
  flex: 1 1 auto;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.back {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 5px;
  background: transparent;
  border: none;
  color: var(--text-2);
  font-size: clamp(11px, 2.1cqw, 12px);
  cursor: pointer;
}
.back:hover,
.back:focus-visible {
  color: var(--text-1);
}
.t {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--brand-500) 8%, transparent);
}
.scap {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--brand-500);
}
.summary p {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-1);
  line-height: 1.55;
  overflow-wrap: anywhere;
  max-block-size: 24cqh;
  overflow: auto;
}
.sbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  align-self: flex-start;
  padding: 3px 8px;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-1);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sbtn:hover,
.sbtn:focus-visible {
  border-color: var(--brand-500);
}
.sbtn:disabled {
  opacity: 0.55;
  cursor: default;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint[data-tone='error'] {
  color: var(--c-red);
}
.del {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  padding: 2px 5px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: clamp(11px, 1.8cqw, 11px);
}
.del:hover,
.del:focus-visible {
  color: var(--c-red);
}
.del:disabled {
  opacity: 0.4;
  cursor: default;
}
.del[data-armed='true'] {
  color: var(--c-red);
  background: color-mix(in srgb, var(--c-red) 12%, transparent);
  border-radius: var(--radius-sm);
}
</style>
