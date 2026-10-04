<script setup lang="ts">
/**
 * 月历卡：一张固定 6×7 的当月格子，今天高亮；可以翻月（翻月只是看，不改任何数据）。
 *
 * 日期算术全在引擎（`@modulo/engine/calendar`）—— 那层有闰年/跨年/补位的单测，
 * 这里只剩"视图状态 + 每分钟让'今天'别过期"。60 秒一跳是为了跨零点：卡片常开着。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { monthGrid, shiftMonth } from '@modulo/engine/calendar'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const view = ref({ year: now.value.getFullYear(), month: now.value.getMonth() + 1 })
const grid = computed(() => monthGrid(view.value.year, view.value.month, now.value))
const weekdayLabel = computed(() => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.value.getDay()])

function step(delta: number): void {
  view.value = shiftMonth(view.value.year, view.value.month, delta)
}
</script>

<template>
  <div class="card calendar" :data-v="variant">
    <div class="card-body">
      <template v-if="variant === 'today'">
        <div class="dom">{{ now.getDate() }}</div>
        <div class="dow">{{ weekdayLabel }} · {{ grid.label }}</div>
      </template>
      <template v-else>
        <div class="head">
          <button class="nav" title="上个月" aria-label="上个月" @click="step(-1)"><ChevronLeft :size="12" /></button>
          <span class="label">{{ grid.label }}</span>
          <button class="nav" title="下个月" aria-label="下个月" @click="step(1)"><ChevronRight :size="12" /></button>
        </div>
        <div class="weekdays">
          <span v-for="(w, i) in grid.weekdays" :key="w" :class="{ we: i >= 5 }">{{ w }}</span>
        </div>
        <div class="month-grid">
          <template v-for="(row, ri) in grid.weeks" :key="ri">
            <span
              v-for="(c, ci) in row"
              :key="`${ri}-${ci}`"
              class="day-cell"
              :class="{ today: c.today, we: c.weekend }"
            >{{ c.day ?? '' }}</span>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 与其他卡同一套规矩：内容随格子连续缩放（clamp(绝对下限, 容器查询单位, 绝对上限)） */
.calendar .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 1cqw, 8px);
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
.weekdays,
.month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: clamp(1px, 0.4cqw, 3px);
}
.weekdays span {
  text-align: center;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
}
.weekdays .we {
  color: var(--text-4);
}
.day-cell {
  text-align: center;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-sm);
  padding: clamp(0px, 0.3cqw, 2px) 0;
}
.day-cell.we {
  color: var(--text-3);
}
.day-cell.today {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 18%, transparent);
  color: var(--text-1);
  font-weight: 600;
}
.dom {
  font-size: clamp(26px, 11cqw, 56px);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.dow {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
</style>
