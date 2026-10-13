<script setup lang="ts">
/**
 * 网页取数（声明式扩展，2026-10-13 批 3）
 *
 * 填一个 https URL + 一个取值路径，宿主把 JSON 抓回来、按路径取数、原样显示。
 * **零代码** —— 这是路线里"扩展系统"的第一层：能用声明式解决的，不让人写代码。
 *
 * 三条沿用仓里既有范式的决定：
 * 1. **边界复用**：URL 判据在引擎 `sanitizeEndpoints` → `watch.normalizeUrl`（只 https、
 *    拒私网/保留主机名、拒 userinfo），与 Rust `net.rs` 同源。本组件不做任何 URL 判断。
 * 2. **取到的数据不落备份**：机器采的不进备份（同 probe 卡的历史样本）—— 只活在内存里，
 *    关掉重开就重取。端点表（用户写的）在 cardData 里跟着备份走。
 * 3. **网页版如实降级**：先试原生 fetch（少数接口开着 CORS，如东财 push2），
 *    失败则明确说"网页版取不到，桌面壳可解决"，而不是静默显示空白。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { formatValue, isScalar, listOf, pickPath, REFRESH_PRESETS } from '@levango7/engine/http'
import { ArrowRight, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { isDesktop } from '../../vue/useShell'

const props = defineProps<{ variant: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!

/** 机器采的结果：**只在内存**（url → 结果）。不落盘、不进备份，理由见文件头。 */
interface Result {
  at: number
  ok: boolean
  status: number | null
  /** 已解析的 JSON（ok 时有效） */
  data?: unknown
  error?: string
}
const results = ref<Record<string, Result>>({})
/** 当前展示的端点（卡面下拉切换） */
const activeId = ref<string>('')
const fetching = ref(false)
const configuring = ref(false)
const adding = ref(false)
const draftLabel = ref('')
const draftUrl = ref('')
const addError = ref('')

const endpoints = computed(() => cards.state.endpoints)
const active = computed(() => endpoints.value.find((e) => e.id === activeId.value) ?? endpoints.value[0] ?? null)
const result = computed(() => (active.value ? results.value[active.value.url] : undefined))

/** 取值 → 显示。用 active 的 path/scale100：**路径是显示参数，不进结果缓存**（改路径立刻生效） */
const shaped = computed(() => {
  const v = result.value?.data
  if (v === undefined || !active.value) return { kind: 'none' as const }
  const picked = pickPath(v, active.value.path)
  if (isScalar(picked)) return { kind: 'scalar' as const, text: formatValue(picked, active.value.scale100) }
  if (Array.isArray(picked)) {
    const rows = listOf(picked, '', '', 8)
    if (rows.length) return { kind: 'list' as const, rows }
  }
  return { kind: 'shape' as const, text: formatValue(picked, active.value.scale100) }
})

function pickActive(): void {
  if (!activeId.value && endpoints.value[0]) activeId.value = endpoints.value[0].id
}

/** 一次取数：桌面壳走 Rust（net.rs 边界），网页版先试原生 fetch、失败给降级文案 */
async function fetchOne(url: string): Promise<Result> {
  const at = Date.now()
  if (isDesktop) {
    try {
      const r = await invoke<{ status: number | null; json: string; error: string; elapsedMs: number }>('fetch_json', { url })
      if (r.error) return { at, ok: false, status: r.status, error: r.error }
      return { at, ok: true, status: r.status, data: JSON.parse(r.json) as unknown }
    } catch (e) {
      return { at, ok: false, status: null, error: String(e) }
    }
  }
  // 网页版：原生 fetch 只在对方开了 CORS 时能过
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    const text = await res.text()
    try {
      return { at, ok: true, status: res.status, data: JSON.parse(text) as unknown }
    } catch {
      return { at, ok: false, status: res.status, error: '响应不是 JSON' }
    }
  } catch {
    return { at, ok: false, status: null, error: '网页版取不到（跨域被拦）：这张卡的数据源需要桌面壳' }
  }
}

async function refreshAll(): Promise<void> {
  if (fetching.value || !endpoints.value.length) return
  fetching.value = true
  try {
    const out: Record<string, Result> = { ...results.value }
    for (const e of endpoints.value) out[e.url] = await fetchOne(e.url)
    results.value = out
  } finally {
    fetching.value = false
  }
}

/** 刷新节奏：取所有端点里最短的那个档（各自刷新会变成一串定时器，不值当） */
const intervalMs = computed(() => {
  if (!endpoints.value.length) return 0
  return Math.min(...endpoints.value.map((e) => e.refreshSec)) * 1000
})
let timer: number | null = null
function armTimer(): void {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (intervalMs.value > 0) timer = window.setInterval(() => void refreshAll(), intervalMs.value)
}

const ageText = computed(() => {
  const r = result.value
  if (!r) return '还没取过'
  const s = Math.round((Date.now() - r.at) / 1000)
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  return `${Math.round(s / 60)} 分钟前`
})

function submitAdd(): void {
  addError.value = ''
  const ok = cards.addEndpoint(draftLabel.value, draftUrl.value)
  if (!ok) {
    addError.value = '这个地址不能收：只支持 https，且不能指向本机/内网（与网页监控同一套边界）'
    return
  }
  adding.value = false
  // 加完就回卡面（否则停在配置态、看不见刚加的数据源在取数）——配置面板是"改完即看"的地方
  configuring.value = false
  draftLabel.value = ''
  draftUrl.value = ''
  pickActive()
  void refreshAll()
}

