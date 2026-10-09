<script setup lang="ts">
/**
 * 月度热力图：把习惯打卡铺成当月格子，深浅表示量。
 *
 * **刻意不做成"连续打卡热力图"那种一整年 53 列** —— 一整年在这个工作台里会挤成一条
 * 1px 的线，投影也救不了。当月 6×7 与月历同一口径，所以卡片高度不随月份跳。
 *
 * 颜色是**相对深浅**：引擎按本月最大值归一，图例上明写着这一句。
 * 颜色带评价色彩，而"这天打了三次卡"既不是好也不是坏 —— 那个评价不该由一张卡替用户下。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { HEAT_LEGEND, monthHeatmap } from '@levango7/engine/heatmap'
import { ChevronLeft, ChevronRight, Flame } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const shift = ref(0)
/** 打卡集合直接当「日期 → 1」用：习惯卡存的就是"打过哪些天"，次数语义留给未来的别的卡 */
const counts = computed<Record<string, number>>(() => Object.fromEntries(cards.state.habit.days.map((d) => [d, 1])))
const m = computed(() => monthHeatmap(counts.value, now.value, shift.value))

function step(delta: number): void {
  const next = shift.value + delta
  // 不许翻到未来：一张还没到的月历没有内容
  if (next > 0) return
  shift.value = next
}
</script>

<template>
  <div class="card heat" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">{{ m.label }}</span>
        <div class="tools">
          <button class="nav" aria-label="上一月" @click="step(-1)"><ChevronLeft :size="12" /></button>
          <button class="nav" :data-off="shift >= 0" aria-label="下一月" :disabled="shift >= 0" @click="step(1)"><ChevronRight :size="12" /></button>
        </div>
      </div>

      <template v-if="m.activeDays > 0">
        <div class="grid" role="img" :aria-label="`${m.label} 打卡 ${m.activeDays} 天`">
          <div class="wd" aria-hidden="true">
            <span v-for="w in m.weekdays" :key="w">{{ w }}</span>
          </div>
          <div v-for="(week, wi) in m.weeks" :key="wi" class="week">
            <span
              v-for="(c, ci) in week"
              :key="ci"
              class="cell"
              :data-lv="c.level"
              :data-muted="c.muted"
              :data-today="c.today"
              :title="c.date ? `${c.date.slice(5)} ${c.value ? `打卡 ${c.value}` : '未打卡'}` : ''"
            >
              <em v-if="c.day !== null && (variant === 'panel' || c.today)">{{ c.day }}</em>
            </span>
          </div>
        </div>
        <p class="cap">
          <Flame :size="11" /> {{ m.activeDays }} 天 · {{ HEAT_LEGEND }}
        </p>
      </template>

      <template v-else>
        <p class="hint">这个月还没有打卡记录</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.heat .card-body {
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
.tools {
  display: flex;
  gap: 3px;
}
.nav {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.nav[data-off='true'] {
  opacity: 0.3;
  cursor: not-allowed;
}
.nav:hover,
.nav:focus-visible {
  color: var(--text-1);
}
.grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wd {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.wd span {
  font-size: clamp(11px, 1.8cqw, 12px);
  color: var(--text-3);
  text-align: center;
  line-height: 1.2;
}
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 2px;
  background: var(--border-soft);
  display: grid;
  place-items: center;
  min-inline-size: 0;
}
.cell[data-muted='true'] {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--border-soft);
}
.cell em {
  font-style: normal;
  font-size: clamp(11px, 1.8cqw, 12px);
  color: var(--text-3);
  line-height: 1;
}
/* 四档色阶都用 color-mix 而不是硬编码颜色：三套皮肤 + 强调色都能跟着走 */
.cell[data-lv='1'] {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 22%, transparent);
}
.cell[data-lv='2'] {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 45%, transparent);
}
.cell[data-lv='3'] {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 70%, transparent);
}
.cell[data-lv='4'] {
  background: var(--mod, var(--brand-500));
}
.cell[data-today='true'] {
  box-shadow: inset 0 0 0 1px var(--text-2);
}
.cap {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
}
</style>