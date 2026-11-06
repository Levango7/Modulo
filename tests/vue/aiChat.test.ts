import { describe, expect, it } from 'vitest'
import {
  addFiles,
  applyChunk,
  attachFile,
  ATTACH_CHARS_MAX,
  ATTACH_MAX_FILES,
  ATTACH_TOTAL_MAX,
  attachmentLine,
  buildMessages,
  canShowDock,
  cardChoices,
  charsLabel,
  contextBlock,
  contextUsage,
  excerptFor,
  filesSummary,
  filterChoices,
  historyWhen,
  mentionQuery,
  outgoingFromTurns,
  stripMention,
  summaryText,
  THINKING_LEVELS,
  thinkingLabel,
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

  /**
   * E2 的 composer 控件行显示「已用 X / 2000」—— 这个数字与 `contextBlock` 的
   * 事后截断必须同源，否则控件是个"看着玩的花架子"（显示没超、其实早截了）。
   * 钉法：不超预算时 usage.used == contextBlock 的真实长度（逐字符核对）。
   */
  it('contextUsage 与 contextBlock 同源：不超预算时两个数字逐字符相等', () => {
    const chips = [choice({ id: 'a', label: '待办' }), choice({ id: 'b', label: '便签' })]
    const u = contextUsage(chips, (c) => (c.id === 'a' ? '交周报' : '周五前发老板'))
    const block = contextBlock(chips, (c) => (c.id === 'a' ? '交周报' : '周五前发老板'))!
    expect(u.used).toBe(block.length)
    expect(u.max).toBe(2000)
    expect(u.cards).toBe(2)
    expect(u.over).toBe(false)
  })

  it('contextUsage：空摘录的卡也占那一份「没有可引用内容」的长度；超预算 over 翻真', () => {
    const u1 = contextUsage([choice({ label: '时钟' })], () => '')
    const b1 = contextBlock([choice({ label: '时钟' })], () => '')!
    expect(u1.used).toBe(b1.length)
    const u2 = contextUsage([choice()], () => 'x'.repeat(5000))
    expect(u2.over, '5000 字远超 2000 预算 ⇒ over').toBe(true)
    expect(u2.cards).toBe(1)
  })
})

