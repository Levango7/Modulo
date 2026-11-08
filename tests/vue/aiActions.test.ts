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
  ACTION_CENTS_MAX,
  ACTION_MAX_PER_REPLY,
  ACTION_NOTE_MAX,
  ACTION_TEXT_MAX,
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

describe('AI 动作：提议怎么执行（首败即停）', () => {
  const acts: AiAction[] = [
    { type: 'todo.add', text: '一条' },
    { type: 'todo.add', text: '两条' },
    { type: 'todo.add', text: '三条' },
  ]

  it('全部成功：done 数对上、调用顺序就是提议顺序', () => {
    const seen: string[] = []
    const r = runActions(acts, (a) => void seen.push(a.type === 'todo.add' ? a.text : a.type))
    expect(r).toEqual({ ok: true, done: 3 })
    expect(seen).toEqual(['一条', '两条', '三条'])
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
    expect(seen).toEqual(['一条'])
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
  })

  it('actionPrompt：三种格式、上限数、常用 id 都在，且它自己产出的示例能过解析', () => {
    const p = actionPrompt()
    expect(p).toContain('addCard')
    expect(p).toContain('todo.add')
    expect(p).toContain('ledger.add')
    expect(p).toContain(`最多 ${ACTION_MAX_PER_REPLY} 个`)
    expect(p).toContain('提议')
    for (const id of ['todo', 'sticky', 'ledger', 'countdown']) expect(p).toContain(id)
    // 自证：指令里给模型看的示例格式，喂回解析器必须真的能过
    const demo = parseActions('看我的。\n' + act({ type: 'ledger.add', cents: 1234, category: '餐饮' }), ctx())
    expect(demo.actions).toHaveLength(1)
    expect(demo.bad).toEqual([])
  })
})
