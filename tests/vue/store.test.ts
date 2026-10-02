import { describe, expect, it } from 'vitest'
import { createLayoutStore, memoryStorage } from '../../src/vue/store'
import type { ModuleRegistry } from '../../src/engine/types'

const REG: ModuleRegistry = [
  {
    id: 'clock',
    title: '时钟',
    defaultVariant: 'big',
    variants: [{ id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 }],
  },
  {
    id: 'sticky',
    title: '便签',
    defaultVariant: 'note',
    variants: [{ id: 'note', name: '便签', minW: 2, minH: 1, idealW: 2, idealH: 2 }],
  },
]

const fresh = () => createLayoutStore({ registry: REG, storage: memoryStorage() })

describe('layout store', () => {
  it('推荐布局在首次创建时就落盘（否则不动版面就没有存档）', () => {
    const storage = memoryStorage()
    createLayoutStore({ registry: REG, storage })
    expect(storage.get('modulo.layout.v1')).toContain('clock')
  })

  it('无存档时用推荐布局起步', () => {
    const s = fresh()
    expect(s.doc.value.items.map((p) => p.id)).toContain('clock')
  })

  /** 键盘连按走 mergeKey；下面这三条锁住「一段连续输入 = 一步」，且不带 key 时不折叠 */
  const emptyBoard = () => {
    const s = fresh()
    s.removeMany(s.doc.value.items.map((p) => p.id))
    s.add('clock', 0, 0)
    return s
  }

  it('连按方向键（同 mergeKey）折叠成一步，一次撤销回到连按之前', () => {
    const s = emptyBoard()
    const before = JSON.stringify(s.doc.value)
    s.move('clock', 1, 0, 'kbd:move:clock')
    s.move('clock', 2, 0, 'kbd:move:clock')
    s.move('clock', 3, 0, 'kbd:move:clock')
    expect(JSON.stringify(s.doc.value)).not.toBe(before)
    s.undo()
    expect(JSON.stringify(s.doc.value)).toBe(before)
  })

  it('mergeKey 不同就不折叠：要撤销两次才回到起点', () => {
    const s = emptyBoard()
    const before = JSON.stringify(s.doc.value)
    s.move('clock', 1, 0, 'kbd:move:clock')
    s.move('clock', 2, 0, 'kbd:move:sticky')
    s.undo()
    expect(JSON.stringify(s.doc.value)).not.toBe(before)
    s.undo()
    expect(JSON.stringify(s.doc.value)).toBe(before)
  })

  it('指针路径不传 mergeKey，两次拖拽就是两步（快速连拖也不被误折）', () => {
    const s = emptyBoard()
    const before = JSON.stringify(s.doc.value)
    s.move('clock', 1, 0)
    s.move('clock', 2, 0)
    s.undo()
    expect(JSON.stringify(s.doc.value)).not.toBe(before)
    s.undo()
    expect(JSON.stringify(s.doc.value)).toBe(before)
  })

  it('操作写入存储，重建 store 后能读回', () => {
    const storage = memoryStorage()
    const a = createLayoutStore({ registry: REG, storage })
    a.remove('clock')
    const b = createLayoutStore({ registry: REG, storage })
    expect(b.doc.value.items.map((p) => p.id)).not.toContain('clock')
  })

  it('撤销/重做回到前后状态', () => {
    const s = fresh()
    const before = JSON.stringify(s.doc.value)
    s.remove('clock')
    expect(s.canUndo.value).toBe(true)
    s.undo()
    expect(JSON.stringify(s.doc.value)).toBe(before)
    s.redo()
    expect(s.doc.value.items.map((p) => p.id)).not.toContain('clock')
  })

  it('库只列未放置的模块', () => {
    const s = fresh()
    expect(s.available.value.map((m) => m.id)).not.toContain('clock')
    s.remove('clock')
    expect(s.available.value.map((m) => m.id)).toContain('clock')
  })

  it('锁定项拒绝移动', () => {
    const s = fresh()
    s.toggleLock('clock')
    const x = s.doc.value.items.find((p) => p.id === 'clock')!.x
    s.move('clock', x + 2, 0)
    expect(s.doc.value.items.find((p) => p.id === 'clock')!.x).toBe(x)
  })

  it('导入损坏 JSON 不抛异常并给出 warning', () => {
    const s = fresh()
    s.importJson('{坏数据')
    expect(s.doc.value.items).toEqual([])
    expect(s.warnings.value.length).toBeGreaterThan(0)
  })
})
