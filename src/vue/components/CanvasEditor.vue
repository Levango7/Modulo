<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import * as E from '../../engine'
import { Lock, LockOpen, Shuffle, X, LayoutGrid, Trash2 } from 'lucide-vue-next'
import type { LayoutStore } from '../store'

const store = inject<LayoutStore>('store')!
const reg = store.reg
const GAP = 16
const COLS = E.LOGICAL_COLS

const gridEl = ref<HTMLElement | null>(null)
const sel = ref<Set<string>>(new Set())
const selCount = computed(() => sel.value.size)

interface Drag {
  mode: 'move' | 'resize' | 'new' | 'group' | 'marquee'
  id: string
  variant?: string
  w: number
  h: number
  startX: number
  startY: number
  originCol: number
  originRow: number
  started: boolean
  preview: E.Rect | null
  groupPreview: E.Rect[]
  marquee: E.Rect | null
  label: string
  bad: boolean
}
const drag = ref<Drag | null>(null)
const ghost = ref({ x: 0, y: 0 })

const items = computed(() => store.doc.value.items)
const rowCount = computed(() => {
  let m = items.value.reduce((acc, p) => Math.max(acc, p.y + p.h), 12)
  const d = drag.value
  if (d?.preview) m = Math.max(m, d.preview.y + d.preview.h)
  if (d?.marquee) m = Math.max(m, d.marquee.y + d.marquee.h)
  for (const r of d?.groupPreview ?? []) m = Math.max(m, r.y + r.h)
  return m
})

const titleOf = (p: E.Placement) => p.title ?? E.findModule(reg, p.id)?.title ?? p.id
const variantOf = (p: E.Placement) => E.resolveVariant(E.findModule(reg, p.id), p.variant)
const variantName = (p: E.Placement) => variantOf(p)?.name ?? ''
const hasVariants = (id: string) => (E.findModule(reg, id)?.variants.length ?? 0) > 1
const isSelected = (id: string) => sel.value.has(id)

function badge(p: E.Placement) {
  const v = variantOf(p)
  return v ? E.fitState({ w: p.w, h: p.h }, v) : { level: 'ideal' as const, label: '' }
}

function cellAt(clientX: number, clientY: number): { col: number; row: number } | null {
  const el = gridEl.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cw = (r.width - (COLS - 1) * GAP) / COLS
  const ch = (r.height - (rowCount.value - 1) * GAP) / rowCount.value
  if (cw <= 0 || ch <= 0) return null
  const col = Math.floor((clientX - r.left) / (cw + GAP))
  const row = Math.floor((clientY - r.top) / (ch + GAP))
  return { col: Math.max(0, Math.min(COLS - 1, col)), row: Math.max(0, row) }
}

function insideCanvas(clientX: number, clientY: number): boolean {
  const el = gridEl.value
  if (!el) return false
  const r = el.getBoundingClientRect()
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
}

function begin(mode: Drag['mode'], id: string, e: PointerEvent, opts: { variant?: string; w: number; h: number }) {
  e.preventDefault()
  const at = cellAt(e.clientX, e.clientY)
  drag.value = {
    mode,
    id,
    variant: opts.variant,
    w: opts.w,
    h: opts.h,
    startX: e.clientX,
    startY: e.clientY,
    originCol: at?.col ?? 0,
    originRow: at?.row ?? 0,
    started: false,
    preview: null,
    groupPreview: [],
    marquee: null,
    label: '',
    bad: false,
  }
  ghost.value = { x: e.clientX, y: e.clientY }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function stopListening() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
}

function startMove(p: E.Placement, e: PointerEvent) {
  if (p.locked) return
  const additive = e.shiftKey || e.ctrlKey || e.metaKey
  if (additive) {
    const next = new Set(sel.value)
    next.has(p.id) ? next.delete(p.id) : next.add(p.id)
    sel.value = next
    return
  }
  if (!sel.value.has(p.id)) sel.value = new Set([p.id])
  const mode = sel.value.size > 1 ? 'group' : 'move'
  if (mode === 'group' && [...sel.value].some((id) => items.value.find((q) => q.id === id)?.locked)) return
  begin(mode, p.id, e, { variant: p.variant, w: p.w, h: p.h })
}

function startNew(id: string, variant: string, e: PointerEvent) {
  const v = E.resolveVariant(E.findModule(reg, id), variant)
  if (!v) return
  begin('new', id, e, { variant: v.id, w: v.idealW, h: v.idealH })
}

function startResize(p: E.Placement, e: PointerEvent) {
  e.stopPropagation()
  if (p.locked) return
  sel.value = new Set([p.id])
  begin('resize', p.id, e, { variant: p.variant, w: p.w, h: p.h })
}

/** 空白处按下 = 框选起点（同时清掉上一次的选择） */
function onCanvasPointerDown(e: PointerEvent) {
  if (e.target !== gridEl.value) return
  sel.value = new Set()
  begin('marquee', '', e, { w: 0, h: 0 })
}

