import { describe, expect, it } from 'vitest'
import {
  groupIntoRow,
  pruneRows,
  rowsBands,
  setRowTitle,
  toggleRowCollapsed,
  ungroupRow,
} from '../../packages/engine/src/rows'
import { sanitizeRows } from '../../packages/engine/src/validate'
import { parseLayout } from '../../packages/engine/src/serialize'
import { removeItem } from '../../packages/engine/src/ops'
import { collides } from '../../packages/engine/src/geometry'
import type { LayoutDoc, Placement } from '../../packages/engine/src/types'
import { REGISTRY, doc } from '../fixtures'

/** 固定夹具：两块卡（clock 4×3 @0,0 与 sticky 3×3 @6,0），下方再压一块 todo @0,6 */
const base = (): LayoutDoc =>
  doc([
    { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 },
    { id: 'sticky', variant: 'note', x: 6, y: 0, w: 3, h: 3 },
    { id: 'todo', variant: 'list', x: 0, y: 6, w: 4, h: 4 },
  ])

const at = (d: LayoutDoc, id: string): Placement => d.items.find((p) => p.id === id)!

describe('groupIntoRow：插入式行头', () => {
  it('成员与其下方内容整体下移 1 行，行头落在腾出的位置', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'], '上午')!
    expect(g.rows).toEqual([{ id: 'r1', title: '上午', y: 0 }])
    expect(at(g, 'clock').y).toBe(1) // 0 → 1
    expect(at(g, 'sticky').y).toBe(1)
    expect(at(g, 'todo').y).toBe(7) // 6 → 7（下方一起让位）
    expect(at(g, 'clock').row).toBe('r1')
    expect(at(g, 'sticky').row).toBe('r1')
    expect(at(g, 'todo').row).toBeUndefined()
  })

  it('成组位置的 x/w/h 与相对布局原样不动', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'])!
    expect(at(g, 'clock')).toMatchObject({ x: 0, w: 4, h: 3 })
    expect(at(g, 'sticky')).toMatchObject({ x: 6, w: 3, h: 3 })
  })

  it('空标题给「新建行」；超长截断', () => {
    expect(groupIntoRow(base(), ['clock'])!.rows![0].title).toBe('新建行')
    expect(groupIntoRow(base(), ['clock'], 'x'.repeat(40))!.rows![0].title).toHaveLength(24)
  })

  it('非法输入一律 null：空表 / 重复 id / 未知 id / 已属于别的行', () => {
    expect(groupIntoRow(base(), [])).toBeNull()
    expect(groupIntoRow(base(), ['clock', 'clock'])).toBeNull()
    expect(groupIntoRow(base(), ['clock', '不存在'])).toBeNull()
    const once = groupIntoRow(base(), ['clock'])!
    expect(groupIntoRow(once, ['clock'])).toBeNull()
  })

  it('行 id 递增且跳过已占用', () => {
    const g1 = groupIntoRow(base(), ['clock'])!
    const g2 = groupIntoRow(g1, ['sticky'])!
    expect(g2.rows!.map((r) => r.id)).toEqual(['r1', 'r2'])
  })
})

describe('ungroupRow：收回行头那一行', () => {
  it('成员与下方内容上移 1 行、归属剥除、行消失', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'], '上午')!
    const u = ungroupRow(g, 'r1')!
    expect(u.rows ?? []).toEqual([])
    expect(at(u, 'clock').y).toBe(0)
    expect(at(u, 'sticky').y).toBe(0)
    expect(at(u, 'todo').y).toBe(6)
    expect(at(u, 'clock').row).toBeUndefined()
  })

  it('往返：成组→解组后与原始 doc 逐字段相同', () => {
    const b = base()
    const round = ungroupRow(groupIntoRow(b, ['clock', 'sticky'])!, 'r1')!
    expect(round.items).toEqual(b.items)
    expect(round.rows ?? []).toEqual([])
  })

  it('折叠中的行先展开再解组（成员坐标完整回来）', () => {
    const b = base()
    const g = groupIntoRow(b, ['clock', 'sticky'])!
    const c = toggleRowCollapsed(g, 'r1')!
    const u = ungroupRow(c, 'r1')!
    // 折叠→展开会把还原的成员追加到数组尾部：items 的**顺序**不是 doc 契约的一部分
    // （投影按 (y,x) 排、DOM 顺序只是绘制次序），按 id 排序逐字段比
    const sorted = (d: { items: typeof b.items }) => [...d.items].sort((x, y) => x.id.localeCompare(y.id))
    expect(sorted(u)).toEqual(sorted(b))
  })

  it('未知行 id → null', () => {
    expect(ungroupRow(base(), 'r9')).toBeNull()
  })
})

