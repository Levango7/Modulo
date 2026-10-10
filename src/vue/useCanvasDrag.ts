/**
 * 编辑器的指针状态机 —— 拖动 / 缩放 / 框选 / 成组移动。
 *
 * 从 `CanvasEditor.vue`（727 行）里抽出来的。抽它的理由不是"行数太长"这么含糊：
 * 那一坨逻辑里有**四条互相 interference 的语义**（移动让位不弹回、缩放非法就回退、
 * 6px 阈值区分点与拖、成组里含锁定项就整组不动），全塞在组件里等于没有防线 ——
 * 而这四条恰好是本项目对 x-hub 声称的差异点。
 *
 * **2026-10-10 交互模型重做**：旧版拖拽可以从卡面**任何位置**发起，触摸端于是需要
 * "长按 250ms 才进拖拽"来防止误触（`dragGate` 的时间分支 + 一条非 passive 的
 * touchmove preventDefault 武装链）—— 代价是"按住等一会儿才动"的反直觉手感，
 * 用户实评为"操作起来不舒服"。新版改成 **Grafana 式的抓手语义**：拖拽只能从
 * **标题带**（`.tag`，模板侧绑定）发起，卡面 pointerdown 只做选中。意图靠**区域**
 * 区分（拖标题带=移动、点卡面=选中、卡面划动=交还滚动），不再靠时间门槛 ——
 * 所以整套长按武装链删除，`dragGate` 退化为纯位移阈值。
 *
 * 这里仍然碰 DOM（getBoundingClientRect / pointer 事件），所以**不是**纯函数；
 * 能纯的部分（格子换算、落位计算）已经交给引擎的 `findFreeSpot` / `fitState`。
 * 抽出来之后至少可以：① 组件回归"长什么样"，逻辑回归"怎么算"。
 */

import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import * as E from '@levango7/engine'
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

/**
 * 拖拽起点判定（纯函数，单测 `tests/vue/canvasDragGate.test.ts`）：
 * - `wait`：位移还没到阈值，继续等；
 * - `start`：进入拖拽。
 *
 * 旧版还有个 `cancel` 分支（触摸长按未满就先划 = 想滚动），2026-10-10 随抓手区
 * 重做一并删除 —— 拖拽入口收窄到标题带之后，卡面划动根本进不了这条状态机，
 * "区分意图"由**区域**完成，不再需要**时间**。见文件头注释。
 */
export function dragGate(distPx: number): 'wait' | 'start' {
  return distPx < DRAG_THRESHOLD ? 'wait' : 'start'
}

export function useCanvasDrag(opts: {
  store: LayoutStore
  gridEl: Ref<HTMLElement | null>
  sel: Ref<Set<string>>
  /** 编辑态的行轨高度，与浏览态同一个数（`useProjection` 的 `rowPx`）。见下面 `cellAt` 的注释 */
  rowPx: Ref<number>
}) {
  const { store, gridEl, sel, rowPx } = opts
  const reg = store.reg
  const COLS = E.LOGICAL_COLS
  const items = computed(() => store.doc.value.items)

  const drag = ref<DragState | null>(null)
  const ghost = ref({ x: 0, y: 0 })

  /**
   * 轨数 = 内容用到几行。**下限刻意不是 12**（2026-10-09 去掉）。
   *
   * 原来写 `Math.max(…, 12)`，那是在"行轨是 `minmax(0,1fr)`、画布把可用高摊给 12 轨"的前提下
   * 给空白处留落点用的。轨改成固定 `rowPx` 之后，那 12 轨会**真的占掉 12 个轨的高度**
   * （1408×1440 下 12×127+11×16 = 1700px，比画布 1329px 还高）—— 于是每次进编辑态都会多出
   * 一个全是空轨的滚动条。落点现在由**画布盒子**本身提供（`.canvas` 的 `flex: 1 0 auto`
   * 让它撑满、必要时还能长高，空白区仍在盒子里，`cellAt` 把那里换算成行号），
   * 不需要靠"多铺几行空轨"来造落点。
   */
  const rowCount = computed(() => {
    let m = items.value.reduce((acc, p) => Math.max(acc, p.y + p.h), 1)
    const d = drag.value
    if (d?.preview) m = Math.max(m, d.preview.y + d.preview.h)
    if (d?.marquee) m = Math.max(m, d.marquee.y + d.marquee.h)
    for (const r of d?.groupPreview ?? []) m = Math.max(m, r.y + r.h)
    return m
  })

  const variantOf = (p: E.Placement) => E.resolveVariant(E.findModule(reg, p.id), p.variant)

  /**
   * 指针 → 格子。**行高直接用 `rowPx`，不再从 DOM 反算**（2026-10-09 改）。
   *
   * 原先是 `ch = (r.height − (rowCount−1)·GAP) / rowCount` —— 那个式子的前提是行轨为
   * `minmax(0,1fr)`（每轨正好是"画布可摊的高度"）。轨改成固定 `rowPx` 之后，画布盒子的高度
   * 与轨高**不再有函数关系**（盒子还是撑满的，但轨是定值，底下留白），那个式子会算出
   * 一个比真实轨高小的数，落点整体偏移。
   *
   * 所以这里改成与 CSS 同一个来源：轨高就是 `rowPx`。**反算这一步本来就是"因为轨是 1fr
   * 才不得不反算"**，轨固定之后它既没必要、也不成立 —— 这也正是 §10.27 里"要改它取 ch 的
   * 方式"那个顾虑的实际结论：不是把 rowPx 塞进去算一遍，而是把反算整个删掉。
   *
   * 列向没有这个问题（列一直是 `repeat(12, minmax(0,1fr))`，画布宽就是它的宽度来源），
   * 所以 `cw` 仍是反算。
   */
  function cellAt(clientX: number, clientY: number): { col: number; row: number } | null {
    const el = gridEl.value
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cw = (r.width - (COLS - 1) * GAP) / COLS
    const ch = rowPx.value
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
    window.addEventListener('pointercancel', onCancel)
  }

  function stopListening() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
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
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      const verdict = dragGate(dist)
      if (verdict === 'wait') return
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

  /** 手势被浏览器收走（pointercancel）或触摸先划作废：清理现场，但不提交任何移动 */
  function onCancel() {
    stopListening()
    drag.value = null
  }

  return { drag, ghost, rowCount, toggleSelect, startMove, startNew, startResize, onCanvasPointerDown, cellAt, insideCanvas, variantOf }
}
