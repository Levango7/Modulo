import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD, dragGate } from '../../src/vue/useCanvasDrag'

/**
 * 拖拽起点判定（2026-10-10 重写）：
 *
 * 旧契约是三元组 `(touch, elapsedMs, distPx)` —— 触摸要长按 250ms 才进拖拽，
 * 没按满先划 = 作废交还滚动。那个设计的前提是"拖拽可以从卡面任何位置发起"，
 * 于是只能用时间门槛防误触；代价是"按住等一会儿才动"的反直觉手感（用户实评
 * 「操作起来不舒服」）。
 *
 * 新契约：拖拽入口收窄到**标题带**（模板侧绑定 `startMove`），卡面 pointerdown
 * 只做选中 —— 区分意图靠**区域**，不靠**时间**。于是 `dragGate` 退化为纯位移
 * 阈值，`cancel` 分支与 `LONG_PRESS_MS` 一并删除。真实链路由 E2E 覆盖：
 * 「拖标题带=移动卡片」「卡面划动=滚动不动」。
 */
describe('dragGate：拖拽起点判定（纯位移阈值）', () => {
  it('位移不到 6px 一律等待（点击不是拖拽）', () => {
    expect(dragGate(0)).toBe('wait')
    expect(dragGate(DRAG_THRESHOLD - 1)).toBe('wait')
  })

  it('位移达到 6px 立即进入拖拽（不再有长按分支，与指针类型无关）', () => {
    expect(dragGate(DRAG_THRESHOLD)).toBe('start')
    expect(dragGate(DRAG_THRESHOLD + 1)).toBe('start')
    expect(dragGate(80)).toBe('start')
  })
})
