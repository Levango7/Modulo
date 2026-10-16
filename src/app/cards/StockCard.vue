<script setup lang="ts">
/**
 * 股票行情卡：自选的指数/个股，现价与涨跌幅。
 *
 * 数据源是东财 push2 的 ulist 接口——**实测 CORS 全开 + UTF-8 + 价格给「分」的整数**，
 * 正好对上这个仓"记账不碰浮点"的口径（显示才除 100）。所以这张卡**纯前端**，
 * 网页版与桌面版行为一致。
 *
 * 行情是机器采的、不落备份（自选名单才是用户写的、进备份）。刷新 60 秒一轮，
 * 手动/增删会立刻查一轮。涨跌配色用 A 股口径（涨红跌绿）—— 国际惯例在这张卡上
 * 反而是错的。停牌字段是 "-" 字符串，解析时如实给 null，界面显示 "—"。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { Plus, RefreshCw, Trash2, TrendingUp } from 'lucide-vue-next'
import { formatChange, formatPrice, parseQuotes, quotesUrl, type StockQuote } from '@levango7/engine/stock'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const quotes = ref<StockQuote[]>([])
const loading = ref(false)
const fetchedAt = ref(0)
const adding = ref(false)
const draftLabel = ref('')
const draftCode = ref('')
const draftOk = computed(() => draftCode.value.trim().length > 0)


const watch = computed(() => cards.state.stocks)
const list = computed(() =>
  watch.value.map((s, i) => ({
    ...s,
    q: quotes.value[i],
    dir: !quotes.value[i] || quotes.value[i].changePctX100 == null ? null : quotes.value[i].changePctX100 > 0 ? 'up' : quotes.value[i].changePctX100 < 0 ? 'down' : 'flat',
  })),
)

async function refresh(): Promise<void> {
  if (!watch.value.length || loading.value) return
  loading.value = true
  try {
    const res = await fetch(quotesUrl(watch.value.map((s) => s.code)))
    const json: unknown = await res.json()
    quotes.value = parseQuotes(json, watch.value.length)
    fetchedAt.value = Date.now()
  } catch {
    quotes.value = [] // 取不到就如实清空，不拿上一次的行情冒充"现在的"
  } finally {
    loading.value = false
  }
}

function add(): void {
  const code = draftCode.value.trim()
  if (!code) return
  cards.addStock(draftLabel.value, code)
  draftLabel.value = ''
  draftCode.value = ''
  adding.value = false
  quotes.value = []
  void refresh()
}

onMounted(() => {
  void refresh()
  // 每分钟一轮：行情卡的价格意义全在"新鲜"，过期比没显示更糟
  const t = window.setInterval(() => void refresh(), 60_000)
  onBeforeUnmount(() => window.clearInterval(t))
})
</script>

<template>
  <div class="card stocks" :data-v="variant">
    <div class="card-body">
      <template v-if="adding">
        <input v-model="draftCode" class="in mono" placeholder="代码（600519 / sh000001 / sz300750）" aria-label="代码" @keydown.enter.prevent="add()" />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取代码）" aria-label="名字" @keydown.enter.prevent="add()" />
        <div class="acts">
          <button class="primary" :disabled="!draftOk" @click="add()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="list.length">
        <div class="top">
          <span class="label">自选行情 · {{ list.length }} 只</span>
          <span class="ops">
            <button class="tbtn" title="现在查一轮" aria-label="刷新行情" :disabled="loading" @click="refresh()"><RefreshCw :size="11" :class="{ spin: loading }" /></button>
            <button class="tbtn" title="加一只" aria-label="加自选" @click="adding = true"><Plus :size="11" /></button>
          </span>
        </div>
        <ul class="list">
          <li v-for="r in list" :key="r.id" :data-dir="r.dir">
            <span class="nm" :title="r.code.toUpperCase()">{{ r.label }}</span>
            <span class="pr mono">{{ r.q ? formatPrice(r.q.priceCents) : '—' }}</span>
            <span class="ch mono" :data-dir="r.dir">
              <template v-if="r.q && r.q.changePctX100 != null">{{ formatChange(r.q.changePctX100) }}</template>
              <template v-else>—</template>
            </span>
            <button v-if="variant === 'list'" class="del" :aria-label="`删除 ${r.label}`" @click="cards.removeStock(r.id)"><Trash2 :size="10" /></button>
          </li>
        </ul>
        <p class="cap">{{ fetchedAt ? '行情分钟级 · 东方财富数据' : '正在取行情…' }}</p>
      </template>

      <template v-else>
        <div class="top">
          <TrendingUp class="ico" :size="15" />
          <button class="tbtn" title="加一只" aria-label="加自选" @click="adding = true"><Plus :size="11" /></button>
        </div>
        <p class="hint">加几个指数或股票代码（如 sh000001、sz300750）</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stocks .card-body {
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
  gap: 1px;
  max-block-size: 44cqh;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: baseline;
  gap: clamp(4px, 1.2cqw, 10px);
  min-width: 0;
}
.list li[data-dir='up'] .pr {
  color: var(--c-red);
}
.nm {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pr {
  flex: none;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.ch {
  flex: none;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-3);
  min-width: 5.5em;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.ch[data-dir='up'] {
  color: var(--c-red);
}
.ch[data-dir='down'] {
  color: var(--c-green);
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
.cap,
.hint {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
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
