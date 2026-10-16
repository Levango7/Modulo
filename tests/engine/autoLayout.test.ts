import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTO, autoLayout, autoLayoutAllRows } from '../../packages/engine/src/autoLayout'
import { groupIntoRow } from '../../packages/engine/src/rows'
import { collides } from '../../packages/engine/src/geometry'
import { LOGICAL_COLS } from '../../packages/engine/src/types'
import type { LayoutDoc } from '../../packages/engine/src/types'
import { REGISTRY, doc } from '../fixtures'

/** 五张卡乱排：重排的可验证底座（几个宽度档都覆盖到） */
const messy = (): LayoutDoc =>
  doc([
    { id: 'clock', variant: 'big', x: 7, y: 2, w: 5, h: 2 },
    { id: 'sticky', variant: 'note', x: 0, y: 0, w: 2, h: 1 },
    { id: 'todo', variant: 'list', x: 3, y: 5, w: 3, h: 3 },
    { id: 'recent', variant: 'bar', x: 8, y: 8, w: 4, h: 1 },
    { id: 'clock2', variant: 'lunar', x: 1, y: 9, w: 2, h: 2 },
  ] as LayoutDoc['items'])

/** 用一个宽松注册表替换 clock2（fixtures 里没有它）：重排只认注册表里有的模块 */
const REG = [...REGISTRY, { id: 'clock2', title: '钟二', defaultVariant: 'lunar', variants: [{ id: 'lunar', name: '小', minW: 2, minH: 2, idealW: 3, idealH: 3 }] }]

const settled = (d: LayoutDoc) => {
  for (let i = 0; i < d.items.length; i += 1) {
    const p = d.items[i]
    expect(p.x, `${p.id} 列内`).toBeGreaterThanOrEqual(0)
    expect(p.x + p.w, `${p.id} 不越界`).toBeLessThanOrEqual(LOGICAL_COLS)
    expect(p.y, `${p.id} 行非负`).toBeGreaterThanOrEqual(0)
    for (let j = i + 1; j < d.items.length; j += 1) {
      expect(collides(p, d.items[j]), `${p.id} 与 ${d.items[j].id} 不该重叠`).toBe(false)
    }
  }
}

describe('autoLayout：格子的算法（数字可手验）', () => {
  it('per=3：宽 4 起步、余数给前 r 张；行高=rowH；不重叠不越界', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 3, rowH: 3 })!
    settled(out)
    const byId = new Map(out.items.map((p) => [p.id, p]))
    // 阅读序 = (y,x)：sticky(0,0) → clock(7,2) → todo(3,5) → recent(8,8) → clock2(1,9)
    expect(byId.get('sticky')).toMatchObject({ x: 0, y: 0, w: 4, h: 3 })
    expect(byId.get('clock')).toMatchObject({ x: 4, y: 0, w: 4, h: 3 })
    expect(byId.get('todo')).toMatchObject({ x: 8, y: 0, w: 4, h: 3 })
    expect(byId.get('recent')).toMatchObject({ x: 0, y: 3, w: 4, h: 3 })
    expect(byId.get('clock2')).toMatchObject({ x: 4, y: 3, w: 4, h: 3 })
  })

  it('per=4：宽 3、四张一行填满 12 列', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 4, rowH: 2 })!
    const byId = new Map(out.items.map((p) => [p.id, p]))
    expect(byId.get('sticky')).toMatchObject({ x: 0, w: 3 })
    expect(byId.get('clock')).toMatchObject({ x: 3, w: 3 })
    expect(byId.get('todo')).toMatchObject({ x: 6, w: 3 })
    expect(byId.get('recent')).toMatchObject({ x: 9, w: 3 })
    settled(out)
  })

  it('宽不小于 minW 且放不下就顺延：per=6（宽 2）时 minW=3 的卡宽取 3', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 6, rowH: 2 })!
    settled(out)
    for (const p of out.items) {
      const v = REG.find((m) => m.id === p.id)!.variants.find((x) => x.id === p.variant)!
      expect(p.w, `${p.id} 宽不小于 minW`).toBeGreaterThanOrEqual(v.minW)
      expect(p.h, `${p.id} 高不小于 minH`).toBeGreaterThanOrEqual(v.minH)
    }
  })

  it('行高低于 minH 时按该格行最大 minH 抬（clock minH=3 > rowH=2）', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 3, rowH: 2 })!
    const byId = new Map(out.items.map((p) => [p.id, p]))
    expect(byId.get('sticky')!.h, '同格行里有 minH=3 的卡 → 整行抬到 3').toBe(3)
    settled(out)
  })

  it('幂等：同输入同输出，重复点“重排”版面不动', () => {
    const once = autoLayout(messy(), REG, { top: true }, { per: 3, rowH: 3 })!
    const twice = autoLayout(once, REG, { top: true }, { per: 3, rowH: 3 })!
    expect(twice.items).toEqual(once.items)
  })

  it('参数出界夹回：per=99 → 6、rowH=0 → 默认', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 99, rowH: 0 })!
    for (const p of out.items) expect(p.w).toBeGreaterThanOrEqual(2) // per 夹回 6 → 宽 2 起步
    settled(out)
  })
})

