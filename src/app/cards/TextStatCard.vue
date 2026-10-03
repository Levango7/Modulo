<script setup lang="ts">
/**
 * 文本统计：粘贴一段文字，字符 / 词 / 行当场出数。
 * 口径（字素簇、CJK 一字一词）在引擎 `textstat.ts`，这里只有 textarea 与读数。
 */
import { computed, ref } from 'vue'
import { textStats } from '@modulo/engine/textstat'

const props = defineProps<{ variant: string }>()

const text = ref('')
const stats = computed(() => textStats(text.value))
const rows = computed(() => [
  { label: '字符', value: stats.value.chars },
  { label: '不含空白', value: stats.value.charsNoSpaces },
  { label: '词数', value: stats.value.words },
  { label: '行数', value: stats.value.lines },
])
</script>

<template>
  <div class="card textstat" :data-v="variant">
    <div class="card-body">
      <textarea v-model="text" class="in" placeholder="把要数的文字粘到这里" aria-label="要统计的文本" />
      <div class="stats">
        <div v-for="r in rows" :key="r.label" class="kv">
          <span class="lab">{{ r.label }}</span>
          <span class="v">{{ r.value }}</span>
        </div>
      </div>
      <p v-if="stats.cjk" class="cap">其中中文 {{ stats.cjk }} 字</p>
    </div>
  </div>
</template>

<style scoped>
.textstat .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.in {
  flex: 1;
  min-height: clamp(40px, 10cqw, 96px);
  resize: none;
  width: 100%;
  font-size: clamp(11px, 2.6cqw, 13px);
  line-height: 1.5;
  padding: 4px 6px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: clamp(2px, 0.8cqw, 6px);
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
}
.kv .lab {
  color: var(--text-3);
}
.kv .v {
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
</style>
