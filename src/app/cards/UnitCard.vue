<script setup lang="ts">
/**
 * 单位换算：长度 / 重量 / 温度 / 面积 / 速度 / 数据量。
 * 换算表与温度公式在引擎（`convert.ts`，系数都有硬事实单测）；这里只摆表单与结果。
 */
import { computed, ref } from 'vue'
import { convert, UNITS, unitName, type UnitCategory } from '@levango7/engine/convert'

const props = defineProps<{ variant: string }>()

const CATEGORIES: { id: UnitCategory; name: string }[] = [
  { id: 'length', name: '长度' },
  { id: 'weight', name: '重量' },
  { id: 'temperature', name: '温度' },
  { id: 'area', name: '面积' },
  { id: 'speed', name: '速度' },
  { id: 'data', name: '数据量' },
]

const category = ref<UnitCategory>('length')
const value = ref('1')
const from = ref('km')
const to = ref('mile')

const units = computed(() => UNITS[category.value])
const num = computed(() => (value.value.trim() === '' ? null : Number(value.value)))
const out = computed(() => {
  if (num.value === null || Number.isNaN(num.value)) return null
  return convert(num.value, category.value, from.value, to.value)
})

function switchCategory(c: UnitCategory): void {
  category.value = c
  from.value = UNITS[c][0].id
  to.value = UNITS[c][1].id
}

function swap(): void {
  ;[from.value, to.value] = [to.value, from.value]
}
</script>

<template>
  <div class="card unitconv" :data-v="variant">
    <div class="card-body">
      <div class="cats" role="group" aria-label="类别">
        <button v-for="c in CATEGORIES" :key="c.id" :data-active="category === c.id" @click="switchCategory(c.id)">
          {{ c.name }}
        </button>
      </div>
      <input v-model="value" class="in" inputmode="decimal" placeholder="数值" aria-label="数值" />
      <div class="pair">
        <select v-model="from" aria-label="从">
          <option v-for="u in units" :key="u.id" :value="u.id">{{ unitName(category, u.id) }}</option>
        </select>
        <button class="swap" title="交换方向" aria-label="交换方向" @click="swap()">⇄</button>
        <select v-model="to" aria-label="到">
          <option v-for="u in units" :key="u.id" :value="u.id">{{ unitName(category, u.id) }}</option>
        </select>
      </div>
      <div class="out" role="status">
        <template v-if="out === null">—</template>
        <template v-else>
          {{ value }} {{ unitName(category, from) }} = <strong>{{ out }}</strong> {{ unitName(category, to) }}
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unitconv .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.cats button {
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  color: var(--text-2);
}
.cats button[data-active='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(12px, 3cqw, 15px);
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: clamp(3px, 1cqw, 8px);
  align-items: center;
}
.pair select {
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 2px;
  color: var(--text-1);
}
.swap {
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: clamp(11px, 2.6cqw, 14px);
  padding: 0 2px;
}
.out {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  line-height: 1.5;
  min-height: 1.5em;
  overflow-wrap: anywhere;
}
.out strong {
  color: var(--text-1);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
