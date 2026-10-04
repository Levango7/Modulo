<script setup lang="ts">
/**
 * 时间进度卡：今天 / 本月 / 今年 各过去了多少。**唯一一张不用输入、也不会过时的卡** ——
 * 每看一眼都在动，摆在那儿就是在说话。
 *
 * 算术在引擎（`@modulo/engine/progress`，含闰年与"还剩几小时"的边界）；这里 30 秒一跳，
 * 只为让百分比跟着走 —— 没必要每秒重画。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatPct, progressOf } from '@modulo/engine/progress'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 30_000)
onBeforeUnmount(() => window.clearInterval(tick))

const p = computed(() => progressOf(now.value))
const rows = computed(() => [
  { key: 'today', label: '今天', value: p.value.today },
  { key: 'month', label: '本月', value: p.value.month },
  { key: 'year', label: '今年', value: p.value.year },
])
</script>

<template>
  <div class="card progress" :data-v="variant">
    <div class="card-body">
      <template v-if="variant === 'year'">
        <div class="big">{{ formatPct(p.year) }}</div>
        <div class="bar"><i :style="{ width: formatPct(p.year) }" /></div>
        <p class="cap">今年第 {{ p.dayOfYear }} 天 · 还剩 {{ p.daysLeftYear }} 天</p>
      </template>
      <template v-else>
        <div v-for="r in rows" :key="r.key" class="row">
          <span class="lab">{{ r.label }}</span>
          <span class="bar"><i :style="{ width: formatPct(r.value) }" /></span>
          <span class="pct">{{ formatPct(r.value) }}</span>
        </div>
        <p class="cap">今天还剩 {{ p.hoursLeftToday }} 小时 · 今年还剩 {{ p.daysLeftYear }} 天</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.progress .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 10px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: clamp(4px, 1.6cqw, 10px);
  min-width: 0;
}
.lab {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  white-space: nowrap;
}
.pct {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bar {
  display: block;
  height: clamp(4px, 1.2cqw, 8px);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--text-3) 18%, transparent);
  overflow: hidden;
}
.bar > i {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--mod, var(--brand-500));
}
.big {
  font-size: clamp(24px, 10cqw, 46px);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
</style>
