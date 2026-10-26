/**
 * 浮窗清单的判定层（`src/vue/floatList.ts`，F-08）。
 *
 * 同 `moduleFilter.test.ts` 的理由：组件层在本仓**没有测试设施**（无 @vue/test-utils / jsdom），
 * 这里是这段判定除了 E2E 之外唯一的钉子。每条断言都对着 `floatList.ts` 文件头写明的选择，
 * 改口径会红在这里而不是红在 UI 上。
 */
import { describe, expect, it } from 'vitest'
import { floatItems } from '../../src/vue/floatList'
import type { Placement } from '@levango7/engine'

const p = (id: string, module?: string): Placement =>
  ({ id, module, variant: 'a', x: 0, y: 0, w: 2, h: 2 }) as Placement

const TITLES: Record<string, string> = { todo: '待办', note: '便签', clock: '世界时钟' }
const titleOf = (m: string): string => TITLES[m] ?? m

describe('浮窗清单：顺序、序号、多实例', () => {
  it('没有浮窗时返回空数组', () => {
    expect(floatItems([p('todo'), p('note')], titleOf, new Set())).toEqual([])
  })

  it('只列在浮动的那些，顺序按版面不按集合', () => {
    const items = [p('clock'), p('todo'), p('note')]
    // Set 的插入顺序故意与版面顺序相反 —— 清单顺序不该跟着它变
    const got = floatItems(items, titleOf, new Set(['note', 'clock']))
    expect(got.map((f) => f.id)).toEqual(['clock', 'note'])
    expect(got.map((f) => f.title)).toEqual(['世界时钟', '便签'])
  })

  it('同模块第二张标序号，且序号按**整个版面**算（不是浮动集合里排第几）', () => {
    const items = [p('todo'), p('note'), p('todo:2', 'todo')]
    // 只让第二张待办浮动：它仍是「待办 2」，不会变成「待办」
    expect(floatItems(items, titleOf, new Set(['todo:2']))).toEqual([
      { id: 'todo:2', title: '待办 2', seq: 2 },
    ])
    // 两张都浮动：两张都在，序号 1 / 2
    expect(floatItems(items, titleOf, new Set(['todo', 'todo:2']))).toEqual([
      { id: 'todo', title: '待办', seq: 1 },
      { id: 'todo:2', title: '待办 2', seq: 2 },
    ])
  })

  it('标题查不到模块时退回模块 id（不编造标题、也不丢条目）', () => {
    expect(floatItems([p('ghost')], titleOf, new Set(['ghost']))).toEqual([
      { id: 'ghost', title: 'ghost', seq: 1 },
    ])
  })

  it('旧档没有 module 字段时按 id 取模块（`moduleIdOf` 的加法字段契约）', () => {
    // 旧档/模板/单实例都不写 module —— 这一条守的是「别直接拿 p.id 查注册表」那条规矩
    expect(floatItems([p('note')], titleOf, new Set(['note']))).toEqual([
      { id: 'note', title: '便签', seq: 1 },
    ])
  })

  it('版面里没有的 id（浮窗集合多出来的）不出现在清单里', () => {
    expect(floatItems([p('todo')], titleOf, new Set(['todo', '已删掉的卡']))).toEqual([
      { id: 'todo', title: '待办', seq: 1 },
    ])
  })
})
