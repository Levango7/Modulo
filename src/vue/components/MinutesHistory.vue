<script setup lang="ts">
/**
 * 速记卡的「历史」区：`meeting_list` 的读取、刷新、删除都自持在这里。
 *
 * 分工：列表数据与删除 IPC 归本组件（挂载即读、父卡在合适的时机调 `reload()`），
 * 「打开详情」上抛给卡本体 —— 卡里已经有录音那半的胶水，这半再多一层中间人只会
 * 让两边的 ref 互相追赶。分组/截断这些判定走 `src/vue/meetings.ts` 的纯函数（有单测）。
 *
 * **删除是两步确认**：第一下只武装（按钮变成「确认删除」），第二下才真发 IPC。
 * 武装态一次只挂一行，点到别的行就挪过去；那一行被删掉后武装态自动解除 ——
 * 这是删除会议记录（不可恢复、没有回收站）在一张小卡里能做的最短防线。
 *
 * **每行一枚导出键**（2026-10-28）：列表里的标题就是会议名，想带走一场不用先进详情。
 * 导出 = `meeting_get` 取数 → `meetingExport.ts` 的纯函数算文本与文件名 → `downloadText`
 * （与备份导出同一条 Blob 链）。失败共用这条的 `error`，不另摆第二个错误位。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { Check, Download, History, RefreshCw, Sparkles, Trash2 } from 'lucide-vue-next'
import { capMeetings, formatMeetingWhen, groupMeetings, type MeetingItem, type MeetingTranscript } from '../meetings'
import { buildMeetingExport } from '../meetingExport'
import { formatDuration } from '../minutesLive'
import { downloadText } from '../fileIo'
import { isDesktop } from '../useShell'

const emit = defineEmits<{
  (e: 'open', m: MeetingItem): void
}>()

const items = ref<MeetingItem[]>([])
const loading = ref(false)
const error = ref('')
const armed = ref<string | null>(null)
/** 正在删除的那一条；非 null 时其余行的删除键一并禁用（防连点开出两个删除） */
const deletingId = ref<string | null>(null)
/** 正在导出的那一条；同 deletingId 的道理：导出要先取数，连点开两份下载没有意义 */
const exportingId = ref<string | null>(null)

/** 「现在」跟着列表数据走：凌晨跨天时旧标签不会一直错到重开应用 */
const now = ref(Date.now())
watch(items, () => {
  now.value = Date.now()
  if (armed.value && !items.value.some((m) => m.id === armed.value)) armed.value = null
})

const page = computed(() => capMeetings(items.value))
const groups = computed(() => groupMeetings(page.value.items, now.value))

/** 挂载即读一次；父卡在「停一场录制 / 改了摘要」之后调 `reload()` 回读落盘值 */
async function reload(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    // 桩/异常路径可能回 null：列表当空处理，别让模板里的遍历炸掉
    items.value = (await invoke<MeetingItem[]>('meeting_list')) ?? []
  } catch (err) {
    error.value = String(err)
  } finally {
    loading.value = false
  }
}
defineExpose({ reload })

async function onDel(m: MeetingItem): Promise<void> {
  if (armed.value !== m.id) {
    armed.value = m.id
    return
  }
  armed.value = null
  deletingId.value = m.id
  try {
    // 后端幂等（不存在也算成功）：这里只管如实转发
    await invoke('meeting_delete', { id: m.id })
  } catch (err) {
    error.value = String(err)
    return
  } finally {
    deletingId.value = null
  }
  await reload()
}

/** 导出一场：取数与下载之间的判定全在纯函数里，这里只排顺序与兜错 */
async function onExport(m: MeetingItem): Promise<void> {
  if (exportingId.value !== null) return
  exportingId.value = m.id
  error.value = ''
  try {
    const t = await invoke<MeetingTranscript>('meeting_get', { id: m.id })
    const e = buildMeetingExport(t, m.title, Date.now())
    downloadText(e.filename, e.text, 'text/plain;charset=utf-8')
  } catch (err) {
    error.value = String(err)
  } finally {
    exportingId.value = null
  }
}
onMounted(() => {
  // 网页版没有历史可读（整块只在桌面壳渲染），别在网页上发起会议 IPC
  if (isDesktop) void reload()
})
</script>

<template>
  <div class="mhist">
    <div class="bar">
      <span class="cap"><History :size="12" /> 历史速记</span>
      <button class="tbtn" :disabled="loading" title="重新读取" aria-label="重新读取历史速记" @click="reload()">
        <RefreshCw :size="12" :class="{ spin: loading }" />
      </button>
    </div>

    <p v-if="error" class="hint" data-tone="error">读历史失败：{{ error }}</p>
    <p v-else-if="loading && !items.length" class="hint">正在读取…</p>
    <p v-else-if="!items.length" class="hint">还没有落盘的速记；停止一场录制后它会出现在这里</p>
    <template v-else>
      <div v-for="g in groups" :key="g.label" class="grp">
        <span class="gl">{{ g.label }}</span>
        <ul>
          <li v-for="m in g.items" :key="m.id">
            <button class="mi" :title="m.title" @click="emit('open', m)">
              <span class="t">{{ m.title }}</span>
              <span class="meta">
                <span v-if="m.hasSummary" class="badge"><Sparkles :size="10" /> 摘要</span>
                <span class="dur">{{ formatDuration(m.durationMs) }}</span>
                <span v-if="formatMeetingWhen(m.createdAt, now)" class="at">{{ formatMeetingWhen(m.createdAt, now) }}</span>
              </span>
            </button>
            <button
              class="exp"
              :disabled="deletingId !== null || exportingId !== null"
              :aria-label="`导出转写：${m.title}`"
              title="导出这场转写为文本"
              @click="onExport(m)"
            >
              <Download v-if="exportingId !== m.id" :size="12" />
              <RefreshCw v-else :size="12" class="spin" />
            </button>
            <button
              class="del"
              :data-armed="armed === m.id"
              :disabled="deletingId !== null || exportingId === m.id"
              :aria-label="armed === m.id ? `确认删除：${m.title}` : `删除：${m.title}`"
              @click="onDel(m)"
            >
              <Trash2 v-if="armed !== m.id" :size="12" />
              <Check v-else :size="12" />
              {{ armed === m.id ? '确认删除' : '' }}
            </button>
          </li>
        </ul>
      </div>
      <p v-if="page.hidden > 0" class="hint">已显示最近 {{ page.items.length }} 场，更早的 {{ page.hidden }} 场未列出</p>
    </template>
  </div>
</template>

<style scoped>
.mhist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.cap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-2);
}
.tbtn {
  flex: none;
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.tbtn:hover,
.tbtn:focus-visible {
  color: var(--text-1);
}
.tbtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.grp {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gl {
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-3);
}
.grp ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-block-size: 34cqh;
  overflow: auto;
}
.grp li {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.mi {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  padding: 2px 5px;
  text-align: start;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
}
.mi:hover,
.mi:focus-visible {
  border-color: var(--border-soft);
}
.t {
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
  gap: 6px;
  min-width: 0;
}
.badge,
.dur,
.at {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.badge {
  color: var(--brand-500);
}
.at {
  margin-inline-start: auto;
}
.exp {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 2px 4px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.exp:hover,
.exp:focus-visible {
  color: var(--text-1);
}
.exp:disabled {
  opacity: 0.4;
  cursor: default;
}
.del {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
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
.hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint[data-tone='error'] {
  color: var(--c-red);
}
</style>
