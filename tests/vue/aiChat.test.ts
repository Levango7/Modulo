import { describe, expect, it } from 'vitest'
import {
  applyChunk,
  buildMessages,
  canShowDock,
  cardChoices,
  contextBlock,
  excerptFor,
  filterChoices,
  historyWhen,
  mentionQuery,
  outgoingFromTurns,
  stripMention,
  turnsFromHistory,
  type CardChoice,
  type ChatChunk,
  type ChatTurn,
  type ExcerptSource,
} from '../../src/vue/aiChat'

/**
 * 对话坞的判定层（F-12 二期）。钉的是"慢网络与手滑最容易出事"的那几条：
 * 流式三态归并、`@` 触发词的边界、引用块的预算、历史里混进 system 的处理。
 */

const turn = (patch: Partial<ChatTurn> = {}): ChatTurn => ({
  role: 'user',
  content: '你好',
  status: 'done',
  error: null,
  ...patch,
})

const chunk = (patch: Partial<ChatChunk> = {}): ChatChunk => ({
  delta: '',
  done: false,
  error: null,
  ...patch,
})

const choice = (patch: Partial<CardChoice> = {}): CardChoice => ({
  id: 'todo',
  module: 'todo',
  title: '待办',
  label: '待办',
  ...patch,
})

/** 一张有内容的卡 + 一份"全空"的数据，按需覆盖字段 */
const source = (patch: Partial<ExcerptSource> = {}): ExcerptSource => ({
  sticky: '',
  todos: [],
  matrix: [],
  notes: [],
  ledger: { symbol: '¥', entries: [] },
  links: [],
  countdown: { label: '', date: '' },
  elapsed: { label: '', date: '' },
  habit: { name: '', days: [] },
  birthdays: [],
  pickList: [],
  ...patch,
})

describe('版面 → @卡片 候选', () => {
  it('同模块多实例带序号，单实例不带 —— 否则「@待办」选中哪一张只能靠猜', () => {
    const items = [{ id: 'todo', module: 'todo' }, { id: 'todo:2', module: 'todo' }, { id: 'sticky' }]
    const out = cardChoices(items, (m) => (m === 'todo' ? '待办' : '便签'))
    expect(out.map((c) => c.label)).toEqual(['待办（1）', '待办（2）', '便签'])
    // 没有 module 字段的旧条目按 id 当模块（与 moduleIdOf 同一口径）
    expect(out[2].module).toBe('sticky')
  })

  it('标题查不到时原样回模块 id —— 不编一个名字出来', () => {
    const out = cardChoices([{ id: 'x1', module: 'unknown-mod' }], (m) => m)
    expect(out[0].title).toBe('unknown-mod')
  })
})

describe('@ 触发词', () => {
  it('行首或空白后的 @ 才算触发', () => {
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQuery('看看 @待', 6)).toEqual({ query: '待', start: 3 })
    // 邮箱不是触发词
    expect(mentionQuery('a@b.com', 7)).toBeNull()
    expect(mentionQuery('没有艾特', 4)).toBeNull()
  })

  it('查询里出现空白或第二个 @ 就结束', () => {
    expect(mentionQuery('@待 办', 4)).toBeNull()
    expect(mentionQuery('@a@b', 4)).toBeNull()
  })

  it('只看光标左边；光标越界按正文两端夹取', () => {
    // 光标在 @ 之前：右边写好的 `@待办` 不参与
    expect(mentionQuery('@待办', 0)).toBeNull()
    expect(mentionQuery('@待办', 99)).toEqual({ query: '待办', start: 0 })
  })

  it('选中候选取掉 @查询，光标落在原处', () => {
    expect(stripMention('看看 @待 吧', 3, 5)).toEqual({ text: '看看  吧', caret: 3 })
    // 光标在 start 之前（调用方传错）也不会把正文反向切坏
    expect(stripMention('abc', 2, 0)).toEqual({ text: 'abc', caret: 2 })
  })
})

describe('候选筛选', () => {
  const choices = [choice({ label: '待办（1）' }), choice({ id: 'n', module: 'notes', title: '速记', label: '速记' })]

  it('空查询列前几个；大小写不敏感；按标题也能命中', () => {
    expect(filterChoices(choices, '').map((c) => c.title)).toEqual(['待办', '速记'])
    expect(filterChoices(choices, '速').map((c) => c.title)).toEqual(['速记'])
    expect(filterChoices([choice({ title: 'Todo', label: 'Todo' })], 'TO').length).toBe(1)
  })

  it('有条数上限 —— 再多就没法用方向键选了', () => {
    const many = Array.from({ length: 20 }, (_, i) => choice({ id: `c${i}` }))
    expect(filterChoices(many, '').length).toBe(6)
    expect(filterChoices(many, '', 2).length).toBe(2)
  })
})

