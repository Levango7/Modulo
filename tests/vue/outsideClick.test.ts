/**
 * 文档级外点关闭判定（App.vue `onDocMousedown` 的纯函数化）。
 *
 * 本文件在 **node 环境**跑，没有真 DOM —— 用最小替身撑起 `Element` 全局，
 * 被测的是「instanceof 守卫 + closest 调用」本身。真 DOM 契约由 E2E 兜：
 * layout.spec 的 storage-error / tx-dialog、reminders.spec 的 reminder-strip
 * 全靠同一套外点关闭逻辑活着。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { insideAddWrap } from '../../src/vue/outsideClick'

/**
 * 最小 Element 替身：只长 closest；`hit` = 命中 `.add-wrap`，`ancestor` = 命中祖先节点。
 * EventTarget 的三个方法是空实现 —— 被测函数只调 closest，它们的存在只是让替身
 * 过 `insideAddWrap(target: EventTarget | null)` 的形参类型（规格初版没带，typecheck 会红）。
 */
class FakeElement implements EventTarget {
  constructor(
    private readonly hit: boolean,
    private readonly ancestor: FakeElement | null = null,
  ) {}
  addEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
  removeEventListener(): void {}
  closest(sel: string): FakeElement | null {
    if (sel !== '.add-wrap') return null
    return this.ancestor ?? (this.hit ? this : null)
  }
}

describe('insideAddWrap', () => {
  beforeEach(() => {
    vi.stubGlobal('Element', FakeElement)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('点中的就是菜单自己 → true（closest 从自身开始匹配，与 contains 一致）', () => {
    expect(insideAddWrap(new FakeElement(true))).toBe(true)
  })

  it('点在菜单的后代上 → true（closest 向上走到 .add-wrap）', () => {
    expect(insideAddWrap(new FakeElement(false, new FakeElement(true)))).toBe(true)
  })

  it('点是别处 → false', () => {
    expect(insideAddWrap(new FakeElement(false))).toBe(false)
  })

  it('target 不是 Element（文本节点/普通对象）→ false 且不抛', () => {
    expect(insideAddWrap({} as EventTarget)).toBe(false)
    expect(insideAddWrap(documentlessTextNode())).toBe(false)
  })

  it('target 是 null → false', () => {
    expect(insideAddWrap(null)).toBe(false)
  })
})

/** 文本节点替身：有 nodeType 但没有 closest —— contains 时代它算"在里面"，closest 版不抛就行 */
function documentlessTextNode(): EventTarget {
  return { nodeType: 3 } as unknown as EventTarget
}
