<script setup lang="ts">
/**
 * 连通性探测：常盯端点的延迟历史 + 迷你折线。
 *
 * 探测复用桌面壳的 `web_probe`（elapsedMs 即往返延迟，边界在 Rust `net.rs`），
 * 与网页监控卡同一套"网页版不能探"的诚实降级。**历史样本是机器采的、不进备份**
 * （仓里的口径：用户写的进备份、机器测的不进），存独立 key `modulo.probe.v1`，
 * 进卡先过引擎 `sanitizeSamples`。名单本身是用户写的，进 cardData。
 *
 * 节流：卡片可见时每 30 秒探一轮（PROBE_INTERVAL_MS），切走就停 ——
 * 探活不该在后台偷偷烧流量。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { PROBE_INTERVAL_MS, probeLevel, probeStats, pushSample, sanitizeSamples, type ProbeSample } from '@levango7/engine/probe'
import { linePoints, scaleSeries } from '@levango7/engine/chart'
import { Plus, RefreshCw, Trash2, Activity } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { isDesktop } from '../../vue/useShell'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const HISTORY_KEY = 'modulo.probe.v1'
/** 每个端点的样本窗口：url → 样本环。不是响应式持久态的一部分，手动触发渲染 */
const history = ref<Record<string, ProbeSample[]>>({})
const probing = ref(false)
const adding = ref(false)
const draftLabel = ref('')
const draftUrl = ref('')
let timer: number | null = null

function loadHistory(): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const out: Record<string, ProbeSample[]> = {}
    for (const p of cards.state.probes) out[p.url] = sanitizeSamples(parsed[p.url])
    history.value = out
  } catch {
    history.value = {}
  }
}
function saveHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch {
    /* 存不进去就不存 —— 历史是最好可以有、没有也能活的缓存 */
  }
}

interface Probe {
  url: string
  status: number | null
  elapsedMs: number
  error: string
}

async function probeAll(): Promise<void> {
  if (!isDesktop || probing.value || !cards.state.probes.length) return
  probing.value = true
  try {
    const at = Date.now()
    for (const p of cards.state.probes) {
      try {
        const r = await invoke<Probe>('web_probe', { url: p.url })
        const h = history.value[p.url] ?? []
        history.value[p.url] = pushSample(h, { at, ms: r.elapsedMs })
      } catch {
        const h = history.value[p.url] ?? []
        history.value[p.url] = pushSample(h, { at, ms: 0 }) // 探不到也算一次样本：界面要显示"不通"
      }
    }
    saveHistory()
  } finally {
    probing.value = false
  }
}

function add(): void {
  const url = draftUrl.value.trim()
  if (!url) return
  cards.addProbe(draftLabel.value, url)
  draftLabel.value = ''
  draftUrl.value = ''
  adding.value = false
  loadHistory()
  void probeAll()
}

const rows = computed(() =>
  cards.state.probes.map((p) => {
    const h = history.value[p.url] ?? []
    const s = probeStats(h)
    const fr = scaleSeries(h.map((x) => (x.ms > 0 ? x.ms : 0)))
    return { ...p, stats: s, level: probeLevel(s.latest), points: linePoints(fr.fracs) }
  }),
)

onMounted(() => {
  loadHistory()
  void probeAll()
  if (isDesktop) timer = window.setInterval(() => void probeAll(), PROBE_INTERVAL_MS)
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div class="card probe" :data-v="variant">
    <div class="card-body">
      <template v-if="adding">
        <input v-model="draftUrl" class="in" placeholder="https://example.com" aria-label="地址" @keydown.enter.prevent="add()" />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取主机名）" aria-label="名字" @keydown.enter.prevent="add()" />
        <div class="acts">
          <button class="primary" @click="add()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="rows.length">
        <div class="top">
          <span class="label">连通性 · {{ rows.length }} 个端点</span>
          <span class="ops">
            <button class="tbtn" title="现在探一轮" aria-label="立即探测" :disabled="probing" @click="probeAll()"><RefreshCw :size="11" :class="{ spin: probing }" /></button>
            <button class="tbtn" title="加一个端点" aria-label="加端点" @click="adding = true"><Plus :size="11" /></button>
          </span>
        </div>
        <ul class="list">
          <li v-for="r in rows" :key="r.id" :data-level="r.level">
            <div class="row1">
              <span class="nm" :title="r.url">{{ r.label }}</span>
              <span class="ms" :data-level="r.level">
                <template v-if="!isDesktop">—</template>
                <template v-else-if="r.stats.latest > 0">{{ r.stats.latest }}ms</template>
                <template v-else-if="r.stats.count">不通</template>
                <template v-else>待探</template>
              </span>
              <button v-if="variant === 'list'" class="del" :aria-label="`删除 ${r.label}`" @click="cards.removeProbe(r.id)"><Trash2 :size="10" /></button>
            </div>
            <svg v-if="r.stats.count > 1" class="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline :points="r.points" />
            </svg>
            <div class="meta">
              <span v-if="isDesktop && r.stats.okCount">均 {{ r.stats.avg }}ms · 最差 {{ r.stats.worst }}ms</span>
              <span v-else-if="!isDesktop">网页版不能探测（桌面壳可探）</span>
              <span v-else>第一轮采样中…</span>
            </div>
          </li>
        </ul>
      </template>

      <template v-else>
        <div class="top">
          <Activity class="ico" :size="15" />
          <button class="tbtn" title="加一个端点" aria-label="加端点" @click="adding = true"><Plus :size="11" /></button>
        </div>
        <p class="hint">加入常盯的端点，桌面壳每 30 秒探一轮延迟</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.probe .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 16px);
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
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.4cqw, 10px);
  max-block-size: 46cqh;
  overflow: auto;
}
.list li {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.nm {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ms {
  flex: none;
  font-size: clamp(11px, 2.1cqw, 12px);
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.ms[data-level='fast'] {
  color: var(--c-green);
}
.ms[data-level='slow'] {
  color: var(--c-amber);
}
.ms[data-level='down'] {
  color: var(--c-red);
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
.spark {
  width: 100%;
  height: clamp(14px, 4cqh, 26px);
}
.spark polyline {
  fill: none;
  stroke: color-mix(in srgb, var(--mod, var(--brand-500)) 60%, transparent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.meta {
  font-size: clamp(11px, 1.8cqw, 11px);
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
