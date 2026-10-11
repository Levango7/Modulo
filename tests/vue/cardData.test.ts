import { describe, expect, it } from 'vitest'
import { sanitizeCardData, type CardData } from '../../src/vue/cardData'

const fallback: CardData = {
  sticky: '',
  todos: [{ id: 'f1', text: '示例待办', done: false }],
  notes: [{ id: 'nf', title: '示例笔记', body: 'b', at: 0 }],
  countdown: { label: '', date: '' },
  elapsed: { label: '', date: '' },
  habit: { name: '', days: [] },
  birthdays: [],
  pickList: [],
  ledger: { symbol: '¥', entries: [] },
  meeting: { cityIds: ['shanghai', 'london', 'new-york'], at: '20:00', minutes: 60, title: '' },
  timers: {
    stopwatch: { accumulatedMs: 0, startedAt: null },
    countdown: { minutes: 25, accumulatedMs: 0, startedAt: null },
    interval: { presetId: 'pomodoro', completedFocus: 0, phaseIndex: 0, accumulatedMs: 0, startedAt: null },
    breath: { patternId: 'box', accumulatedMs: 0, startedAt: null },
  },
  links: [],
  commands: [],
  matrix: [],
  probes: [],
  watch: [],
  fixed: { base: '', rate: '', symbol: '¥' },
  duty: { roster: [], anchor: '' },
}

