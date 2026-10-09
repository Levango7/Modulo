<script setup lang="ts">
/**
 * HN 热榜（hacker-news，免 key，英文科技）：前 5 条标题 + 分数 + 评论数。
 * 这个数据源是"1 个列表 + 每条一次请求"，所以**一次刷新 = 1 + 5 个小请求**（卡上如实写）。
 * 桌面壳里点不开外链（`target="_blank"` 在 WebView 里没反应），所以标题只作文本、外链在网页版给。
 */
import { computed, inject, onMounted } from 'vue'
import { HN_TOP_URL, hnItemUrl, parseStory, parseTopIds, type HnStory } from '@levango7/engine/hn'
import { RefreshCw } from 'lucide-vue-next'
import { isDesktop } from '../../vue/useShell'
import { useRemote } from '../../vue/useRemote'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()

interface HnPayload {
  stories: HnStory[]
  fetchedAt: number
}

const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }

const hn = useRemote(storage, {
  key: 'modulo.hn.v1',
  url: () => HN_TOP_URL,
  ttlMs: 15 * 60 * 1000,
  parse: (payload, now) => {
    // 风扇收窄在引擎里（每条各自 parseStory），这里只把结果凑成一个快照
    const raw = payload as { stories?: unknown } | null
    if (!raw || !Array.isArray(raw.stories)) return null
    const stories = raw.stories.map(parseStory).filter((s): s is HnStory => s !== null)
    return stories.length ? { stories, fetchedAt: now } : null
  },
  fetchList: async () => {
    const res = await fetch(HN_TOP_URL, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`列表接口返回 ${res.status}`)
    const ids = parseTopIds(await res.json(), 5)
    if (!ids) throw new Error('热榜列表是空的')
    const items = await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(hnItemUrl(id), { headers: { Accept: 'application/json' } })
        return r.ok ? ((await r.json()) as unknown) : null
      }),
    )
    return { stories: items.filter((x) => x !== null) }
  },
})
onMounted(() => hn.ensureFresh())

const list = computed<HnStory[]>(() => (hn.snapshot.value as HnPayload | null)?.stories ?? [])
</script>

<template>
  <div class="card hn" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <span class="title">HN 热榜</span>
        <button class="refresh" :class="{ spinning: hn.status.value === 'loading' }" title="立刻刷新" aria-label="刷新热榜" @click="hn.refresh()">
          <RefreshCw :size="13" />
        </button>
      </div>
      <ol v-if="list.length" class="list">
        <li v-for="s in list" :key="s.id">
          <template v-if="isDesktop">
            <span class="t">{{ s.title }}</span>
          </template>
          <a v-else class="t" :href="s.url" target="_blank" rel="noreferrer">{{ s.title }}</a>
          <span class="meta">▲{{ s.score }} · {{ s.comments }}</span>
        </li>
      </ol>
      <p v-else-if="hn.status.value === 'loading'" class="hint">正在取热榜…</p>
      <p v-else class="hint">取不到（{{ hn.message.value || '点右上角刷新' }}）</p>
      <p class="cap">每次刷新 = 1 个列表 + 5 条详情 · {{ isDesktop ? '桌面壳里点不开外链' : '点标题去原站' }}</p>
    </div>
  </div>
</template>

<style scoped>
.hn .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.refresh {
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-2);
  cursor: pointer;
}
.refresh.spinning {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.list {
  list-style: decimal;
  margin: 0;
  padding-left: 1.3em;
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 0.8cqw, 6px);
}
.list li {
  font-size: clamp(11px, 2.4cqw, 12px);
  line-height: 1.45;
  color: var(--text-1);
  overflow-wrap: anywhere;
}
.list a {
  color: var(--text-1);
  text-decoration: none;
}
.list a:hover {
  color: var(--brand-600);
}
.meta {
  margin-left: 6px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
}
</style>
