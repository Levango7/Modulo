import { describe, expect, it } from 'vitest'
import { sanitizeItems } from '@modulo/engine/validate'
import { docToJson, parseLayout } from '@modulo/engine/serialize'
import { collides } from '@modulo/engine/geometry'
import { REGISTRY } from '../fixtures'

describe('sanitizeItems', () => {
  it('非数组回退空布局', () => {
    const { items, warnings } = sanitizeItems('nope', REGISTRY)
    expect(items).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })
  it('跳过未知模块并留 warning', () => {
    const { items, warnings } = sanitizeItems([{ id: 'ghost', variant: 'x', x: 0, y: 0, w: 2, h: 2 }], REGISTRY)
    expect(items).toEqual([])
    expect(warnings.join()).toContain('ghost')
  })
  it('重复 id 只保留第一条', () => {
    const { items } = sanitizeItems(
      [
        { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 },
        { id: 'clock', variant: 'big', x: 6, y: 0, w: 4, h: 3 },
      ],
      REGISTRY,
    )
    expect(items).toHaveLength(1)
  })
  it('非整数坐标的条目被跳过', () => {
    expect(sanitizeItems([{ id: 'clock', variant: 'big', x: 1.5, y: 0, w: 4, h: 3 }], REGISTRY).items).toEqual([])
  })
  it('失效形态归一到 defaultVariant', () => {
    const { items, warnings } = sanitizeItems([{ id: 'clock', variant: 'gone', x: 0, y: 0, w: 4, h: 3 }], REGISTRY)
    expect(items[0].variant).toBe('big')
    expect(warnings.join()).toContain('归一')
  })
  it('小于形态 min 的尺寸被抬到 min（可能引发重叠，随后被消解）', () => {
    const { items } = sanitizeItems(
      [
        { id: 'clock', variant: 'big', x: 0, y: 0, w: 1, h: 1 },
        { id: 'todo', variant: 'list', x: 0, y: 0, w: 3, h: 3 },
      ],
      REGISTRY,
    )
    expect(items[0]).toMatchObject({ w: 3, h: 3 })
    expect(collides(items[0], items[1])).toBe(false)
  })
  it('标题截断到 24 字符，纯空白标题丢弃', () => {
    const { items } = sanitizeItems(
      [
        { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3, title: 'x'.repeat(50) },
        { id: 'sticky', variant: 'note', x: 6, y: 0, w: 2, h: 2, title: '   ' },
      ],
      REGISTRY,
    )
    expect(items[0].title).toHaveLength(24)
    expect(items[1].title).toBeUndefined()
  })
  it('x 超出右边界时向内收缩', () => {
    const { items } = sanitizeItems([{ id: 'clock', variant: 'big', x: 99, y: 0, w: 4, h: 3 }], REGISTRY)
    expect(items[0].x).toBe(8)
  })
})

describe('serialize', () => {
  it('导出再导入等价', () => {
    const src = parseLayout(
      JSON.stringify({ cols: 12, items: [{ id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 }] }),
      REGISTRY,
    ).doc
    const round = parseLayout(docToJson(src), REGISTRY)
    expect(round.doc.items).toEqual(src.items)
    expect(round.warnings).toEqual([])
  })
  it('损坏 JSON 回退空布局不抛异常', () => {
    const { doc, warnings } = parseLayout('{ 这不是 JSON', REGISTRY)
    expect(doc.items).toEqual([])
    expect(warnings.join()).toContain('JSON')
  })
  it('高于当前支持的 schemaVersion 给 warning 但仍按 v1 读', () => {
    const { doc, warnings } = parseLayout(
      JSON.stringify({ schemaVersion: 9, cols: 12, items: [{ id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 }] }),
      REGISTRY,
    )
    expect(doc.items).toHaveLength(1)
    expect(warnings.join()).toContain('schemaVersion')
  })
})
