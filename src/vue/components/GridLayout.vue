<script setup lang="ts">
import { computed } from 'vue'
import { CARD_COMPONENTS } from '../cardComponents'
import type { PhysicalRect } from '../../engine/projection'

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
.cell > * {
  flex: 1;
  min-height: 0;
}
</style>