describe('toggleRowCollapsed：折叠与展开是可逆的整段位移', () => {
  it('折叠：成员移出、下方上移、行头留下（行高 1）', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'], '上午')!
    const c = toggleRowCollapsed(g, 'r1')!
    expect(c.items.map((p) => p.id)).toEqual(['todo'])
    expect(at(c, 'todo').y).toBe(4) // 7 → 4（成员区 3 行被收回）
    expect(rowsBands(c)[0]).toMatchObject({ h: 1 })
    expect(c.rows![0].collapsed).toBe(true)
    expect(c.rows![0].stash).toHaveLength(2)
  })

  it('展开：成员按相对偏移还原、下方让出成员区', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'])!
    const back = toggleRowCollapsed(toggleRowCollapsed(g, 'r1')!, 'r1')!
    expect(back.items.map((p) => p.id).sort()).toEqual(['clock', 'sticky', 'todo'])
    expect(at(back, 'clock')).toMatchObject({ x: 0, y: 1, w: 4, h: 3, row: 'r1' })
    expect(at(back, 'todo').y).toBe(7)
    expect(back.rows![0].collapsed).toBeUndefined()
    expect(back.rows![0].stash).toBeUndefined()
  })

  it('嵌套帧：折叠上面的行 A，下面折叠行 B 跟着上移；两层展开后全部还原', () => {
    // 造两行：A（clock）在上、B（todo）在下
    let d = groupIntoRow(base(), ['clock'], 'A')! // 行头 0，clock → 1
    d = groupIntoRow(d, ['todo'], 'B')! // todo 原本 y=7 → 行头 7、todo → 8
    const [a, b] = d.rows!
    expect(a.y).toBe(0)
    expect(b.y).toBe(7)
    // 两层分别折叠
    let c = toggleRowCollapsed(d, 'r1')! // 折叠 A：clock 收起 3 行，B 的行头 7 → 4
    expect(c.rows!.find((r) => r.id === 'r2')!.y).toBe(4)
    c = toggleRowCollapsed(c, 'r2')! // 折叠 B
    expect(rowsBands(c).every((v) => v.h === 1)).toBe(true)
    // 逆序展开：B 先展开（此时帧由 A 折叠后的坐标系定义）再 A
    let e = toggleRowCollapsed(c, 'r2')!
    expect(e.items.find((p) => p.id === 'todo')!.y).toBe(5) // B 行头 4 → 成员 5
    e = toggleRowCollapsed(e, 'r1')!
    expect(e.items.find((p) => p.id === 'clock')!.y).toBe(1)
    expect(e.items.find((p) => p.id === 'todo')!.y).toBe(8)
    expect(e.rows!.map((r) => r.y)).toEqual([0, 7])
  })

  it('展开时还原位被他卡占住 → 同列带向下让位，且与原 doc 不叠不丢', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'])!
    const c = toggleRowCollapsed(g, 'r1')!
    // 折叠期间在成员区位置放一张新卡（模拟用户操作）
    const intruder: Placement = { id: 'todo', variant: 'list', x: 8, y: 2, w: 4, h: 4 }
    const withIntruder: LayoutDoc = { ...c, items: [{ ...intruder, y: 1 }, ...c.items.filter((p) => p.id !== 'todo')] }
    const e = toggleRowCollapsed(withIntruder, 'r1')!
    expect(e.items).toHaveLength(3)
    for (let i = 0; i < e.items.length; i += 1) {
      for (let j = i + 1; j < e.items.length; j += 1) {
        expect(collides(e.items[i], e.items[j]), `${e.items[i].id} 与 ${e.items[j].id} 不该重叠`).toBe(false)
      }
    }
  })

  it('未知行 id → null', () => {
    expect(toggleRowCollapsed(base(), 'r9')).toBeNull()
  })
})

describe('setRowTitle / rowsBands / pruneRows', () => {
  it('setRowTitle：改名、空白名保留原名、未知行 null', () => {
    const g = groupIntoRow(base(), ['clock'], '原名')!
    expect(setRowTitle(g, 'r1', '  新名  ')!.rows![0].title).toBe('新名')
    expect(setRowTitle(g, 'r1', '   ')!.rows![0].title).toBe('原名')
    expect(setRowTitle(g, 'r9', 'x')).toBeNull()
  })

  it('rowsBands：行高 = 行头 1 行 + 成员跨度；折叠 = 1', () => {
    const g = groupIntoRow(base(), ['clock'])!
    expect(rowsBands(g)[0]).toMatchObject({ h: 1 + 3, members: ['clock'] })
    const c = toggleRowCollapsed(g, 'r1')!
    expect(rowsBands(c)[0]).toMatchObject({ h: 1, members: ['clock'] })
  })

  it('pruneRows：删光成员的行连行头一起收回（removeItem 触发的真实路径）', () => {
    const g = groupIntoRow(base(), ['clock'], '上午')!
    const after = removeItem(g, 'clock')!
    expect(after.rows ?? []).toEqual([])
    expect(at(after, 'todo').y).toBe(6) // 行头行收回后 todo 回到原位
  })

  it('pruneRows：行里还有成员就不动', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'])!
    expect(pruneRows(g).rows).toHaveLength(1)
  })
})

