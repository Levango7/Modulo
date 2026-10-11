<script setup lang="ts">
/**
 * 数据图表卡：记账 / 打卡的迷你趋势图。
 *
 * 关键定位：**它是别的卡的数据的另一种看法** —— 自己一行数据都不存，
 * 读记账（`ledger.entries`）与打卡（`habit.days`）的同源 cardData。好处是
 * 图永远和源卡一致，且删掉图表卡不动任何数据。
 *
 * 图形是纯 SVG（viewBox 0 0 100 100 + preserveAspectRatio none 随卡面拉伸），
 * 几何全在引擎 `chart.ts`（可单测）；线条加 non-scaling-stroke 防拉伸变粗。
 * 没有引入任何图表库 —— 这个体量的迷你图，一个 polyline / 几个 rect 就够，
 * 图表库的体积和 API 面都不划算。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { barSlots, linePoints, scaleSeries } from '@levango7/engine/chart'
import { dailyTotals, formatMoneyShort } from '@levango7/engine/ledger'
import { lastNDays, streakDays } from '@levango7/engine/habit'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 5 * 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const LEDGER_DAYS = 30
const HABIT_DAYS = 28

const ledger = computed(() => {
  if (props.variant !== 'ledger') return null
  const pts = dailyTotals(cards.state.ledger.entries, now.value, LEDGER_DAYS)
  const scale = scaleSeries(pts.map((p) => p.cents))
  return { pts, scale, slots: barSlots(pts.length), total: pts.reduce((s, p) => s + p.cents, 0) }
})

const habit = computed(() => {
  if (props.variant !== 'habit') return null
  const days = lastNDays(cards.state.habit.days, now.value, HABIT_DAYS)
  const scale = scaleSeries(days.map((d) => (d.done ? 1 : 0)))
  return { days, scale, streak: streakDays(cards.state.habit.days, now.value), doneCount: days.filter((d) => d.done).length }
})

/** 柱高：值越大越高的条形；0 值给一条 0.6 单位的基线痕，看得出"这一天存在但没花" */
const barY = (frac: number) => 100 - 6 - frac * 88
const barH = (frac: number) => Math.max(frac * 88, 0.6)
</script>

<template>
  <div class="card chart" :data-v="variant">
    <div class="card-body">
      <template v-if="variant === 'ledger' && ledger">
        <div class="top">
          <span class="label">近 {{ LEDGER_DAYS }} 天花费</span>
          <span class="sum">{{ formatMoneyShort(ledger.total) }}</span>
        </div>
        <svg v-if="ledger.scale.max > 0" viewBox="0 0 100 100" preserveAspectRatio="none" class="chart" aria-hidden="true">
          <rect
            v-for="(s, i) in ledger.slots"
            :key="i"
            :x="s.x"
            :width="s.w"
            :y="barY(ledger.scale.fracs[i])"
            :height="barH(ledger.scale.fracs[i])"
            rx="0.5"
            class="bar"
            :data-hot="i === ledger.slots.length - 1"
          />
        </svg>
        <p v-else class="hint">记一笔账（记账卡），这里就有每天的花费柱状图</p>
        <p v-if="ledger.scale.max > 0" class="cap">柱高相对当日花费，最高一天 {{ formatMoneyShort(ledger.scale.max) }}</p>
      </template>

      <template v-else-if="variant === 'habit' && habit">
        <div class="top">
          <span class="label">近 {{ HABIT_DAYS }} 天打卡</span>
          <span class="sum" v-if="cards.state.habit.name">{{ cards.state.habit.name }}</span>
        </div>
        <svg v-if="habit.scale.max > 0" viewBox="0 0 100 100" preserveAspectRatio="none" class="chart" aria-hidden="true">
          <polyline :points="linePoints(habit.scale.fracs)" class="line" />
        </svg>
        <p v-else class="hint">在打卡卡上勾一天，这里就有趋势线</p>
        <p v-if="habit.scale.max > 0" class="cap">打卡 {{ habit.doneCount }} / {{ HABIT_DAYS }} 天 · 连续 {{ habit.streak }} 天</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chart .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-2);
}
.sum {
  font-size: clamp(11px, 2.6cqw, 14px);
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart {
  width: 100%;
  height: auto;
  flex: 1 1 auto;
  min-height: 0;
  aspect-ratio: 5 / 2;
}
.bar {
  fill: color-mix(in srgb, var(--mod, var(--brand-500)) 55%, transparent);
}
.bar[data-hot='true'] {
  fill: var(--mod, var(--brand-500));
}
.line {
  fill: none;
  stroke: var(--mod, var(--brand-500));
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.cap,
.hint {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
</style>
