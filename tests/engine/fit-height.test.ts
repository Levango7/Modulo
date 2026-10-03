import { describe, expect, it } from 'vitest'
import * as E from '@modulo/engine'
import type { ModuleRegistry } from '@modulo/engine/types'

const REG: ModuleRegistry = [
  {
    id: 'todo',
    title: '待办',
    defaultVariant: 'list',
    variants: [{ id: 'list', name: '清单', minW: 3, minH: 3, idealW: 4, idealH: 6 }],
  },
  {
    id: 'sticky',
    title: '便签',
    defaultVariant: 'note',
    variants: [{ id: 'note', name: '便签', minW: 2, minH: 2, idealW: 2, idealH: 3 }],
  },
]

const doc = () =>
  E.toDoc([
    { id: 'todo', variant: 'list', x: 0, y: 0, w: 4, h: 6 },
    { id: 'sticky', variant: 'note', x: 4, y: 0, w: 2, h: 3 },
  ], 12)
const h = (d: E.LayoutDoc, id: string) => d.items.find((p) => p.id === id)!.h

describe('fitHeights 按内容收紧', () => {
  it('把过高的卡片收到内容真正需要的行数', () => {
    expect(h(E.fitHeights(doc(), REG, { todo: 4 }), 'todo')).toBe(4)
  })

  it('只变矮不变高：want 大于当前高度时忽略', () => {
    const src = doc()
    expect(h(E.fitHeights(src, REG, { todo: 9 }), 'todo')).toBe(6)
    expect(E.fitHeights(src, REG, { todo: 9 })).toBe(src)
  })

  it('不得低于形态最小尺寸', () => {
    expect(h(E.fitHeights(doc(), REG, { todo: 1 }), 'todo')).toBe(3)
    expect(h(E.fitHeights(doc(), REG, { sticky: 1 }), 'sticky')).toBe(2)
  })

  it('未知 id、NaN、负数一律忽略', () => {
    const out = E.fitHeights(doc(), REG, { ghost: 1, todo: NaN, sticky: -3 })
    expect([h(out, 'todo'), h(out, 'sticky')]).toEqual([6, 3])
  })

  it('没有任何变化时返回同一个引用（供上层跳过写入）', () => {
    const src = doc()
    expect(E.fitHeights(src, REG, {})).toBe(src)
    expect(E.fitHeights(src, REG, { todo: 6 })).toBe(src)
  })

  it('收紧不会引入重叠，也不改宽度与坐标', () => {
    const out = E.fitHeights(doc(), REG, { todo: 3, sticky: 2 })
    for (const p of out.items) {
      const before = doc().items.find((q) => q.id === p.id)!
      expect([p.x, p.y, p.w]).toEqual([before.x, before.y, before.w])
    }
    expect(E.collides(out.items[0], out.items[1])).toBe(false)
  })
})
