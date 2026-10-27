import { describe, expect, it } from 'vitest'
import { adoptLegacyKey, createLayoutStore, memoryStorage } from '../../src/vue/store'
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

  it('setExtensions：ext 段整体替换，内置段不动；装好的扩展卡按 manifest 契约可加卡/可多开', () => {
    const s = fresh()
    const base = s.reg.length
    const card = {
      id: 'k1',
      title: '扩展一',
      group: '扩展',
      blurb: '测试卡包',
      variants: [{ id: 'std', name: '标准', minW: 1, minH: 1, idealW: 2, idealH: 2 }],
      html: '<b/>',
    }
    s.setExtensions([card])
    expect(s.reg.length).toBe(base + 1)
    expect(s.reg[s.reg.length - 1].id).toBe('ext:k1')
    expect(s.available.value.some((m) => m.id === 'ext:k1'), '模块库看得到').toBe(true)
    // 装好后就能像内置卡一样加卡（引擎能查到它的尺寸契约），第二张起 ext:k1:2
    s.add('ext:k1', 0, 0)
    s.add('ext:k1', 2, 0)
    const ids = s.doc.value.items.map((p) => p.id)
    expect(ids).toContain('ext:k1')
    expect(ids).toContain('ext:k1:2')
    // 换一份名单 = ext 段整体替换；内置段一根手指都没动
    s.setExtensions([])
    expect(s.reg.length).toBe(base)
    expect(s.reg.slice(0, base).map((m) => m.id)).toEqual(REG.map((m) => m.id))
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

describe('adoptLegacyKey：把裸 localStorage 的历史接管进适配器（一次性）', () => {
  const KEY = 'modulo.rss.v1'

  it('镜像为空时才搬：搬完镜像里有，旧值仍在（写盘失败不至于连旧值都没了）', () => {
    const storage = memoryStorage()
    let legacy: string | null = '{"a":1}'
    const out = adoptLegacyKey(storage, () => legacy, KEY)
    expect(out).toBe('{"a":1}')
    expect(storage.get(KEY)).toBe('{"a":1}')
    expect(legacy).toBe('{"a":1}') // 没删旧值
  })

  it('镜像有值就以镜像为准，绝不拿旧值覆盖新的', () => {
    const storage = memoryStorage()
    storage.set(KEY, '{"new":true}')
    let read = 0
    const out = adoptLegacyKey(storage, () => {
      read += 1
      return '{"old":true}'
    }, KEY)
    expect(out).toBe('{"new":true}')
    expect(read).toBe(0) // 连读都不读（少一次可能的异常路径）
    expect(storage.get(KEY)).toBe('{"new":true}')
  })

  it('空串当"没有"：localStorage 里的空串不是有效归档', () => {
    const storage = memoryStorage()
    expect(adoptLegacyKey(storage, () => '', KEY)).toBeNull()
    expect(storage.get(KEY)).toBeNull()
  })

  it('读 localStorage 抛错（隐私模式/配额）：按"没有"处理，不把启动带崩', () => {
    const storage = memoryStorage()
    expect(
      adoptLegacyKey(storage, () => {
        throw new Error('SecurityError')
      }, KEY),
    ).toBeNull()
  })

  it('写适配器失败：旧值照旧返回（这一轮先用着），镜像仍是空', () => {
    const storage = {
      get: () => null,
      set: () => {
        throw new Error('disk full')
      },
    }
    expect(adoptLegacyKey(storage, () => '{"a":1}', KEY)).toBe('{"a":1}')
  })

  it('两边都没有：null（调用方照旧走"没有历史"分支）', () => {
    expect(adoptLegacyKey(memoryStorage(), () => null, KEY)).toBeNull()
  })
})
