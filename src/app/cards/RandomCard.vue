<script setup lang="ts">
/**
 * 随机数：区间整数 / 骰子。RNG **注入**进引擎（`random.ts`）——
 * 这里才把 `crypto.getRandomValues` 包成 `() => number` 递进去，测试用的是固定序列。
 */
import { ref } from 'vue'
import { rollInts } from '@levango7/engine/random'

const props = defineProps<{ variant: string }>()

const min = ref('1')
const max = ref('100')
const count = ref('1')
const unique = ref(false)
const results = ref<number[] | null>(null)
const error = ref('')

function cryptoRng(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]! / 2 ** 32
}

function roll(): void {
  error.value = ''
  const spec = {
    min: Number(min.value),
    max: Number(max.value),
    count: Number(count.value === '' ? '1' : count.value),
    unique: unique.value,
  }
  const r = rollInts(spec, cryptoRng)
  if (r === null) {
    results.value = null
    error.value = '参数不对：区间装不下、min 比 max 大、或数量不是正整数'
    return
  }
  results.value = r
}
</script>

<template>
  <div class="card randomcard" :data-v="variant">
    <div class="card-body">
      <div class="inputs">
        <label class="f">最小<input v-model="min" class="in" inputmode="numeric" /></label>
        <label class="f">最大<input v-model="max" class="in" inputmode="numeric" /></label>
        <label class="f">个数<input v-model="count" class="in" inputmode="numeric" /></label>
      </div>
      <label class="chk"><input v-model="unique" type="checkbox" /> 不重复</label>
      <button class="go" @click="roll()">抽一个 / 抽一组</button>
      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <p v-else-if="results" class="out" role="status">
        <span v-for="(n, i) in results" :key="i" class="n">{{ n }}</span>
      </p>
      <p v-else class="hint">设好区间，点上面那枚按钮</p>
    </div>
  </div>
</template>

<style scoped>
.randomcard .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.inputs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(3px, 1cqw, 6px);
}
.f {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
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
  font-variant-numeric: tabular-nums;
}
.chk {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-2);
}
.go {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
  font-size: clamp(11px, 2.6cqw, 13px);
  padding: 2px 0;
}
.err {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--brand-600);
  line-height: 1.5;
}
.out {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: clamp(3px, 1cqw, 8px);
}
.n {
  font-size: clamp(14px, 4.4cqw, 22px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  background: var(--bg-card-soft);
  border-radius: var(--radius-sm);
  padding: 0 clamp(4px, 1.2cqw, 8px);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
}
</style>
