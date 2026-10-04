<script setup lang="ts">
/**
 * 月度统计：这个月完成了多少、还欠着多少。
 *
 * 算术在 `@modulo/engine/focus` 的 `monthStat`。它依赖待办的 `doneAt`（完成时刻）——
 * 那是一个**可选、向后兼容**的字段：v1 数据与旧备份里没有它，于是这类条目不会被算进
 * 任何一个月（引擎不猜）。卡上会把这一点说出来，而不是给一个看起来很确定的百分比。
 */
import { computed, inject } from 'vue'
import { monthStat } from '@modulo/engine/focus'
import { CalendarRange } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const stat = computed(() => monthStat(cards.state.todos, new Date()))
/** 没有 `doneAt` 的已完成条目：它们不知道自己属于哪个月，不进统计，但要在卡上说明 */
const undated = computed(() => cards.state.todos.filter((t) => t.done && typeof t.doneAt !== 'number').length)
const pct = computed(() => `${Math.round(stat.value.ratio * 100)}%`)
</script>

<template>
  <div class="card mstat" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">{{ stat.label }}</span>
        <CalendarRange class="ico" :size="13" />
      </div>

      <div class="num">{{ pct }}</div>
      <div class="bar" role="img" :aria-label="`本月完成率 ${pct}`">
        <span class="fill" :style="{ inlineSize: pct }" />
      </div>

      <p class="cap">本月完成 {{ stat.completed }} · 还欠 {{ stat.outstanding }}</p>
      <p v-if="undated > 0" class="note">{{ undated }} 条旧记录没有完成时间，没算进任何月份</p>
    </div>
  </div>
</template>

<style scoped>
.mstat .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 8px);
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
.ico {
  color: var(--mod, var(--brand-500));
}
.num {
  font-size: clamp(18px, 7cqw, 32px);
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.bar {
  block-size: 6px;
  border-radius: 3px;
  background: var(--border-soft);
  overflow: hidden;
}
.fill {
  display: block;
  block-size: 100%;
  border-radius: 3px;
  background: var(--mod, var(--brand-500));
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.note {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
</style>
