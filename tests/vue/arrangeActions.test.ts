/**
 * 排布动作名 → 执行体的定点映射（`src/vue/arrangeActions.ts`）。
 *
 * 守的是「每个名字接到的是不是它自己那个」：顶栏发的是名字，App 按名字取函数，
 * 接错了类型一样过（两边都是 `() => void`），只能靠这里逐条点名。
 * E2E 里只有「整理 / 撑满 / 紧凑」三条真的点了下拉项，收紧与行重排没有任何断言覆盖，
 * 所以这五条是它们唯一的钉子。
 */
import { describe, expect, it, vi } from 'vitest'
import { arrangeRunner, type ArrangeAction } from '../../src/vue/arrangeActions'

const ACTIONS: ArrangeAction[] = ['tidy', 'compact', 'fit', 'spread', 'reflow']

describe('排布动作映射', () => {
  /** 五个执行体各是一个 spy，靠调用记录分辨"取到了谁" */
  const makeRunners = () => ({
    tidy: vi.fn(),
    compact: vi.fn(),
    fit: vi.fn(),
    spread: vi.fn(),
    reflow: vi.fn(),
  })

  it.each(ACTIONS)('%s 取到自己那一个，且不碰别的', (action) => {
    const runners = makeRunners()
    const picked = arrangeRunner(action, runners)

    picked()

    expect(runners[action]).toHaveBeenCalledTimes(1)
    for (const other of ACTIONS) {
      if (other !== action) expect(runners[other], `${action} 不该碰到 ${other}`).not.toHaveBeenCalled()
    }
  })

  it('返回的就是表里那个函数对象本身（不是包一层的新闭包）', () => {
    const runners = makeRunners()
    for (const action of ACTIONS) {
      expect(arrangeRunner(action, runners)).toBe(runners[action])
    }
  })

  it('只查表、不执行：取执行体这一步不会顺手跑一遍', () => {
    const runners = makeRunners()
    for (const action of ACTIONS) arrangeRunner(action, runners)
    for (const action of ACTIONS) expect(runners[action]).not.toHaveBeenCalled()
  })
})
