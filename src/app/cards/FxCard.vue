<script setup lang="ts">
/**
 * 汇率（open.er-api，免 key）：几种常用币对 USD 的牌价 + 一行换算。
 * 取数走 `useRemote`（首次渲染才查 / TTL 60 分钟 / 取不到保留上一份）；
 * 收窄响应与交叉汇率在引擎 `fx.ts`（真夹具单测）。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { FX_CURRENCIES, FX_URL, crossRate, currencyName, parseRates } from '@modulo/engine/fx'
import { RefreshCw } from 'lucide-vue-next'
import { useRemote } from '../../vue/useRemote'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()
const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }

const fx = useRemote(storage, {
  key: 'modulo.fx.v1',
  url: () => FX_URL,
  parse: parseRates,
  ttlMs: 60 * 60 * 1000,
})
onMounted(() => fx.ensureFresh())

const amount = ref('100')
const from = ref('USD')
const to = ref('CNY')

const codes = computed(() => Object.keys(fx.snapshot.value?.rates ?? {}).sort())
const converted = computed(() => {
  const s = fx.snapshot.value
  const n = Number(amount.value)
  if (!s || amount.value.trim() === '' || !Number.isFinite(n)) return null
  return crossRate(n, from.value, to.value, s.rates)
})

function rateOf(code: string): number | null {
  const s = fx.snapshot.value
  if (!s) return null
  return crossRate(1, 'USD', code, s.rates)
}
</script>

<template>
  <div class="card fx" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <span class="title">对美元</span>
        <button class="refresh" :class="{ spinning: fx.status.value === 'loading' }" title="立刻刷新汇率" aria-label="刷新汇率" @click="fx.refresh()">
          <RefreshCw :size="13" />
        </button>
      </div>
      <template v-if="fx.snapshot.value">
        <ul class="list">
          <li v-for="c in FX_CURRENCIES" :key="c.code">
            <span class="code">{{ c.code }}</span>
            <span class="name">{{ c.name }}</span>
            <span class="rate">{{ rateOf(c.code)?.toFixed(4) ?? '—' }}</span>
          </li>
        </ul>
        <div class="conv">
          <input v-model="amount" class="in num" inputmode="decimal" aria-label="金额" />
          <select v-model="from" aria-label="从">
            <option v-for="c in codes" :key="c" :value="c">{{ c }}</option>
          </select>
          <span class="arrow">→</span>
          <select v-model="to" aria-label="到">
            <option v-for="c in codes" :key="c" :value="c">{{ c }}</option>
          </select>
          <strong class="out">{{ converted === null ? '—' : converted.toFixed(4) }}</strong>
          <span class="outname">{{ currencyName(to) }}</span>
        </div>
        <p class="cap">
          上游数据：{{ fx.snapshot.value.updatedAt || '未标注' }}
          <template v-if="fx.status.value === 'error'"> · 上次没取到（{{ fx.message.value }}）</template>
        </p>
      </template>
      <p v-else-if="fx.status.value === 'loading'" class="hint">正在取汇率…</p>
      <p v-else class="hint">取不到汇率（{{ fx.message.value || '点右上角刷新' }}）</p>
    </div>
  </div>
</template>

<style scoped>
.fx .card-body {
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
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(1px, 0.6cqw, 4px);
}
.list li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: clamp(4px, 1.4cqw, 10px);
  align-items: baseline;
  min-width: 0;
}
.code {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-1);
  font-family: ui-monospace, monospace;
}
.name {
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rate {
  justify-self: end;
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.conv {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: clamp(3px, 1cqw, 8px);
  border-top: 1px solid var(--border-soft);
  padding-top: clamp(3px, 1cqw, 8px);
}
.conv .in {
  width: 4.5em;
  font-size: clamp(11px, 2.6cqw, 13px);
  padding: 1px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.conv select {
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 2px;
  color: var(--text-1);
}
.arrow {
  color: var(--text-3);
  font-size: clamp(11px, 2.4cqw, 12px);
}
.out {
  font-size: clamp(12px, 3cqw, 15px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.outname {
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
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
  line-height: 1.6;
}
</style>
