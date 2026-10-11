import { describe, expect, it } from 'vitest'
import { BACKUP_KIND, BACKUP_VERSION, emptyCardData, buildBackup, backupToJson, parseBackup } from '../../src/vue/backup'
import type { CardData } from '../../src/vue/cardData'
import type { LayoutDoc, SchemeBook } from '@levango7/engine'
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
  elapsed: { label: '不喝奶茶', date: '2026-10-01' },
  habit: { name: '早起', days: ['2026-10-15', '2026-10-16'] },
  birthdays: [
    { id: 'b1', name: '妈妈', month: 3, day: 5, year: 1962 },
    { id: 'b2', name: '老陈', month: 11, day: 30 },
  ],
  pickList: [
    { id: 'p1', label: '取快递', weight: 3 },
    { id: 'p2', label: '浇花', weight: 1 },
  ],
  ledger: {
    symbol: '¥',
    entries: [
      { id: 'e1', date: '2026-10-02', cents: 2550, category: '餐饮', note: '午饭' },
      { id: 'e2', date: '2026-10-03', cents: 1200, category: '交通', note: '地铁' },
    ],
  },
  meeting: { cityIds: ['shanghai', 'london'], at: '20:00', minutes: 60, title: '双周同步' },
  timers: {
    stopwatch: { accumulatedMs: 12_345, startedAt: null },
    countdown: { minutes: 15, accumulatedMs: 0, startedAt: null },
    interval: { presetId: 'fifty-ten', completedFocus: 2, phaseIndex: 5, accumulatedMs: 0, startedAt: null },
    breath: { patternId: 'relax-478', accumulatedMs: 3_000, startedAt: null },
  },
  links: [{ id: 'l1', label: '仓库', href: 'https://github.com' }],
  commands: [{ id: 'c1', label: '重启', cmd: 'sudo reboot' }],
  matrix: [{ id: 'm1', text: '季度规划', q: 'plan', done: false }],
  probes: [{ id: 'p1', label: '健康检查', url: 'https://example.com/health' }],
  watch: [],
  fixed: { base: '1,280.00', rate: '6%', symbol: '¥' },
  duty: { roster: ['张三', '李四'], anchor: '2026-01-01' },
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

  it('包里带导出时刻，且时钟是注入的 —— 导出这刻因此可测', () => {
    const payload = makePayload({ now: () => new Date('2026-10-04T08:30:00.000Z') })
    expect(payload.createdAt).toBe('2026-10-04T08:30:00.000Z')
    const back = parseBackup(backupToJson(payload), REGISTRY)
    expect(back.meta).toEqual({ app: '0.2.0', version: BACKUP_VERSION, createdAt: '2026-10-04T08:30:00.000Z' })
  })

  it('v1 旧包没有 createdAt：meta 如实说 null，并留一句 warning，不当成坏包', () => {
    const raw = backupToJson(makePayload())
    const obj = JSON.parse(raw) as Record<string, unknown>
    delete obj.createdAt
    const back = parseBackup(JSON.stringify(obj), REGISTRY)
    expect(back.kind).toBe('backup')
    expect(back.meta).toEqual({ app: '0.2.0', version: BACKUP_VERSION, createdAt: null })
    expect(back.warnings.some((w) => w.includes('没有记录导出时间'))).toBe(true)
  })

  it('旧版布局 / 方案册导出没有 meta —— 它们本来就不是备份包', () => {
    const layoutOnly = parseBackup(JSON.stringify(layout), REGISTRY)
    expect(layoutOnly.kind).toBe('layout')
    expect(layoutOnly.meta).toBeNull()
    expect(parseBackup(JSON.stringify(book), REGISTRY).meta).toBeNull()
  })

  it('没设过倒数日时 summary 如实说不（确认框不该凭空多一句）', () => {
    const back = parseBackup(backupToJson(makePayload({ cardData: { ...cardData, countdown: { label: '', date: '' } } })), REGISTRY)
    expect(back.summary.countdown).toBe(false)
  })

  it('深拷贝：导出后用户新敲的字不会跟着进包', () => {
    const live: CardData = {
      sticky: '原样',
      todos: [{ id: 't1', text: '一', done: false }],
      notes: [],
      countdown: { label: '原样', date: '2027-01-01' },
      elapsed: { label: '原样', date: '2026-10-01' },
      habit: { name: '原样', days: ['2026-10-15'] },
      birthdays: [{ id: 'b1', name: '原样', month: 3, day: 5 }],
      pickList: [{ id: 'p1', label: '原样', weight: 2 }],
      ledger: { symbol: '¥', entries: [{ id: 'e1', date: '2026-10-01', cents: 100, category: '其他', note: '原样' }] },
      meeting: { cityIds: ['shanghai'], at: '09:00', minutes: 30, title: '原样' },
      timers: {
        stopwatch: { accumulatedMs: 1000, startedAt: null },
        countdown: { minutes: 5, accumulatedMs: 0, startedAt: null },
        interval: { presetId: 'pomodoro', completedFocus: 0, phaseIndex: 0, accumulatedMs: 0, startedAt: null },
        breath: { patternId: 'box', accumulatedMs: 0, startedAt: null },
      },
      links: [{ id: 'l1', label: '原样', href: 'https://example.com' }],
      commands: [{ id: 'c1', label: '重启', cmd: 'sudo reboot' }],
      matrix: [{ id: 'm1', text: '季度规划', q: 'plan', done: false }],
      probes: [{ id: 'p1', label: '健康检查', url: 'https://example.com/health' }],
  watch: [],
      fixed: { base: '100', rate: '10%', symbol: '¥' },
      duty: { roster: ['原样'], anchor: '2026-01-01' },
    }
    const payload = makePayload({ cardData: live })
    live.sticky = '后来改的'
    live.todos.push({ id: 't9', text: '后来加的', done: false })
    live.countdown.label = '后来改的名字'
    live.habit.days.push('2026-10-16')
    expect(payload.cardData.sticky).toBe('原样')
    expect(payload.cardData.todos).toHaveLength(1)
    expect(payload.cardData.countdown.label).toBe('原样')
    expect(payload.cardData.habit.days).toEqual(['2026-10-15'])
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
