<script setup lang="ts">
import { computed } from 'vue'
import { CARD_COMPONENTS } from '../cardComponents'
import type { PhysicalRect } from '@levango7/engine/projection'

const props = defineProps<{
  rects: PhysicalRect[]
  cols: number
  rowPx: number
  gap: number
}>()

const rows = computed(() => props.rects.reduce((m, r) => Math.max(m, r.y + r.h), 1))
</script>

<template>
  <TransitionGroup
    tag="div"
    name="cell"
    class="grid"
    :style="{
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${rows}, ${rowPx}px)`,
      gap: `${gap}px`,
    }"
  >
    <div
      v-for="r in rects"
      :key="r.id"
      class="cell"
      :data-module="r.id"
      :style="{ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` }"
    >
      <component :is="CARD_COMPONENTS[r.id]" :variant="r.variant" :module-id="r.id" />
    </div>
  </TransitionGroup>
</template>

<style scoped>
.grid {
  display: grid;
  position: relative;
  align-content: start;
}
/* container-type: size 是卡片用 cqw/cqh 连续缩放的前提 */
.cell {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  container-type: size;
}
/* 浏览态的交互反馈。编辑态的 .cell（CanvasEditor）有 grab/selected 一套，
   这里缺一套，导致同一张卡在两个视图下手感不一致 —— 悬停像没反应。
   只接令牌里已经定义好、但闲置的 --shadow-hover，不新造值。 */
.cell > * {
  flex: 1;
  min-height: 0;
  transition:
    box-shadow var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.cell:hover > * {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
/* 按下：往下 1px + 阴影收回，形成「压下去」的立体反馈，与抬起的 hover 成对 */
.cell:active > * {
  transform: translateY(0);
  box-shadow: var(--shadow-card);
  transition-duration: 60ms;
}
/* 触屏没有 hover，卡片不该显得「没反应」——用短暂高亮代替 */
@media (hover: none) {
  .cell > * {
    transition: box-shadow 90ms var(--ease-out);
  }
  .cell:active > * {
    box-shadow: var(--shadow-hover);
    transform: none;
  }
}
</style>
