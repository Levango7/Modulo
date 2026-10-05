<script setup lang="ts">
/**
 * 年历卡：一眼看整年 12 个月，今天高亮；可以翻年（翻年只是看，不改任何数据）。
 *
 * 日期算术全在引擎（`@modulo/engine/yearcalendar`）—— 那层有闰年/补位的单测，
 * 这里只剩"视图状态 + 每分钟让'今天'别过期"。60 秒一跳是为了跨零点：卡片常开着。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatYearLabel, shiftYear, yearGrid } from '@modulo/engine/yearcalendar'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const view = ref({ year: now.value.getFullYear() })
const months = computed(() => yearGrid(view.value.year, now.value))

function step(delta: number): void {
  view.value = { year: shiftYear(view.value.year, delta) }
}
</script>

<template>
  <div class="card year-calendar" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <button class="nav" title="上一年" aria-label="上一年" @click="step(-1)"><ChevronLeft :size="12" /></button>
        <span class="label">{{ formatYearLabel(view.year) }}</span>
        <button class="nav" title="下一年" aria-label="下一年" @click="step(1)"><ChevronRight :size="12" /></button>
      </div>
      <div class="year-grid">
        <div v-for="mini in months" :key="mini.month" class="mini">
          <div class="mini-label">{{ mini.label }}</div>
          <div class="month-grid">
            <template v-for="(row, ri) in mini.monthRows" :key="ri">
              <span
                v-for="(c, ci) in row"
                :key="`${ri}-${ci}`"
                class="day-cell"
                :class="{ today: c.today, we: c.weekend }"
              >{{ c.day ?? '' }}</span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 与其他卡同一套规矩：内容随格子连续缩放（clamp(绝对下限, 容器查询单位, 绝对上限)） */
.year-calendar .card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: clamp(8px, 2.2cqw, 18px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.label {
  font-size: clamp(11px, 2.8cqw, 14px);
  color: var(--text-1);
}
.nav {
  display: inline-flex;
  padding: 0 2px;
  background: transparent;
  border: none;
  color: var(--text-2);
  cursor: pointer;
}
.nav:hover {
  color: var(--text-1);
}
.year-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(4px, 1.4cqw, 12px);
}
.mini {
  display: flex;
  flex-direction: column;
  gap: clamp(1px, 0.4cqw, 3px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
}
.mini-label {
  text-align: center;
  font-size: clamp(11px, 2cqw, 12px);
  color: var(--text-2);
}
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: clamp(1px, 0.3cqw, 2px);
}
.day-cell {
  text-align: center;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-sm);
}
.day-cell.we {
  color: var(--text-3);
}
.day-cell.today {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 18%, transparent);
  color: var(--text-1);
  font-weight: 600;
}
</style>
