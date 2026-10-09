<script setup lang="ts">
/**
 * 日期工具：星期几 / 距今天几天 / 往前往后 N 天。
 * 解析与"本地日历日"口径复用倒数日那套引擎（`dtools.ts`/`countdown.ts`）——
 * 同一个日期在两张卡里不能算出两个答案。
 */
import { computed, ref } from 'vue'
import { addDays, weekdayOf } from '@levango7/engine/dtools'
import { daysUntil } from '@levango7/engine/countdown'
import { isValidDate } from '@levango7/engine'

const props = defineProps<{ variant: string }>()

const date = ref('')
const offset = ref('7')
const today = ref(new Date())

const valid = computed(() => isValidDate(date.value))
const dow = computed(() => (valid.value ? weekdayOf(date.value) : null))
const until = computed(() => (valid.value ? daysUntil(date.value, today.value) : null))
const offsetN = computed(() => (offset.value.trim() === '' ? null : Number(offset.value)))
const offsetDate = computed(() => {
  if (!valid.value || offsetN.value === null || !Number.isInteger(offsetN.value)) return null
  return addDays(date.value, offsetN.value)
})
</script>

<template>
  <div class="card dtools" :data-v="variant">
    <div class="card-body">
      <input v-model="date" class="in" type="date" aria-label="日期" />
      <template v-if="valid">
        <p class="fact">
          是 <strong>{{ dow }}</strong>
          <template v-if="until === 0">，就是今天</template>
          <template v-else-if="until !== null && until > 0">，距今 {{ until }} 天</template>
          <template v-else-if="until !== null">，已过 {{ -until }} 天</template>
        </p>
        <div class="offset-row">
          <span class="lab">±</span>
          <input v-model="offset" class="in num" inputmode="numeric" aria-label="天数" />
          <span class="lab">天</span>
          <strong v-if="offsetDate" class="res">{{ offsetDate }}</strong>
        </div>
      </template>
      <p v-else-if="date" class="hint">日期不完整 —— 用日期选择器选一个</p>
      <p v-else class="hint">选一个日期，看它是星期几、距今几天</p>
    </div>
  </div>
</template>

<style scoped>
.dtools .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.fact {
  margin: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.fact strong {
  color: var(--text-1);
  font-weight: 600;
}
.offset-row {
  display: flex;
  align-items: center;
  gap: clamp(3px, 1cqw, 6px);
  flex-wrap: wrap;
}
.lab {
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
}
.num {
  width: 4.5em;
}
.res {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
