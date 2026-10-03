<script setup lang="ts">
/**
 * 计算器：四则 + 括号 + 百分比。**表达式求值在引擎**（`calc.ts`，递归下降、无 `eval`）——
 * 那层有 12 条单测钉着优先级 / 错误文案 / 浮点显示口径；这里只有"按键拼表达式"这一件事。
 * 实时求值：显示行下面那行就是当前结果，按 = 才把它变成新的起点。
 */
import { computed, ref } from 'vue'
import { evaluate, formatCalcNumber } from '@modulo/engine/calc'

const props = defineProps<{ variant: string }>()

const expr = ref('')
const keys = ['C', '⌫', '(', ')', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '0', '.', '%', '+', '=']

const result = computed(() => {
  if (!expr.value.trim()) return null
  const r = evaluate(expr.value)
  return r.error ? null : r.value
})
const error = computed(() => {
  if (!expr.value.trim()) return null
  return evaluate(expr.value).error
})

function press(k: string): void {
  if (k === 'C') {
    expr.value = ''
    return
  }
  if (k === '⌫') {
    expr.value = expr.value.slice(0, -1)
    return
  }
  if (k === '=') {
    const r = evaluate(expr.value)
    if (!r.error) expr.value = formatCalcNumber(r.value)
    return
  }
  // × ÷ 是给人看的写法，求值前换回 * /（tokenize 只认后者）
  expr.value += k === '×' ? '*' : k === '÷' ? '/' : k
}

/** 表达式里 × ÷ 显示成乘除号 */
const shown = computed(() => expr.value.replace(/\*/g, '×').replace(/\//g, '÷'))
</script>

<template>
  <div class="card calc" :data-v="variant">
    <div class="card-body">
      <div class="display" role="status" aria-live="polite">
        <div class="expr">{{ shown || '0' }}</div>
        <div class="out" :class="{ err: error }">
          {{ error ? error : result === null ? '输入表达式' : `= ${formatCalcNumber(result)}` }}
        </div>
      </div>
      <div class="pad">
        <button v-for="k in keys" :key="k" :class="{ op: '+-×÷%'.includes(k), eq: k === '=', clear: k === 'C' }" @click="press(k)">
          {{ k }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calc .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.display {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: clamp(4px, 1.2cqw, 10px);
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
  min-width: 0;
}
.expr {
  font-size: clamp(12px, 3cqw, 16px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.out {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-3);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.out.err {
  color: var(--brand-600);
}
.pad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: clamp(2px, 0.8cqw, 6px);
}
.pad button {
  padding: clamp(2px, 0.8cqw, 6px) 0;
  font-size: clamp(11px, 2.8cqw, 14px);
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
}
.pad .op {
  color: var(--brand-600);
}
.pad .eq {
  grid-column: span 4;
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 600;
}
.pad .clear {
  color: var(--text-3);
}
</style>