onMounted(() => {
  pickActive()
  void refreshAll()
  armTimer()
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div class="wcard" :class="{ chromeless: props.chromeless }">
    <header class="whead">
      <select v-if="endpoints.length > 1" v-model="activeId" aria-label="选择数据源" @change="pickActive">
        <option v-for="e in endpoints" :key="e.id" :value="e.id">{{ e.label || e.url }}</option>
      </select>
      <span v-else class="wlabel">{{ active?.label || active?.url || '未配置数据源' }}</span>
      <span class="wacts">
        <button title="现在取一次" @click="refreshAll"><RefreshCw :size="12" :class="{ spin: fetching }" /></button>
        <button title="数据源设置" @click="configuring = !configuring"><Settings2 :size="12" /></button>
      </span>
    </header>

    <div v-if="configuring" class="wcfg">
      <div v-for="e in endpoints" :key="e.id" class="cfgrow">
        <input
          class="cfginput"
          :value="e.label"
          :placeholder="e.url"
          aria-label="显示名"
          @change="cards.tuneEndpoint(e.id, { label: ($event.target as HTMLInputElement).value })"
        />
        <input
          class="cfginput path"
          :value="e.path"
          placeholder="取值路径，如 data[0].price"
          aria-label="取值路径"
          @change="cards.tuneEndpoint(e.id, { path: ($event.target as HTMLInputElement).value })"
        />
        <select
          class="cfgsel"
          :value="String(e.refreshSec)"
          aria-label="刷新频率"
          @change="cards.tuneEndpoint(e.id, { refreshSec: Number(($event.target as HTMLSelectElement).value) })"
        >
          <option v-for="sec in REFRESH_PRESETS" :key="sec" :value="String(sec)">
            {{ sec < 60 ? `${sec} 秒` : sec < 3600 ? `${sec / 60} 分钟` : `${sec / 3600} 小时` }}
          </option>
        </select>
        <label class="cfg100" title="接口给的是「分」时打开：显示时除以 100">
          <input
            type="checkbox"
            :checked="e.scale100"
            @change="cards.tuneEndpoint(e.id, { scale100: ($event.target as HTMLInputElement).checked })"
          />
          分→元
        </label>
        <button class="cfgdel" title="删除数据源" @click="cards.removeEndpoint(e.id)"><Trash2 :size="11" /></button>
      </div>

      <div v-if="adding" class="addrow">
        <input v-model="draftLabel" class="cfginput" placeholder="显示名（可空）" aria-label="新数据源显示名" />
        <input v-model="draftUrl" class="cfginput url" placeholder="https://… 接口地址" aria-label="新数据源地址" />
        <button class="cfgok" @click="submitAdd">加</button>
        <button class="cfgdel" title="取消" @click="adding = false"><X :size="11" /></button>
      </div>
      <p v-if="addError" class="werr">{{ addError }}</p>
      <button v-else class="wadd" @click="adding = true"><Plus :size="11" /> 添加数据源</button>
    </div>

    <div v-else class="wbody">
      <p v-if="!endpoints.length" class="whint">还没配置数据源：点右上角 <Settings2 :size="11" /> 填一个 https 接口</p>
      <template v-else-if="result?.ok">
        <p v-if="shaped.kind === 'scalar'" class="wbig">{{ shaped.text }}</p>
        <ul v-else-if="shaped.kind === 'list'" class="wlist">
          <li v-for="(row, i) in shaped.rows" :key="i">
            <span class="witem">{{ row.label }}</span>
            <span class="wval">{{ row.value }}</span>
          </li>
        </ul>
        <p v-else class="whint">{{ shaped.kind === 'shape' ? `取到的是 ${shaped.text}` : '这个路径在响应里没找到值' }}</p>
      </template>
      <p v-else-if="result" class="werr">
        <ArrowRight :size="11" /> {{ result.error }}
      </p>
      <p v-else class="whint">正在取数…</p>
    </div>

    <footer v-if="endpoints.length" class="wfoot">
      <span>{{ result?.status ? `HTTP ${result.status}` : '—' }}</span>
      <span>{{ ageText }}</span>
    </footer>
  </div>
</template>

<style scoped>
.wcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.whead {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}
.wlabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.whead select {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  max-width: 60%;
}
.wacts {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}
.wacts button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
}
.wacts button:hover {
  color: var(--text-1);
  background: var(--bg-card-soft);
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.wbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--space-1) 0;
}
.wbig {
  margin: 0;
  font-size: clamp(22px, 9cqmin, 44px);
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}
.wlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wlist li {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: clamp(11px, 1.5cqw, 13px);
}
.witem {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wval {
  margin-left: auto;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  flex: none;
}
.whint,
.werr {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 3px;
}
.werr {
  color: var(--c-red);
  overflow: hidden;
}
.wfoot {
  flex: none;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-4);
  padding-top: 2px;
  border-top: 1px solid var(--border-soft);
}
.wcfg {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: var(--space-1) 0;
}
.cfgrow,
.addrow {
  display: flex;
  align-items: center;
  gap: 3px;
}
.cfginput {
  min-width: 0;
  flex: 1;
  font-size: 11px;
  padding: 1px 4px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.cfginput.path {
  flex: 1.4;
}
.cfginput.url {
  flex: 2;
}
.cfgsel {
  font: inherit;
  font-size: 10px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-2);
}
.cfg100 {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
}
.cfgdel,
.cfgok {
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-soft);
  background: var(--bg-card-soft);
  color: var(--text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 1px 5px;
  font-size: 11px;
}
.cfgdel:hover {
  color: var(--c-red);
}
.cfgok:hover {
  color: var(--text-1);
}
.wadd {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  border: 1px dashed var(--border-strong);
  background: transparent;
  color: var(--text-3);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.wadd:hover {
  color: var(--text-1);
}
</style>
