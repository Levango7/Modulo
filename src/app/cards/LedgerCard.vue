<script setup lang="ts">
/**
 * 记账：本月花了多少、按类怎么分。
 *
 * **金额全程是「分」的整数**（引擎 `ledger.ts` 的口径），这条卡一处都不碰小数 ——
 * 显示时才除以 100。求和、比较、百分比都在整数域里做完。
 *
 * 用户写的每一条都进 `cardData.ledger`（跟着完整备份走）；币种符号是一个偏好，但也跟着走 ——
 * 换机器时不必再问一次"这里的钱是哪种"。
 */
import { computed, inject, ref } from 'vue'
import { categoryTotals, dailyTotals, formatMoney, formatMoneyShort, LEDGER_CATEGORIES, monthSummary, parseAmount } from '@levango7/engine/ledger'
import { ChevronRight, Plus, Trash2, Wallet } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
// 月份可以翻：只显示"本月"的话，月底想回头看上个月就得等
const monthOffset = ref(0)

/** `monthOffset` 是"往回推几个月"，`-1` = 上个月 */
const cursor = computed(() => new Date(now.value.getFullYear(), now.value.getMonth() + monthOffset.value, 1))
const sum = computed(() => monthSummary(cards.state.ledger.entries, cursor.value))
const totals = computed(() => categoryTotals(sum.value.entries))
const maxTotal = computed(() => totals.value.reduce((m, t) => Math.max(m, t.cents), 0))
const trend = computed(() => (props.variant === 'panel' ? dailyTotals(cards.state.ledger.entries, cursor.value, 14) : []))
const trendMax = computed(() => trend.value.reduce((m, d) => Math.max(m, d.cents), 0))

const adding = ref(false)
const draftAmount = ref('')
const draftNote = ref('')
const draftCat = ref<string>(LEDGER_CATEGORIES[0])
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function save(): void {
  const cents = parseAmount(draftAmount.value)
  // 金额敲不进去就不提交、不报错、不清空输入 —— 用户多半是还没敲完
  if (cents === null) return
  cards.addLedger(today(), cents, draftCat.value, draftNote.value)
  draftAmount.value = ''
  draftNote.value = ''
  adding.value = false
}
</script>

<template>
  <div class="card ledger" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">{{ sum.label }}</span>
        <div class="tools">
          <button class="edit" title="上一月" aria-label="上一月" @click="monthOffset -= 1"><ChevronRight :size="11" class="flip" /></button>
          <button class="edit" title="下一月" aria-label="下一月" :disabled="monthOffset >= 0" :data-off="monthOffset >= 0" @click="monthOffset += 1"><ChevronRight :size="11" /></button>
        </div>
      </div>

      <template v-if="adding">
        <input v-model="draftAmount" class="in" inputmode="decimal" placeholder="金额（如 12.50）" aria-label="金额" @keydown.enter.prevent="save()" />
        <select v-model="draftCat" class="in" aria-label="分类">
          <option v-for="c in LEDGER_CATEGORIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <input v-model="draftNote" class="in" maxlength="40" placeholder="备注（可空）" aria-label="备注" @keydown.enter.prevent="save()" />
        <div class="acts">
          <button class="primary" :disabled="parseAmount(draftAmount) === null" @click="save()">记一笔</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="sum.total > 0">
        <div class="num">{{ formatMoney(sum.total, cards.state.ledger.symbol) }}</div>
        <p class="cap">
          {{ sum.entries.length }} 笔 · 日均 {{ formatMoneyShort(sum.dailyAvg, cards.state.ledger.symbol) }}
          <template v-if="sum.dayOfMonth < sum.daysInMonth">
            · 整月约 {{ formatMoneyShort(sum.projected, cards.state.ledger.symbol) }}
          </template>
        </p>

        <ul class="cats">
          <li v-for="t in totals.slice(0, variant === 'panel' ? 6 : 3)" :key="t.category">
            <div class="crow">
              <span class="cn">{{ t.category }}</span>
              <span class="cv">{{ formatMoneyShort(t.cents, cards.state.ledger.symbol) }}</span>
            </div>
            <div class="bar" role="img" :aria-label="`${t.category} ${formatMoney(t.cents, cards.state.ledger.symbol)}`">
              <span class="fill" :style="{ inlineSize: maxTotal ? `${Math.round((t.cents / maxTotal) * 100)}%` : '0%' }" />
            </div>
          </li>
        </ul>

        <div v-if="trend.length && trendMax" class="trend" aria-hidden="true">
          <span v-for="d in trend" :key="d.date" class="tdot" :style="{ blockSize: `${Math.max(6, Math.round((d.cents / trendMax) * 100))}%` }" />
        </div>
      </template>

      <template v-else>
        <div class="top">
          <Wallet class="ico" :size="15" />
          <button class="edit" title="记一笔" aria-label="记一笔" @click="adding = true"><Plus :size="12" /></button>
        </div>
        <p class="hint">这个月还没记账</p>
      </template>

      <div v-if="!adding && sum.total > 0" class="foot">
        <button class="add" @click="adding = true"><Plus :size="12" /> 记一笔</button>
        <ul v-if="variant === 'panel'" class="rows">
          <li v-for="r in sum.entries.slice(0, 8)" :key="r.id">
            <span class="rd">{{ r.date.slice(5) }} {{ r.category }}</span>
            <span class="rn">{{ r.note }}</span>
            <span class="rv">{{ formatMoneyShort(r.cents, cards.state.ledger.symbol) }}</span>
            <button class="del" :aria-label="`删除 ${r.date} 的 ${r.cents} 分`" @click="cards.removeLedger(r.id)"><Trash2 :size="10" /></button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ledger .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.tools {
  display: flex;
  gap: 3px;
}
.edit {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.edit[data-off='true'] {
  opacity: 0.3;
  cursor: not-allowed;
}
.edit:hover,
.edit:focus-visible {
  color: var(--text-1);
}
.flip {
  transform: scaleX(-1);
}
.num {
  font-size: clamp(17px, 6cqw, 28px);
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.cats {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 0.6cqw, 5px);
}
.crow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.cn {
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  white-space: nowrap;
}
.cv {
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bar {
  block-size: 3px;
  border-radius: 2px;
  background: var(--border-soft);
  overflow: hidden;
}
.fill {
  display: block;
  block-size: 100%;
  background: var(--mod, var(--brand-500));
}
.trend {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  block-size: 14px;
  margin-block-start: 2px;
}
.tdot {
  flex: 1 1 auto;
  min-inline-size: 2px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 55%, transparent);
}
.foot {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: clamp(11px, 2.2cqw, 11px);
  padding: 1px 7px;
  color: var(--text-2);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-block-size: 30cqh;
  overflow: auto;
}
.rows li {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}
.rd {
  flex: 0 0 auto;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rn {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rv {
  flex: 0 0 auto;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.del {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover,
.del:focus-visible {
  color: var(--text-1);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.ico {
  color: var(--mod, var(--brand-500));
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
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
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 8px;
}
.acts .primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
.acts .primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
