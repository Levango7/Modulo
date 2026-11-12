/**
 * 「AI 动手」纯函数层的钉子（改天换地第十二笔）。
 *
 * 这一层的输入是**模型写的文本** —— 最不可信的那种输入。测的重点 accordingly：
 * 宽容（围栏 / 空白 / 行中不算）、闸门（三条白名单各自的边界）、可见（坏行必须说人话）、
 * 执行（首败即停、失败不回滚已做的）。
 */
import { describe, expect, it } from 'vitest'
import {
  actionLabel,
  actionPrompt,
  actionResultLines,
  actionResultText,
  ACTION_CENTS_MAX,
  ACTION_MAX_PER_REPLY,
  ACTION_NOTE_MAX,
  ACTION_RESULT_MARK,
  ACTION_TEXT_MAX,
  isActionResult,
  parseActions,
  runActions,
  stripActionLines,
  type AiAction,
  type ActionContext,
} from '../../src/vue/aiActions'

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  moduleIds: ['todo', 'sticky', 'ledger', 'clock'],
  today: '2026-11-09',
  ...over,
})

const act = (o: Record<string, unknown>): string => `@@act ${JSON.stringify(o)}`

describe('AI 动作：解析与剥行（最不可信的输入）', () => {
  it('没有动作行：clean 与原文一致（只整理尾空白），两边都空', () => {
    const text = '今天天气不错。\n\n要不要摆张卡？'
    const r = parseActions(text, ctx())
    expect(r.clean).toBe(text)
    expect(r.actions).toEqual([])
    expect(r.bad).toEqual([])
  })

  it('正文里的动作行被剥掉，正文顺序不变', () => {
    const text = ['先给你摆一张待办卡。', act({ type: 'addCard', moduleId: 'todo' }), '顺手加一条。'].join('\n')
    const r = parseActions(text, ctx())
    expect(r.clean).toBe('先给你摆一张待办卡。\n顺手加一条。')
    expect(r.actions).toEqual([{ type: 'addCard', moduleId: 'todo' }])
  })

  it('前缀宽容：行首空白与代码围栏都认', () => {
    const text = ['好的。', `  ${act({ type: 'todo.add', text: '买牛奶' })}  `, '```' + act({ type: 'todo.add', text: '取快递' }) + '```'].join('\n')
    const r = parseActions(text, ctx())
    expect(r.actions.map((a) => (a.type === 'todo.add' ? a.text : ''))).toEqual(['买牛奶', '取快递'])
    expect(r.bad).toEqual([])
  })

  it('行中的 @@act 不算动作（留在正文里）', () => {
    const text = '格式是 @@act {"type":"todo.add","text":"x"} 这样。'
    const r = parseActions(text, ctx())
    expect(r.actions).toEqual([])
    expect(r.clean).toBe(text)
  })

  it('坏 JSON / 不是对象 —— 进 bad 不抛', () => {
    const r = parseActions(['在。', '@@act {oops', '@@act [1,2]'].join('\n'), ctx())
    expect(r.actions).toEqual([])
    expect(r.bad).toHaveLength(2)
    expect(r.bad[0]).toContain('没看懂')
    expect(r.clean).toBe('在。')
  })

  it('未知动作 / 空 type —— 人话说"这一版还不会"', () => {
    const r = parseActions([act({ type: 'canvas.clear' }), act({})].join('\n'), ctx())
    expect(r.actions).toEqual([])
    expect(r.bad).toHaveLength(2)
    expect(r.bad[0]).toContain('还不会')
    expect(r.bad[0]).toContain('canvas.clear')
  })

  it('剥掉动作行后多余空行折叠；stripActionLines 与 clean 同口径', () => {
    const text = ['上面。', '', act({ type: 'todo.add', text: 'x' }), '', '', '下面。'].join('\n')
    const r = parseActions(text, ctx())
    expect(r.clean).toBe('上面。\n\n下面。')
    expect(stripActionLines(text)).toBe(r.clean)
  })
})

