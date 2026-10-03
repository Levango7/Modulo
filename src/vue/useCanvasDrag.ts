/**
 * 编辑器的指针状态机 —— 拖动 / 缩放 / 框选 / 成组移动。
 *
 * 从 `CanvasEditor.vue`（727 行）里抽出来的。抽它的理由不是"行数太长"这么含糊：
 * 那一坨逻辑里有**四条互相 interference 的语义**（移动让位不弹回、缩放非法就回退、
 * 6px 阈值区分点与拖、成组里含锁定项就整组不动），全塞在组件里等于没有防线 ——
 * 而这四条恰好是本项目对 x-hub 声称的差异点。
 *
 * 这里仍然碰 DOM（getBoundingClientRect / pointer 事件），所以**不是**纯函数；
 * 能纯的部分（格子换算、落位计算）已经交给引擎的 `findFreeSpot` / `fitState`。
 * 抽出来之后至少可以：① 组件回归"长什么样"，逻辑回归"怎么算"。
 */

import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import * as E from '../engine'
import type { LayoutStore } from './store'

export const GAP = 16

export interface DragState {
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

/** 6px 位移阈值：小于它就是点击，不是拖拽 */
export const DRAG_THRESHOLD = 6

export function useCanvasDrag(opts: {
  store: LayoutStore
  gridEl: Ref<HTMLElement | null>
  sel: Ref<Set<string>>
}) {
  const { store, gridEl, sel } = opts
  const reg = store.reg
  const COLS = E.LOGICAL_COLS
  const items = computed(() => store.doc.value.items)

  const drag = ref<DragState | null>(null)
  const ghost = ref({ x: 0, y: 0 })

  const rowCount = computed(() => {
    let m = items.value.reduce((acc, p) => Math.max(acc, p.y + p.h), 12)
    const d = drag.value
    if (d?.preview) m = Math.max(m, d.preview.y + d.preview.h)
    if (d?.marquee) m = Math.max(m, d.marquee.y + d.marquee.h)
    for (const r of d?.groupPreview ?? []) m = Math.max(m, r.y + r.h)
    return m
  })

  const variantOf = (p: E.Placement) => E.resolveVariant(E.findModule(reg, p.id), p.variant)

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

  function begin(mode: DragState['mode'], id: string, e: PointerEvent, o: { variant?: string; w: number; h: number }) {
    e.preventDefault()
    const at = cellAt(e.clientX, e.clientY)
    drag.value = {
      mode,
      id,
      variant: o.variant,
      w: o.w,
      h: o.h,
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
  onBeforeUnmount(stopListening)

  function toggleSelect(id: string) {
    const next = new Set(sel.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    sel.value = next
  }

  function startMove(p: E.Placement, e: PointerEvent) {
    if (p.locked) return
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      toggleSelect(p.id)
      return
    }
    if (!sel.value.has(p.id)) sel.value = new Set([p.id])
    const mode = sel.value.size > 1 ? 'group' : 'move'
    // 成组里有锁定项就整组不动：半拖半不动比完全不动更难理解
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
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
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
      d.groupPreview = items.value.filter((q) => sel.value.has(q.id)).map((q) => ({ x: q.x + dx, y: q.y + dy, w: q.w, h: q.h }))
      d.label = `移动 ${sel.value.size} 个模块`
      return
    }

    if (d.mode === 'resize' && p) {
      const v = variantOf(p)!
      // 缩放**当场**改 w/h 让内容重排；低于形态 min 会被引擎拒绝并回退，所以这里只负责算意图
      const nw = Math.min(Math.max(cell.col - p.x + 1, v.minW), COLS - p.x)
      const nh = Math.max(cell.row - p.y + 1, v.minH)
      const f = E.fitState({ w: nw, h: nh }, v)
      d.preview = { x: p.x, y: p.y, w: nw, h: nh }
      d.label = `${nw}×${nh} · ${f.label}`
      d.bad = f.level === 'below'
      return
    }

    // 移动 → 目标被占时同列带向下找最近空位，**绝不弹回**（缩放才是"非法就回退"）
    const blockers = d.mode === 'move' && p ? items.value.filter((q) => q.id !== d.id) : items.value
    d.preview = E.findFreeSpot(blockers, d.w, d.h, cell.col, cell.row, COLS)
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
      if (d.marquee) sel.value = new Set(items.value.filter((p) => E.collides(p, d.marquee!)).map((p) => p.id))
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

  return { drag, ghost, rowCount, toggleSelect, startMove, startNew, startResize, onCanvasPointerDown, cellAt, insideCanvas, variantOf }
}
