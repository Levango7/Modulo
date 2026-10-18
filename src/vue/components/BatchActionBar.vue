<script setup lang="ts">
import { Rows3, Trash2 } from 'lucide-vue-next'

/**
 * 批量操作条（选中 >1 张时出现）。**纯展示 + 上抛**：取材（`groupableIds`）与执行
 * （`store.toggleLockMany` / `removeMany` / 清选中）全留在母组件 —— 抽走它们等于把
 * 选中集搬成两份，而选中集正是键盘编排枢纽在管的东西。
 */
defineProps<{ count: number; canGroup: boolean }>()
const emit = defineEmits<{
  (e: 'group'): void
  (e: 'lock'): void
  (e: 'remove'): void
  (e: 'clear'): void
}>()
</script>

<template>
  <div v-if="count > 1" class="batch">
    <span>已选 {{ count }} 个</span>
    <button :disabled="!canGroup" title="把选中且未归行的卡合成一行（行头插在它们上方）" @click="emit('group')"><Rows3 :size="13" /> 成组为行</button>
    <button @click="emit('lock')">锁定/解锁</button>
    <button @click="emit('remove')"><Trash2 :size="13" /> 批量移回库</button>
    <button @click="emit('clear')">取消选择</button>
  </div>
</template>

<style scoped>
.batch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--brand-50);
}
.batch button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
</style>