describe('AI 动作：三条白名单各自的闸门', () => {
  it('addCard：注册表里有的卡才让摆；variant 可选、不在也不报（卡侧自己兜底）', () => {
    const ok = parseActions(act({ type: 'addCard', moduleId: 'sticky', variant: 'big' }), ctx())
    expect(ok.actions).toEqual([{ type: 'addCard', moduleId: 'sticky', variant: 'big' }])
    const noId = parseActions(act({ type: 'addCard' }), ctx())
    expect(noId.bad[0]).toContain('没写 moduleId')
    const notExist = parseActions(act({ type: 'addCard', moduleId: 'nonexistent' }), ctx())
    expect(notExist.actions).toEqual([])
    expect(notExist.bad[0]).toContain('注册表里没有')
  })

  it('todo.add：空内容 / 超长 —— 不执行并列出来', () => {
    expect(parseActions(act({ type: 'todo.add', text: '  ' }), ctx()).bad[0]).toContain('没写内容')
    const long = parseActions(act({ type: 'todo.add', text: '字'.repeat(ACTION_TEXT_MAX + 1) }), ctx())
    expect(long.actions).toEqual([])
    expect(long.bad[0]).toContain('太长')
  })

  it('ledger.add：金额必须是正的整数分（12.34 元 = 1234）', () => {
    for (const cents of [0, -1, 12.34, ACTION_CENTS_MAX + 1, '1234']) {
      const r = parseActions(act({ type: 'ledger.add', cents, category: '餐饮' }), ctx())
      expect(r.actions, `cents=${String(cents)} 不该过`).toEqual([])
      expect(r.bad[0]).toContain('整数分')
    }
    const ok = parseActions(act({ type: 'ledger.add', cents: 1234, category: '餐饮' }), ctx())
    expect(ok.actions).toEqual([{ type: 'ledger.add', cents: 1234, category: '餐饮', date: '2026-11-09' }])
  })

  it('ledger.add：没写日期落今天；写了坏日期不执行；分类/备注各自封顶', () => {
    const withDate = parseActions(act({ type: 'ledger.add', cents: 1, category: 'a', date: '2026-01-31' }), ctx())
    expect(withDate.actions[0]).toMatchObject({ date: '2026-01-31' })
    const badDate = parseActions(act({ type: 'ledger.add', cents: 1, category: 'a', date: '一月三十一' }), ctx())
    expect(badDate.actions).toEqual([])
    expect(badDate.bad[0]).toContain('YYYY-MM-DD')
    const noCat = parseActions(act({ type: 'ledger.add', cents: 1 }), ctx())
    expect(noCat.bad[0]).toContain('没写分类')
    const longNote = parseActions(act({ type: 'ledger.add', cents: 1, category: 'a', note: '字'.repeat(ACTION_NOTE_MAX + 1) }), ctx())
    expect(longNote.bad[0]).toContain('备注太长')
  })

  it('一次最多 5 个：多出来的不执行、数出来说明', () => {
    const lines = Array.from({ length: ACTION_MAX_PER_REPLY + 2 }, (_, i) => act({ type: 'todo.add', text: `第${i}条` }))
    const r = parseActions(lines.join('\n'), ctx())
    expect(r.actions).toHaveLength(ACTION_MAX_PER_REPLY)
    expect(r.bad).toHaveLength(1)
    expect(r.bad[0]).toContain('多出来的 2 个')
  })
})

describe('AI 动作 v1.1：三个新动作的闸门（便签 / 倒数日 / 习惯）', () => {
  it('sticky.append：空 / 超长 —— 不执行；合法原样留下（只追加，从设计上不覆盖）', () => {
    const ok = parseActions(act({ type: 'sticky.append', text: '还有一件事' }), ctx())
    expect(ok.actions).toEqual([{ type: 'sticky.append', text: '还有一件事' }])
    expect(parseActions(act({ type: 'sticky.append', text: '  ' }), ctx()).bad[0]).toContain('没写要加什么')
    const long = parseActions(act({ type: 'sticky.append', text: '字'.repeat(ACTION_TEXT_MAX + 1) }), ctx())
    expect(long.actions).toEqual([])
    expect(long.bad[0]).toContain('太长')
  })

  it('countdown.set：名字与日期都得在；日期写法看不懂不执行', () => {
    const ok = parseActions(act({ type: 'countdown.set', label: '发版', date: '2026-12-01' }), ctx())
    expect(ok.actions).toEqual([{ type: 'countdown.set', label: '发版', date: '2026-12-01' }])
    expect(parseActions(act({ type: 'countdown.set', date: '2026-12-01' }), ctx()).bad[0]).toContain('没写名字')
    expect(parseActions(act({ type: 'countdown.set', label: '发版', date: '12月1日' }), ctx()).bad[0]).toContain('YYYY-MM-DD')
    const long = parseActions(act({ type: 'countdown.set', label: '字'.repeat(21), date: '2026-12-01' }), ctx())
    expect(long.bad[0]).toContain('太长')
  })

  it('habit.check：无字段也算合法（打今天的卡是执行侧的事）', () => {
    const r = parseActions(act({ type: 'habit.check' }), ctx())
    expect(r.actions).toEqual([{ type: 'habit.check' }])
    expect(r.bad).toEqual([])
  })
})

