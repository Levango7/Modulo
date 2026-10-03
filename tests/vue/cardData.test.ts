import { describe, expect, it } from 'vitest'
import { sanitizeCardData, type CardData } from '../../src/vue/cardData'

const fallback: CardData = {
  sticky: '',
  todos: [{ id: 'f1', text: '示例待办', done: false }],
  notes: [{ id: 'nf', title: '示例笔记', body: 'b', at: 0 }],
  countdown: { label: '', date: '' },
}

describe('sanitizeCardData：盘上数据先清洗再用', () => {
  it('形状正确的数据原样保留', () => {
    const r = sanitizeCardData({ sticky: '便签', todos: [{ id: 'a', text: '一', done: true }], notes: [] }, fallback)
    expect(r).toEqual({
      sticky: '便签',
      todos: [{ id: 'a', text: '一', done: true }],
      notes: [],
      countdown: fallback.countdown,
    })
  })

  it('todos 是 null 时整栏回退示例，而不是把 null 交给渲染期', () => {
    expect(() => sanitizeCardData({ todos: null }, fallback)).not.toThrow()
    expect(sanitizeCardData({ todos: null }, fallback).todos).toEqual(fallback.todos)
  })

  it('单条目形状不对只丢那一条', () => {
    const r = sanitizeCardData({ todos: [{ id: 'a', text: '留着', done: true }, null, { text: 1 }, { id: 'b', text: '   ' }] }, fallback)
    expect(r.todos.map((t) => t.id)).toEqual(['a'])
  })

  it('done 只认真 true，字符串/数字一律 false', () => {
    const r = sanitizeCardData({ todos: [{ id: 'a', text: '一', done: 'yes' }, { id: 'b', text: '二', done: 1 }] }, fallback)
    expect(r.todos.map((t) => t.done)).toEqual([false, false])
  })

  it('id 撞号会被改成唯一 —— toggle/remove 按 id 找，撞号会连坐', () => {
    const r = sanitizeCardData({ todos: [{ id: 'x', text: '一' }, { id: 'x', text: '二' }, { id: 'x', text: '三' }] }, fallback)
    expect(new Set(r.todos.map((t) => t.id)).size).toBe(3)
  })

  it('缺 id 会补出稳定且唯一的 id', () => {
    const r = sanitizeCardData({ todos: [{ text: '一' }, { text: '二' }] }, fallback)
    expect(r.todos.map((t) => t.id)).toEqual(['t0', 't1'])
  })

  it('sticky 不是字符串就变空串，超长截断', () => {
    expect(sanitizeCardData({ sticky: { a: 1 } }, fallback).sticky).toBe('')
    expect(sanitizeCardData({ sticky: 'x'.repeat(9000) }, fallback).sticky.length).toBe(4000)
  })

  it('条目数夹到上限：几百 MB 的坏文件不该冻住首屏', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, text: `第 ${i} 条` }))
    expect(sanitizeCardData({ todos: many }, fallback).todos.length).toBe(200)
  })

  it('单条文本按上限截断', () => {
    const r = sanitizeCardData({ todos: [{ id: 'a', text: 'y'.repeat(5000) }] }, fallback)
    expect(r.todos[0].text.length).toBe(2000)
  })

  it('notes 缺 title 给「无标题」，at 非有限数换成当前时间', () => {
    const before = Date.now()
    const r = sanitizeCardData({ notes: [{ id: 'n1', body: '只有正文', at: Number.NaN }] }, fallback)
    expect(r.notes[0].title).toBe('无标题')
    expect(r.notes[0].at).toBeGreaterThanOrEqual(before)
  })

  it('顶层不是对象时整份回退（含数组，因为数组会让 todos/notes 双双失踪）', () => {
    for (const bad of [null, 'x', 42, [], true]) expect(sanitizeCardData(bad, fallback)).toBe(fallback)
  })

  it('__proto__ 之类的键不会漏进状态：只认白名单字段', () => {
    const r = sanitizeCardData(JSON.parse('{"__proto__":{"polluted":1},"sticky":"ok"}'), fallback)
    expect(Object.keys(r).sort()).toEqual(['countdown', 'notes', 'sticky', 'todos'])
    expect({} as Record<string, unknown>).not.toHaveProperty('polluted')
  })

  describe('倒数日：用户写的内容，清洗后要能安全落盘、也要能跟着备份走', () => {
    it('正常的名字与日期原样留；名字去空白、截到 24 字', () => {
      const r = sanitizeCardData({ countdown: { label: '  元旦假期  ', date: '2027-01-01' } }, fallback)
      expect(r.countdown).toEqual({ label: '元旦假期', date: '2027-01-01' })
      const long = sanitizeCardData({ countdown: { label: 'x'.repeat(80), date: '2027-01-01' } }, fallback)
      expect(long.countdown.label).toHaveLength(24)
    })

    it('日期必须真实存在：2026-02-30 / 2026-2-3 / 垃圾串一律当"没设"（不编一个日子）', () => {
      for (const bad of ['2026-02-30', '2026-2-3', '2026-13-01', 'abc', '', 42, null]) {
        expect(sanitizeCardData({ countdown: { label: 'x', date: bad } }, fallback).countdown.date).toBe('')
      }
      expect(sanitizeCardData({ countdown: { label: 'x', date: '2028-02-29' } }, fallback).countdown.date).toBe('2028-02-29')
    })

    it('整块缺失（旧数据）或形状不对 → 回退兜底，绝不抛', () => {
      expect(sanitizeCardData({ sticky: 'a' }, fallback).countdown).toEqual(fallback.countdown)
      for (const bad of [null, 'x', 42, [], true]) {
        expect(sanitizeCardData({ countdown: bad }, fallback).countdown).toEqual(fallback.countdown)
      }
    })
  })
})
