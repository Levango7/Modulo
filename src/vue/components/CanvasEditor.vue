<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import * as E from '@modulo/engine'
import { Lock, LockOpen, Shuffle, X, LayoutGrid, Trash2 } from 'lucide-vue-next'
import type { LayoutStore } from '../store'
import { useCanvasDrag } from '../useCanvasDrag'
import { useCellFocus } from '../useCellFocus'
import { cellIntent, globalIntent, isEditableTarget, shouldPrevent } from '../keyboard'

const store = inject<LayoutStore>('store')!
const reg = store.reg

const gridEl = ref<HTMLElement | null>(null)
const sel = ref<Set<string>>(new Set())
const selCount = computed(() => sel.value.size)

const items = computed(() => store.doc.value.items)

/** 指针状态机在 `useCanvasDrag.ts`（见那里的注释：四条互相 interference 的语义为什么值得单列一个文件） */
const { drag, ghost, rowCount, toggleSelect, startMove, startNew, startResize, onCanvasPointerDown, variantOf } = useCanvasDrag({ store, gridEl, sel })

const titleOf = (p: E.Placement) => p.title ?? E.findModule(reg, p.id)?.title ?? p.id
const variantName = (p: E.Placement) => variantOf(p)?.name ?? ''
const hasVariants = (id: string) => (E.findModule(reg, id)?.variants.length ?? 0) > 1
const isSelected = (id: string) => sel.value.has(id)

function badge(p: E.Placement) {
  const v = variantOf(p)
  return v ? E.fitState({ w: p.w, h: p.h }, v) : { level: 'ideal' as const, label: '' }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
})
onMounted(() => {
  /** 挂 window 而不是容器：拖拽时 pointerdown 被 preventDefault，焦点可能仍留在 body 上，
   *  容器级监听会收不到键盘事件（实测 Ctrl+Z 失效） */
  window.addEventListener('keydown', onGlobalKey)
})

function cellStyle(p: E.Placement) {
  return { gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }
}

/* ---- 焦点跟随：删除/移动后焦点不能丢进 body，聚焦的格子要滚进视口 ---- */
const { setCellRef, focusNearest } = useCellFocus()

function clearSel() {
  sel.value = new Set()
}

/**
 * 键盘编排。**判定全在 `keyboard.ts`（纯函数，可单测）**，这里只负责执行意图。
 * 拆开的理由：这段语义（Shift 改尺寸、Alt 只动当前格、mergeKey 折叠历史）是本项目
 * 对 x-hub 声称的差异点之一 —— 它原先埋在 727 行组件里，一条断言都没有。
 */
function runIntent(intent: ReturnType<typeof cellIntent> | ReturnType<typeof globalIntent>) {
  if (!intent) return
  switch (intent.kind) {
    case 'clearSelection':
      clearSel()
      break
    case 'selectAll':
      sel.value = new Set(items.value.map((p) => p.id))
      break
    case 'deleteSelection': {
      const anchor = items.value.find((q) => q.id === [...sel.value][0])
      const rest = items.value.filter((q) => !sel.value.has(q.id))
      store.removeMany([...sel.value])
      clearSel()
      if (anchor) focusNearest(rest, anchor)
      break
    }
    case 'moveMany':
      store.moveMany(intent.ids, intent.dx, intent.dy, intent.mergeKey)
      break
    case 'resize':
      store.resize(intent.id, intent.w, intent.h, intent.mergeKey)
      break
    case 'move':
      store.move(intent.id, intent.x, intent.y, intent.mergeKey)
      break
    case 'toggleSelect':
      toggleSelect(intent.id)
      break
    case 'cycleVariant':
      store.cycleVariant(intent.id)
      break
    case 'toggleLock':
      store.toggleLock(intent.id)
      break
    case 'remove': {
      const p = items.value.find((q) => q.id === intent.id)
      if (!p) break
      const rest = items.value.filter((q) => q.id !== p.id)
      store.remove(p.id)
      focusNearest(rest, p)
      break
    }
  }
}

function onGlobalKey(e: KeyboardEvent) {
  /** 输入框里把 Ctrl+Z / Ctrl+A / Backspace 交还给原生文本编辑，别抢 */
  if (isEditableTarget(e.target)) return
  const intent = globalIntent(e, { items: items.value, selCount: selCount.value })
  if (!intent) return
  if (shouldPrevent(intent)) e.preventDefault()
  runIntent(intent)
}