function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  ghost.value = { x: e.clientX, y: e.clientY }
  if (!d.started) {
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return
    d.started = true
  }
  const cell = insideCanvas(e.clientX, e.clientY) ? cellAt(e.clientX, e.clientY) : null

  if (d.mode === 'marquee') {
    if (!cell) return
    const a = { col: d.originCol, row: d.originRow }
    d.marquee = {
      x: Math.min(a.col, cell.col),
      y: Math.min(a.row, cell.row),
      w: Math.abs(a.col - cell.col) + 1,
      h: Math.abs(a.row - cell.row) + 1,
    }
    return
  }
  if (!cell) {
    d.preview = null
    d.groupPreview = []
    d.label = ''
    return
  }
  const p = items.value.find((q) => q.id === d.id)

  if (d.mode === 'group') {
    const dx = cell.col - d.originCol
    const dy = cell.row - d.originRow
    d.groupPreview = items.value
      .filter((q) => sel.value.has(q.id))
      .map((q) => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h }))
    d.label = `移动 ${sel.value.size} 个模块`
    return
  }

  if (d.mode === 'resize' && p) {
    const v = variantOf(p)!
    const nw = Math.min(Math.max(cell.col - p.x + 1, v.minW), COLS - p.x)
    const nh = Math.max(cell.row - p.y + 1, v.minH)
    const f = E.fitState({ w: nw, h: nh }, v)
    d.preview = { x: p.x, y: p.y, w: nw, h: nh }
    d.label = `${nw}×${nh} · ${f.label}`
    d.bad = f.level === 'below'
    return
  }

  const blockers = d.mode === 'move' && p ? items.value.filter((q) => q.id !== d.id) : items.value
  const spot = E.findFreeSpot(blockers, d.w, d.h, cell.col, cell.row, COLS)
  d.preview = spot
  const v = E.resolveVariant(E.findModule(reg, d.id), d.variant)
  const f = v ? E.fitState({ w: d.w, h: d.h }, v) : { level: 'ideal' as const, label: '' }
  d.label = `${d.w}×${d.h} · ${f.label}`
  d.bad = f.level === 'below'
}

function onUp(e: PointerEvent) {
  const d = drag.value
  stopListening()
  drag.value = null
  if (!d || !d.started) return

  if (d.mode === 'marquee') {
    const box = d.marquee
    if (box) {
      const hit = items.value.filter((p) => E.collides(p, box)).map((p) => p.id)
      sel.value = new Set(hit)
    }
    return
  }
  if (d.mode === 'group') {
    const cell = cellAt(e.clientX, e.clientY)
    if (!cell) return
    store.moveMany([...sel.value], cell.col - d.originCol, cell.row - d.originRow)
    return
  }
  if (!insideCanvas(e.clientX, e.clientY)) return
  const cell = cellAt(e.clientX, e.clientY)
  if (!cell) return
  if (d.mode === 'resize') store.resize(d.id, d.preview?.w ?? d.w, d.preview?.h ?? d.h)
  else if (d.mode === 'new') {
    store.add(d.id, cell.col, cell.row, d.variant)
    sel.value = new Set([d.id])
  } else store.move(d.id, cell.col, cell.row)
}

onBeforeUnmount(() => {
  stopListening()
  window.removeEventListener('keydown', onKeydown)
})
onMounted(() => {
  /** 挂 window 而不是容器：拖拽时 pointerdown 被 preventDefault，焦点可能仍留在 body 上，
   *  容器级监听会收不到键盘事件（实测 Ctrl+Z 失效） */
  window.addEventListener('keydown', onKeydown)
})

function cellStyle(p: E.Placement) {
  return { gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }
}

function clearSel() {
  sel.value = new Set()
}
function removeSelected() {
  store.removeMany([...sel.value])
  clearSel()
}

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  if (!n || !n.tagName) return false
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  /** 输入框里把 Ctrl+Z / Ctrl+A / Backspace 交还给原生文本编辑，别抢 */
  if (isEditable(e.target)) return
  if (e.key === 'Escape') clearSel()
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    sel.value = new Set(items.value.map((p) => p.id))
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selCount.value > 1) {
    e.preventDefault()
    store.removeMany([...sel.value])
    sel.value = new Set()
  }
}

/** 键盘编排 —— x-hub 的编辑器实测 tabindex 数为 0，这条是我们的差距点之一 */
function onCellKeydown(p: E.Placement, e: KeyboardEvent) {
  const dir: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const step = dir[e.key]
  if (step) {
    e.preventDefault()
    if (selCount.value > 1 && !e.altKey) store.moveMany([...sel.value], step[0], step[1])
    else if (e.shiftKey) store.resize(p.id, p.w + step[0], p.h + step[1])
    else store.move(p.id, p.x + step[0], p.y + step[1])
    return
  }
  if (e.key === 'Enter') store.cycleVariant(p.id)
  else if (e.key === 'l' || e.key === 'L') store.toggleLock(p.id)
  else if (e.key === 'Delete' || e.key === 'Backspace') store.remove(p.id)
  else return
  e.preventDefault()
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
          :class="{ locked: p.locked, selected: isSelected(p.id) }"
          :style="cellStyle(p)"
          tabindex="0"
          role="group"
          :aria-label="`${titleOf(p)}，${p.w} 乘 ${p.h} 格。方向键移动，Shift 加方向键缩放，回车切换形态，Delete 移回模块库`"
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
          方向键移动 · Shift+方向键缩放 · Enter 切形态 · Delete 移回库 · L 锁定 · Shift+点选/空白框选 · Ctrl+A 全选 · Esc 取消
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
