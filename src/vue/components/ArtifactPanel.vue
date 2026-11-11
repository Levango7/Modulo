<script setup lang="ts">
/**
 * 右栏产物面板（F-15 P0，契约 §1.2）。
 *
 * 三件事：
 * 1. **摆法由 App 算**（`artifactPanel.ts` 的 `artLayout`）—— 这里只消费 `width` / `overlay`
 *    两个已经算好的结果，不自己判窄屏、不自己夹对话区保底。两条真相会分叉。
 * 2. **内容是三个现有组件**（`GridLayout` / `CanvasEditor` / `StackEditor`），一个都不重写。
 *    投影也在本地另算一份（`useProjection` 量的是**本面板自己的宽**）—— 用 App 那一份
 *    等于拿 1440 的列数去画 420 的栏，卡片会全挤成一条。
 * 3. **本组件可写版面**：画布 / 堆叠视图里的拖拽与按钮直接落 `store`，与编辑态同一条写入口
 *    （进版面历史，Ctrl+Z 撤得掉）。这不是"AI 偷偷写盘" —— 是用户自己在动。
 */
import { computed, inject, ref } from 'vue'
import { PanelRightClose } from 'lucide-vue-next'
import * as E from '@levango7/engine'
import { cardComponentOf } from '../cardComponents'
import type { LayoutStore } from '../store'
import { useElementSize } from '../useElementSize'
import { useProjection } from '../useProjection'
import GridLayout from './GridLayout.vue'
import CanvasEditor from './CanvasEditor.vue'
import StackEditor from './StackEditor.vue'
import {
  ARTIFACT_VIEWS,
  ART_CANVAS_SUGGEST,
  canvasFits,
  clampArtWidth,
  type ArtifactView,
} from '../artifactPanel'

const props = defineProps<{
  /** 已经算好的列宽（0 = 折叠；App 用 `artLayout` 产出） */
  width: number
  /** 浮层形态（窄屏展开时）：不占列宽、压在对话上 */
  overlay: boolean
  view: ArtifactView
  /** 脱离成浮窗的卡不参与投影（与工作台同一份集合） */
  hidden: ReadonlySet<string>
  canDetach: boolean
}>()
const emit = defineEmits<{
  (e: 'resize', width: number): void
  (e: 'update:view', v: ArtifactView): void
  (e: 'collapse'): void
  (e: 'detach', id: string): void
}>()

const store = inject<LayoutStore>('store')!

/** 量自己的内容区：列数 / 行高 / 投影都跟着它走（初始值取默认宽度，首帧不跳） */
const bodyEl = ref<HTMLElement | null>(null)
const { width: bodyW, height: bodyH } = useElementSize(bodyEl, 420, 480)
const hiddenRef = computed(() => props.hidden)
const { cols, rowPx, gap, projection } = useProjection(store, bodyW, bodyH, hiddenRef)

/**
 * 拖拽调宽。手柄在**左边缘**：往左拖 = 变宽，所以是 `起点宽 − Δx`。
 * 指针捕获挂到手柄自己身上，move/up 就不会漏到画布里的卡片上
 * （漏出去的表现是"拖到一半开始拖卡片"）。
 */
const dragging = ref(false)
let startX = 0
let startW = 0
function onGrabDown(e: PointerEvent): void {
  dragging.value = true
  startX = e.clientX
  startW = props.width
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}
function onGrabMove(e: PointerEvent): void {
  if (!dragging.value) return
  emit('resize', clampArtWidth(startW - (e.clientX - startX)))
}
function onGrabEnd(e: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
}
/** 键盘调宽：手柄本身可聚焦，←/→ 一次 16px（不用鼠标也能改） */
function onGrabKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  emit('resize', clampArtWidth(props.width + (e.key === 'ArrowLeft' ? 16 : -16)))
}

const title = computed(() => ARTIFACT_VIEWS.find((v) => v.id === props.view)?.label ?? '版面')
</script>

