<script setup lang="ts">
/**
 * 网页监控：一份 https 名单，定期探活。
 *
 * ## 这一版的边界，写在文件头是因为它决定了这张卡能承诺什么
 *
 * 桌面壳会在**桌面侧**发请求（前端 `fetch` 会被 CORS 拦）。一旦有了这条能力，它就成了
 * SSRF 的入口 —— 尤其本应用的 CSP 正是它自己配的，而 CSP 拦不住走 Rust 侧的请求：
 * 页面一旦被 XSS 攻破，就能借这条通道探测内网，而那正是 CSP 唯一想防的事。
 *
 * 所以边界收在最小：**只允许 https**（明文一律拒绝）；**IP 字面量落在私有/保留网段就拒绝**
 * （`169.254.169.254` 云元数据端点拿到就等于拿到临时凭据、`127.x`、`10/8`、`172.16/12`、
 * `192.168/16`、`100.64/10`、`::1`、`fc00::/7`、`fe80::/10`，含 IPv4-mapped 绕法）；
 * **不跟随重定向**（3xx 原样报出，堵掉「公网 URL 302 到内网」）；**只有 URL**（无自定义
 * header、无方法、无请求体、不带 Cookie）。**DNS rebinding 不防** —— 靠域名绕开的挡不住，
 * 因为请求本来就是以用户身份发出的，本机任何进程都能做同样的事。
 *
 * **代价**：因此**监控不了自家 NAS / 路由器**。这是刻意的 —— 那是另一个特性、另一套边界。
 *
 * ## 一个必须说清的限制
 *
 * 卡上**不显示 HTTP 状态码**。本机 WinHTTP 层查响应头这条路是坏的
 * （`WinHttpQueryHeaders` 对各种 info level 一律返回 ERROR_WINHTTP_SECURE_FAILURE），
 * 所以只能回答「通不通、多久」，回答不了「是不是 404」。显示成具体数字会是编的。
 */
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { blockedReason, normalizeUrl } from '@modulo/engine/watch'
import { isDesktop } from '../../vue/useShell'
import { Activity, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

interface Probe {
  url: string
  status: number | null
  elapsedMs: number
  error: string
}

const list = computed(() => cards.state.watch)

/** url → 最近一次结果。请求是异步的，回来时用户可能已经换了别的条目，所以按 url 对号。 */
const results = ref<Record<string, Probe>>({})
const probingAll = ref(false)

const adding = ref(false)
const draftLabel = ref('')
const draftUrl = ref('')
const draftError = ref('')

const cleanUrl = computed(() => normalizeUrl(draftUrl.value))
/** 拒收原因要说人话：私网地址用户往往是"想监控自己 NAS"，得告诉他为什么不行 */
const draftWhy = computed(() => {
  if (!draftUrl.value.trim()) return ''
  const u = cleanUrl.value
  if (u) return ''
  const raw = draftUrl.value.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https:/i.test(raw)) return '只支持 https'
  try {
    // 引擎里不能用 `new URL`（它的 tsconfig 不放 DOM），这里也用正则保持一致
const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?\[?([^\]/?:#]*)\]?/i.exec(
  /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
)
const why = m ? blockedReason(m[1]) : null
if (why) return `不监控${why}的地址`
  } catch {
    /* 落到下面的通用文案 */
  }
  return '这不是一个能用的 https 地址'
})

function save(): void {
  const url = cleanUrl.value
  if (!url) return
  cards.addWatch(draftLabel.value, url)
  draftLabel.value = ''
  draftUrl.value = ''
  draftError.value = ''
  adding.value = false
}

async function probeOne(url: string): Promise<void> {
  if (!isDesktop) return
  try {
    const r = await invoke<Probe>('web_probe', { url })
    results.value = { ...results.value, [url]: r }
  } catch (e: unknown) {
    // 命令本身都调不动（不该发生）也要留下痕迹，不能让这一行永远空着像"还没探"
    results.value = {
      ...results.value,
      [url]: { url, status: null, elapsedMs: 0, error: e instanceof Error ? e.message : String(e) },
    }
  }
}

async function probeAll(): Promise<void> {
  if (!list.value.length || probingAll.value) return
  probingAll.value = true
  // 串行而不是 Promise.all：一次并发十几条请求打出去既不礼貌，也会让耗时数字互相干扰
  for (const w of list.value) await probeOne(w.url)
  probingAll.value = false
}


onMounted(() => void probeAll())

/** 自动刷新：只盯「有没有变」，间隔刻意给得很大 —— 这是探活不是轮询监控 */
const AUTO_MS = 5 * 60 * 1000
let timer = 0
onMounted(() => {
  timer = window.setInterval(() => void probeAll(), AUTO_MS)
})
onUnmounted(() => window.clearInterval(timer))

function verdict(p: Probe | undefined): { text: string; tone: string } {
  if (!p) return { text: '未探测', tone: 'idle' }
  if (p.error) return { text: p.error, tone: 'bad' }
  return { text: p.elapsedMs > 0 ? `${p.elapsedMs} ms` : '已连接', tone: 'ok' }
}
</script>

<template>
  <div class="card webmon" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">
          <Activity :size="11" /> 网页监控 · {{ list.length }}
          <template v-if="!isDesktop">（网页版不能探活）</template>
        </span>
        <div class="acts">
          <button v-if="isDesktop" class="add" title="重新探一遍" aria-label="重新探测" :disabled="probingAll" @click="probeAll()">
            <RefreshCw :size="12" :class="{ spin: probingAll }" />
          </button>
          <button class="add" title="加一条" aria-label="加一条监控" @click="adding = true"><Plus :size="12" /></button>
        </div>
      </div>

      <template v-if="adding">
        <input v-model="draftUrl" class="in" placeholder="https://example.com" aria-label="要监控的地址" @keydown.enter.prevent="save()" />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取主机名）" aria-label="名字" @keydown.enter.prevent="save()" />
        <p v-if="draftWhy" class="why">{{ draftWhy }}</p>
        <p v-else-if="cleanUrl" class="ok">将监控 {{ cleanUrl }}</p>
        <div class="acts">
          <button class="primary" :disabled="!cleanUrl" @click="save()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <p v-else-if="!list.length" class="empty">还没有监控项。点右上角加一条 —— 只支持 https，且不监控私有网段。</p>

      <ul v-else class="rows">
        <li v-for="w in list" :key="w.id" class="row">
          <span class="dot" :class="verdict(results[w.url]).tone" />
          <span class="name">{{ w.label }}</span>
          <span class="verdict" :class="verdict(results[w.url]).tone" :title="w.url">{{ verdict(results[w.url]).text }}</span>
          <button class="del" title="移除" aria-label="移除监控项" @click="cards.removeWatch(w.id)"><Trash2 :size="11" /></button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.webmon .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1cqw, 7px);
  padding: clamp(8px, 2.2cqw, 18px);
  overflow: hidden;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-2);
  min-width: 0;
}
.acts {
  display: flex;
  gap: 2px;
}
.add {
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.add:disabled {
  opacity: 0.4;
  cursor: default;
}
.add:hover,
.add:focus-visible {
  color: var(--text-1);
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.in {
  inline-size: 100%;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 3px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-1);
}
.why,
.ok,
.empty {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  line-height: 1.45;
}
.why {
  color: var(--text-2);
}
.ok {
  color: var(--text-3);
}
.empty {
  color: var(--text-3);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.dot {
  flex: none;
  inline-size: 6px;
  block-size: 6px;
  border-radius: 50%;
  background: var(--border-soft);
}
.dot.ok {
  background: var(--ok, #4a9);
}
.dot.bad {
  background: var(--bad, #c66);
}
.name {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-1);
}
.verdict {
  flex: none;
  max-inline-size: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}
.verdict.bad {
  color: var(--text-2);
}
.del {
  flex: none;
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover,
.del:focus-visible {
  color: var(--text-1);
}
.primary {
  font-size: clamp(11px, 2.4cqw, 12px);
}
</style>