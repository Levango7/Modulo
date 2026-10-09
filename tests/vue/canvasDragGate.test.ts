import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD, LONG_PRESS_MS, dragGate } from '../../src/vue/useCanvasDrag'

/**
 * 拖拽起点判定（2026-10-10 加）：
 * 鼠标 / 手写笔过 6px 即拖；**触摸要长按 250ms** —— 没按满就先划动 = 想滚动 / 误触，整段作废。
 * 真实链路由 E2E「触摸：长按 250ms 才进拖拽」覆盖（合成 touch 事件走指针管线）。
 */
describe('dragGate：拖拽起点判定', () => {
  it('位移不到 6px 一律等待（点击不是拖拽，与指针类型无关）', () => {
    expect(dragGate(false, 0, 0)).toBe('wait')
    expect(dragGate(false, 5000, DRAG_THRESHOLD - 1)).toBe('wait')
    expect(dragGate(true, 5000, DRAG_THRESHOLD - 1)).toBe('wait')
  })

  it('鼠标 / 手写笔：过阈值立即拖，不等长按', () => {
    expect(dragGate(false, 0, DRAG_THRESHOLD)).toBe('start')
  })

  it('触摸：长按未满就划动 → 作废（交还滚动）', () => {
    expect(dragGate(true, 0, 50)).toBe('cancel')
    expect(dragGate(true, LONG_PRESS_MS - 1, 50)).toBe('cancel')
  })

  it('触摸：长按满 250ms 后过阈值 → 拖', () => {
    expect(dragGate(true, LONG_PRESS_MS, DRAG_THRESHOLD)).toBe('start')
    expect(dragGate(true, LONG_PRESS_MS + 300, 80)).toBe('start')
  })
})
