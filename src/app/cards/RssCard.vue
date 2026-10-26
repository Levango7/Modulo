<script setup lang="ts">
/**
 * RSS 订阅卡：常读源的最新标题。
 *
 * 取数分两路（如实，不装）：
 * - **先试原生 fetch** —— 少数源开了 CORS，网页版也能读；
 * - 失败且在**桌面壳**里 → 走 Rust `fetch_text`（真实源实测全无 CORS 头，浏览器
 *   侧拦死；桌面壳的 WinHTTP 不受 CORS 限制，还按内容声明解 GBK/UTF-8）。
 * - 网页版且源没有 CORS → 如实标「此源网页版读不了（桌面壳可读）」，不摆假仪表盘。
 *
 * 名单是用户写的，进备份；抓到的条目是机器采的，存独立持久化键（不进备份）。
 * 桌面壳每 5 分钟一轮（PROBE_INTERVAL_MS），切走就停。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { Plus, RefreshCw, Rss, Trash2 } from 'lucide-vue-next'
import { parseFeed } from '@levango7/engine/rss'
import { invoke } from '@tauri-apps/api/core'
import type { CardDataApi } from '../../vue/cardData'
import { adoptLegacyKey, type StorageAdapter } from '../../vue/store'
import { isDesktop } from '../../vue/useShell'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!
/** 历史走存储适配器（桌面 = 文件镜像）：此前是裸 localStorage —— 不在镜像、不在备份、也不参与同步 */
const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }

const HISTORY_KEY = 'modulo.rss.v1'
const REFRESH_MS = 5 * 60_000

interface FeedResult {
  url: string
  summary: { title: string; items: { title: string; link: string; date: string }[] } | null
  note: string
}

const results = ref<Record<string, FeedResult>>({})
const loading = ref(false)
const adding = ref(false)
const draftLabel = ref('')
const draftUrl = ref('')
let timer: number | null = null

function loadHistory(): void {
  try {
    // 老版本写在裸 localStorage 里：镜像为空时一次性搬过来（见 store.ts 的 adoptLegacyKey）
    const raw = adoptLegacyKey(storage, (k) => localStorage.getItem(k), HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const out: Record<string, FeedResult> = {}
    for (const f of cards.state.feeds) {
      const r = parsed[f.url] as { summary?: FeedResult['summary']; note?: string } | undefined
      out[f.url] = r?.summary
        ? { url: f.url, summary: r.summary, note: '' }
        : { url: f.url, summary: null, note: r?.note ?? '' }
    }
    results.value = out
  } catch {
    results.value = {}
  }
}
function saveHistory(): void {
  try {
    const out: Record<string, { summary: FeedResult['summary']; note: string }> = {}
    for (const [url, r] of Object.entries(results.value)) out[url] = { summary: r.summary, note: r.note }
    storage.set(HISTORY_KEY, JSON.stringify(out))
  } catch {
    /* 存不进去就不存 —— 缓存是最好可以有、没有也能活的缓存 */
  }
}

/** 一份源的文本从哪来：先试原生 fetch（CORS 开着的源网页版也能读），桌面壳兜底走 Rust */
async function fetchOne(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } })
    if (res.ok) return await res.text()
  } catch {
    /* 原生 fetch 被拦（CORS/网络）—— 继续走桌面壳那一路 */
  }
  if (!isDesktop) return null
  const r = await invoke<{ status: number | null; text: string; error: string }>('fetch_text', { url })
  if (r.error) return null
  return r.text
}

async function refresh(): Promise<void> {
  if (loading.value || !cards.state.feeds.length) return
  loading.value = true
  const next: typeof results.value = {}
  for (const f of cards.state.feeds) {
    // eslint-disable-next-line no-await-in-loop -- 顺序取，别一次打 N 个并发请求
    const text = await fetchOne(f.url)
    const summary = text ? parseFeed(text) : null
    next[f.url] = summary
      ? { url: f.url, summary, note: '' }
      : { url: f.url, summary: null, note: text ? '解析不到条目（源格式不认）' : isDesktop ? '取不到（网络或源挂了）' : '此源网页版读不了（桌面壳可读）' }
  }
  results.value = next
  saveHistory()
  loading.value = false
}

