<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { ListChecks } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { todosOf } from '../../vue/instanceData'

/**
 * `moduleId` 是**模块** id、`instanceId` 是**实例** id（第二张待办卡是 `todo:2`）。
 * 两者都要：判定"这是不是第二张"靠的是它们不相等（见 `instanceData.ts`）。
 */
const props = defineProps<{ variant: string; chromeless?: boolean; moduleId?: string; instanceId?: string }>()
const cards = inject<CardDataApi>('cardData')!
const draft = ref('')
/**
 * 清单**按实例取**（F-01 阶段 2 第二个字段，2026-10-29）：两张待办卡各管各的清单。
 * 判定在 `instanceData.ts`（纯函数、锁 100）；加/勾/删都把两个 id 原样传下去，
 * 组件里不放"是不是第二张"的判断逻辑。
 */
const mine = computed(() => todosOf(cards.state, props.moduleId, props.instanceId))
const open = computed(() => mine.value.filter((t) => !t.done))
const done = computed(() => mine.value.filter((t) => t.done))
const showDone = computed(() => props.variant !== 'compact')

function submit(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  cards.addTodo(draft.value, props.moduleId, props.instanceId)
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
            <input type="checkbox" :checked="t.done" @change="cards.toggleTodo(t.id, moduleId, instanceId)" />
            <span>{{ t.text }}</span>
          </label>
          <button class="del" :aria-label="`删除待办：${t.text}`" title="删除" @click="cards.removeTodo(t.id, moduleId, instanceId)">×</button>
        </li>
      </ul>
      <template v-if="showDone && done.length">
        <p class="done-title muted">已完成 {{ done.length }}</p>
        <ul class="list done">
          <li v-for="t in done" :key="t.id">
            <label><input type="checkbox" checked @change="cards.toggleTodo(t.id, moduleId, instanceId)" /><span>{{ t.text }}</span></label>
          </li>
        </ul>
      </template>
      <input v-model="draft" class="add" placeholder="添加待办，回车确认" aria-label="添加待办" @keydown="submit" />
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
  position: relative;
  border: none;
  background: transparent;
  color: var(--text-3);
  padding: 0 var(--space-1);
  line-height: 1;
}
/* 视觉只有 18×13px，手指几乎点不中（2026-10-13 无障碍走查：全仓最小热区就这两枚）。
   行距 23px：垂直各扩 6px 后命中区 31×25，恰好铺满行、不越到相邻行（同行头图标钮的做法）。
   注意：外扩会让 scrollWidth > clientWidth —— 「不裁字」守卫已按"文本自身放得下"排除这种
   热区伪元素，不然它会把 18px 宽的 × 误判成被裁文本（实测踩过一次）。 */
.del::after {
  content: '';
  position: absolute;
  inset: -6px;
  min-width: 26px;
  min-height: 25px;
}
.add {
  width: 100%;
  font-size: clamp(12px, 1.4cqw, 15px);
}
</style>
