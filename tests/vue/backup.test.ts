import { describe, expect, it } from 'vitest'
import { BACKUP_KIND, BACKUP_VERSION, emptyCardData, buildBackup, backupToJson, parseBackup } from '../../src/vue/backup'
import type { CardData } from '../../src/vue/cardData'
import type { LayoutDoc, SchemeBook } from '@modulo/engine'
import { REGISTRY } from '../../src/vue/cardRegistry'

const layout: LayoutDoc = {
  schemaVersion: 1,
  cols: 12,
  items: [
    { id: 'clock', variant: 'big', x: 0, y: 0, w: 5, h: 3 },
    { id: 'todo', variant: 'list', x: 5, y: 0, w: 4, h: 6 },
  ],
}

const book: SchemeBook = {
  schemaVersion: 1,
  activeId: 's1',
  schemes: [{ id: 's1', name: '我的排法', doc: layout, updatedAt: 1000 }],
}

const cardData: CardData = {
  sticky: '别忘了交房租',
  todos: [
    { id: 't1', text: '写周报', done: false },
    { id: 't2', text: '买咖啡豆', done: true },
  ],
  notes: [{ id: 'n1', title: '想法', body: '把投影抽成包', at: 5 }],
  countdown: { label: '元旦', date: '2027-01-01' },
}

function makePayload(over: Partial<Parameters<typeof buildBackup>[0]> = {}) {
  return buildBackup({ layout, schemes: book, cardData, app: '0.2.0', ...over })
}

describe('buildBackup：三样东西必须都在里面', () => {
  it('导出后逐项还原：版面、方案册、卡片内容一个不少', () => {
    const back = parseBackup(backupToJson(makePayload()), REGISTRY)
    expect(back.kind).toBe('backup')
    expect(back.layout?.items.map((i) => i.id)).toEqual(['clock', 'todo'])
    expect(back.schemes?.schemes.map((s) => s.name)).toEqual(['我的排法'])
    expect(back.cardData?.sticky).toBe('别忘了交房租')
    expect(back.cardData?.todos.map((t) => t.text)).toEqual(['写周报', '买咖啡豆'])
    expect(back.cardData?.notes.map((n) => n.title)).toEqual(['想法'])
    expect(back.cardData?.countdown).toEqual({ label: '元旦', date: '2027-01-01' })
  })

  it('summary 报的是事实，导入前的确认框靠它说话', () => {
    const back = parseBackup(backupToJson(makePayload()), REGISTRY)
    expect(back.summary).toEqual({ modules: 2, todos: 2, notes: 1, sticky: true, schemes: 1, countdown: true })
  })

  it('没设过倒数日时 summary 如实说不（确认框不该凭空多一句）', () => {
    const back = parseBackup(backupToJson(makePayload({ cardData: { ...cardData, countdown: { label: '', date: '' } } })), REGISTRY)
    expect(back.summary.countdown).toBe(false)
  })

  it('深拷贝：导出后用户新敲的字不会跟着进包', () => {
    const live: CardData = { sticky: '原样', todos: [{ id: 't1', text: '一', done: false }], notes: [], countdown: { label: '原样', date: '2027-01-01' } }
    const payload = makePayload({ cardData: live })
    live.sticky = '后来改的'
    live.todos.push({ id: 't9', text: '后来加的', done: false })
    live.countdown.label = '后来改的名字'
    expect(payload.cardData.sticky).toBe('原样')
    expect(payload.cardData.todos).toHaveLength(1)
    expect(payload.cardData.countdown.label).toBe('原样')
  })

  it('kind 与 version 是这份包自己的元数据，不与版面 schemaVersion 混用', () => {
    const p = makePayload()
    expect(p.kind).toBe(BACKUP_KIND)
    expect(p.version).toBe(BACKUP_VERSION)
    expect(p.app).toBe('0.2.0')
  })
})

