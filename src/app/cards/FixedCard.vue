<script setup lang="ts">
/**
 * 固定整数位计算：金额 × 一个率，给出小额、含率总额、去率净额。
 *
 * 全程整数运算（金额到分、率到万分之一），只有显示才除 10/100 —— 与记账卡同一条纪律。
 * 界面上会显示解析出来的率（`6%` / `600%`），因为"6 到底是 6% 还是 600%"这件事
 * **差 100 倍**，而用户在输入框里看不出区别。
 */
import { computed, inject } from 'vue'
import { fixedPlan, formatFixed, formatRate, parseMoney, parseRate } from '@modulo/engine/fixed'
import { Percent } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const base = computed(() => parseMoney(cards.state.fixed.base))
const rate = computed(() => parseRate(cards.state.fixed.rate))
const symbol = computed(() => cards.state.fixed.symbol)
const plan = computed(() => (base.value === null || rate.value === null ? null : fixedPlan(base.value, rate.value)))
/** 两个输入都合法才给结果；否则界面上是空而不是 0 */
const ready = computed(() => base.value !== null && rate.value !== null)

function setRate(text: string): void {
  cards.setFixed(cards.state.fixed.base, text)
}
</script>

<template>
  <div class="card fixedcard" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">整数位计算</span>
        <Percent v-if="ready" class="ico" :size="13" />
      </div>

      <div class="io">
        <input
          class="in"
          inputmode="decimal"
          placeholder="金额（如 1,280.00）"
          aria-label="金额"
          :value="cards.state.fixed.base"
          @input="cards.setFixed(($event.target as HTMLInputElement).value, cards.state.fixed.rate)"
        />
        <input
          class="in rate"
          placeholder="率（如 6%）"
          aria-label="率"
          :value="cards.state.fixed.rate"
          @input="setRate(($event.target as HTMLInputElement).value)"
        />
      </div>

      <template v-if="plan">
        <div class="num">{{ formatFixed(plan.result, 2, symbol) }}</div>
        <p class="rate">按 {{ formatRate(plan.rate) }} 算出的数额</p>
        <ul class="rows">
          <li><span>基数</span><b>{{ formatFixed(plan.base, 2, symbol) }}</b></li>
          <li><span>含率总额</span><b>{{ formatFixed(plan.total, 2, symbol) }}</b></li>
          <li v-if="plan.rate < 10000"><span>去率净额</span><b>{{ formatFixed(plan.net, 2, symbol) }}</b></li>
          <li v-else class="note"><span>去率净额</span><b>率 ≥ 100%，无意义</b></li>
        </ul>
        <p class="tip">「6」按 6% 读，「0.06」也按 6% 读；结果按财务口径四舍五入到分</p>
      </template>
      <p v-else class="hint">
        {{ base === null && cards.state.fixed.base.trim() ? '金额认不出来（至多两位小数、不能是负数）' : '' }}
        {{ rate === null && cards.state.fixed.rate.trim() ? '率认不出来（数字，可带 %）' : '' }}
        <template v-if="!cards.state.fixed.base.trim() && !cards.state.fixed.rate.trim()">填金额与率</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.fixedcard .card-body {
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
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.ico {
  color: var(--mod, var(--brand-500));
}
.io {
  display: flex;
  gap: 4px;
}
.in {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.in.rate {
  flex: 0 0 34%;
}
.num {
  font-size: clamp(17px, 6cqw, 28px);
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.rate {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rows li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.rows span {
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
}
.rows b {
  font-size: clamp(11px, 2.2cqw, 12px);
  font-weight: 500;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rows .note b {
  color: var(--text-3);
  font-weight: 400;
}
.tip {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>