function add(): void {
  const url = draftUrl.value.trim()
  if (!url) return
  cards.addFeed(draftLabel.value, url)
  draftLabel.value = ''
  draftUrl.value = ''
  adding.value = false
  loadHistory()
  void refresh()
}

const rows = computed(() =>
  cards.state.feeds.map((f) => {
    const r = results.value[f.url]
    return { ...f, summary: r?.summary ?? null, note: r?.note ?? '' }
  }),
)

onMounted(() => {
  loadHistory()
  void refresh()
  if (isDesktop) timer = window.setInterval(() => void refresh(), REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div class="card rss" :data-v="variant">
    <div class="card-body">
      <template v-if="adding">
        <input v-model="draftUrl" class="in mono" placeholder="https://example.com/feed.xml" aria-label="订阅地址" @keydown.enter.prevent="add()" />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取主机名）" aria-label="名字" @keydown.enter.prevent="add()" />
        <div class="acts">
          <button class="primary" @click="add()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="rows.length">
        <div class="top">
          <span class="label">订阅 · {{ rows.length }} 个源</span>
          <span class="ops">
            <button class="tbtn" title="现在抓一轮" aria-label="刷新订阅" :disabled="loading" @click="refresh()"><RefreshCw :size="11" :class="{ spin: loading }" /></button>
            <button class="tbtn" title="加一个源" aria-label="加订阅" @click="adding = true"><Plus :size="11" /></button>
          </span>
        </div>
        <div v-for="r in rows" :key="r.id" class="feed">
          <div class="fhead">
            <span class="fname" :title="r.url">{{ r.summary?.title || r.label }}</span>
            <button v-if="variant === 'list'" class="del" :aria-label="`删除 ${r.label}`" @click="cards.removeFeed(r.id)"><Trash2 :size="10" /></button>
          </div>
          <ul v-if="r.summary" class="items">
            <li v-for="(it, i) in r.summary.items" :key="i">
              <a v-if="it.link" class="tl" :href="it.link" :title="it.title" rel="noopener noreferrer">{{ it.title }}</a>
              <span v-else class="tl">{{ it.title }}</span>
              <span class="dt">{{ it.date }}</span>
            </li>
          </ul>
          <p v-else class="note">{{ r.note }}</p>
        </div>
      </template>

      <template v-else>
        <div class="top">
          <Rss class="ico" :size="15" />
          <button class="tbtn" title="加一个源" aria-label="加订阅" @click="adding = true"><Plus :size="11" /></button>
        </div>
        <p class="hint">加入常读的 RSS/Atom 源，取最新标题（桌面壳每 5 分钟一轮）</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.rss .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
  max-block-size: 100%;
  overflow: auto;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-2);
}
.ico {
  color: var(--mod, var(--brand-500));
}
.ops {
  display: inline-flex;
  gap: 2px;
}
.tbtn {
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
.feed {
  min-width: 0;
  border-top: 1px solid color-mix(in srgb, var(--border-strong) 45%, transparent);
  padding-top: 2px;
}
.feed:first-of-type {
  border-top: none;
}
.fhead {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fname {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.1cqw, 12px);
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.del {
  flex: none;
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover {
  color: var(--text-1);
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-block-size: 40cqh;
  overflow: auto;
}
.items li {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.tl {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2cqw, 12px);
  color: var(--text-1);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
a.tl:hover,
a.tl:focus-visible {
  text-decoration: underline;
  color: var(--mod, var(--brand-500));
}
.dt {
  flex: none;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-4);
  font-variant-numeric: tabular-nums;
}
.note {
  margin: 0;
  font-size: clamp(11px, 1.9cqw, 11px);
  color: var(--text-3);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.mono {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
.acts {
  display: flex;
  gap: var(--space-2);
}
.acts button {
  font-size: clamp(11px, 2.2cqw, 12px);
  padding: 1px 8px;
}
.acts .primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
</style>