/** 焦点在某个格子上时的键盘编排 */
function onCellKeydown(p: E.Placement, e: KeyboardEvent) {
  if (isEditableTarget(e.target)) return
  const intent = cellIntent(e, p, [...sel.value])
  if (!intent) return
  if (shouldPrevent(intent)) e.preventDefault()
  runIntent(intent)
}

function removeSelected() {
  store.removeMany([...sel.value])
  clearSel()
}
</script>

<template>
  <div class="editor">
    <aside class="lib">
      <h3><LayoutGrid :size="14" /> 模块库</h3>
      <p v-if="!store.available.value.length" class="muted small">全部模块都已放置</p>
      <div v-for="m in store.available.value" :key="m.id" class="lib-item">
        <div class="lib-title" @pointerdown="startNew(m.id, m.defaultVariant, $event)">{{ m.title }}</div>
        <div class="lib-variants">
          <button
            v-for="v in m.variants"
            :key="v.id"
            class="chip"
            :data-active="v.id === m.defaultVariant"
            @pointerdown="startNew(m.id, v.id, $event)"
          >
            {{ v.name }} {{ v.idealW }}×{{ v.idealH }}
          </button>
        </div>
      </div>
    </aside>

    <section class="stage">
      <div
        ref="gridEl"
        class="canvas"
        :style="{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }"
        @pointerdown="onCanvasPointerDown"
      >
        <div
          v-for="p in items"
          :key="p.id"
          class="cell"
          :data-module="p.id"
          :ref="(el: unknown) => setCellRef(p.id, el)"
          :class="{ locked: p.locked, selected: isSelected(p.id) }"
          :style="cellStyle(p)"
          tabindex="0"
          role="group"
          :aria-label="`${titleOf(p)}，${p.w} 乘 ${p.h} 格。方向键移动，Shift 加方向键缩放，空格切换选入，回车切换形态，Delete 移回模块库`"
          @pointerdown="startMove(p, $event)"
          @keydown="onCellKeydown(p, $event)"
        >
          <div class="tag">
            <span class="tag-name">{{ titleOf(p) }}</span>
            <span v-if="hasVariants(p.id)" class="tag-var">{{ variantName(p) }}</span>
          </div>
          <div class="body"><slot :item="p" /></div>
          <div class="ctrl">
            <button v-if="hasVariants(p.id)" class="cbtn" title="切换形态 (Enter)" @pointerdown.stop="store.cycleVariant(p.id)">
              <Shuffle :size="13" />
            </button>
            <button
              class="cbtn"
              :data-active="p.locked"
              :title="p.locked ? '已锁定，按 L 解锁' : '锁定 (L)'"
              @pointerdown.stop="store.toggleLock(p.id)"
            >
              <Lock v-if="p.locked" :size="13" /><LockOpen v-else :size="13" />
            </button>
            <button class="cbtn" title="移回模块库 (Delete)" @pointerdown.stop="store.remove(p.id)">
              <X :size="13" />
            </button>
          </div>
          <span class="badge" :data-level="badge(p).level">{{ badge(p).label }}</span>
          <span class="size">{{ p.w }}×{{ p.h }}</span>
          <span v-if="!p.locked" class="grip" title="拖拽调整尺寸" @pointerdown="startResize(p, $event)" />
        </div>

        <div
          v-if="drag?.preview"
          class="preview"
          :class="{ bad: drag.bad }"
          :style="{
            gridColumn: `${drag.preview.x + 1} / span ${drag.preview.w}`,
            gridRow: `${drag.preview.y + 1} / span ${drag.preview.h}`,
          }"
        />
        <div
          v-for="(g, i) in drag?.groupPreview ?? []"
          :key="`g${i}`"
          class="preview group"
          :style="{ gridColumn: `${g.x + 1} / span ${g.w}`, gridRow: `${g.y + 1} / span ${g.h}` }"
        />
        <div
          v-if="drag?.marquee"
          class="marquee"
          :style="{
            gridColumn: `${drag.marquee.x + 1} / span ${drag.marquee.w}`,
            gridRow: `${drag.marquee.y + 1} / span ${drag.marquee.h}`,
          }"
        />
        <p v-if="!items.length" class="empty muted">从左侧点住一个模块拖进来</p>
      </div>

      <div class="foot">
        <p class="hint">
          方向键移动 · Shift+方向键缩放 · 空格选入 · Enter 切形态 · Delete 移回库 · L 锁定 · Shift+点选/空白框选 · Ctrl+A 全选 · Esc 取消
        </p>
        <div v-if="selCount > 1" class="batch">
          <span>已选 {{ selCount }} 个</span>
          <button @click="store.toggleLockMany([...sel])">锁定/解锁</button>
          <button @click="removeSelected()"><Trash2 :size="13" /> 批量移回库</button>
          <button @click="clearSel()">取消选择</button>
        </div>
      </div>
    </section>

    <div v-if="drag?.started && drag.label" class="ghost" :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }">
      {{ drag.label }}
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-4);
  height: 100%;
  min-height: 0;
}
.lib {
  overflow: auto;
  padding-right: var(--space-2);
}
.lib h3 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin: 0 0 var(--space-3);
}
.lib-item {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  touch-action: none;
  transition: box-shadow var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.lib-item:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.lib-title {
  font-weight: 600;
  margin-bottom: var(--space-2);
  cursor: grab;
}
.lib-variants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  cursor: grab;
  touch-action: none;
}
.small {
  font-size: 12px;
}
.stage {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.canvas {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  flex: 1;
  min-height: 320px;
  padding: var(--space-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-xl);
  background-image: radial-gradient(var(--border-strong) 1px, transparent 1px);
  background-size: 14px 14px;
  position: relative;
  touch-action: none;
}
.cell {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: var(--frost-surface);
  border: 1px solid var(--border-soft);
  box-shadow: var(--frost-edge), var(--shadow-card);
  display: flex;
  container-type: size;
  cursor: grab;
  touch-action: none;
  transition: box-shadow var(--dur-micro) var(--ease-out);
}
.cell:hover {
  box-shadow: var(--frost-edge), var(--shadow-hover);
}
.cell.selected {
  outline: 2px solid var(--brand-500);
  outline-offset: -2px;
}
.cell.locked {
  cursor: default;
  outline: 2px dashed var(--brand-glow);
  outline-offset: -2px;
}
.cell:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus), var(--shadow-card);
}
/* 标签占独立的一条头部带，不压在卡片自身表头上（x-hub 编辑器那处叠字的根因） */
.tag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--bg-card-soft);
  color: var(--text-2);
  pointer-events: none;
}
.tag-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag-var {
  margin-left: auto;
  color: var(--text-3);
  white-space: nowrap;
}
.body {
  flex: 1;
  min-width: 0;
  padding-top: 20px;
}
.body :deep(.card) {
  height: 100%;
  background: transparent;
  border: none;
  box-shadow: none;
}
.ctrl {
  position: absolute;
  top: 22px;
  right: 4px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--dur-micro) var(--ease-out);
}
.cell:hover .ctrl,
.cell:focus .ctrl,
.cell.selected .ctrl {
  opacity: 1;
}
.cbtn {
  display: grid;
  place-items: center;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
}
.badge {
  position: absolute;
  bottom: 3px;
  left: 4px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  color: var(--text-3);
  pointer-events: none;
}
.badge[data-level='below'] {
  color: var(--c-red);
}
.badge[data-level='ideal'] {
  color: var(--c-green);
}
.size {
  position: absolute;
  bottom: 3px;
  right: 16px;
  font-size: 10px;
  color: var(--text-3);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--brand-glow) 50%);
  border-radius: 0 0 var(--radius-lg) 0;
}
.preview {
  pointer-events: none;
  border: 2px dashed var(--brand-500);
  border-radius: var(--radius-lg);
  background: var(--brand-50);
  opacity: 0.55;
}
.preview.group {
  border-style: solid;
  border-color: var(--brand-glow);
}
.preview.bad {
  border-color: var(--c-red);
  background: color-mix(in oklab, var(--c-red) 18%, transparent);
}
.marquee {
  pointer-events: none;
  border: 1px solid var(--brand-500);
  background: var(--brand-glow);
  border-radius: var(--radius-sm);
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
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
.ghost {
  position: fixed;
  z-index: var(--z-overlay);
  transform: translate(10px, 12px);
  pointer-events: none;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  font-size: 12px;
  box-shadow: var(--shadow-hover);
}
@media (max-width: 720px) {
  .editor {
    grid-template-columns: 1fr;
  }
}
</style>
