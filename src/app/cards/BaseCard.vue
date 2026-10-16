<script setup lang="ts">
/**
 * 进制转换：2–36 进制互转（BigInt，大数不丢精度 —— 引擎 `baseconv.ts` 的单测里
 * 有 2^53+1 那颗 Number 会数错的数）。这里只有输入、进制选择与结果。
 */
import { computed, ref } from 'vue'
import { isValidInBase, MAX_VALUE_LEN, toBase } from '@levango7/engine/baseconv'

const props = defineProps<{ variant: string }>()

const value = ref('255')
const from = ref(10)
const to = ref(16)

const BASES = [2, 8, 10, 16, 32, 36]

const out = computed(() => toBase(value.value, from.value, to.value))
const inValid = computed(() => value.value.trim() !== '' && isValidInBase(value.value, from.value))
/** 太长是**另一种**拒因，不能混进「位不属于 N 进制」里 —— 那会骗用户（位其实是对的） */
const tooLong = computed(() => value.value.trim().replace(/^-/, '').length > MAX_VALUE_LEN)
</script>

<template>
  <div class="card baseconv" :data-v="variant">
    <div class="card-body">
      <input v-model="value" class="in" aria-label="要转换的值" spellcheck="false" />
      <div class="pair">
        <label class="f">从
          <select v-model.number="from" aria-label="原进制">
            <option v-for="b in BASES" :key="b" :value="b">{{ b }} 进制</option>
          </select>
        </label>
        <span class="arrow">→</span>
        <label class="f">到
          <select v-model.number="to" aria-label="目标进制">
            <option v-for="b in BASES" :key="b" :value="b">{{ b }} 进制</option>
          </select>
        </label>
      </div>
      <div class="out" role="status">
        <template v-if="value.trim() === ''">输入一个值</template>
        <template v-else-if="tooLong">太长了，最多 {{ MAX_VALUE_LEN }} 位</template>
        <template v-else-if="!inValid">这个值里有的位不属于 {{ from }} 进制</template>
        <template v-else-if="out === null">—</template>
        <template v-else><code>{{ out }}</code></template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.baseconv .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
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
  font-family: ui-monospace, monospace;
}
.pair {
  display: flex;
  align-items: flex-end;
  gap: clamp(4px, 1.4cqw, 10px);
}
.f {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
}
.f select {
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 2px;
  color: var(--text-1);
}
.arrow {
  color: var(--text-3);
  padding-bottom: 3px;
}
.out {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  min-height: 1.5em;
  overflow-wrap: anywhere;
}
.out code {
  color: var(--text-1);
  font-family: ui-monospace, monospace;
  font-size: clamp(13px, 3.2cqw, 16px);
  overflow-wrap: anywhere;
}
</style>