describe('AI 动作：提议怎么执行（首败即停）', () => {
  const acts: AiAction[] = [
    { type: 'todo.add', text: '一条' },
    { type: 'todo.add', text: '两条' },
    { type: 'todo.add', text: '三条' },
  ]

  it('全部成功：done 数对上、调用顺序就是提议顺序、无产出时 values 占位 undefined', () => {
    const seen: string[] = []
    const r = runActions(acts, (a) => void seen.push(a.type === 'todo.add' ? a.text : a.type))
    expect(r).toEqual({ ok: true, done: 3, values: [undefined, undefined, undefined] })
    expect(seen).toEqual(['一条', '两条', '三条'])
  })

  it('读类动作的产出进 values，并原样进回喂文本（写动作没有产出 = 成功）', () => {
    const planned: AiAction[] = [
      { type: 'context.read', moduleId: 'todo' },
      { type: 'todo.add', text: '买牛奶' },
      { type: 'context.read' },
    ]
    const r = runActions(planned, (a) => {
      if (a.type === 'context.read') return a.moduleId ? '未完成：交周报' : '待办、便签'
    })
    expect(r.ok).toBe(true)
    expect(r.done).toBe(3)
    expect(r.values).toEqual(['未完成：交周报', undefined, '待办、便签'])
    const lines = actionResultLines(planned, r, (a) => actionLabel(a))
    expect(lines[0]).toBe('看一眼「todo」卡：未完成：交周报')
    expect(lines[1]).toBe('加一条待办：买牛奶：成功')
    expect(lines[2]).toBe('看一眼版面清单：待办、便签')
  })

  it('第二个抛：第一个不回滚、第三个不再跑，错误带出来', () => {
    const seen: string[] = []
    const r = runActions(acts, (a) => {
      const t = a.type === 'todo.add' ? a.text : ''
      if (t === '两条') throw new Error('盘子满了')
      seen.push(t)
    })
    expect(r.ok).toBe(false)
    expect(r.done).toBe(1)
    expect(r.error).toContain('盘子满了')
    expect(r.values).toEqual([undefined])
    expect(seen).toEqual(['一条'])
  })
})

describe('AI 动作 v1.3：read 类（先看再动）', () => {
  it('context.read：无 moduleId = 看版面清单；有则过注册表白名单；未知卡 id 拒收', () => {
    expect(parseActions(act({ type: 'context.read' }), ctx()).actions).toEqual([{ type: 'context.read' }])
    expect(parseActions(act({ type: 'context.read', moduleId: 'todo' }), ctx()).actions).toEqual([
      { type: 'context.read', moduleId: 'todo' },
    ])
    const bad = parseActions(act({ type: 'context.read', moduleId: 'nonexistent' }), ctx())
    expect(bad.actions).toEqual([])
    expect(bad.bad[0]).toContain('注册表里没有')
  })

  it('人话：看一眼版面清单 / 看一眼「待办」卡（卡名查不到落回 id）', () => {
    expect(actionLabel({ type: 'context.read' })).toBe('看一眼版面清单')
    expect(actionLabel({ type: 'context.read', moduleId: 'todo' }, () => '待办')).toBe('看一眼「待办」卡')
    expect(actionLabel({ type: 'context.read', moduleId: 'todo' })).toBe('看一眼「todo」卡')
  })

  it('actionPrompt：read 的两种格式在，且点名"只读、结果会回给你"', () => {
    const p = actionPrompt()
    expect(p).toContain('context.read')
    expect(p).toContain('只读')
    expect(p).toContain('会随执行结果回给你')
  })
})

