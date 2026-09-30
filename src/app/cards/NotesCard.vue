<script setup lang="ts">
import { computed, inject } from 'vue'
import { FileText, History } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string; moduleId?: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!
const limit = computed(() => (props.variant === 'tall' ? 20 : props.variant === 'bar' ? 6 : 4))
const items = computed(() => cards.state.notes.slice(0, limit.value))

function when(at: number): string {
  const d = Math.floor((Date.now() - at) / 60000)
  if (d < 1) return '刚刚'
  if (d < 60) return `${d} 分钟前`
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`
  return `${Math.floor(d / 1440)} 天前`
}
</script>

<template>
  <div class="card">
    <div v-if="!chromeless" class="card-head">
      <History v-if="moduleId === 'recent'" :size="14" /><FileText v-else :size="14" />
      <span>{{ moduleId === 'recent' ? '最近改动' : '速记' }}</span>
    </div>
    <div class="card-body">
      <p v-if="!items.length" class="muted empty">还没有内容</p>
      <ul class="list">
        <li v-for="n in items" :key="n.id">
          <div class="t">{{ n.title }}</div>
          <div class="s muted">{{ when(n.at) }}</div>
          <div v-if="variant !== 'bar'" class="b">{{ n.body }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(4px, 1cqw, 12px);
}
.t {
  font-weight: 600;
  font-size: clamp(12px, 1.4cqw, 15px);
}
.s {
  font-size: clamp(11px, 1.1cqw, 12px);
}
.b {
  color: var(--text-2);
  font-size: clamp(12px, 1.3cqw, 14px);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.empty {
  text-align: center;
  margin-top: 20%;
}
</style>