describe('盘上数据：sanitizeRows 孤儿剥除 + parseLayout 往返', () => {
  it('指向不存在行的归属被剥除、条目保留、有警告', () => {
    const items: Placement[] = [{ id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3, row: 'rX' }]
    const r = sanitizeRows([{ id: 'r1', title: '在的行', y: 0 }], items)
    expect(r.items[0].row).toBeUndefined()
    expect(r.rows).toHaveLength(1)
    expect(r.warnings.join()).toContain('不存在的行')
  })

  it('坏行被跳过（缺 id / y 非法 / 重复），不抛', () => {
    const r = sanitizeRows([{ y: 0 }, { id: 'r1', y: -1 }, { id: 'r1', y: 3 }, { id: 'r1', y: 3 }], [])
    expect(r.rows).toHaveLength(1)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('parseLayout：带行与折叠现场的文档往返（保存→读回）', () => {
    const g = groupIntoRow(base(), ['clock', 'sticky'], '上午')!
    const c = toggleRowCollapsed(g, 'r1')!
    const raw = JSON.stringify(c)
    const { doc: back, warnings } = parseLayout(raw, REGISTRY)
    expect(warnings.filter((w) => w.includes('行'))).toEqual([])
    expect(back.rows).toEqual([{ id: 'r1', title: '上午', y: 0, collapsed: true, stash: c.rows![0].stash }])
    expect(back.items.map((p) => p.id)).toEqual(['todo'])
    // 再展开一次仍能完整还原
    const e = toggleRowCollapsed(back, 'r1')!
    expect(e.items.find((p) => p.id === 'clock')).toMatchObject({ x: 0, y: 1, w: 4, h: 3, row: 'r1' })
  })

  it('旧档（无 rows 字段）零影响', () => {
    const { doc: back, warnings } = parseLayout(JSON.stringify(base()), REGISTRY)
    expect(back.rows).toBeUndefined()
    expect(back.items).toHaveLength(3)
    expect(warnings).toEqual([])
  })
})

describe('带内非成员（guest）：组上半带而某张高卡横跨这段 —— E2E 抓出的真实场景', () => {
  /** 与出厂版面同构：待办 6 行高，纵向横跨便签/速记的住处 */
  const wide = (): LayoutDoc =>
    doc([
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 6, h: 3 },
      { id: 'todo', variant: 'list', x: 6, y: 0, w: 6, h: 6 },
      { id: 'sticky', variant: 'note', x: 0, y: 3, w: 3, h: 3 },
      { id: 'recent', variant: 'bar', x: 0, y: 6, w: 12, h: 2 },
    ])

  it('折叠 → 展开 → 解组：带内非成员按现场还原，整份 doc 逐字段回到原样（曾塌 +6 行）', () => {
    const b = wide()
    const g = groupIntoRow(b, ['clock', 'todo'], '上半带')! // sticky（y3..6）坐在成员区 [1,7) 里 → guest
    const c = toggleRowCollapsed(g, 'r1')!
    expect(c.items.map((p) => p.id).sort(), '成员与 guest 都移出 items').toEqual(['recent', 'sticky'])
    const e = toggleRowCollapsed(c, 'r1')!
    const u = ungroupRow(e, 'r1')!
    const sorted = (d: LayoutDoc) => [...d.items].sort((x, y) => x.id.localeCompare(y.id))
    expect(sorted(u)).toEqual(sorted(b))
    expect(u.rows ?? []).toEqual([])
  })

  it('折叠期间 guest 留在带下方；rowsBands 的成员列表不含 guest（拖动/计数只认成员）', () => {
    const g = groupIntoRow(wide(), ['clock', 'todo'], '上半带')!
    const c = toggleRowCollapsed(g, 'r1')!
    expect(rowsBands(c)[0].members.sort()).toEqual(['clock', 'todo'])
    expect(rowsBands(c)[0].h).toBe(1)
    expect(c.rows![0].stash!.filter((s) => s.guest).map((s) => s.id)).toEqual(['sticky'])
  })
})

describe('覆盖补口：字段齐全的成员 / 盘上数据防御分支', () => {
  it('带标题 + 隐藏标题 + 锁定的成员：折叠展开往返后字段逐一保留', () => {
    const themed: LayoutDoc = doc([
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3, title: '我的钟', hideTitle: true, locked: true },
      { id: 'sticky', variant: 'note', x: 6, y: 0, w: 3, h: 3 },
      { id: 'todo', variant: 'list', x: 0, y: 6, w: 4, h: 4 },
    ])
    const g = groupIntoRow(themed, ['clock'], '仪式')!
    const c = toggleRowCollapsed(g, 'r1')!
    // 现场里字段齐全
    expect(c.rows![0].stash![0]).toMatchObject({ title: '我的钟', hideTitle: true, locked: true })
    // rowsBands 的未折叠侧
    expect(rowsBands(g)[0].members).toEqual(['clock'])
    const e = toggleRowCollapsed(c, 'r1')!
    expect(at(e, 'clock')).toMatchObject({ title: '我的钟', hideTitle: true, locked: true, y: 1, row: 'r1' })
  })

  it('带内非成员自身带字段（标题/锁定）：折叠现场保留、展开不设归属但字段回来', () => {
    const themed: LayoutDoc = doc([
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 6, h: 3 },
      { id: 'todo', variant: 'list', x: 6, y: 0, w: 6, h: 6 },
      { id: 'sticky', variant: 'note', x: 0, y: 3, w: 3, h: 3, title: '被收起的便签', locked: true },
    ])
    const g = groupIntoRow(themed, ['clock', 'todo'], '上半带')!
    const c = toggleRowCollapsed(g, 'r1')!
    const guest = c.rows![0].stash!.find((s) => s.guest)!
    expect(guest).toMatchObject({ id: 'sticky', title: '被收起的便签', locked: true })
    const e = toggleRowCollapsed(c, 'r1')!
    const back = e.items.find((p) => p.id === 'sticky')!
    expect(back).toMatchObject({ title: '被收起的便签', locked: true, x: 0, y: 4 })
    expect(back.row, 'guest 展开后不该有归属').toBeUndefined()
  })

  it('两行上下叠：删光上面一行的成员 → 行收回、下面那一行整体上移一行', () => {
    let d = groupIntoRow(base(), ['clock'], 'A')! // 行头 0
    d = groupIntoRow(d, ['todo'], 'B')! // A 插入后 todo 在 y7 → B 行头 7（todo 下移 1 → 8）
    const after = removeItem(d, 'clock')!
    expect(after.rows!.map((r) => r.id)).toEqual(['r2'])
    expect(after.rows![0].y, 'B 的行头应上移一行').toBe(6)
    expect(at(after, 'todo').y).toBe(7)
  })

  it('sanitizeRows：带标题的行保留标题；stash 里坏条目丢弃、好条目留下', () => {
    const items: Placement[] = [
      { id: 'clock', variant: 'big', x: 0, y: 1, w: 4, h: 3, row: 'r1' },
      { id: 'sticky', variant: 'note', x: 6, y: 1, w: 3, h: 3, row: 'r2' },
    ]
    const r = sanitizeRows(
      [
        { id: 'r1', title: '有名字的行', y: 0, collapsed: true, stash: [{ id: 'clock', x: 0, dy: 0, w: 4, h: 3, variant: 'big' }, { id: 'bad', x: 'x' }] },
        { id: 'r2', y: 0 }, // 无标题 → 「新建行」
      ],
      items,
    )
    expect(r.rows.find((x) => x.id === 'r1')).toMatchObject({ title: '有名字的行', collapsed: true })
    expect(r.rows.find((x) => x.id === 'r1')!.stash).toHaveLength(1) // 坏条目被丢
    expect(r.rows.find((x) => x.id === 'r2')!.title).toBe('新建行')
    expect(r.warnings.length).toBe(0) // 归属都有效，无孤儿
  })

  it('sanitizeItems：带 title/hideTitle/locked/row 的条目字段原样透传；坏 w 回退 idealW', () => {
    const r = sanitizeRows([{ id: 'r1', title: '行', y: 0 }], sanitizeItemsFixture())
    expect(r.rows).toHaveLength(1)
    const bad = sanitizeItemsFixture()
    expect(bad[0]).toMatchObject({ w: 4, h: 3 }) // w:'x' → idealW=4（clock big）
  })
})

/** sanitizeItems 的覆盖夹具：一条字段齐全、一条 w 非整数（走回退分支） */
function sanitizeItemsFixture(): Placement[] {
  const res = sanitizeItemsRaw([
    { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3, title: '钟', hideTitle: false, locked: true, row: 'r1' },
    { id: 'sticky', variant: 'note', x: 6, y: 0, w: 'x', h: 3 },
  ], REGISTRY).items
  return res
}

import { sanitizeItems as sanitizeItemsRaw } from '../../packages/engine/src/validate'
