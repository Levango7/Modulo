/**
 * 「AI 动手」纯函数层的钉子（改天换地第十二笔）。
 *
 * 这一层的输入是**模型写的文本** —— 最不可信的那种输入。测的重点 accordingly：
 * 宽容（围栏 / 空白 / 行中不算）、闸门（三条白名单各自的边界）、可见（坏行必须说人话）、
 * 执行（首败即停、失败不回滚已做的）。
 */
import { describe, expect, it } from 'vitest'
import {
  actionFromObject,
  actionFromToolCall,
  actionLabel,
  actionPrompt,
  actionResultLines,
  actionResultText,
  actStepStatuses,
  ACTION_CENTS_MAX,
  ACTION_MAX_PER_REPLY,
  ACTION_NOTE_MAX,
  ACTION_RESULT_MARK,
  ACTION_TEXT_MAX,
  isActionResult,
  parseActions,
  runActions,
  runOneAction,
  stripActionLines,
  timelineRows,
  toolNameOf,
  toolResultText,
  toolSpecs,
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

/**
 * 执行时间线（F-15 P0 §1.5）：把「提议 → 照做 → 结果」摊成纵向一行一步。
 *
 * 这一层的输入全是**已经在内存里的东西**（动作 / 提议状态 / 执行结果的逐条状态），
 * 所以它能在 node 里穷举 —— 组件那半只负责把行画成点。
 */
describe('执行时间线：一行一步、状态点与执行结果同源', () => {
  const A = (t: string): AiAction => ({ type: 'todo.add', text: t })

  it('actStepStatuses 与 actionResultLines 讲的是同一件事（首败即停的三段）', () => {
    const actions = [A('a'), A('b'), A('c')]
    // 第 2 个失败：前 1 个成功、第 2 个失败、第 3 个没执行
    const run = { ok: false, done: 1, error: '版面上没有这张卡', values: [] }
    expect(actStepStatuses(actions, run)).toEqual(['ok', 'fail', 'skipped'])
    // 同一份 run 喂给回喂文本：措辞不同、判断一致（失败的那条明说原因，后面的说没执行）
    expect(actionResultLines(actions, run, (a) => (a.type === 'todo.add' ? a.text : ''))).toEqual([
      'a：成功',
      'b：失败（版面上没有这张卡）',
      'c：没有执行（前一步失败了）',
    ])
  })

  it('全成功 ⇒ 全 ok；一个都没跑成 ⇒ 首条失败、其余未执行', () => {
    const actions = [A('a'), A('b')]
    expect(actStepStatuses(actions, { ok: true, done: 2 })).toEqual(['ok', 'ok'])
    expect(actStepStatuses(actions, { ok: false, done: 0, error: 'x' })).toEqual(['fail', 'skipped'])
  })

  it('还没点头 ⇒ 全部「待确认」', () => {
    expect(timelineRows({ labels: ['加一条待办'], following: false })).toEqual([
      { label: '加一条待办', step: 'pending' },
    ])
    expect(timelineRows({ labels: ['加一条待办'], state: 'pending', following: false })[0].step).toBe('pending')
  })

  it('「算了」⇒ 全部「未执行」（一条都没写，不是"成功"）', () => {
    expect(timelineRows({ labels: ['a', 'b'], state: 'dismissed', following: false })).toEqual([
      { label: 'a', step: 'skipped' },
      { label: 'b', step: 'skipped' },
    ])
  })

  it('「照做」⇒ 用逐条状态；缺步骤表时按全成功（老的数据形状不画红点）', () => {
    expect(
      timelineRows({ labels: ['a', 'b', 'c'], state: 'done', steps: ['ok', 'fail', 'skipped'], following: false }),
    ).toEqual([
      { label: 'a', step: 'ok' },
      { label: 'b', step: 'fail' },
      { label: 'c', step: 'skipped' },
    ])
    expect(timelineRows({ labels: ['a'], state: 'done', following: false })[0].step).toBe('ok')
  })

  it('坏行**不进**时间线（它是"这一版照做不了"，不是提议的一步；界面另起一行说）', () => {
    // 混进同一列会被读成"它也提议了这个" —— 这里是那条纪律的钉子
    expect(timelineRows({ labels: ['a'], following: false })).toEqual([{ label: 'a', step: 'pending' }])
  })

  it('照做后那轮还在流式 ⇒ 末尾补一行「执行中」；流完了那行就没了', () => {
    const base = { labels: ['a'], state: 'done' as const, steps: ['ok' as const] }
    const withFollow = timelineRows({ ...base, following: true })
    expect(withFollow.at(-1)?.step).toBe('running')
    expect(withFollow.at(-1)?.label).toContain('接着')
    // 同一条 turn 在流式结束后：只剩动作本身，没有"执行中"那行
    expect(timelineRows({ ...base, following: false })).toHaveLength(1)
  })

  it('没点头 / 没坏行时不会长出「执行中」（那行只属于"已照做"）', () => {
    expect(timelineRows({ labels: ['a'], following: true })).toHaveLength(1)
    expect(timelineRows({ labels: [], following: true })).toEqual([])
  })
})

/**
 * F4c-1「工具执行闭环」：`runActions` 拆出单步、工具调用走同一道闸门。
 *
 * 这一组钉的是**两处不许各算一遍**：单步与整体是同一份 `done` / `values` 口径；
 * 原生 tool-calling 的参数与 `@@act` 文本是同一份校验（含同一句错误文案）。
 */
describe('F4c-1：单步执行与整体执行是同一份判断', () => {
  const acts: AiAction[] = [
    { type: 'todo.add', text: 'a' },
    { type: 'todo.add', text: 'b' },
    { type: 'todo.add', text: 'c' },
  ]

  /** 同一个 apply 语义：`todo.add` 有产出（方便看 values 的落点），其余没有 */
  const applyOf =
    (failAt?: string) =>
    (a: AiAction): string | undefined => {
      if (a.type !== 'todo.add') return undefined
      if (a.text === failAt) throw new Error('盘子满了')
      return `ok:${a.text}`
    }

  /** 手工按 `runOneAction` 拼一遍 —— 规格要求 runActions 就是这段循环 */
  const stepwise = (list: readonly AiAction[], apply: (a: AiAction) => string | void | undefined) => {
    const values: (string | undefined)[] = []
    for (let i = 0; i < list.length; i++) {
      const one = runOneAction(list[i], apply)
      if (!one.ok) return { ok: false as const, done: i, error: one.error, values }
      values.push(one.value)
    }
    return { ok: true as const, done: list.length, values }
  }

  it('全成功：runActions 与「依次 runOneAction」逐字段相等', () => {
    expect(runActions(acts, applyOf())).toEqual(stepwise(acts, applyOf()))
    expect(runActions(acts, applyOf())).toEqual({ ok: true, done: 3, values: ['ok:a', 'ok:b', 'ok:c'] })
  })

  it('第 2 个抛错：两条路同为 done=1、error 同一句、values 只到失败之前', () => {
    const whole = runActions(acts, applyOf('b'))
    expect(whole).toEqual(stepwise(acts, applyOf('b')))
    expect(whole.ok).toBe(false)
    expect(whole.done).toBe(1)
    expect(whole.values).toEqual(['ok:a'])
    expect(whole.error).toContain('盘子满了')
  })

  it('runOneAction 抛错 → {ok:false,error}，自己**不抛**', () => {
    const one = runOneAction(acts[0], () => {
      throw new Error('盘子满了')
    })
    expect(one).toStrictEqual({ ok: false, error: 'Error: 盘子满了' })
    expect(() =>
      runOneAction(acts[0], () => {
        throw new Error('x')
      }),
    ).not.toThrow()
  })

  it('runOneAction 成功：没产出 ⇒ value 是 undefined；有产出 ⇒ 原样带出', () => {
    expect(runOneAction(acts[0], () => undefined)).toStrictEqual({ ok: true, value: undefined })
    expect(runOneAction(acts[0], () => '看到三条待办')).toStrictEqual({ ok: true, value: '看到三条待办' })
  })
})

describe('F4c-1：工具调用走与 @@act 同一道闸门', () => {
  it('两条兜底文案逐字不变（搬到闸门里也不许改一个标点）', () => {
    // 「JSON 不合法」留在 parseLine（只有它知道原文）；「不是对象」在 actionFromObject，
    // 原文由 parseLine 传进去 —— 这两条是用户唯一能拿到的定位信息。
    expect(parseActions('@@act {oops', ctx()).bad).toEqual(['有一行动作没看懂（JSON 不合法）：@@act {oops'])
    expect(parseActions('@@act [1,2]', ctx()).bad).toEqual(['有一行动作没看懂（不是对象）：@@act [1,2]'])
  })

  it('actionFromObject 与 parseActions 对同一段 JSON 结论相等（好的、坏的都比）', () => {
    const good = { type: 'ledger.add', cents: 1234, category: '餐饮', date: '2026-01-31' }
    expect(actionFromObject(good, ctx())).toEqual(parseActions(act(good), ctx()).actions[0])
    const bad = { type: 'ledger.add', cents: 12.34, category: '餐饮' }
    expect(actionFromObject(bad, ctx())).toEqual({ bad: parseActions(act(bad), ctx()).bad[0] })
  })

  it('工具名按 OpenAI 约束换成下划线（点 → 下划线）', () => {
    expect(toolNameOf('todo.add')).toBe('todo_add')
    expect(toolNameOf('context.read')).toBe('context_read')
    expect(toolNameOf('addCard')).toBe('add_card')
  })

  it('todo_add：必填字段过桥后就是一条 todo.add；没给 instanceId 时该字段不出现', () => {
    expect(actionFromToolCall('todo_add', { text: '买牛奶' }, ctx())).toEqual({ type: 'todo.add', text: '买牛奶' })
  })

  it('未知工具名 ⇒ bad 且把名字说出来（不静默丢）', () => {
    const r = actionFromToolCall('canvas_clear', {}, ctx())
    expect('bad' in r).toBe(true)
    if ('bad' in r) {
      expect(r.bad).toContain('canvas_clear')
      expect(r.bad).toContain('没有提供')
    }
  })

  it('参数不是对象（null / 数组 / 基本类型）⇒ bad', () => {
    for (const args of [null, [1, 2], 'x', 3]) {
      const r = actionFromToolCall('todo_add', args, ctx())
      expect('bad' in r, `args=${JSON.stringify(args)} 不该过`).toBe(true)
      if ('bad' in r) expect(r.bad).toContain('参数不是一个对象')
    }
  })

  it('args 里瞎写的 type 被工具名覆盖（类型以函数名为准）', () => {
    expect(actionFromToolCall('todo_add', { type: 'memory.add', text: 'x' }, ctx())).toEqual({
      type: 'todo.add',
      text: 'x',
    })
  })

  it('闸门同源：不是整数分的金额，两条路拒收并且是同一句文案', () => {
    const viaTool = actionFromToolCall('ledger_add', { cents: 12.34, category: '餐饮' }, ctx())
    const viaText = parseActions(act({ type: 'ledger.add', cents: 12.34, category: '餐饮' }), ctx())
    expect(viaText.actions).toEqual([])
    expect(viaTool).toEqual({ bad: viaText.bad[0] })
  })

  it('toolSpecs：8 条、名字合法且不重复、描述非空、required 的键都在 properties 里', () => {
    const specs = toolSpecs()
    expect(specs).toHaveLength(8)
    const names = specs.map((s) => s.name)
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining([
        'add_card',
        'todo_add',
        'ledger_add',
        'sticky_append',
        'countdown_set',
        'habit_check',
        'memory_add',
        'context_read',
      ]),
    )
    for (const s of specs) {
      expect(s.description.trim(), `${s.name} 没写描述`).not.toBe('')
      expect(s.parameters.type, `${s.name} 的参数不是 object`).toBe('object')
      const props = s.parameters.properties as Record<string, unknown>
      const required = s.parameters.required as string[]
      expect(Array.isArray(required), `${s.name} 的 required 不是数组`).toBe(true)
      for (const k of required) expect(Object.keys(props), `${s.name}.${k} 没写 schema`).toContain(k)
    }
    // habit.check 没有必填字段（打今天的卡不需要参数）
    expect(specs.find((s) => s.name === 'habit_check')?.parameters.required).toEqual([])
  })

  it('toolSpecs 的描述里不许出现 E2E 夹具词（这段字会进 system 块）', () => {
    const blob = JSON.stringify(toolSpecs())
    for (const w of ['发版', '团建餐', '跑步']) expect(blob).not.toContain(w)
  })

  it('toolResultText：带 ACTION_RESULT_MARK 的三段结构逐字对拍', () => {
    const t = toolResultText(['a：成功', 'b：失败（原因）'])
    expect(t.startsWith(ACTION_RESULT_MARK)).toBe(true)
    expect(t.split('\n')).toEqual([
      `${ACTION_RESULT_MARK}你刚才调用的工具已经执行完了：`,
      '- a：成功',
      '- b：失败（原因）',
      '如果还要继续调用工具，照常调用（不要重复已经做过的）；都完成了就用一两句话收尾。',
    ])
    // 与动作回喂同一套标记：界面据此渲染小条、回填时也认得出
    expect(isActionResult(t)).toBe(true)
  })
})