describe('流式三态归并', () => {
  it('增量累积，状态仍是 streaming', () => {
    const t = applyChunk(turn({ role: 'assistant', content: '', status: 'streaming' }), chunk({ delta: '你' }))
    expect(t).toMatchObject({ content: '你', status: 'streaming' })
  })

  it('错误压过一切：已经收到的一半留着，但状态不能被随后的 done 洗掉', () => {
    const a = applyChunk(turn({ role: 'assistant', content: '半句', status: 'streaming' }), chunk({ error: '连接失败' }))
    expect(a).toMatchObject({ content: '半句', status: 'error', error: '连接失败' })
    const b = applyChunk(a, chunk({ done: true }))
    expect(b).toBe(a) // error 之后再来 done：原样返回
  })

  it('done 收尾；空帧（SSE 心跳）原样返回同一个对象', () => {
    expect(applyChunk(turn({ status: 'streaming' }), chunk({ done: true })).status).toBe('done')
    const t = turn()
    expect(applyChunk(t, chunk())).toBe(t)
  })
})

describe('组装请求', () => {
  it('只发说完的：流式占位、出错的整轮、空白内容都不进历史', () => {
    const turns = [
      turn({ role: 'user', content: '第一问' }),
      turn({ role: 'assistant', content: '第一答' }),
      turn({ role: 'user', content: '  ' }),
      turn({ role: 'assistant', content: '', status: 'streaming' }),
      turn({ role: 'assistant', content: '失败', status: 'error', error: 'x' }),
      turn({ role: 'user', content: '第二问' }),
    ]
    expect(outgoingFromTurns(turns)).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ])
  })

  it('只保留最近 N 条 —— 长上下文靠会话，不靠无限塞', () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn({ content: `第 ${i} 条` }))
    const out = outgoingFromTurns(turns, 3)
    expect(out.map((m) => m.content)).toEqual(['第 17 条', '第 18 条', '第 19 条'])
  })

  it('有引用时 system 块在最前；没引用时一条都不多', () => {
    const chips = [choice()]
    const withCtx = buildMessages([turn()], chips, () => '未完成：交周报')
    expect(withCtx[0].role).toBe('system')
    expect(withCtx[0].content).toContain('待办')
    expect(withCtx[0].content).toContain('交周报')
    expect(withCtx[1]).toEqual({ role: 'user', content: '你好' })
    expect(buildMessages([turn()], [], () => '')).toHaveLength(1)
  })

  it('引用块有预算：超了要明说被截断，不能静默变成"就这些"', () => {
    const block = contextBlock([choice()], () => 'x'.repeat(5000))!
    expect(block.length).toBeLessThanOrEqual(2000 + '（引用内容过长，已截断）'.length + 1)
    expect(block).toContain('已截断')
  })

  it('没有可引用内容的卡如实写一句，不替它编内容', () => {
    expect(contextBlock([choice({ label: '时钟' })], () => '')).toContain('没有可引用的文字内容')
    expect(contextBlock([], () => '')).toBeNull()
  })
})