<template>
  <aside
    class="artifact"
    data-artifact-panel
    :data-overlay="overlay ? '1' : '0'"
    :data-view="view"
    :data-dragging="dragging ? '1' : '0'"
    :style="overlay ? undefined : { width: `${width}px` }"
    aria-label="产物面板"
  >
    <div
      class="grab"
      data-artifact-grab
      role="separator"
      aria-orientation="vertical"
      :aria-label="`调整产物面板宽度（当前 ${width} 像素，← → 每次 16 像素）`"
      tabindex="0"
      @pointerdown="onGrabDown"
      @pointermove="onGrabMove"
      @pointerup="onGrabEnd"
      @pointercancel="onGrabEnd"
      @keydown="onGrabKey"
    />
    <header class="head">
      <span class="label">产物 · {{ title }}</span>
      <div class="seg" role="group" aria-label="产物视图">
        <button
          v-for="v in ARTIFACT_VIEWS"
          :key="v.id"
          :data-art="v.id"
          :data-active="view === v.id"
          :title="v.hint"
          @click="emit('update:view', v.id)"
        >
          {{ v.label }}
        </button>
      </div>
      <button class="fold" data-artifact-collapse title="收起产物（对话占满宽度）" @click="emit('collapse')">
        <PanelRightClose :size="14" />
      </button>
    </header>

    <div ref="bodyEl" class="body" data-artifact-body>
      <template v-if="view === 'layout'">
        <p v-if="projection.collapsed.length" class="hint" data-artifact-collapsed>
          这条宽度放不下：{{ projection.collapsed.map((c) => c.id).join('、') }}
        </p>
        <GridLayout
          :rects="projection.rects"
          :cols="cols"
          :row-px="rowPx"
          :gap="gap"
          :can-detach="canDetach"
          @detach="(id: string) => emit('detach', id)"
        />
        <p v-if="!projection.rects.length" class="hint" data-artifact-empty>
          版面是空的。跟它说「看看我的版面」它也只能看到空的 —— 去「布局编辑」拖几张卡进来。
        </p>
      </template>
      <CanvasEditor v-else-if="view === 'canvas' && canvasFits(bodyW)" :row-px="rowPx">
        <template #default="{ item }">
          <component
            :is="cardComponentOf(E.moduleIdOf(item))"
            :variant="item.variant"
            :module-id="E.moduleIdOf(item)"
            :instance-id="item.id"
            :chromeless="true"
          />
        </template>
      </CanvasEditor>
      <!-- 画布在这么窄的栏里画不出东西（它的模块库会占掉 220px）—— 不摆坏界面，给一句能做的 -->
      <div v-else-if="view === 'canvas'" class="hint-wrap" data-artifact-canvas-narrow>
        <p class="hint">
          画布视图要宽一点才画得开（它自带一列模块库，这条栏现在只有 {{ Math.round(bodyW) }}px）。
          把左边缘往左拖，或点下面这个按钮。
        </p>
        <button class="widen" data-artifact-widen @click="emit('resize', ART_CANVAS_SUGGEST)">
          拉宽到 {{ ART_CANVAS_SUGGEST }}px
        </button>
      </div>
      <StackEditor v-else />
    </div>
  </aside>
</template>

<style scoped>
.artifact {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: none;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
}
/* 浮层形态（窄屏展开）：不占列宽，压在对话上，从底部升起 */
.artifact[data-overlay='1'] {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-menu);
  max-height: 62%;
  box-shadow: var(--shadow-hover);
}
/* 手柄压在左边缘的发丝线上，自身透明 —— 平时看不见，指上去才亮 */
.grab {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
  z-index: 1;
}
.grab:hover,
.grab:focus-visible,
.artifact[data-dragging='1'] .grab {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.label {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-3);
  white-space: nowrap;
}
.seg {
  display: flex;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.seg button {
  border: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
}
.seg button[data-active='true'] {
  background: var(--accent);
  color: #fff;
}
.fold {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
}
.fold:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2);
}
.hint-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
}
.widen {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.hint {
  margin: 0 0 var(--space-2);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}
</style>
