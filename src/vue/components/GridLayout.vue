<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, provide, ref, watch } from 'vue'
import { ExternalLink, X } from 'lucide-vue-next'
import { cardComponentOf } from '../cardComponents'
import { attachCardFx } from '../cardFx'
import { flipFrames } from '../expandFlip'
import type { CardExpandFn, FlipRect } from '../expandFlip'
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
  // 事件委托只认网格的**直接子级** .cell（2026-11-28 reviewer 顺手修 A）：
  // DutyCard / HeatmapCard 卡内也有 .cell 类元素，closest 会命中它们 ——
  // 把卡内格子误挂成卡面效果（聚光/倾斜挂错了层）。父节点是网格根（.grid）才算数。
  if (!cell || cell.parentElement !== gridEl.value?.$el) return
  bindCardFx(cell.firstElementChild)
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

/**
 * 卡片原位展开 overlay（视觉刀 1·四，2026-11-28）：provide `cardExpand` 给卡组件
 * （TodoCard 的「展开」钮）。内容 = 与网格里**同一张卡组件、完全相同的 props**
 * （variant / module id / instance id 都照抄，保数据一致 —— 卡内容走 inject('cardData')，
 * 展开体与网格卡读的就是同一份数据）；不是搬运同一个 DOM 节点，而是复刻一份再 FLIP。
 *
 * 动画：WAAPI 两帧（from = 源 rect，to = flipFrames 的居中目标），关闭反向回放到源 rect
 * 再卸载；`prefers-reduced-motion` 命中则完全不播、直接显隐（tokens.css 的全局钳只压 CSS
 * 过渡，压不住 WAAPI，得自己查）。三种关闭：Esc（捕获阶段拦，别让 App 全局键再处理一遍）、
 * scrim 点击、右上角关闭钮。z-index 用 --z-modal 档，与仓内各弹层同层。
 */
const FLIP_MS = 200
const FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'

interface ExpandedCard {
  moduleId: string
  placementId: string
  variant: string
}
const expanded = ref<ExpandedCard | null>(null)
/** 关闭动画进行中——防止 Esc/点 scrim 连按期间再起一条反向动画打架 */
const expandClosing = ref(false)
const expandSrc = ref<FlipRect>({ left: 0, top: 0, width: 0, height: 0 })
const expandEl = ref<HTMLElement | null>(null)
/** 触发卡里那枚「展开」钮：关闭 overlay 时把焦点还给它的落点（reviewer 顺手修 C） */
const expandTrigger = ref<HTMLElement | null>(null)

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const openCardExpand: CardExpandFn = (moduleId, placementId, sourceEl) => {
  if (expanded.value) return
  const r = sourceEl.getBoundingClientRect()
  expandSrc.value = { left: r.left, top: r.top, width: r.width, height: r.height }
  // 焦点管理（顺手修 C，最小可用）：记下触发卡里的「展开」钮，关闭时把焦点还给它的落点
  expandTrigger.value = sourceEl.querySelector<HTMLElement>('[data-card-expand]')
  // 形态照抄网格投影里这张卡实际生效的那个（overlay 与网格同形态，卡内 cqw/cqh 缩放口径一致）
  const rect = props.rects.find((x) => x.id === placementId)
  expanded.value = { moduleId, placementId, variant: rect?.variant ?? 'default' }
}
provide('cardExpand', openCardExpand)

watch(expanded, async (v, prev) => {
  // 关闭（含反向动画结束的卸载那一刻）：焦点还给网格里那枚「展开」钮；
  // 卡已离树（删卡/换实例）就不还，不做完整 focus trap。
  if (!v) {
    if (prev && expandTrigger.value?.isConnected) expandTrigger.value.focus()
    return
  }
  if (prev) return
  await nextTick()
  const el = expandEl.value
  if (!el) return
  const { from, to, target } = flipFrames(expandSrc.value, window.innerWidth, window.innerHeight)
  // 目标位写进行内样式：动画只负责"从源 rect 飞过来"，落定后与样式一致、无跳帧
  el.style.left = `${target.left}px`
  el.style.top = `${target.top}px`
  el.style.width = `${target.width}px`
  el.style.height = `${target.height}px`
  // 打开即把焦点交给关闭钮（顺手修 C）：键盘用户 Esc / Tab 都有明确落点
  el.querySelector<HTMLElement>('.expand-close')?.focus()
  if (prefersReducedMotion()) return
  el.animate([from, to], { duration: FLIP_MS, easing: FLIP_EASING })
})

function closeCardExpand(): void {
  if (!expanded.value || expandClosing.value) return
  const el = expandEl.value
  if (!el || prefersReducedMotion()) {
    expanded.value = null
    return
  }
  expandClosing.value = true
  const { from, to } = flipFrames(expandSrc.value, window.innerWidth, window.innerHeight)
  const anim = el.animate([to, from], { duration: FLIP_MS, easing: FLIP_EASING })
  const finish = (): void => {
    expanded.value = null
    expandClosing.value = false
  }
  anim.onfinish = finish
  anim.oncancel = finish
}

/** Esc 关闭：捕获阶段拦下（与 OnboardingWizard 同一做法），App 的全局按键不再处理一遍 */
function onDocKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !expanded.value) return
  e.preventDefault()
  e.stopPropagation()
  closeCardExpand()
}
onMounted(() => document.addEventListener('keydown', onDocKeydown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocKeydown, true))
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

  <!-- 卡片原位展开 overlay（视觉刀 1·四）：Teleport 到 body，z-index 走 --z-modal 档。
       卡组件与网格里完全同款同 props（见 openCardExpand 注释），scrim 点击 / Esc / 关闭钮三种关闭。 -->
  <Teleport to="body">
    <div v-if="expanded" class="expand-scrim" @click.self="closeCardExpand">
      <div ref="expandEl" class="expand-card" role="dialog" aria-modal="true" aria-label="卡片详情">
        <button class="expand-close" title="关闭 (Esc)" aria-label="关闭详情" @click="closeCardExpand">
          <X :size="16" />
        </button>
        <component
          :is="cardComponentOf(expanded.moduleId)"
          :variant="expanded.variant"
          :module-id="expanded.moduleId"
          :instance-id="expanded.placementId"
        />
      </div>
    </div>
  </Teleport>
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
  /* 按压反馈的第一子级补一条同特异规则（2026-11-28 reviewer 顺手修 B）：
     `.cell:active > *` 是 0,2,0，压不过上面 hover 倾斜的 `.cell:hover > :first-child`
     0,3,0 —— 触屏按压时按住倾斜不归零。触屏上 tap 会带 sticky hover，:active 与
     :hover 同时命中，这里同特异且靠后，保证按压瞬间 transform 真正归零。 */
  .cell:active > :first-child {
    transform: none;
  }
}
/* 卡片原位展开 overlay（视觉刀 1·四）。scrim = 背景纱 + blur（blur(12px) 沿仓内弹层惯例）；
   展开体由 JS 把 flipFrames 的目标位写进行内样式，WAAPI 两帧驱动，落定即样式位、无跳帧。 */
.expand-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
  backdrop-filter: blur(12px);
}
.expand-card {
  position: fixed;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--bg-card-solid);
  box-shadow: var(--shadow-hover);
}
/* 展开体里就是与网格同款的卡组件：让它铺满动画驱动的外壳 */
.expand-card > * {
  width: 100%;
  height: 100%;
}
.expand-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  color: var(--text-3);
  cursor: pointer;
}
.expand-close:hover {
  color: var(--text-1);
}
</style>
