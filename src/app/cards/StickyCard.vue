<script setup lang="ts">
import { computed, inject } from 'vue'
import { StickyNote } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { stickyOf, writeSticky } from '../../vue/instanceData'

/**
 * `moduleId` 是**模块** id、`instanceId` 是**实例** id（第二张便签是 `sticky:2`）。
 * 两者都要：判定"这是不是第二张"靠的是它们不相等（见 `instanceData.ts`）。
 */
const props = defineProps<{ variant: string; chromeless?: boolean; moduleId?: string; instanceId?: string }>()
const cards = inject<CardDataApi>('cardData')!
/**
 * 便签正文**按实例取**（F-01 阶段 2）：两张便签各写各的，不再共享一份。
 * 判定在 `instanceData.ts`（纯函数、锁 100），这里只把它接成 `v-model` 要的读写对 ——
 * 组件里不放"是不是第二张"的判断逻辑。
 */
const text = computed({
  get: () => stickyOf(cards.state, props.moduleId, props.instanceId),
  set: (v: string) => writeSticky(cards.state, props.moduleId, props.instanceId, v),
})
</script>

<template>
  <div class="card">
    <div v-if="!chromeless" class="card-head"><StickyNote :size="14" /><span>便签</span></div>
    <div class="card-body">
      <textarea v-model="text" class="pad" placeholder="随手记…" aria-label="便签内容" spellcheck="false" />
    </div>
  </div>
</template>

<style scoped>
.card-body {
  display: flex;
}
.pad {
  flex: 1;
  min-height: 0;
  resize: none;
  border: none;
  background: transparent;
  font-size: clamp(12px, 1.5cqw, 15px);
  line-height: 1.6;
  padding: 0;
}
.pad:focus {
  outline: none;
  box-shadow: none;
}
.hint {
  margin-left: auto;
  font-size: 11px;
}
</style>
