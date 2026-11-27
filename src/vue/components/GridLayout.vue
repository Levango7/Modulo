<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { cardComponentOf } from '../cardComponents'
import { attachCardFx } from '../cardFx'
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

/**
 * 浏览态卡面效果（视觉刀 1·三，2026-11-28）：给**卡组件根**（`.cell > :first-child`，
 * 不是全局 `.card` —— 那层被浮窗/编辑器/设置预览共用）挂 pointer 聚光与倾斜。
 *
 * 挂载策略 —— 三层兜，全部经 `bindCardFx` 去重：
 * 1. `onMounted` 对已挂载的卡逐个 attach（同步首屏四兄弟此时已就位）；
 * 2. `onUpdated` 对子树重同步（TransitionGroup 增删卡之后补挂），
 *    顺带把已离树的卡（含懒加载换根后留下的旧壳）解绑删除 —— 不攒垃圾；
 * 3. 网格级**事件委托**的 pointermove 兜最后一种情况：懒加载卡的根 DOM 节点是
 *    chunk 到位后才换上来的，那一步不触发本组件的更新，靠指针落到哪张卡上
 *    就把哪张卡补挂上。
 * 卸载时全部解绑；`shouldSkipCardFx` 命中的环境（reduced-motion / 触屏）在
 * attach 内部直接不绑监听，这里不用再分叉。
 */
const gridEl = ref<{ $el: HTMLDivElement | null } | null>(null)
const fxTargets = new Map<HTMLElement, () => void>()

function bindCardFx(card: Element | null | undefined): void {
  if (!(card instanceof HTMLElement) || fxTargets.has(card)) return
  fxTargets.set(card, attachCardFx(card))
}

function syncCardFx(): void {
  const cells = gridEl.value?.$el?.querySelectorAll<HTMLElement>('.cell > :first-child') ?? []
  for (const card of cells) bindCardFx(card)
  for (const [card, unbind] of fxTargets) {
    if (!card.isConnected) {
      unbind()
      fxTargets.delete(card)
    }
  }
}

const onGridPointerMove = (e: PointerEvent): void => {
  const cell = e.target instanceof Element ? e.target.closest('.cell') : null
  bindCardFx(cell?.firstElementChild)
}

onMounted(() => {
  syncCardFx()
  gridEl.value?.$el?.addEventListener('pointermove', onGridPointerMove)
})
onUpdated(syncCardFx)
onBeforeUnmount(() => {
  gridEl.value?.$el?.removeEventListener('pointermove', onGridPointerMove)
  for (const unbind of fxTargets.values()) unbind()
  fxTargets.clear()
})
</script>

<template>
  <TransitionGroup
    ref="gridEl"
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
      :data-module="r.module ?? r.id"
      :style="{ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}` }"
    >
      <!--
        `module-id` 是**模块** id（卡组件按它挑形态/尺寸契约），`instance-id` 是**实例** id
        （第二张起是 `模块:2`）—— 两张便签要各写各的内容，就得两个都给（`instanceData.ts`）。
        单实例时两者相等，行为与只给 module-id 时逐字相同。
      -->
      <component
        :is="cardComponentOf(r.module ?? r.id)"
        :variant="r.variant"
        :module-id="r.module ?? r.id"
        :instance-id="r.id"
      />
      <button
        v-if="canDetach"
        class="detach"
        title="脱离成桌面浮窗（主窗收起来它还在）"
        :aria-label="`把「${r.module ?? r.id}」脱离成浮窗`"
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
}
/* 卡组件根 = `.cell` 的首个子元素（detach 按钮排在其后）：
   玻璃壳层与倾斜效果只挂这里，**绝不挂全局 .card** —— 那层被浮窗/编辑器/设置预览共用。
   isolation 让下面两个伪元素的 z-index:-1 落在卡内部：盖住卡自己的底色、不盖内容。 */
.cell > :first-child {
  isolation: isolate;
  transition:
    box-shadow var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.cell:hover > * {
  box-shadow: var(--shadow-hover);
}
/* 悬停倾斜（视觉刀 1·三）：接管整个 transform 表达式 —— 0.16,1,0.3,1 的既有时长曲线
   保留，-1px 抬升合并进来，不再叠两层 transform 打架。角度来自 cardFx.ts 写入的
   --rx/--ry；触屏 / reduced-motion 下 JS 不绑监听，变量恒缺省，退化为 0deg 的原样抬升。 */
.cell:hover > :first-child {
  transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateY(-1px);
}
/* 按下：往下 1px + 阴影收回，形成「压下去」的立体反馈，与抬起的 hover 成对。
   上面 hover 的 :first-child 规则特异性更高，active 想压过它必须同特异且靠后 —— 否则
   按住不放时倾斜不归零，「压下去」的手感就丢了。`.cell:active > *` 原样留给按钮。 */
.cell:active > * {
  transform: translateY(0);
  box-shadow: var(--shadow-card);
  transition-duration: 60ms;
}
.cell:active > :first-child {
  transform: translateY(0);
  box-shadow: var(--shadow-card);
  transition-duration: 60ms;
}
/* 玻璃壳层（视觉刀 1）：各卡组件的实色底一个字不动（对比度门禁量的是实色语义），
   玻璃感全部走这层 ::before 叠加 —— 聚光光斑并进它的 background，两变一、少一个合成层。
   @property 让 --spot 可过渡；不认它的引擎上聚光从渐显退化为直切，壳层本身不受影响。 */
@property --spot {
  syntax: '<number>';
  initial-value: 0;
  inherits: false;
}
.cell > :first-child::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(
      180px circle at var(--mx, 50%) var(--my, 50%),
      rgba(255, 255, 255, calc(0.4 * var(--spot, 0))),
      rgba(255, 255, 255, 0) 70%
    ),
    var(--bg-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.25);
  transition: --spot var(--dur-micro) var(--ease-out);
}
.cell:hover > :first-child::before {
  --spot: 1;
}
/* 1px 边框提亮：光斑扫到哪、哪段边框亮 —— padding + mask 挖出 1px 环，环色随 --mx/--my 走 */
.cell > :first-child::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: radial-gradient(
    180px circle at var(--mx, 50%) var(--my, 50%),
    rgba(255, 255, 255, 0.55),
    rgba(255, 255, 255, 0) 70%
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity var(--dur-micro) var(--ease-out);
}
.cell:hover > :first-child::after {
  opacity: 1;
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
