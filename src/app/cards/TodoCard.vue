<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { ListChecks } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!
const draft = ref('')
const open = computed(() => cards.state.todos.filter((t) => !t.done))
const done = computed(() => cards.state.todos.filter((t) => t.done))
const showDone = computed(() => props.variant !== 'compact')

function submit(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  cards.addTodo(draft.value)
  draft.value = ''
}
</script>

<template>
  <div class="card">
    <div v-if="!chromeless" class="card-head"><ListChecks :size="14" /><span>待办</span><span class="muted count">{{ open.length }} 项</span></div>
    <div class="card-body">
      <ul class="list">
        <li v-for="t in open" :key="t.id">
          <label>
            <input type="checkbox" :checked="t.done" @change="cards.toggleTodo(t.id)" />
            <span>{{ t.text }}</span>
          </label>
          <button class="del" title="删除" @click="cards.removeTodo(t.id)">×</button>
        </li>
      </ul>
      <template v-if="showDone && done.length">
        <p class="done-title muted">已完成 {{ done.length }}</p>
        <ul class="list done">
          <li v-for="t in done" :key="t.id">
            <label><input type="checkbox" checked @change="cards.toggleTodo(t.id)" /><span>{{ t.text }}</span></label>
          </li>
        </ul>
      </template>
      <input v-model="draft" class="add" placeholder="添加待办，回车确认" @keydown="submit" />
    </div>
  </div>
</template>

<style scoped>
.card-head .count {
  margin-left: auto;
  font-size: 12px;
}
.list {
  list-style: none;
  margin: 0 0 var(--space-2);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 0.6cqw, 8px);
}
.list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.list label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  font-size: clamp(12px, 1.4cqw, 15px);
}
.list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.done-title {
  margin: 0 0 var(--space-1);
  font-size: 11px;
}
.done {
  opacity: 0.55;
}
.done span {
  text-decoration: line-through;
}
.del {
  border: none;
  background: transparent;
  color: var(--text-3);
  padding: 0 var(--space-1);
  line-height: 1;
}
.add {
  width: 100%;
  font-size: clamp(12px, 1.4cqw, 15px);
}
</style>
