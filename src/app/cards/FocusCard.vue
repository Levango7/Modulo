<script setup lang="ts">
/**
 * 每日聚焦：把待办里**第一条没做完的**顶到眼前。
 *
 * 这张卡不新增任何数据结构 —— 它读的是待办卡同一份 `cardData.todos`，算术在
 * `@modulo/engine/focus`。所以它天然与待办卡一致：在待办卡里打勾，这里立刻换下一条。
 *
 * 为什么不给"排序 / 优先级 / 智能挑一条"：待办是用户自己排的顺序，替他重排等于替他做决定。
 * 想重排就让他在待办卡里拖 —— 这张卡的职责是把第一件顶到眼前，不是当任务管理器。
 */
import { computed, inject } from 'vue'
import { focusToday, nextUp } from '@modulo/engine/focus'
import { CheckCheck, ListTodo } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

// 不订阅"每分钟刷新"：这张卡的内容只在待办变动时变，绑一个定时器只会白跑
const next = computed(() => nextUp(cards.state.todos))
const stat = computed(() => focusToday(cards.state.todos, new Date()))
</script>

<template>
  <div class="card focus" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">今日聚焦</span>
        <span class="count">今天完成 {{ stat.doneToday }} · 还剩 {{ stat.remaining }}</span>
      </div>

      <template v-if="next">
        <p class="task">{{ next.text }}</p>
        <p v-if="variant === 'list'" class="rest">
          <CheckCheck :size="12" /> 已完成 {{ stat.total - stat.remaining }} / {{ stat.total }}
        </p>
      </template>
      <template v-else>
        <div class="done">
          <CheckCheck :size="18" />
          <p class="fin">{{ stat.total === 0 ? '还没有待办' : '今天的事都做完了' }}</p>
        </div>
      </template>

      <p v-if="!next && stat.total === 0" class="hint">
        <ListTodo :size="11" /> 先去待办卡写一条，这里会自动顶上来
      </p>
    </div>
  </div>
</template>

<style scoped>
.focus .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.count {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.task {
  margin: 0;
  font-size: clamp(13px, 5cqw, 22px);
  line-height: 1.35;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rest {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.done {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--mod, var(--brand-500));
}
.fin {
  margin: 0;
  font-size: clamp(12px, 3.4cqw, 16px);
  color: var(--text-2);
}
.hint {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
