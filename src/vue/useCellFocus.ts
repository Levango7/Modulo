import { nextTick } from 'vue'
import type * as E from '@levango7/engine'

/**
 * 编辑器格子的焦点跟随：删除/移动后焦点不能丢进 body，聚焦的格子要滚进视口。
 * 原先是 CanvasEditor.vue 里的 cellEls Map + focusCell/focusNearest 四个函数，
 * 抽出来之后组件只剩 runIntent 一类的「执行意图」职责。
 */
export function useCellFocus() {
  const cellEls = new Map<string, HTMLElement>()

  function setCellRef(id: string, el: unknown) {
    if (el) cellEls.set(id, el as HTMLElement)
    else cellEls.delete(id)
  }

  function focusCell(id: string) {
    nextTick(() => {
      const el = cellEls.get(id)
      if (!el) return
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }

  function focusNearest(candidates: E.Placement[], from: E.Rect) {
    if (!candidates.length) return
    const cx = from.x + from.w / 2
    const cy = from.y + from.h / 2
    const dist = (p: E.Placement) => Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy)
    focusCell([...candidates].sort((a, b) => dist(a) - dist(b))[0].id)
  }

  return { setCellRef, focusCell, focusNearest }
}