describe('AI 动作 v1.4：多实例定点（instanceId）', () => {
  const instCtx = (): ActionContext => ({
    ...ctx(),
    moduleIds: ['todo', 'sticky', 'ledger', 'clock', 'habit'],
    instances: [
      { id: 'todo', module: 'todo' },
      { id: 'habit', module: 'habit' },
      { id: 'habit:2', module: 'habit' },
    ],
  })

  it('定点写：instanceId 在清单里就过、不在就整行拒收（缺省逐字不变）', () => {
    expect(parseActions(act({ type: 'habit.check', instanceId: 'habit:2' }), instCtx()).actions).toEqual([
      { type: 'habit.check', instanceId: 'habit:2' },
    ])
    // 缺省 = 第一实例：不带 instanceId 的解析结果与 v1.3 逐字同形
    expect(parseActions(act({ type: 'todo.add', text: '买牛奶' }), instCtx()).actions).toEqual([
      { type: 'todo.add', text: '买牛奶' },
    ])
    const bad = parseActions(act({ type: 'habit.check', instanceId: 'habit:9' }), instCtx())
    expect(bad.actions).toEqual([])
    expect(bad.bad[0]).toContain('实例清单里没有这张卡')
  })

  it('context.read 定点读：moduleId 与 instanceId 必须对得上', () => {
    expect(parseActions(act({ type: 'context.read', instanceId: 'habit:2' }), instCtx()).actions).toEqual([
      { type: 'context.read', instanceId: 'habit:2' },
    ])
    expect(parseActions(act({ type: 'context.read', moduleId: 'habit', instanceId: 'habit:2' }), instCtx()).actions).toEqual([
      { type: 'context.read', moduleId: 'habit', instanceId: 'habit:2' },
    ])
    const mismatch = parseActions(act({ type: 'context.read', moduleId: 'todo', instanceId: 'habit:2' }), instCtx())
    expect(mismatch.actions).toEqual([])
    expect(mismatch.bad[0]).toContain('moduleId 与 instanceId 对不上')
    const unknown = parseActions(act({ type: 'context.read', instanceId: 'nope:1' }), instCtx())
    expect(unknown.actions).toEqual([])
    expect(unknown.bad[0]).toContain('实例清单里没有这张卡')
  })

  it('没有实例清单的旧 ctx：instanceId 拒收（清单为空，不会静默定点到别处）', () => {
    const bad = parseActions(act({ type: 'habit.check', instanceId: 'habit:2' }), ctx())
    expect(bad.actions).toEqual([])
    expect(bad.bad[0]).toContain('实例清单里没有这张卡')
  })

  it('actionLabel：定点前缀统一 + 定点读的人话', () => {
    expect(actionLabel({ type: 'habit.check', instanceId: 'habit:2' }, undefined, (id) => `冥想（${id}）`)).toBe(
      '定点「冥想（habit:2）」 · 给习惯卡打上今天的卡',
    )
    expect(actionLabel({ type: 'todo.add', text: '买牛奶', instanceId: 'todo' })).toBe('定点「todo」 · 加一条待办：买牛奶')
    expect(actionLabel({ type: 'context.read', instanceId: 'habit:2' })).toBe('定点「habit:2」 · 看一眼这张卡')
  })
})