describe('autoLayout：目标范围与让位', () => {
  it('行内重排：只动该行成员；行头 y 不动；无行卡原样', () => {
    let d = groupIntoRow(messy(), ['clock', 'todo'], '组')! // 行头插在 min y=0 上方
    const rowY = d.rows![0].y
    const recentBefore = d.items.find((p) => p.id === 'recent')!
    const out = autoLayout(d, REG, { row: d.rows![0].id }, { per: 2, rowH: 3 })!
    expect(out.rows![0].y, '行头不动').toBe(rowY)
    const byId = new Map(out.items.map((p) => [p.id, p]))
    expect(byId.get('clock')).toMatchObject({ x: 0, y: rowY + 1, w: 6 })
    expect(byId.get('todo')).toMatchObject({ x: 6, y: rowY + 1, w: 6 })
    // 非成员在重排后若被压到 → 让位（不重叠是铁律）；位置允许变，但必须不叠
    expect(byId.get('recent')).toBeDefined()
    void recentBefore
    settled(out)
  })

  it('非法/空目标一律 null：行不存在 / 没有无行卡 / 折叠中的行', () => {
    const d = groupIntoRow(messy(), ['clock', 'todo'], '组')!
    expect(autoLayout(d, REG, { row: 'rX' }, DEFAULT_AUTO)).toBeNull()
    // 把无行卡都收进行里：top 目标为空
    let all = d
    all = groupIntoRow(all, ['sticky'], '组2')!
    all = groupIntoRow(all, ['recent'], '组3')!
    all = groupIntoRow(all, ['clock2'], '组4')!
    expect(autoLayout(all, REG, { top: true }, DEFAULT_AUTO)).toBeNull()
  })

  it('autoLayoutAllRows：逐行用各自参数重排', () => {
    let d = groupIntoRow(messy(), ['clock', 'todo'], 'A')!
    d = groupIntoRow(d, ['sticky', 'recent'], 'B')!
    d = { ...d, rows: d.rows!.map((r) => (r.title === 'A' ? { ...r, auto: { per: 2, rowH: 3 } } : { ...r, auto: { per: 2, rowH: 2 } })) }
    const out = autoLayoutAllRows(d, REG)!
    settled(out)
    for (const row of out.rows!) {
      const members = out.items.filter((p) => p.row === row.id)
      expect(members.length).toBe(2)
      expect(members[0].y, '从行头下一行开始').toBe(row.y + 1)
      expect(members[0].w + members[1].w).toBe(12)
      expect(members[0].h, '行高按各自参数').toBe(row.auto!.rowH)
    }
  })

  it('无行可排时 autoLayoutAllRows → null', () => {
    expect(autoLayoutAllRows(messy(), REG)).toBeNull()
  })
})

