import { describe, expect, it } from 'vitest'
import * as E from '../../src/engine'
import type { ModuleRegistry } from '../../src/engine/types'

const REG: ModuleRegistry = [
  { id: 'clock', title: '时钟', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 2, idealW: 4, idealH: 3 }] },
  { id: 'todo', title: '待办', defaultVariant: 'v', variants: [{ id: 'v', name: 'v', minW: 2, minH: 2, idealW: 3, idealH: 4 }] },
]

const doc = (over: Partial<E.LayoutDoc> = {}): E.LayoutDoc => ({
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'clock', variant: 'v', x: 0, y: 0, w: 4, h: 3 }],
  ...over,
})

describe('scheme book 纯操作', () => {
  it('新建方案会设为活动项并排在最前', () => {
    const b = E.createScheme(E.emptyBook(), 's1', '工作', doc(), 10)
    expect(b.activeId).toBe('s1')
    expect(b.schemes.map((s) => s.name)).toEqual(['工作'])
  })

  it('重名自动加序号，不覆盖已有方案', () => {
    let b = E.createScheme(E.emptyBook(), 's1', '工作', doc(), 1)
    b = E.createScheme(b, 's2', '工作', doc(), 2)
    expect(b.schemes.map((s) => s.name)).toEqual(['工作 2', '工作'])
  })

  it('名称 trim 与超长截断；空名回退默认', () => {
    const b = E.createScheme(E.emptyBook(), 's1', '   ', doc(), 1)
    expect(b.schemes[0].name).toBe('未命名版面')
    expect(E.createScheme(E.emptyBook(), 's1', 'x'.repeat(80), doc(), 1).schemes[0].name).toHaveLength(32)
  })

  it('改名 / 覆盖 / 删除，删除活动项后自动落到下一条', () => {
    let b = E.createScheme(E.emptyBook(), 's1', '一', doc(), 1)
    b = E.createScheme(b, 's2', '二', doc(), 2)
    b = E.renameScheme(b, 's1', '一改')
    expect(b.schemes.find((s) => s.id === 's1')!.name).toBe('一改')
    b = E.updateScheme(b, 's1', doc({ items: [] }), 99)
    expect(b.schemes.find((s) => s.id === 's1')!.updatedAt).toBe(99)
    b = E.removeScheme(b, 's2')
    expect(b.schemes.map((s) => s.id)).toEqual(['s1'])
    expect(b.activeId).toBe('s1')
  })

  it('超过上限只保留最新的若干条', () => {
    let b = E.emptyBook()
    for (let i = 0; i < E.MAX_SCHEMES + 6; i++) b = E.createScheme(b, `s${i}`, `版面 ${i}`, doc(), i)
    expect(b.schemes).toHaveLength(E.MAX_SCHEMES)
    expect(b.schemes[0].name).toBe(`版面 ${E.MAX_SCHEMES + 5}`)
  })
})

describe('parseBook / mergeBooks 对外来数据不设防', () => {
  it('损坏 JSON 回退空册并给 warning', () => {
    const { book, warnings } = E.parseBook('{坏', REG)
    expect(book.schemes).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('逐条校验：未知模块被剔除，全空方案的条目被丢弃', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'a',
      schemes: [
        { id: 'a', name: '好', doc: doc(), updatedAt: 1 },
        { id: 'b', name: '空', doc: { items: [{ id: 'ghost', variant: 'v', x: 0, y: 0, w: 2, h: 2 }] }, updatedAt: 2 },
      ],
    })
    const { book, warnings } = E.parseBook(raw, REG)
    expect(book.schemes.map((s) => s.id)).toEqual(['a'])
    expect(book.activeId).toBe('a')
    expect(warnings.join()).toContain('空')
  })

  it('activeId 指向不存在的方案时归空', () => {
    const raw = JSON.stringify({ activeId: 'nope', schemes: [{ id: 'a', name: 'A', doc: doc(), updatedAt: 1 }] })
    expect(E.parseBook(raw, REG).book.activeId).toBeNull()
  })

  it('合并导入不覆盖已有方案：id 与名称各自加后缀', () => {
    const base = E.createScheme(E.emptyBook(), 's1', '工作', doc(), 1)
    const incoming = E.parseBook(
      JSON.stringify({ schemes: [{ id: 's1', name: '工作', doc: doc(), updatedAt: 5 }] }),
      REG,
    ).book
    const merged = E.mergeBooks(base, incoming)
    expect(merged.schemes).toHaveLength(2)
    expect(merged.schemes[0]).toMatchObject({ name: '工作 2' })
    expect(merged.schemes[0].id).not.toBe('s1')
    expect(merged.activeId).toBe('s1')
  })

  it('导出再导入等价', () => {
    let b = E.createScheme(E.emptyBook(), 's1', '一', doc(), 1)
    b = E.createScheme(b, 's2', '二', doc({ items: [{ id: 'todo', variant: 'v', x: 0, y: 0, w: 3, h: 4 }] }), 2)
    const round = E.parseBook(E.bookToJson(b), REG).book
    expect(round.schemes.map((s) => [s.id, s.name, s.doc.items.length])).toEqual(
      b.schemes.map((s) => [s.id, s.name, s.doc.items.length]),
    )
    expect(round.activeId).toBe(b.activeId)
  })
})