describe('AI 动作 v1.5：读侧增强（moduleIds 多卡 + full 全卡）', () => {
  const readCtx = (): ActionContext => ({
    ...ctx(),
    moduleIds: ['todo', 'sticky', 'ledger', 'clock', 'habit', 'notes'],
    instances: [{ id: 'todo', module: 'todo' }],
  })

  it('多卡并行读：moduleIds 数组原样解析（不给时与 v1.4 逐字同形）', () => {
    expect(parseActions(act({ type: 'context.read', moduleIds: ['todo', 'habit', 'ledger'] }), readCtx()).actions).toEqual([
      { type: 'context.read', moduleIds: ['todo', 'habit', 'ledger'] },
    ])
    expect(parseActions(act({ type: 'context.read' }), readCtx()).actions).toEqual([{ type: 'context.read' }])
    expect(parseActions(act({ type: 'context.read', moduleId: 'todo' }), readCtx()).actions).toEqual([
      { type: 'context.read', moduleId: 'todo' },
    ])
  })

  it('moduleIds 与 moduleId / instanceId 互斥（混写不知道读哪张）', () => {
    const both = parseActions(act({ type: 'context.read', moduleIds: ['todo'], moduleId: 'todo' }), readCtx())
    expect(both.actions).toEqual([])
    expect(both.bad[0]).toContain('只能给一个')
    const withInst = parseActions(act({ type: 'context.read', moduleIds: ['todo'], instanceId: 'todo' }), readCtx())
    expect(withInst.actions).toEqual([])
    expect(withInst.bad[0]).toContain('只能给一个')
  })

  it('moduleIds 的闸门：非数组 / 空 / 超上限 / 重复 / 未知 id 逐条人话拒收', () => {
    const notArr = parseActions(act({ type: 'context.read', moduleIds: 'todo' }), readCtx())
    expect(notArr.actions).toEqual([])
    expect(notArr.bad[0]).toContain('不是数组')
    const empty = parseActions(act({ type: 'context.read', moduleIds: [] }), readCtx())
    expect(empty.actions).toEqual([])
    expect(empty.bad[0]).toContain('空的')
    const tooMany = parseActions(
      act({ type: 'context.read', moduleIds: ['todo', 'sticky', 'ledger', 'clock', 'habit', 'notes'] }),
      readCtx(),
    )
    expect(tooMany.actions).toEqual([])
    expect(tooMany.bad[0]).toContain('太多了')
    const dup = parseActions(act({ type: 'context.read', moduleIds: ['todo', 'todo'] }), readCtx())
    expect(dup.actions).toEqual([])
    expect(dup.bad[0]).toContain('重复')
    const unknown = parseActions(act({ type: 'context.read', moduleIds: ['todo', 'nope'] }), readCtx())
    expect(unknown.actions).toEqual([])
    expect(unknown.bad[0]).toContain('注册表里没有这张卡')
  })

  it('full：配 moduleId / moduleIds / instanceId 都过，配 roster 拒收（看清单用不上）', () => {
    expect(parseActions(act({ type: 'context.read', moduleId: 'notes', full: true }), readCtx()).actions).toEqual([
      { type: 'context.read', moduleId: 'notes', full: true },
    ])
    expect(
      parseActions(act({ type: 'context.read', moduleIds: ['todo', 'habit'], full: true }), readCtx()).actions,
    ).toEqual([{ type: 'context.read', moduleIds: ['todo', 'habit'], full: true }])
    const instCtx = (): ActionContext => ({
      ...readCtx(),
      instances: [
        { id: 'notes', module: 'notes' },
        { id: 'notes:2', module: 'notes' },
      ],
    })
    expect(
      parseActions(act({ type: 'context.read', moduleId: 'notes', instanceId: 'notes:2', full: true }), instCtx()).actions,
    ).toEqual([{ type: 'context.read', moduleId: 'notes', instanceId: 'notes:2', full: true }])
    const roster = parseActions(act({ type: 'context.read', full: true }), readCtx())
    expect(roster.actions).toEqual([])
    expect(roster.bad[0]).toContain('full 要配')
    // full 缺省 = 不带：既有读法逐字不变
    expect(parseActions(act({ type: 'context.read', moduleId: 'notes' }), readCtx()).actions).toEqual([
      { type: 'context.read', moduleId: 'notes' },
    ])
  })

  it('actionLabel：多卡一组 + 全卡的人话', () => {
    expect(
      actionLabel({ type: 'context.read', moduleIds: ['todo', 'habit'] }, (id) => (id === 'todo' ? '待办' : '习惯')),
    ).toBe('看一眼 2 张卡（待办、习惯）')
    expect(actionLabel({ type: 'context.read', moduleId: 'notes', full: true }, (id) => (id === 'notes' ? '速记' : id))).toBe(
      '看一眼整张「速记」',
    )
    expect(actionLabel({ type: 'context.read', moduleId: 'todo' })).toBe('看一眼「todo」卡')
  })

  it('actionPrompt：多卡与全卡的写法都写进指令，上限数在', () => {
    const p = actionPrompt()
    expect(p).toContain('moduleIds')
    expect(p).toContain('"full":true')
    expect(p).toContain('5 张')
    expect(p).toContain('2000 字')
  })
})