describe('parseBackup：旧文件不该因为格式升级就导不进来', () => {
  it('认旧版布局导出，并且照样逐条清洗', () => {
    const raw = JSON.stringify({ schemaVersion: 1, cols: 12, items: [{ id: 'clock', variant: 'big', x: 0, y: 0, w: 99, h: 3 }, { id: '不存在', x: 0, y: 0, w: 2, h: 2 }] })
    const back = parseBackup(raw, REGISTRY)
    expect(back.kind).toBe('layout')
    expect(back.layout?.items).toHaveLength(1)
    expect(back.warnings.join()).toContain('未知模块')
  })

  it('认旧版方案册导出', () => {
    const back = parseBackup(JSON.stringify(book), REGISTRY)
    expect(back.kind).toBe('schemes')
    expect(back.schemes?.schemes).toHaveLength(1)
    expect(back.layout).toBeNull()
    expect(back.cardData).toBeNull()
  })

  it('认不出就什么都不导，并说明原因 —— 绝不"尽力而为"地猜', () => {
    for (const raw of ['{ 坏 json', '[]', 'null', '"字符串"', '{}', JSON.stringify({ foo: 1 })]) {
      const back = parseBackup(raw, REGISTRY)
      expect(back.kind, raw).toBe('unknown')
      expect(back.layout, raw).toBeNull()
      expect(back.schemes, raw).toBeNull()
      expect(back.cardData, raw).toBeNull()
      expect(back.warnings.length, raw).toBeGreaterThan(0)
    }
  })
})

describe('parseBackup：坏数据走清洗，不抛也不静默', () => {
  it('永不抛异常', () => {
    expect(() => parseBackup('undefined', REGISTRY)).not.toThrow()
    expect(() => parseBackup('{"kind":"modulo.backup","layout":42}', REGISTRY)).not.toThrow()
  })

  it('布局整份坏掉时回退空布局并留 warning，不是整包失败', () => {
    const raw = JSON.stringify({ ...makePayload(), layout: { items: '不是数组' } })
    const back = parseBackup(raw, REGISTRY)
    expect(back.layout?.items).toEqual([])
    expect(back.warnings.length).toBeGreaterThan(0)
  })

  it('卡片内容形状不对：清空并说明，不拿示例内容糊上去', () => {
    const raw = JSON.stringify({ ...makePayload(), cardData: { sticky: 42, todos: 'nope' } })
    const back = parseBackup(raw, REGISTRY)
    expect(back.cardData).toEqual(emptyCardData())
    expect(back.warnings.join()).toContain('卡片内容')
  })

  it('缺 schemes 字段：恢复版面与内容，并明说方案册没有', () => {
    const raw = JSON.stringify({ kind: BACKUP_KIND, version: 1, layout, cardData })
    const back = parseBackup(raw, REGISTRY)
    expect(back.layout?.items).toHaveLength(2)
    expect(back.schemes).toBeNull()
    expect(back.cardData?.todos).toHaveLength(2)
    expect(back.warnings.join()).toContain('没有方案册')
  })

  it('备份格式版本高于当前支持：告警并按当前版本读', () => {
    const raw = JSON.stringify({ ...makePayload(), version: 99 })
    const back = parseBackup(raw, REGISTRY)
    expect(back.warnings.join()).toContain('v99')
    expect(back.layout?.items).toHaveLength(2)
  })

  it('包里的未知模块被剔除并留 warning（不信任外来文件）', () => {
    const raw = JSON.stringify({ ...makePayload(), layout: { ...layout, items: [...layout.items, { id: '外来的', variant: 'x', x: 0, y: 9, w: 2, h: 2 }] } })
    const back = parseBackup(raw, REGISTRY)
    expect(back.layout?.items.map((i) => i.id)).toEqual(['clock', 'todo'])
    expect(back.warnings.join()).toContain('外来的')
  })

  it('内容里的原型污染键不会漏进状态', () => {
    const raw = JSON.stringify({ ...makePayload(), cardData: JSON.parse('{"sticky":"x","todos":[],"__proto__":{"polluted":1}}') })
    const back = parseBackup(raw, REGISTRY)
    expect((back.cardData as unknown as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
