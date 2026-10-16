<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { CARD_COMPONENTS } from '../cardComponents'
import type { PhysicalRect } from '@levango7/engine/projection'

const props = defineProps<{
  rects: PhysicalRect[]
  cols: number
  rowPx: number
  gap: number
  /** 桌面壳才显示「脱离成浮窗」入口（2026-10-13 第一批） */
  canDetach?: boolean
}>()
const emit = defineEmits<{ (e: 'detach', id: string): void }>()

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
      <button
        v-if="canDetach"
        class="detach"
        title="脱离成桌面浮窗（主窗收起来它还在）"
        :aria-label="`把「${r.id}」脱离成浮窗`"
        @click.stop="emit('detach', r.id)"
      >
        <ExternalLink :size="11" />
      </button>
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
/* 「脱离成浮窗」入口：悬停/聚焦时浮在卡片右上角。热区 22×22（沿行头图标钮的做法），
   视觉 20×20 —— 浏览态此前没有任何操作按钮，所以它进来时克制到只在这一角。 */
.detach {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  color: var(--text-3);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--dur-micro) var(--ease-out), color var(--dur-micro) var(--ease-out);
}
.detach::after {
  content: '';
  position: absolute;
  inset: -3px;
}
.cell:hover .detach,
.detach:focus-visible {
  opacity: 1;
}
.detach:hover {
  color: var(--text-1);
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