describe('AI 动作 v1.6：按内容找卡（query）', () => {
  const readCtx = (): ActionContext => ({ ...ctx(), moduleIds: ['todo', 'sticky', 'ledger'] })

  it('query trim 后原样解析，人话叫「找一找写有「…」的东西」（v1.7 起「卡」→「东西」）', () => {
    expect(parseActions(act({ type: 'context.read', query: '  体检  ' }), readCtx()).actions).toEqual([
      { type: 'context.read', query: '体检' },
    ])
    expect(actionLabel({ type: 'context.read', query: '体检' })).toBe('找一找写有「体检」的东西')
  })

  it('query 与 moduleId / moduleIds / instanceId / full 互斥（找卡 vs 读卡）', () => {
    const m = parseActions(act({ type: 'context.read', query: '体检', moduleId: 'todo' }), readCtx())
    expect(m.actions).toEqual([])
    expect(m.bad[0]).toContain('只能给一个')
    const f = parseActions(act({ type: 'context.read', query: '体检', full: true }), readCtx())
    expect(f.actions).toEqual([])
    expect(f.bad[0]).toContain('只能给一个')
    const instCtx = (): ActionContext => ({ ...readCtx(), instances: [{ id: 'todo', module: 'todo' }] })
    const i = parseActions(act({ type: 'context.read', query: '体检', instanceId: 'todo' }), instCtx())
    expect(i.actions).toEqual([])
    expect(i.bad[0]).toContain('只能给一个')
  })

  it('闸门：不是文字 / 空 / 超长逐条人话拒收', () => {
    const notStr = parseActions(act({ type: 'context.read', query: 12 }), readCtx())
    expect(notStr.actions).toEqual([])
    expect(notStr.bad[0]).toContain('不是文字')
    const empty = parseActions(act({ type: 'context.read', query: '   ' }), readCtx())
    expect(empty.actions).toEqual([])
    expect(empty.bad[0]).toContain('空的')
    const long = parseActions(act({ type: 'context.read', query: 'x'.repeat(41) }), readCtx())
    expect(long.actions).toEqual([])
    expect(long.bad[0]).toContain('太长了')
  })

  it('actionPrompt：找卡写法与「互斥」说明都在', () => {
    const p = actionPrompt()
    expect(p).toContain('"query":"体检"')
    expect(p).toContain('互斥')
  })
})

describe('AI 动作 v1.7：找我的东西（多关键词 + 三类来源）', () => {
  const readCtx = (): ActionContext => ({ ...ctx(), moduleIds: ['todo', 'sticky', 'ledger'] })

  it('多关键词：空格分隔，多个空格归一成一个', () => {
    expect(parseActions(act({ type: 'context.read', query: '  体检   挂号  ' }), readCtx()).actions).toEqual([
      { type: 'context.read', query: '体检 挂号' },
    ])
    expect(actionLabel({ type: 'context.read', query: '体检 挂号' })).toBe('找一找写有「体检 挂号」的东西')
  })

  it('词数上限 4：超了整行拒收（人话里说清最多几个）', () => {
    const bad = parseActions(act({ type: 'context.read', query: '一 二 三 四 五' }), readCtx())
    expect(bad.actions).toEqual([])
    expect(bad.bad[0]).toContain('最多 4 个')
  })

  it('单关键词与缺省行为逐字不变（人话里「东西」替换「卡」）', () => {
    expect(parseActions(act({ type: 'context.read', query: '体检' }), readCtx()).actions).toEqual([
      { type: 'context.read', query: '体检' },
    ])
    expect(actionLabel({ type: 'context.read', query: '体检' })).toBe('找一找写有「体检」的东西')
  })

  it('actionPrompt：三类来源与「都要出现」都写进指令', () => {
    const p = actionPrompt()
    expect(p).toContain('卡片 / 资料 / 技能')
    expect(p).toContain('都要出现')
  })
})