describe('sanitizeCardData：盘上数据先清洗再用', () => {
  it('形状正确的数据原样保留', () => {
    const r = sanitizeCardData({ sticky: '便签', todos: [{ id: 'a', text: '一', done: true }], notes: [] }, fallback)
    expect(r).toEqual({
      sticky: '便签',
      todos: [{ id: 'a', text: '一', done: true }],
      notes: [],
      countdown: fallback.countdown,
      elapsed: fallback.elapsed,
      habit: fallback.habit,
      birthdays: [],
      pickList: [],
      ledger: { symbol: '¥', entries: [] },
      meeting: fallback.meeting,
      timers: fallback.timers,
      links: [],
      commands: [],
      matrix: [],
      probes: [],
  watch: [],
      fixed: fallback.fixed,
      duty: fallback.duty,
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
    expect(Object.keys(r).sort()).toEqual([
      'birthdays', 'commands', 'countdown', 'duty', 'elapsed', 'fixed', 'habit', 'ledger', 'links', 'matrix', 'meeting', 'notes', 'pickList', 'probes', 'sticky', 'timers', 'todos', 'watch',
    ])
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

    describe('doneAt：月度统计的地基，可选且必须诚实', () => {
      it('已完成且时间戳合法 → 留着', () => {
        const out = sanitizeCardData({ todos: [{ id: 'a', text: '一', done: true, doneAt: 1_700_000_000_000 }] }, fallback)
        expect(out.todos[0].doneAt).toBe(1_700_000_000_000)
      })

      it('未完成却带着 doneAt → 丢掉（完成时刻指向一个不成立的过去）', () => {
        const out = sanitizeCardData({ todos: [{ id: 'a', text: '一', done: false, doneAt: 1_700_000_000_000 }] }, fallback)
        expect(out.todos[0].doneAt).toBeUndefined()
        expect('doneAt' in out.todos[0]).toBe(false)
      })

      it('NaN / 非数字时间戳 → 当作没有，不让月度统计按 NaN 比较静默少算', () => {
        for (const bad of [Number.NaN, '1700000000000', null, Infinity]) {
          const out = sanitizeCardData({ todos: [{ id: 'a', text: '一', done: true, doneAt: bad }] }, fallback)
          expect(out.todos[0].doneAt).toBeUndefined()
        }
      })

      it('v1 旧数据没有 doneAt → 照样能读，不报错也不补一个假时间', () => {
        const out = sanitizeCardData({ todos: [{ id: 'a', text: '一', done: true }] }, fallback)
        expect(out.todos[0].done).toBe(true)
        expect(out.todos[0].doneAt).toBeUndefined()
      })
    })

    describe('生日：月日必真，出生年可有可无', () => {
      it('正常的两条原样留', () => {
        const out = sanitizeCardData(
          { birthdays: [{ id: 'b1', name: '妈妈', month: 3, day: 5, year: 1962 }, { id: 'b2', name: '老陈', month: 11, day: 30 }] },
          fallback,
        )
        expect(out.birthdays).toEqual([
          { id: 'b1', name: '妈妈', month: 3, day: 5, year: 1962 },
          { id: 'b2', name: '老陈', month: 11, day: 30 },
        ])
      })

      it('2 月 29 日合法（平年由引擎落到 28）；2 月 30 日丢掉那一条', () => {
        const out = sanitizeCardData(
          { birthdays: [{ name: '闰', month: 2, day: 29 }, { name: '假', month: 2, day: 30 }] },
          fallback,
        )
        expect(out.birthdays.map((b) => b.name)).toEqual(['闰'])
      })

      it('非法出生年（0 / 负数 / 小数 / 字符串）→ 不带 year，而不是把垃圾写进备份', () => {
        for (const y of [0, -5, 1988.5, '1962']) {
          const out = sanitizeCardData({ birthdays: [{ name: 'x', month: 3, day: 5, year: y }] }, fallback)
          expect('year' in out.birthdays[0]).toBe(false)
        }
        // 3000 这种"格式合法但语义荒唐"的值这一层不拦：它要的是时钟，而清洗函数刻意不摸 Date.now()。
        // 语义那一关在引擎（nextBirthday 对 year > 今年返回 turns = null），已由 birthday.test.ts 钉死。
        expect(sanitizeCardData({ birthdays: [{ name: 'x', month: 3, day: 5, year: 3000 }] }, fallback).birthdays[0].year).toBe(3000)
      })

      it('名字空 / 缺字段 / 整块缺失 → 丢那一条或回退兜底，绝不抛', () => {
        expect(sanitizeCardData({ birthdays: [{ month: 3, day: 5 }] }, fallback).birthdays).toEqual([])
        for (const bad of [null, 'x', 42, [], true]) {
          expect(sanitizeCardData({ birthdays: bad }, fallback).birthdays).toEqual(fallback.birthdays)
        }
        expect(sanitizeCardData({ sticky: 'a' }, fallback).birthdays).toEqual([])
      })
    })

    describe('抽签名单：权重夹在 0–99，坏值回 1 而不是 0', () => {
      it('正常条目原样留', () => {
        const out = sanitizeCardData(
          { pickList: [{ id: 'p1', label: '取快递', weight: 3 }, { id: 'p2', label: '浇花', weight: 0 }] },
          fallback,
        )
        expect(out.pickList).toEqual([
          { id: 'p1', label: '取快递', weight: 3 },
          { id: 'p2', label: '浇花', weight: 0 },
        ])
      })

      it('没写权重 → 1（等概率）', () => {
        expect(sanitizeCardData({ pickList: [{ label: 'a' }] }, fallback).pickList[0].weight).toBe(1)
      })

      it('超范围 / 小数 / NaN → 夹回合法范围，一个坏权重不该让整张卡抽不出东西', () => {
        const w = (v: unknown) => sanitizeCardData({ pickList: [{ label: 'a', weight: v }] }, fallback).pickList[0].weight
        expect(w(1000)).toBe(99)
        expect(w(-3)).toBe(0)
        expect(w(2.6)).toBe(3)
        expect(w(Number.NaN)).toBe(1)
        expect(w('5')).toBe(1)
      })

      it('label 空 / 缺字段 → 丢那一条；整块形状不对 → 回退兜底', () => {
        expect(sanitizeCardData({ pickList: [{ weight: 2 }] }, fallback).pickList).toEqual([])
        for (const bad of [null, 'x', 42, [], true]) {
          expect(sanitizeCardData({ pickList: bad }, fallback).pickList).toEqual(fallback.pickList)
        }
      })

      it('id 撞号会被改成唯一 —— 删一条 / 改权重都按 id 找', () => {
        const out = sanitizeCardData(
          { pickList: [{ id: 'x', label: 'a' }, { id: 'x', label: 'b' }] },
          fallback,
        )
        expect(out.pickList.map((p) => p.id)).toEqual(['x', 'p1-0'])
      })

    describe('记账：金额必须是「分」的整数，半条账比错账更危险', () => {
      it('正常条目原样留，分类不在候选表里回「其他」', () => {
        const out = sanitizeCardData(
          {
            ledger: {
              symbol: '$',
              entries: [
                { id: 'a', date: '2026-10-02', cents: 2550, category: '餐饮', note: '午饭' },
                { id: 'b', date: '2026-10-03', cents: 100, category: '不存在的类', note: '' },
              ],
            },
          },
          fallback,
        )
        expect(out.ledger.symbol).toBe('$')
        expect(out.ledger.entries).toEqual([
          { id: 'a', date: '2026-10-02', cents: 2550, category: '餐饮', note: '午饭' },
          { id: 'b', date: '2026-10-03', cents: 100, category: '其他', note: '' },
        ])
      })

      it('**小数分 / 负数 / NaN / 字符串金额一律丢那条** —— 错账能看出来，半条账会让总额悄悄少一块', () => {
        for (const cents of [12.5, -100, Number.NaN, '2550', Number.POSITIVE_INFINITY]) {
          const out = sanitizeCardData({ ledger: { entries: [{ id: 'x', date: '2026-10-02', cents }] } }, fallback)
          expect(out.ledger.entries, String(cents)).toEqual([])
        }
      })

      it('日期不真的（2026-02-30 / 2026-13-01）→ 丢那条', () => {
        const out = sanitizeCardData(
          { ledger: { entries: [{ id: 'x', date: '2026-02-30', cents: 100 }, { id: 'y', date: '2026-13-01', cents: 100 }] } },
          fallback,
        )
        expect(out.ledger.entries).toEqual([])
      })

      it('超上限金额 → 丢那条（约一亿元以上多半敲错了）', () => {
        expect(sanitizeCardData({ ledger: { entries: [{ date: '2026-10-02', cents: 20_000_000_000 }] } }, fallback).ledger.entries).toEqual([])
      })

      it('币种符号超长 → 截断；整块形状不对 → 回退兜底，绝不抛', () => {
        expect(sanitizeCardData({ ledger: { symbol: '人民币元', entries: [] } }, fallback).ledger.symbol).toHaveLength(4)
        for (const bad of [null, 'x', 42, [], true, { entries: 'nope' }]) {
          expect(sanitizeCardData({ ledger: bad }, fallback).ledger).toEqual(fallback.ledger)
        }
        expect(sanitizeCardData({ sticky: 'a' }, fallback).ledger).toEqual(fallback.ledger)
      })

      it('id 撞号会被改成唯一 —— 删一条按 id 找，撞号会连坐删错', () => {
        const out = sanitizeCardData(
          { ledger: { entries: [{ id: 'x', date: '2026-10-02', cents: 1 }, { id: 'x', date: '2026-10-03', cents: 2 }] } },
          fallback,
        )
        expect(out.ledger.entries.map((r) => r.id)).toEqual(['x', 'e1-0'])
      })
    })

    describe('会议规划：只存「我说几点开」，各城几点是算出来的', () => {
      it('正常值原样留', () => {
        const out = sanitizeCardData(
          { meeting: { cityIds: ['shanghai', 'london'], at: '20:00', minutes: 90, title: '  双周同步  ' } },
          fallback,
        )
        expect(out.meeting).toEqual({ cityIds: ['shanghai', 'london'], at: '20:00', minutes: 90, title: '双周同步' })
      })

      it('时间补零到 HH:mm；不像时间的 → 回退默认，不留一个"非法的时间"在状态里', () => {
        expect(sanitizeCardData({ meeting: { at: '9:5' } }, fallback).meeting.at).toBe('09:05')
        for (const bad of ['25:00', '20:70', 'abc', '', 42]) {
          expect(sanitizeCardData({ meeting: { at: bad } }, fallback).meeting.at, String(bad)).toBe(fallback.meeting.at)
        }
      })

      it('时长夹到 5–600 分钟并取整', () => {
        expect(sanitizeCardData({ meeting: { minutes: 0 } }, fallback).meeting.minutes).toBe(5)
        expect(sanitizeCardData({ meeting: { minutes: 9999 } }, fallback).meeting.minutes).toBe(600)
        expect(sanitizeCardData({ meeting: { minutes: 30.6 } }, fallback).meeting.minutes).toBe(31)
        expect(sanitizeCardData({ meeting: { minutes: 'x' } }, fallback).meeting.minutes).toBe(fallback.meeting.minutes)
      })

      it('城市名单清洗：去掉不认识的、砍到 4 个；**空名单保持空**（那是「还没挑」，不是回默认三城）', () => {
        expect(sanitizeCardData({ meeting: { cityIds: ['atlantis', 'shanghai', 'shanghai'] } }, fallback).meeting.cityIds).toEqual(['shanghai'])
        expect(sanitizeCardData({ meeting: { cityIds: ['a', 'b', 'c', 'd', 'e'] } }, fallback).meeting.cityIds).toHaveLength(0)
        expect(sanitizeCardData({ meeting: { cityIds: [] } }, fallback).meeting.cityIds).toEqual([])
        expect(sanitizeCardData({ meeting: { cityIds: 'x' } }, fallback).meeting.cityIds).toEqual(fallback.meeting.cityIds)
      })

      it('整块形状不对 → 回退兜底，绝不抛', () => {
        for (const bad of [null, 'x', 42, [], true]) {
          expect(sanitizeCardData({ meeting: bad }, fallback).meeting, String(bad)).toEqual(fallback.meeting)
        }
      })
    })
    describe('计时器：存的是时间戳，不是"已经跑了多少秒"', () => {
      const timers = (o: unknown) => sanitizeCardData({ timers: o }, fallback).timers

      it('正常值原样留', () => {
        expect(
          timers({
            stopwatch: { accumulatedMs: 12_345, startedAt: 1_700_000_000_000 },
            countdown: { minutes: 45, accumulatedMs: 0, startedAt: null },
            interval: { presetId: 'fifty-ten', completedFocus: 2, phaseIndex: 5, accumulatedMs: 0, startedAt: null },
            breath: { patternId: 'relax-478', accumulatedMs: 3000, startedAt: null },
          }),
        ).toEqual({
          stopwatch: { accumulatedMs: 12_345, startedAt: 1_700_000_000_000 },
          countdown: { minutes: 45, accumulatedMs: 0, startedAt: null },
          interval: { presetId: 'fifty-ten', completedFocus: 2, phaseIndex: 5, accumulatedMs: 0, startedAt: null },
          breath: { patternId: 'relax-478', accumulatedMs: 3000, startedAt: null },
        })
      })

      it('整块缺失（旧数据）→ 回退兜底，且四个钟都给空档而不是"已经在跑"', () => {
        expect(sanitizeCardData({ sticky: 'a' }, fallback).timers).toEqual(fallback.timers)
        expect(fallback.timers.stopwatch).toEqual({ accumulatedMs: 0, startedAt: null })
      })

      it('整块形状不对 → 回退兜底，绝不抛', () => {
        for (const bad of [null, 'x', 42, [], true]) {
          expect(timers(bad), String(bad)).toEqual(fallback.timers)
        }
      })

      it('单个分支形状不对 → 只丢那一支，其余照常', () => {
        const out = timers({ stopwatch: 'nope', breath: { patternId: 'calm', accumulatedMs: 100, startedAt: null } })
        expect(out.stopwatch).toEqual(fallback.timers.stopwatch)
        expect(out.breath.patternId).toBe('calm')
      })

      it('startedAt 脏值 → null（= 停着）。没跑起来却带着时刻，会显示一段凭空的时间', () => {
        for (const bad of [0, -1, Number.NaN, 'x', null]) {
          const out = timers({ stopwatch: { accumulatedMs: 0, startedAt: bad } })
          expect(out.stopwatch.startedAt, String(bad)).toBeNull()
        }
      })

      it('累计量夹到约 7 天；负数与 NaN 回兜底', () => {
        expect(timers({ stopwatch: { accumulatedMs: 1e12 } }).stopwatch.accumulatedMs).toBe(599 * 60_000 * 7)
        expect(timers({ stopwatch: { accumulatedMs: -5 } }).stopwatch.accumulatedMs).toBe(fallback.timers.stopwatch.accumulatedMs)
        expect(timers({ stopwatch: { accumulatedMs: Number.NaN } }).stopwatch.accumulatedMs).toBe(fallback.timers.stopwatch.accumulatedMs)
      })

      it('倒计时时长夹到 1–599 分并取整', () => {
        expect(timers({ countdown: { minutes: 0 } }).countdown.minutes).toBe(1)
        expect(timers({ countdown: { minutes: 9999 } }).countdown.minutes).toBe(599)
        expect(timers({ countdown: { minutes: 12.6 } }).countdown.minutes).toBe(13)
        expect(timers({ countdown: { minutes: 'x' } }).countdown.minutes).toBe(fallback.timers.countdown.minutes)
      })

      it('间歇的轮次与相位夹到 0–9999 并取整', () => {
        const out = timers({ interval: { completedFocus: -3, phaseIndex: 99999 } })
        expect(out.interval.completedFocus).toBe(0)
        expect(out.interval.phaseIndex).toBe(9999)
      })

      it('预设 id / 节奏 id 不是字符串 → 兜底（引擎那边认不出也是落回默认，两边一致）', () => {
        expect(timers({ interval: { presetId: 42 } }).interval.presetId).toBe(fallback.timers.interval.presetId)
        expect(timers({ breath: { patternId: null } }).breath.patternId).toBe(fallback.timers.breath.patternId)
      })
    })
    describe('快捷链接：协议白名单与去重交给引擎，清洗层不重复实现', () => {
      const links = (o: unknown) => sanitizeCardData({ links: o }, fallback).links

      it('正常条目原样留，并按标签排序（拼音序：仓 cang < 新 xin）', () => {
        expect(links([{ id: 'l1', label: '仓库', href: 'https://github.com' }, { id: 'l2', label: '新闻', href: 'https://news.test' }])).toEqual([
          { id: 'l1', label: '仓库', href: 'https://github.com' },
          { id: 'l2', label: '新闻', href: 'https://news.test' },
        ])
      })

      it('**javascript: 一律拒收** —— 黑名单永远漏得掉下一个危险协议，所以用白名单', () => {
        expect(links([{ label: 'x', href: 'javascript:alert(1)' }])).toEqual([])
        expect(links([{ label: 'x', href: 'data:text/html,<script>' }])).toEqual([])
      })

      it('无协议按 https 补齐；同名同链去重', () => {
        const out = links([{ label: 'A', href: 'example.com' }, { label: 'A', href: 'https://example.com' }])
        expect(out).toHaveLength(1)
        expect(out[0].href).toBe('https://example.com')
      })

      it('缺 id 会补出唯一 id（删一条按 id 找，撞号会连坐）', () => {
        expect(new Set(links([{ href: 'a.test' }, { href: 'b.test' }, { href: 'c.test' }]).map((l) => l.id)).size).toBe(3)
      })

      it('整块缺失或形状不对 → 回退兜底，绝不抛', () => {
        expect(sanitizeCardData({ sticky: 'a' }, fallback).links).toEqual([])
        for (const bad of [null, 'x', 42, {}, true]) {
          expect(links(bad), String(bad)).toEqual([])
        }
      })
    })

    describe('命令速查：清洗在引擎（commands.ts），这里守的是"盘上数据进得来、坏命令进不去"', () => {
      const commands = (o: unknown) => sanitizeCardData({ commands: o }, fallback).commands
      it('合法条目保留、空白命令被丢', () => {
        expect(commands([{ id: 'c1', label: '重启', cmd: 'sudo reboot' }, { id: 'c2', label: '空', cmd: '   ' }])).toEqual([
          { id: 'c1', label: '重启', cmd: 'sudo reboot' },
        ])
      })
      it('多行命令原样保留（管道/脚本贴进来是常态），只有首尾空白被去', () => {
        const out = commands([{ cmd: '  a | b\n  c  ' }])
        expect(out[0].cmd).toBe('a | b\n  c')
        expect(out[0].label).toBe('a | b') // 空名用命令首行兜底
      })
      it('同名字同命令去重；命令超长被截断而不是整条拒收', () => {
        const out = commands([{ label: '同', cmd: 'same' }, { label: '同', cmd: 'same' }])
        expect(out).toHaveLength(1)
        expect(commands([{ cmd: 'x'.repeat(400) }])[0].cmd).toHaveLength(240)
      })
      it('整块缺失或形状不对 → 回退兜底，绝不抛', () => {
        for (const bad of [null, 'x', 42, {}, true]) {
          expect(commands(bad), String(bad)).toEqual([])
        }
      })
    })

    describe('四象限待办：字是用户写的，坏象限归位而不是丢条目', () => {
      const matrix = (o: unknown) => sanitizeCardData({ matrix: o }, fallback).matrix
      it('合法条目保留；空文本丢；坏象限归 do', () => {
        const out = matrix([
          { id: 'm1', text: '季度规划', q: 'plan', done: false },
          { id: 'm2', text: '   ', q: 'do' },
          { id: 'm3', text: '救火', q: '爆炸', done: false },
          { id: 'm4', text: '划水', q: 'drop', done: true, doneAt: 123 },
        ])
        expect(out).toEqual([
          { id: 'm1', text: '季度规划', q: 'plan', done: false },
          { id: 'm3', text: '救火', q: 'do', done: false },
          { id: 'm4', text: '划水', q: 'drop', done: true, doneAt: 123 },
        ])
      })
      it('doneAt 只跟 done=true 走（与 todos 同一语义）', () => {
        const out = matrix([{ text: '未完成却带完成时刻', q: 'do', done: false, doneAt: 99 }])
        expect(out[0]).not.toHaveProperty('doneAt')
      })
      it('整块缺失或形状不对 → 空表，绝不抛', () => {
        for (const bad of [null, 'x', 42, {}, true]) expect(matrix(bad), String(bad)).toEqual([])
      })
    })

    describe('连通性探测名单：与网页监控同一条边界（引擎 sanitizeProbes）', () => {
      const probes = (o: unknown) => sanitizeCardData({ probes: o }, fallback).probes
      it('合规 https 保留，私网/明文进不来', () => {
        expect(probes([{ label: '健康', url: 'https://example.com/health' }])).toHaveLength(1)
        expect(probes([{ url: 'http://a.test' }, { url: 'https://10.0.0.1/' }])).toEqual([])
      })
      it('整块缺失或形状不对 → 空表，绝不抛', () => {
        for (const bad of [null, 'x', 42, {}, true]) expect(probes(bad), String(bad)).toEqual([])
      })
    })

    describe('整数位计算与值班表', () => {
      it('两个草稿字段去空白并截断；符号超长截断', () => {
        const out = sanitizeCardData({ fixed: { base: '  1,280.00  ', rate: ' 6% ', symbol: '人民币元' } }, fallback).fixed
        expect(out).toEqual({ base: '1,280.00', rate: '6%', symbol: '人民币元'.slice(0, 4) })
      })

      it('fixed 形状不对 → 逐字段回退兜底，绝不抛', () => {
        for (const bad of [null, 'x', 42, [], true]) {
          expect(sanitizeCardData({ fixed: bad }, fallback).fixed, String(bad)).toEqual(fallback.fixed)
        }
      })

      it('值班名单：去重保序（同名排两次会让轮转表出现重复行）', () => {
        const out = sanitizeCardData({ duty: { roster: [' 甲 ', '乙', '甲', '', '  ', 42] } }, fallback).duty
        expect(out.roster).toEqual(['甲', '乙'])
      })

      it('轮转锚点必须是真日期；空串合法（表示"从今天起轮"）', () => {
        expect(sanitizeCardData({ duty: { anchor: '2026-01-01' } }, fallback).duty.anchor).toBe('2026-01-01')
        expect(sanitizeCardData({ duty: { anchor: '' } }, fallback).duty.anchor).toBe('')
        for (const bad of ['2026-02-30', 'x', 42, null]) {
          expect(sanitizeCardData({ duty: { anchor: bad } }, fallback).duty.anchor, String(bad)).toBe('')
        }
      })

      it('值班名单砍到 30 人；duty 形状不对 → 回退兜底', () => {
        const many = Array.from({ length: 60 }, (_, i) => `人${i}`)
        expect(sanitizeCardData({ duty: { roster: many } }, fallback).duty.roster).toHaveLength(30)
        for (const bad of [null, 'x', 42, [], true]) {
          expect(sanitizeCardData({ duty: bad }, fallback).duty, String(bad)).toEqual(fallback.duty)
        }
        expect(sanitizeCardData({ sticky: 'a' }, fallback).duty).toEqual(fallback.duty)
      })
    })    })
  })
})
