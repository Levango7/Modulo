/**
 * 「打开某个界面」的名字 → 处理函数分派（App.vue `cmdCtx.openUI` 那串 if/else if 的纯函数化）。
 *
 * 钉两件事：① 五个名字各自命中自己的处理函数、**且不碰另外四个**（原来的 else if 链
 * 靠顺序保证互斥，查表靠键唯一保证，形状不同所以要钉子）；② 未知名静默无操作不抛。
 */
import { describe, expect, it, vi } from 'vitest'
import { makeOpenUI, type OpenUIName } from '../../src/vue/openUI'

const NAMES: OpenUIName[] = ['templates', 'settings', 'palette', 'edit', 'workbench']

describe('makeOpenUI', () => {
  it.each(NAMES)('名字 %s 只触发自己的处理函数', (name) => {
    const calls: string[] = []
    const handlers = Object.fromEntries(
      NAMES.map((n) => [n, () => void calls.push(n)]),
    ) as Record<OpenUIName, () => void>
    makeOpenUI(handlers)(name)
    expect(calls).toEqual([name])
  })

  it('未知名（类型外）静默无操作，不抛也不碰任何处理函数', () => {
    const calls: string[] = []
    const handlers = Object.fromEntries(
      NAMES.map((n) => [n, () => void calls.push(n)]),
    ) as Record<OpenUIName, () => void>
    expect(() => makeOpenUI(handlers)('nope' as OpenUIName)).not.toThrow()
    expect(calls).toEqual([])
  })

  it('返回的函数可重复调用，每次都命中', () => {
    const open = vi.fn()
    const dispatch = makeOpenUI({ templates: open, settings: open, palette: open, edit: open, workbench: open })
    dispatch('palette')
    dispatch('palette')
    expect(open).toHaveBeenCalledTimes(2)
  })
})