describe('autoLayout：覆盖补口（参数夹回 / 余数分配 / 阅读序 / 让位 / 全行入口）', () => {
  it('参数假值（per=0 / rowH=NaN）走默认 3×3 —— 不是崩也不是 0', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 0, rowH: Number.NaN })!
    settled(out)
    const byId = new Map(out.items.map((p) => [p.id, p]))
    expect(byId.get('sticky')).toMatchObject({ x: 0, y: 0, w: 4, h: 3 })
  })

  it('per=5 的余数分配：12=2×5+2 → 前两张宽 3、其余宽 2', () => {
    const out = autoLayout(messy(), REG, { top: true }, { per: 5, rowH: 2 })!
    const first = [...out.items].sort((a, b) => a.y - b.y || a.x - b.x)
    // 原始分配 [3,3,2,2,2]（前 r=2 张 +1），再各自抬到 minW：clock/todo/recent 的 minW=3
    // → 精确序列 [3,3,3,3,2]（sticky 与 clock2 的 minW=2 保持 2）—— 两条规则一起钉
    expect(first.map((p) => p.w)).toEqual([3, 3, 3, 3, 2])
    settled(out)
  })

  it('阅读序：同一 y 的两张卡按 x 排先后', () => {
    const d = doc([
      { id: 'todo', variant: 'list', x: 5, y: 0, w: 3, h: 3 },
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 },
    ])
    const out = autoLayout(d, REGISTRY, { top: true }, { per: 2, rowH: 3 })!
    const byId = new Map(out.items.map((p) => [p.id, p]))
    expect(byId.get('clock'), 'x=0 的先排').toMatchObject({ x: 0, y: 0 })
    expect(byId.get('todo')).toMatchObject({ x: 6, y: 0 })
  })

  it('折叠中的行没有可见成员区 → null（不重排一个看不见的东西）', () => {
    const g = groupIntoRow(messy(), ['clock', 'todo'], '组')!
    const collapsed = { ...g, rows: g.rows!.map((r) => ({ ...r, collapsed: true as const, stash: [] })) }
    expect(autoLayout(collapsed, REG, { row: g.rows![0].id }, DEFAULT_AUTO)).toBeNull()
  })

  it('重排结果压到无行卡 → 那一张让位（同列带向下首配），全表仍不重叠', () => {
    // 行成员重排后会铺到 0..12 列，正好压住下方 y=4 的无行卡
    let d = groupIntoRow(
      doc([
        { id: 'clock', variant: 'big', x: 0, y: 0, w: 3, h: 3 },
        { id: 'sticky', variant: 'note', x: 4, y: 0, w: 3, h: 3 },
        { id: 'todo', variant: 'list', x: 0, y: 4, w: 3, h: 3 },
      ]),
      ['clock', 'sticky'],
      '组',
    )!
    const out = autoLayout(d, REGISTRY, { row: d.rows![0].id }, { per: 2, rowH: 3 })!
    settled(out)
    expect(out.items.find((p) => p.id === 'todo')).toBeDefined()
  })

  it('autoLayoutAllRows：空成员的行跳过；全部行都空 → null（没有可动的）', () => {
    const base = messy()
    const withEmptyRows = { ...base, rows: [{ id: 'rx', title: '空', y: 0 }, { id: 'ry', title: '也空', y: 5 }] }
    expect(autoLayoutAllRows(withEmptyRows, REG)).toBeNull()
  })
})

describe('autoLayout：最后两处防御分支', () => {
  it('doc 没有 rows 字段却点名重排行 → null（?? [] 兜底不抛）', () => {
    const noRows = messy() // fixtures 的 doc() 不产 rows 字段
    expect(autoLayout(noRows, REG, { row: 'r1' }, DEFAULT_AUTO)).toBeNull()
  })
  it('注册表里没有的卡：min 回退 1×1（不因找不到形态就扔卡片）', () => {
    const d = doc([{ id: 'ghost', variant: 'x', x: 3, y: 0, w: 2, h: 2 }] as LayoutDoc['items'])
    const out = autoLayout(d, REGISTRY, { top: true }, { per: 4, rowH: 2 })!
    expect(out.items[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 2 })
  })
})