describe('卡片正文摘录（只读用户真写进去的字）', () => {
  it('便签按实例取（第二张读自己那份）', () => {
    expect(excerptFor(choice({ module: 'sticky', id: 'sticky' }), source({ sticky: '第一张' }))).toBe('第一张')
    expect(
      excerptFor(
        choice({ module: 'sticky', id: 'sticky:2' }),
        source({ sticky: '第一张', byInstance: { 'sticky:2': { sticky: '第二张' } } }),
      ),
    ).toBe('第二张')
  })

  it('待办分未完成/已完成；全空时什么都不给', () => {
    const todos = [
      { id: 'a', text: '交周报', done: false },
      { id: 'b', text: '买牛奶', done: true },
    ]
    expect(excerptFor(choice({ module: 'todo' }), source({ todos }))).toBe('未完成：交周报（另有 1 条已完成）')
    // 第二张待办卡读自己那份清单（F-01 阶段 2 第二个字段），不回落第一张
    const second = excerptFor(
      choice({ module: 'todo', id: 'todo:2' }),
      source({ todos, byInstance: { 'todo:2': { todos: [{ id: 'z', text: '写周会纪要', done: false }] } } }),
    )
    expect(second).toBe('未完成：写周会纪要')
    expect(excerptFor(choice({ module: 'todo' }), source({ todos: [{ id: 'b', text: '买牛奶', done: true }] }))).toBe(
      '没有未完成的条目（另有 1 条已完成）',
    )
    expect(excerptFor(choice({ module: 'todo' }), source())).toBe('')
    // 一条都没完成：不画蛇添足写「另有 0 条已完成」
    expect(excerptFor(choice({ module: 'todo' }), source({ todos: [{ id: 'a', text: '交周报', done: false }] }))).toBe(
      '未完成：交周报',
    )
  })

  it('四象限 / 速记 / 记账 / 链接各有自己的形状', () => {
    expect(
      excerptFor(choice({ module: 'matrix' }), source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: false }] })),
    ).toBe('未完成：季度复盘')
    // 四象限全做完了 = 没有可引用的未完成项
    expect(
      excerptFor(choice({ module: 'matrix' }), source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: true }] })),
    ).toBe('')
    expect(
      excerptFor(
        choice({ module: 'notes' }),
        source({ notes: [{ id: 'n', title: '周会', body: '三件事', at: 0 }] }),
      ),
    ).toBe('周会：三件事')
    expect(
      excerptFor(
        choice({ module: 'ledger' }),
        source({ ledger: { symbol: '¥', entries: [{ id: 'l', date: '2026-10-28', cents: 1250, category: '餐饮', note: '午饭' }] } }),
      ),
    ).toBe('2026-10-28 餐饮 午饭 12.50¥')
    expect(
      excerptFor(choice({ module: 'links' }), source({ links: [{ label: '文档', href: 'https://x.y' }] })),
    ).toBe('文档 https://x.y')
    // 无标题 / 未分类 / 没设币种：给中性兜底，不出「：」开头的半截行
    expect(
      excerptFor(choice({ module: 'notes' }), source({ notes: [{ id: 'n', title: '', body: '没有标题', at: 0 }] })),
    ).toBe('无标题：没有标题')
    expect(
      excerptFor(
        choice({ module: 'ledger' }),
        source({ ledger: { symbol: '', entries: [{ id: 'l', date: '2026-10-28', cents: 100, category: '', note: '早饭' }] } }),
      ),
    ).toBe('2026-10-28 未分类 早饭 1.00')
  })

  it('倒数日 / 正计时 / 习惯 / 生日 / 抽签', () => {
    expect(excerptFor(choice({ module: 'countdown' }), source({ countdown: { label: '发版', date: '2026-11-01' } }))).toBe(
      '发版：2026-11-01',
    )
    expect(excerptFor(choice({ module: 'elapsed' }), source({ elapsed: { label: '戒烟', date: '2026-01-01' } }))).toBe(
      '戒烟：从 2026-01-01 起',
    )
    expect(excerptFor(choice({ module: 'habit' }), source({ habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] } }))).toBe(
      '跑步：已打卡 2 天',
    )
    expect(
      excerptFor(choice({ module: 'birthday' }), source({ birthdays: [{ id: 'b', name: '小王', month: 3, day: 5 }] })),
    ).toBe('小王：3 月 5 日')
    expect(excerptFor(choice({ module: 'pick' }), source({ pickList: [{ id: 'p', label: '小红', weight: 1 }] }))).toBe('小红')
  })

  it('没写内容 / 不认识的模块一律空串（联网卡与计算卡不喂）', () => {
    expect(excerptFor(choice({ module: 'countdown' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'elapsed' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'habit' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'notes' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'ledger' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'birthday' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'pick' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'weather' }), source())).toBe('')
  })

  it('超长正文被截断（每张卡 400 字）', () => {
    const long = excerptFor(choice({ module: 'sticky', id: 'sticky' }), source({ sticky: 'x'.repeat(900) }))
    expect(long.length).toBe(401)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('历史', () => {
  it('只认 user/assistant，system 与空内容不进气泡', () => {
    const turns = turnsFromHistory([
      { role: 'system', content: '你是助手', ts: 1 },
      { role: 'user', content: '问', ts: 1 },
      { role: 'assistant', content: '  ', ts: 1 },
      { role: 'assistant', content: '答', ts: 1 },
    ])
    expect(turns.map((t) => t.content)).toEqual(['问', '答'])
    expect(turns.every((t) => t.status === 'done')).toBe(true)
  })

  it('时间：今天/昨天只说时分，同年带月日，跨年带年份', () => {
    const now = new Date(2026, 9, 29, 14, 5, 0).getTime()
    const sec = (d: Date): number => Math.floor(d.getTime() / 1000)
    expect(historyWhen(sec(new Date(2026, 9, 29, 9, 3)), now)).toBe('今天 09:03')
    expect(historyWhen(sec(new Date(2026, 9, 28, 23, 59)), now)).toBe('昨天 23:59')
    expect(historyWhen(sec(new Date(2026, 8, 1, 8, 0)), now)).toBe('09-01 08:00')
    expect(historyWhen(sec(new Date(2025, 8, 1, 8, 0)), now)).toBe('2025-09-01')
  })
})

describe('坞该不该出现', () => {
  const base = {
    desktop: true,
    view: 'workbench' as const,
    floats: 0,
    settingsOpen: false,
    templatesOpen: false,
    paletteOpen: false,
    onboardingOpen: false,
  }

  it('桌面工作台、没有浮窗、没有全屏遮罩时才在', () => {
    expect(canShowDock(base)).toBe(true)
  })

  it('网页版 / 布局编辑 / 有浮窗 / 任一全屏遮罩 —— 一律不渲染', () => {
    expect(canShowDock({ ...base, desktop: false })).toBe(false)
    expect(canShowDock({ ...base, view: 'edit' })).toBe(false)
    expect(canShowDock({ ...base, floats: 1 })).toBe(false)
    expect(canShowDock({ ...base, settingsOpen: true })).toBe(false)
    expect(canShowDock({ ...base, templatesOpen: true })).toBe(false)
    expect(canShowDock({ ...base, paletteOpen: true })).toBe(false)
    expect(canShowDock({ ...base, onboardingOpen: true })).toBe(false)
  })
})