describe('AI 动作 v1.2：工具结果回喂（agent 循环）', () => {
  const acts: AiAction[] = [
    { type: 'todo.add', text: '买牛奶' },
    { type: 'ledger.add', cents: 100, category: 'a', date: '2026-11-09' },
    { type: 'habit.check' },
  ]

  it('actionResultLines：成功 / 失败 / 因前一步失败而没执行 三种行', () => {
    const ok = actionResultLines(acts, { ok: true, done: 3 }, (a) => actionLabel(a))
    expect(ok).toEqual([
      '加一条待办：买牛奶：成功',
      '记一笔：¥1.00 · a：成功',
      '给习惯卡打上今天的卡：成功',
    ])
    const bad = actionResultLines(acts, { ok: false, done: 1, error: '盘子满了' }, (a) => actionLabel(a))
    expect(bad[1]).toContain('失败（盘子满了）')
    expect(bad[2]).toContain('没有执行（前一步失败了）')
  })

  it('actionResultText：带标记、逐条列出、明确让它继续或收尾', () => {
    const t = actionResultText(['甲：成功'])
    expect(t.startsWith(ACTION_RESULT_MARK)).toBe(true)
    expect(t).toContain('- 甲：成功')
    expect(t).toContain('不要重复已经做过的')
  })

  it('isActionResult：认标记（容忍行首空白），不误伤用户自己的话', () => {
    expect(isActionResult(`${ACTION_RESULT_MARK}刚才…`)).toBe(true)
    expect(isActionResult(`   ${ACTION_RESULT_MARK}刚才…`)).toBe(true)
    expect(isActionResult('（工具结果的）这是我自己打的字')).toBe(false)
    expect(isActionResult('普通提问')).toBe(false)
  })
})

describe('AI 动作：人话与指令', () => {
  it('actionLabel：三条各自的人话；卡名给不了落回 id', () => {
    expect(actionLabel({ type: 'addCard', moduleId: 'todo' }, () => '待办')).toBe('摆一张「待办」卡')
    expect(actionLabel({ type: 'addCard', moduleId: 'todo' })).toBe('摆一张「todo」卡')
    expect(actionLabel({ type: 'todo.add', text: '买牛奶' })).toBe('加一条待办：买牛奶')
    expect(actionLabel({ type: 'ledger.add', cents: 1250, category: '餐饮', note: '午饭', date: '2026-11-09' })).toBe(
      '记一笔：¥12.50 · 餐饮 · 午饭',
    )
    expect(actionLabel({ type: 'ledger.add', cents: 1, category: 'a', date: '2026-11-09' })).toBe('记一笔：¥0.01 · a')
    // v1.1 的三条
    expect(actionLabel({ type: 'sticky.append', text: '还有一件事' })).toBe('往便签里加一段：还有一件事')
    expect(actionLabel({ type: 'countdown.set', label: '发版', date: '2026-12-01' })).toBe('把倒数日设成「发版 · 2026-12-01」')
    expect(actionLabel({ type: 'habit.check' })).toBe('给习惯卡打上今天的卡')
  })

  it('actionPrompt：可用动作清单、上限数、常用 id、定点写法都在，且它自己产出的示例能过解析', () => {
    const p = actionPrompt()
    expect(p).toContain('addCard')
    expect(p).toContain('instanceId')
    expect(p).toContain('todo.add')
    expect(p).toContain('ledger.add')
    expect(p).toContain('sticky.append')
    expect(p).toContain('countdown.set')
    expect(p).toContain('habit.check')
    expect(p).toContain(`最多 ${ACTION_MAX_PER_REPLY} 个`)
    expect(p).toContain('提议')
    for (const id of ['todo', 'sticky', 'ledger', 'countdown']) expect(p).toContain(id)
    // 自证：指令里给模型看的示例格式，喂回解析器必须真的能过
    const demo = parseActions('看我的。\n' + act({ type: 'ledger.add', cents: 1234, category: '餐饮' }), ctx())
    expect(demo.actions).toHaveLength(1)
    expect(demo.bad).toEqual([])
  })

  it('actionPrompt 的示例词不与 E2E 夹具撞车（这段字整体进 system 块）', () => {
    // chat-dock「@第二张卡」那条断言钉着系统块里不许出现第一张卡的内容；
    // 实测逃逸：v1.1 初版示例写了 "label":"发版" ⇒ 那条用例红。这里把禁用词钉住，秒级反馈。
    const p = actionPrompt()
    for (const w of ['发版', '团建餐', '跑步']) expect(p).not.toContain(w)
  })
})
