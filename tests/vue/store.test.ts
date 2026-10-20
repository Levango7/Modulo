import { describe, expect, it } from 'vitest'
import { createLayoutStore, memoryStorage } from '../../src/vue/store'
import type { ModuleRegistry } from '@levango7/engine/types'

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
  it('出厂默认模板在首次创建时就落盘（否则不动版面就没有存档）', () => {
    const storage = memoryStorage()
    createLayoutStore({ registry: REG, storage })
    expect(storage.get('modulo.layout.v1')).toContain('clock')
  })

  it('无存档时用出厂默认模板起步', () => {
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

  it('模块库列全部模块 —— 多开：同一张卡可以放第二张', () => {
    const s = fresh()
    expect(s.available.value.map((m) => m.id)).toContain('clock')
    // 第二张拿 `模块:2` 的实例 id，并记住自己属于哪个模块
    s.add('clock', 0, 0)
    const ids = s.doc.value.items.map((p) => p.id)
    expect(ids).toContain('clock')
    expect(ids).toContain('clock:2')
    const second = s.doc.value.items.find((p) => p.id === 'clock:2')!
    expect(second.module).toBe('clock')
    // 第三张继续递增；删掉中间一张后复用最小空位
    s.add('clock', 0, 0)
    expect(s.doc.value.items.map((p) => p.id)).toContain('clock:3')
    s.remove('clock:2')
    s.add('clock', 0, 0)
    expect(s.doc.value.items.map((p) => p.id)).toContain('clock:2')
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

describe('行容器与 store 的交互（阶段 B）', () => {
  it('折叠的成员仍记在 placedIds 里（折叠≠卸载；多开后模块库不再据此隐藏', () => {
    const s = fresh()
    s.add('clock', 0, 0)
    s.add('sticky', 0, 4)
    s.groupIntoRow(['clock'])
    const rowId = s.doc.value.rows![0].id
    s.toggleRow(rowId)
    expect(s.doc.value.items.some((p) => p.id === 'clock'), '折叠后不在 items 里').toBe(false)
    expect(s.placedIds.value.has('clock'), '折叠现场也算"在版面上"').toBe(true)
    // 展开后原样回来
    s.toggleRow(rowId)
    expect(s.doc.value.items.some((p) => p.id === 'clock')).toBe(true)
  })

  it('删光行里的卡：行自动消失（pruneRows 的真实入口）', () => {
    const s = fresh()
    s.add('clock', 0, 0)
    s.add('sticky', 0, 4)
    s.groupIntoRow(['clock'])
    expect(s.doc.value.rows).toHaveLength(1)
    s.remove('clock')
    expect(s.doc.value.rows ?? []).toHaveLength(0)
  })
})

describe('编辑器事务的 store 原语（restore，2026-10-12）', () => {
  it('restore 把整份版面换回快照，并写进存储', () => {
    const storage = memoryStorage()
    // 出厂模板已含 clock/sticky（add 会被去重成 no-op）—— 用"移动"制造一份真实改动
    const s = createLayoutStore({ registry: REG, storage })
    const snapshot = s.doc.value
    s.move('sticky', 0, 5)
    expect(JSON.stringify(s.doc.value)).not.toBe(JSON.stringify(snapshot))
    s.restore(snapshot)
    expect(JSON.stringify(s.doc.value)).toBe(JSON.stringify(snapshot))
    expect(storage.get('modulo.layout.v1')).toBe(JSON.stringify(snapshot))
  })

  it('restore 是历史里的一步：Ctrl+Z 能把"取消"再踩回去，重做也成对', () => {
    const s = fresh()
    const snapshot = s.doc.value
    s.move('sticky', 0, 5)
    const edited = JSON.stringify(s.doc.value)
    s.restore(snapshot)
    expect(JSON.stringify(s.doc.value)).toBe(JSON.stringify(snapshot))
    expect(s.canUndo.value, '还原本身压了一步历史').toBe(true)
    s.undo()
    expect(JSON.stringify(s.doc.value), '撤销"取消"找回改动').toBe(edited)
    s.redo()
    expect(JSON.stringify(s.doc.value), '重做回去仍是快照').toBe(JSON.stringify(snapshot))
  })

  it('restore 同一份快照是 no-op（不产生空历史步）', () => {
    const s = fresh()
    const snapshot = s.doc.value
    const undoableBefore = s.canUndo.value
    s.restore(snapshot)
    expect(s.canUndo.value).toBe(undoableBefore)
  })
})