describe('摘要正文（三期）', () => {
  const excerpt = (c: CardChoice): string => (c.id === 'sticky' ? '周五前把周报发给老板' : '')

  it('什么都没给 → null（按钮应保持禁用）', () => {
    expect(summaryText([], '   ', excerpt)).toBeNull()
  })

  it('只有引用：正文就是引用块 —— 带头、带卡片正文', () => {
    const out = summaryText([choice({ id: 'sticky', module: 'sticky', label: '便签' })], '', excerpt)!
    expect(out).toContain('用户在版面里引用了下面这些卡片')
    expect(out).toContain('## 便签')
    expect(out).toContain('周五前把周报发给老板')
  })

  it('只有输入：正文就是那段字（去掉首尾空白）', () => {
    expect(summaryText([], '  下周交周报  ', excerpt)).toBe('下周交周报')
  })

  it('两者都有：卡片在前、输入在后 —— 后者往往是对前者的指令', () => {
    const out = summaryText([choice({ id: 'sticky', module: 'sticky', label: '便签' })], '只留待办', excerpt)!
    expect(out.indexOf('## 便签')).toBeLessThan(out.indexOf('只留待办'))
  })

  it('引用块贴着预算时再加输入会超：整段二次封顶并明说截断', () => {
    const long = '账'.repeat(2000)
    const out = summaryText([choice({ id: 'sticky', module: 'sticky' })], long, () => long, 2000)!
    expect(out.length).toBe(2000)
    expect(out.endsWith('（内容过长，已截断）')).toBe(true)
  })

  it('预算在边界内原样返回（不多切一刀）', () => {
    expect(summaryText([], 'abc', excerpt, 10)).toBe('abc')
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
    // `id` 必须显式给成 `matrix`：`choice()` 的默认 id 是 `todo`，配 `module: 'matrix'`
    // 是现实里不存在的组合（实例 id 与模块 id 不等 ⇒ 按"第二实例"取 ⇒ 读 `byInstance['todo']`）。
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix' }),
        source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: false }] }),
      ),
    ).toBe('未完成：季度复盘')
    // 第二张四象限卡读自己那份清单（F-01 阶段 2 合并序第七个字段），不回落第一张
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix:2' }),
        source({
          matrix: [{ id: 'm', text: '第一张的复盘', q: 'plan', done: false }],
          byInstance: { 'matrix:2': { matrix: [{ id: 'z', text: '第二张的复盘', q: 'plan', done: false }] } },
        }),
      ),
    ).toBe('未完成：第二张的复盘')
    // 四象限全做完了 = 没有可引用的未完成项
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix' }),
        source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: true }] }),
      ),
    ).toBe('')
    expect(
      excerptFor(
        choice({ module: 'notes', id: 'notes' }),
        source({ notes: [{ id: 'n', title: '周会', body: '三件事', at: 0 }] }),
      ),
    ).toBe('周会：三件事')
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({ ledger: { symbol: '¥', entries: [{ id: 'l', date: '2026-10-28', cents: 1250, category: '餐饮', note: '午饭' }] } }),
      ),
    ).toBe('2026-10-28 餐饮 午饭 12.50¥')
    expect(
      excerptFor(choice({ module: 'links' }), source({ links: [{ label: '文档', href: 'https://x.y' }] })),
    ).toBe('文档 https://x.y')
    // 无标题 / 未分类 / 没设币种：给中性兜底，不出「：」开头的半截行
    expect(
      excerptFor(choice({ module: 'notes', id: 'notes' }), source({ notes: [{ id: 'n', title: '', body: '没有标题', at: 0 }] })),
    ).toBe('无标题：没有标题')
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({ ledger: { symbol: '', entries: [{ id: 'l', date: '2026-10-28', cents: 100, category: '', note: '早饭' }] } }),
      ),
    ).toBe('2026-10-28 未分类 早饭 1.00')
  })

  it('记账按实例取：第二张报自己的条目，符号仍共用顶层那个（§12.48 的口径）', () => {
    const first = { ledger: { symbol: '¥', entries: [{ id: 'l1', date: '2026-10-28', cents: 1250, category: '餐饮', note: '午饭' }] } }
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger:2' }),
        source({
          ...first,
          byInstance: {
            'ledger:2': { ledger: [{ id: 'l2', date: '2026-10-29', cents: 3900, category: '医疗', note: '体检挂号' }] },
          },
        }),
      ),
    ).toBe('2026-10-29 医疗 体检挂号 39.00¥')
    // 第二张还没记 ⇒ 空串，不拿第一张的条目（口径与前四个字段逐字相同）
    expect(excerptFor(choice({ module: 'ledger', id: 'ledger:2' }), source(first))).toBe('')
  })

  it('倒数日 / 正计时 / 习惯 / 生日 / 抽签', () => {
    // id 要与 module 配对（`choice` 默认给的是 todo）：不配对就等于"第二实例"，读的是切片不是顶层
    expect(
      excerptFor(choice({ module: 'countdown', id: 'countdown' }), source({ countdown: { label: '发版', date: '2026-11-01' } })),
    ).toBe('发版：2026-11-01')
    expect(
      excerptFor(choice({ module: 'elapsed', id: 'elapsed' }), source({ elapsed: { label: '戒烟', date: '2026-01-01' } })),
    ).toBe('戒烟：从 2026-01-01 起')
    // 习惯与哥哥们一样：id 要与 module 配对，不配对（`choice` 默认 id 是 'todo'）等于
    // 声称"第二实例"，读的是切片 —— 那条路在下面的按实例用例里单独钉
    expect(
      excerptFor(choice({ module: 'habit', id: 'habit' }), source({ habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] } })),
    ).toBe('跑步：已打卡 2 天')
    expect(
      excerptFor(choice({ module: 'birthday' }), source({ birthdays: [{ id: 'b', name: '小王', month: 3, day: 5 }] })),
    ).toBe('小王：3 月 5 日')
    expect(excerptFor(choice({ module: 'pick' }), source({ pickList: [{ id: 'p', label: '小红', weight: 1 }] }))).toBe('小红')
  })

  it('倒数日按实例取：第二张报自己的日子，没设日子时不拿第一张的', () => {
    const first = { countdown: { label: '发版', date: '2026-11-01' } }
    expect(
      excerptFor(
        choice({ module: 'countdown', id: 'countdown:2' }),
        source({ ...first, byInstance: { 'countdown:2': { countdown: { label: '体检', date: '2026-12-20' } } } }),
      ),
    ).toBe('体检：2026-12-20')
    // 第二张还没设日子 ⇒ 空串，**不回落顶层**（口径与便签 / 待办逐字相同：回落就是把阶段 1 那个缺陷请回来）
    expect(excerptFor(choice({ module: 'countdown', id: 'countdown:2' }), source(first))).toBe('')
  })

  it('正计时按实例取：第二张报自己的起点，没设起点时不拿第一张的', () => {
    const first = { elapsed: { label: '戒烟', date: '2026-01-01' } }
    expect(
      excerptFor(
        choice({ module: 'elapsed', id: 'elapsed:2' }),
        source({ ...first, byInstance: { 'elapsed:2': { elapsed: { label: '健身', date: '2026-05-01' } } } }),
      ),
    ).toBe('健身：从 2026-05-01 起')
    expect(excerptFor(choice({ module: 'elapsed', id: 'elapsed:2' }), source(first))).toBe('')
  })

  it('习惯按实例取：第二张报自己的名字和天数，没设时不拿第一张的', () => {
    const first = { habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] } }
    expect(
      excerptFor(
        choice({ module: 'habit', id: 'habit:2' }),
        source({ ...first, byInstance: { 'habit:2': { habit: { name: '冥想', days: ['2026-11-01', '2026-11-02', '2026-11-03'] } } } }),
      ),
    ).toBe('冥想：已打卡 3 天')
    // 第二张还没设 ⇒ 空串，**不回落顶层**（口径与哥哥们逐字相同：回落就是把阶段 1 那个缺陷请回来）
    expect(excerptFor(choice({ module: 'habit', id: 'habit:2' }), source(first))).toBe('')
  })

  it('速记按实例取：第二张报自己的那几条，没写时不拿第一张的', () => {
    const first = { notes: [{ id: 'n1', title: '第一张的', body: '顶层那份', at: 1 }] }
    expect(
      excerptFor(
        choice({ module: 'notes', id: 'notes:2' }),
        source({ ...first, byInstance: { 'notes:2': { notes: [{ id: 'n2', title: '第二张的', body: '切片那份', at: 2 }] } } }),
      ),
    ).toBe('第二张的：切片那份')
    // 第二张还没写 ⇒ 空串，不回落顶层（§12.52 习惯同一条口径）
    expect(excerptFor(choice({ module: 'notes', id: 'notes:2' }), source(first))).toBe('')
  })

  it('没写内容 / 不认识的模块一律空串（联网卡与计算卡不喂）', () => {
    expect(excerptFor(choice({ module: 'countdown', id: 'countdown' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'elapsed', id: 'elapsed' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'habit', id: 'habit' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'notes' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'ledger', id: 'ledger' }), source())).toBe('')
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

describe('思考档位与附件（E3）', () => {
  it('四档：off 是默认；未知 id 回落默认文案（与 Rust「未知值不加指令」同口径）', () => {
    expect(THINKING_LEVELS.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'high'])
    expect(thinkingLabel('off')).toBe('默认')
    expect(thinkingLabel('high')).toBe('深')
    // 不抛、也不把英文 id 露给用户 —— 回落到「默认」
    expect(thinkingLabel('turbo')).toBe('默认')
  })

  it('attachFile：空文件与二进制拒收，理由里带文件名', () => {
    const empty = attachFile('空.md', '  \n\t ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toContain('空.md')
    const bin = attachFile('图.png', 'PNG\u0000\u0001')
    expect(bin.ok).toBe(false)
    if (!bin.ok) expect(bin.reason).toContain('不像文本文件')
  })

  it('attachFile：CRLF 归一；超长按码点截到 8000 并记下截断', () => {
    const ok = attachFile('a.txt', '一\r\n二')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.file.content).toBe('一\n二')
    const cut = attachFile('长.txt', '字'.repeat(ATTACH_CHARS_MAX + 5))
    expect(cut.ok).toBe(true)
    if (cut.ok) {
      expect(cut.file.truncated).toBe(true)
      expect(cut.file.chars).toBe(ATTACH_CHARS_MAX)
      expect(Array.from(cut.file.content)).toHaveLength(ATTACH_CHARS_MAX)
    }
  })

  it('attachFile：emoji 按码点算，不会被劈成两个半截', () => {
    const ok = attachFile('e.txt', '😀'.repeat(3))
    expect(ok.ok).toBe(true)
    // 3 个 emoji = 3 个码点（不是 6 个 UTF-16 单元）
    if (ok.ok) expect(ok.file.chars).toBe(3)
  })

  it('addFiles：同名不重复挂；个数与合计预算各自守门', () => {
    const dup = addFiles([], [
      { name: 'a.md', text: 'x' },
      { name: 'a.md', text: 'y' },
    ])
    expect(dup.files).toHaveLength(1)
    expect(dup.rejected[0]).toContain('已经挂上了')

    const many = addFiles([], ['1', '2', '3', '4'].map((n) => ({ name: `${n}.md`, text: 'x' })))
    expect(many.files).toHaveLength(ATTACH_MAX_FILES)
    expect(many.rejected.join('')).toContain('一次最多带')

    // 合计上限：两个顶格文件正好用满，第三个小文件也进不来
    const full = '字'.repeat(ATTACH_CHARS_MAX)
    const over = addFiles([], [
      { name: 'A', text: full },
      { name: 'B', text: full },
      { name: 'C', text: '一点点' },
    ])
    expect(over.files).toHaveLength(2)
    expect(over.rejected.join('')).toContain(String(ATTACH_TOTAL_MAX))
  })

  it('addFiles：坏文件（空 / 二进制）的理由原样透传，不悄悄吞掉', () => {
    const r = addFiles([], [
      { name: 'empty.md', text: '   \n' },
      { name: 'bin.png', text: 'x\u0000y' },
    ])
    expect(r.files).toHaveLength(0)
    expect(r.rejected).toHaveLength(2)
    expect(r.rejected[0]).toContain('是空的')
    expect(r.rejected[1]).toContain('不像文本文件')
  })

  it('filesSummary / attachmentLine：没文件不出摘要；截断要说', () => {
    expect(filesSummary([])).toBeNull()
    const one = attachFile('a.md', 'x'.repeat(1234))
    if (!one.ok) throw new Error('夹具应当被接收')
    expect(filesSummary([one.file])).toBe('1 个文件 · 1.2k 字')
    expect(attachmentLine(one.file)).toBe('a.md · 1.2k 字')
    const cut = attachFile('b.md', 'x'.repeat(ATTACH_CHARS_MAX + 1))
    if (!cut.ok) throw new Error('夹具应当被接收')
    expect(filesSummary([cut.file])).toContain('有截断')
    expect(attachmentLine(cut.file)).toContain('已截断')
  })

  it('charsLabel：千位以下报精确值，以上报量级', () => {
    expect(charsLabel(999)).toBe('999 字')
    expect(charsLabel(1000)).toBe('1.0k 字')
    expect(charsLabel(12400)).toBe('12k 字')
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
    // E1：chat 视图里坞也要在（全高面板）；edit 仍不挡拖拽
    expect(canShowDock({ ...base, view: 'chat' })).toBe(true)
    expect(canShowDock({ ...base, view: 'edit' })).toBe(false)
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
