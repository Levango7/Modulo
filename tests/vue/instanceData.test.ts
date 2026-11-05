/**
 * 按实例取数（F-01 阶段 2）：判定层的用例。
 *
 * 这里只钉**判定**（读哪一份 / 写哪一份）—— 卡片里那半（v-model 接成读写对）由 E2E 钉，
 * 与 `floatList.test.ts` / `moduleFilter.test.ts` 同一条分工。
 *
 * 三条口径各有用例，外加两条"不许静默变空"的防守：
 * 只拿到实例 id、拿不到模块 id 时必须回落到顶层 —— 那样任何还没传 module-id 的渲染点
 * 行为都与今天一致，而不是把内容变没。
 */
import { describe, expect, it } from 'vitest'
import {
  allCountdowns,
  allHabitDays,
  allHabits,
  allLedgerEntries,
  allNotes,
  allTodos,
  anyCountdownSet,
  anySticky,
  countdownOf,
  elapsedOf,
  habitLabel,
  habitOf,
  ledgerEntriesOf,
  matrixOf,
  notesOf,
  stickyOf,
  todosOf,
  writeCountdown,
  writeElapsed,
  writeHabit,
  writeLedgerEntries,
  writeMatrix,
  writeNotes,
  writeSticky,
  writeTodos,
  type InstanceSource,
} from '../../src/vue/instanceData'
import type { CountdownSetting, ElapsedSetting, HabitSetting, InstanceData, LedgerRow, MatrixTodo, Note, Todo } from '../../src/vue/cardDataTypes'

/** 空的"名字 + 日子"：与顶层 `emptyCardData` 那一份逐字相同 */
const blankDay = (): { label: string; date: string } => ({ label: '', date: '' })

const src = (sticky: string, byInstance?: InstanceSource['byInstance'], todos: Todo[] = [], matrix?: MatrixTodo[]): InstanceSource => ({
  sticky,
  todos,
  countdown: blankDay(),
  elapsed: blankDay(),
  ...(matrix ? { matrix } : {}),
  ...(byInstance ? { byInstance } : {}),
})

/** 一条待办的最简形状（id 只要唯一，本层不看它怎么生成） */
const todo = (id: string, text: string, done = false): Todo => ({ id, text, done })

/** 一条四象限待办的最简形状（`q` 是本层唯一多出来的维度） */
const mx = (id: string, text: string, q: MatrixTodo['q'] = 'do'): MatrixTodo => ({ id, text, q, done: false })

describe('stickyOf：读哪一份', () => {
  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    expect(stickyOf(src('共享的正文'), 'sticky', 'sticky')).toBe('共享的正文')
  })

  it('只拿到实例 id、拿不到模块 id ⇒ 读顶层（不静默变空）', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), undefined, 'sticky:2')).toBe('共享的正文')
  })

  it('拿不到实例 id ⇒ 读顶层', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), 'sticky', undefined)).toBe('共享的正文')
  })

  it('第二实例有自己的内容 ⇒ 读自己的', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), 'sticky', 'sticky:2')).toBe('第二张')
  })

  it('第二实例还没写过 ⇒ 空白，不继承顶层（第二条口径）', () => {
    expect(stickyOf(src('共享的正文'), 'sticky', 'sticky:2')).toBe('')
  })

  it('byInstance 里那一份没有 sticky 字段 ⇒ 空白', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': {} }), 'sticky', 'sticky:2')).toBe('')
  })

  it('顶层那一份本身没内容 ⇒ 空串（防御，不返回 undefined）', () => {
    expect(
      stickyOf({ sticky: undefined as unknown as string, todos: [], countdown: blankDay(), elapsed: blankDay() }, 'sticky', 'sticky'),
    ).toBe('')
  })

  it('判定不靠解析 `:2` 后缀：只看两个 id 是否相等', () => {
    // 形状上不像"第二张"，但只要实例 id ≠ 模块 id 就按第二实例处理
    expect(stickyOf(src('共享', { 'abc': { sticky: '自己的' } }), 'sticky', 'abc')).toBe('自己的')
  })
})

describe('writeSticky：写哪一份', () => {
  it('写第一实例 ⇒ 仍写顶层，不建 byInstance', () => {
    const d = src('旧的')
    writeSticky(d, 'sticky', 'sticky', '新的')
    expect(d.sticky).toBe('新的')
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的一份，顶层不动', () => {
    const d = src('第一张的正文')
    writeSticky(d, 'sticky', 'sticky:2', '第二张的正文')
    expect(d.sticky).toBe('第一张的正文')
    expect(d.byInstance).toEqual({ 'sticky:2': { sticky: '第二张的正文' } })
    expect(stickyOf(d, 'sticky', 'sticky:2')).toBe('第二张的正文')
  })

  it('第二实例反复写 ⇒ 覆盖自己的那一份，也不碰同模块的其它实例', () => {
    const d = src('第一张')
    writeSticky(d, 'sticky', 'sticky:2', '甲')
    writeSticky(d, 'sticky', 'sticky:3', '乙')
    writeSticky(d, 'sticky', 'sticky:2', '甲改过')
    expect(d.byInstance).toEqual({ 'sticky:2': { sticky: '甲改过' }, 'sticky:3': { sticky: '乙' } })
  })

  it('已有 byInstance 时再写 ⇒ 保留同实例里将来会有的其它字段（现在是空集，形状要留着）', () => {
    const d = src('第一张', { 'sticky:2': {} })
    writeSticky(d, 'sticky', 'sticky:2', '写了')
    expect(d.byInstance?.['sticky:2']).toEqual({ sticky: '写了' })
  })

  it('拿不到模块 id 时写 ⇒ 写顶层（与读的回落同一条口径）', () => {
    const d = src('旧的')
    writeSticky(d, undefined, 'sticky:2', '新的')
    expect(d.sticky).toBe('新的')
    expect(d.byInstance).toBeUndefined()
  })
})

describe('todosOf：读哪一份清单', () => {
  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    const top = [todo('t1', '买奶油')]
    expect(todosOf(src('', undefined, top), 'todo', 'todo')).toEqual(top)
  })

  it('第二实例有自己的清单 ⇒ 读自己的', () => {
    const d = src('', { 'todo:2': { todos: [todo('t9', '第二张的')] } }, [todo('t1', '第一张的')])
    expect(todosOf(d, 'todo', 'todo:2')).toEqual([todo('t9', '第二张的')])
  })

  it('第二实例还没写过 ⇒ 空清单，不继承顶层（与便签同一条口径）', () => {
    const d = src('', undefined, [todo('t1', '第一张的')])
    expect(todosOf(d, 'todo', 'todo:2')).toEqual([])
  })

  it('只拿到实例 id、拿不到模块 id ⇒ 读顶层（不静默变空）', () => {
    const d = src('', { 'todo:2': { todos: [todo('t9', '第二张的')] } }, [todo('t1', '第一张的')])
    expect(todosOf(d, undefined, 'todo:2')).toEqual([todo('t1', '第一张的')])
  })

  it('顶层那一份本身没有 todos（坏数据）⇒ 空数组，不返回 undefined', () => {
    expect(
      todosOf({ sticky: '', todos: undefined as unknown as Todo[], countdown: blankDay(), elapsed: blankDay() }, 'todo', 'todo'),
    ).toEqual([])
  })
})

describe('writeTodos：写哪一份清单', () => {
  it('写第一实例 ⇒ 仍写顶层，不建 byInstance', () => {
    const d = src('')
    writeTodos(d, 'todo', 'todo', [todo('t1', '新加的')])
    expect(d.todos).toEqual([todo('t1', '新加的')])
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的一份，顶层不动', () => {
    const d = src('', undefined, [todo('t1', '第一张的')])
    writeTodos(d, 'todo', 'todo:2', [todo('t9', '第二张的')])
    expect(d.todos).toEqual([todo('t1', '第一张的')])
    expect(d.byInstance).toEqual({ 'todo:2': { todos: [todo('t9', '第二张的')] } })
  })

  it('同一实例里便签与待办互不覆盖（写清单不碰正文，写正文不碰清单）', () => {
    const d = src('')
    writeSticky(d, 'todo', 'todo:2', '第二张的正文')
    writeTodos(d, 'todo', 'todo:2', [todo('t9', '第二张的待办')])
    expect(d.byInstance?.['todo:2']).toEqual({ sticky: '第二张的正文', todos: [todo('t9', '第二张的待办')] })
    // 反向：再写一次正文，清单还在
    writeSticky(d, 'todo', 'todo:2', '改过的正文')
    expect(d.byInstance?.['todo:2']).toEqual({ sticky: '改过的正文', todos: [todo('t9', '第二张的待办')] })
  })

  it('写第二实例的清单不动同模块的第三张', () => {
    const d = src('')
    writeTodos(d, 'todo', 'todo:2', [todo('t2', '甲')])
    writeTodos(d, 'todo', 'todo:3', [todo('t3', '乙')])
    expect(d.byInstance?.['todo:2']).toEqual({ todos: [todo('t2', '甲')] })
    expect(d.byInstance?.['todo:3']).toEqual({ todos: [todo('t3', '乙')] })
  })

  it('拿不到模块 id 时写 ⇒ 写顶层（与读的回落同一条口径）', () => {
    const d = src('', undefined, [todo('t1', '旧的')])
    writeTodos(d, undefined, 'todo:2', [todo('t2', '新的')])
    expect(d.todos).toEqual([todo('t2', '新的')])
    expect(d.byInstance).toBeUndefined()
  })
})

describe('countdownOf / writeCountdown：读哪一份、写哪一份', () => {
  /** 与顶层同形状的一份；`src()` 里给的是空的 */
  const day = (label: string, date: string): CountdownSetting => ({ label, date })

  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    const d = src('')
    d.countdown = day('元旦', '2027-01-01')
    expect(countdownOf(d, 'countdown', 'countdown')).toEqual(day('元旦', '2027-01-01'))
  })

  it('第一实例读、但顶层这份本身没设过（坏数据）⇒ 空"名字 + 日子"，不抛', () => {
    const d: InstanceSource = { sticky: '', todos: [], countdown: undefined as unknown as CountdownSetting, elapsed: blankDay() }
    expect(countdownOf(d, 'countdown', 'countdown')).toEqual(blankDay())
  })

  it('第二实例读自己的；还没写过 ⇒ 空"名字 + 日子"，不继承顶层（第二条口径）', () => {
    const d = src('')
    d.countdown = day('元旦', '2027-01-01')
    expect(countdownOf(d, 'countdown', 'countdown:2')).toEqual(blankDay())
  })

  it('第二实例写自己的 ⇒ 顶层不动', () => {
    const d = src('')
    d.countdown = day('元旦', '2027-01-01')
    writeCountdown(d, 'countdown', 'countdown:2', day('第二张的', '2027-02-02'))
    expect(d.byInstance).toEqual({ 'countdown:2': { countdown: day('第二张的', '2027-02-02') } })
    expect(countdownOf(d, 'countdown', 'countdown')).toEqual(day('元旦', '2027-01-01'))
    expect(countdownOf(d, 'countdown', 'countdown:2')).toEqual(day('第二张的', '2027-02-02'))
  })

  it('写第二实例不碰同模块的第三张', () => {
    const d = src('')
    writeCountdown(d, 'countdown', 'countdown:2', day('甲', '2027-01-01'))
    writeCountdown(d, 'countdown', 'countdown:3', day('乙', '2027-02-02'))
    expect(d.byInstance?.['countdown:2']?.countdown).toEqual(day('甲', '2027-01-01'))
    expect(d.byInstance?.['countdown:3']?.countdown).toEqual(day('乙', '2027-02-02'))
  })

  it('写第一实例 ⇒ 仍写顶层，不建 byInstance（旧档形状逐字不变）', () => {
    const d = src('')
    writeCountdown(d, 'countdown', 'countdown', day('元旦', '2027-01-01'))
    expect(d.countdown).toEqual(day('元旦', '2027-01-01'))
    expect(d.byInstance).toBeUndefined()
  })

  it('拿不到模块 id 时读 / 写都回落顶层（不静默变空）', () => {
    const d = src('')
    writeCountdown(d, undefined, 'countdown:2', day('元旦', '2027-01-01'))
    expect(d.countdown).toEqual(day('元旦', '2027-01-01'))
    expect(countdownOf(d, undefined, 'countdown:2')).toEqual(day('元旦', '2027-01-01'))
    expect(d.byInstance).toBeUndefined()
  })
})

describe('elapsedOf / writeElapsed：与倒数日同形状、同口径', () => {
  const day = (label: string, date: string): ElapsedSetting => ({ label, date })

  it('单实例读写仍在顶层；第二实例自己一份', () => {
    const d = src('')
    d.elapsed = day('戒烟', '2026-01-01')
    expect(elapsedOf(d, 'elapsed', 'elapsed')).toEqual(day('戒烟', '2026-01-01'))
    writeElapsed(d, 'elapsed', 'elapsed', day('戒酒', '2026-03-01'))
    expect(d.elapsed).toEqual(day('戒酒', '2026-03-01'))
    expect(d.byInstance).toBeUndefined()
    writeElapsed(d, 'elapsed', 'elapsed:2', day('戒咖啡', '2026-02-01'))
    expect(d.elapsed).toEqual(day('戒酒', '2026-03-01'))
    expect(elapsedOf(d, 'elapsed', 'elapsed:2')).toEqual(day('戒咖啡', '2026-02-01'))
  })

  it('第一实例读、但顶层这份本身没设过（坏数据）⇒ 空，不抛', () => {
    const d: InstanceSource = { sticky: '', todos: [], countdown: blankDay(), elapsed: undefined as unknown as ElapsedSetting }
    expect(elapsedOf(d, 'elapsed', 'elapsed')).toEqual(blankDay())
  })

  it('第二实例还没写过 ⇒ 空，不继承顶层', () => {
    const d = src('')
    d.elapsed = day('戒烟', '2026-01-01')
    expect(elapsedOf(d, 'elapsed', 'elapsed:2')).toEqual(blankDay())
  })

  it('同一实例里倒数日与正计时互不覆盖（两张卡可能摆在一起）', () => {
    const d = src('')
    writeCountdown(d, 'countdown', 'countdown:2', { label: '倒数', date: '2027-01-01' })
    writeElapsed(d, 'countdown', 'countdown:2', { label: '正计时', date: '2026-01-01' })
    expect(d.byInstance?.['countdown:2']).toEqual({
      countdown: { label: '倒数', date: '2027-01-01' },
      elapsed: { label: '正计时', date: '2026-01-01' },
    })
  })
})

describe('allCountdowns：提醒那一路要的是全部', () => {
  const day = (label: string, date: string): CountdownSetting => ({ label, date })

  it('没有 byInstance ⇒ 只有顶层那一份', () => {
    const d = src('')
    d.countdown = day('元旦', '2027-01-01')
    expect(allCountdowns(d)).toEqual([day('元旦', '2027-01-01')])
  })

  it('实例切片里设过倒数日的都铺平进来；没设的切片不出现在结果里', () => {
    const d = src('')
    d.countdown = day('元旦', '2027-01-01')
    d.byInstance = {
      'countdown:2': { countdown: day('第二张的', '2027-02-02') },
      'countdown:3': {},
      'sticky:4': { sticky: '我不是倒数日' },
    }
    expect(allCountdowns(d)).toEqual([day('元旦', '2027-01-01'), day('第二张的', '2027-02-02')])
  })

  it('顶层空（第一张没设）时也不少：第二张的仍然在结果里', () => {
    const d = src('', { 'countdown:2': { countdown: day('只有第二张', '2027-02-02') } })
    expect(allCountdowns(d)).toEqual([blankDay(), day('只有第二张', '2027-02-02')])
  })

  it('顶层这份本身没设过（坏数据）⇒ 结果里仍有它的位置（第一项是空），实例切片照常铺平', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: undefined as unknown as CountdownSetting,
      elapsed: blankDay(),
      byInstance: { 'countdown:2': { countdown: day('只有第二张', '2027-02-02') } },
    }
    expect(allCountdowns(d)).toEqual([blankDay(), day('只有第二张', '2027-02-02')])
  })
})

describe('matrixOf：读哪一份清单', () => {
  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    const top = [mx('m1', '写周报')]
    expect(matrixOf(src('', undefined, [], top), 'matrix', 'matrix')).toEqual(top)
  })

  it('第二实例有自己的清单 ⇒ 读自己的', () => {
    const d = src('', { 'matrix:2': { matrix: [mx('m9', '第二张的')] } }, [], [mx('m1', '第一张的')])
    expect(matrixOf(d, 'matrix', 'matrix:2')).toEqual([mx('m9', '第二张的')])
  })

  it('第二实例还没写过 ⇒ 空清单，不继承顶层（与便签 / 待办同一条口径）', () => {
    const d = src('', undefined, [], [mx('m1', '第一张的')])
    expect(matrixOf(d, 'matrix', 'matrix:2')).toEqual([])
  })

  it('byInstance 里那一份没有 matrix 字段 ⇒ 空清单', () => {
    const d = src('', { 'matrix:2': {} }, [], [mx('m1', '第一张的')])
    expect(matrixOf(d, 'matrix', 'matrix:2')).toEqual([])
  })

  it('只拿到实例 id、拿不到模块 id ⇒ 读顶层（不静默变空）', () => {
    const d = src('', { 'matrix:2': { matrix: [mx('m9', '第二张的')] } }, [], [mx('m1', '第一张的')])
    expect(matrixOf(d, undefined, 'matrix:2')).toEqual([mx('m1', '第一张的')])
  })

  it('顶层那一份本身没有 matrix（坏数据）⇒ 空数组，不返回 undefined', () => {
    expect(matrixOf({ sticky: '', todos: [], countdown: blankDay(), elapsed: blankDay(), matrix: undefined as unknown as MatrixTodo[] }, 'matrix', 'matrix')).toEqual(
      [],
    )
  })
})

describe('writeMatrix：写哪一份清单', () => {
  it('写第一实例 ⇒ 仍写顶层，不建 byInstance', () => {
    const d = src('', undefined, [], [])
    writeMatrix(d, 'matrix', 'matrix', [mx('m1', '新加的')])
    expect(d.matrix).toEqual([mx('m1', '新加的')])
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的一份，顶层不动', () => {
    const d = src('', undefined, [], [mx('m1', '第一张的')])
    writeMatrix(d, 'matrix', 'matrix:2', [mx('m9', '第二张的')])
    expect(d.matrix).toEqual([mx('m1', '第一张的')])
    expect(d.byInstance).toEqual({ 'matrix:2': { matrix: [mx('m9', '第二张的')] } })
  })

  it('同一实例里四象限与待办、便签互不覆盖（三段内容各走各的字段）', () => {
    const d = src('')
    writeSticky(d, 'matrix', 'matrix:2', '第二张的正文')
    writeTodos(d, 'matrix', 'matrix:2', [todo('t9', '第二张的待办')])
    writeMatrix(d, 'matrix', 'matrix:2', [mx('m9', '第二张的四象限')])
    expect(d.byInstance?.['matrix:2']).toEqual({
      sticky: '第二张的正文',
      todos: [todo('t9', '第二张的待办')],
      matrix: [mx('m9', '第二张的四象限')],
    })
    // 反向：再写一次四象限，前两段都还在
    writeMatrix(d, 'matrix', 'matrix:2', [mx('m9', '改过的'), mx('m10', '新加的')])
    expect(d.byInstance?.['matrix:2']).toEqual({
      sticky: '第二张的正文',
      todos: [todo('t9', '第二张的待办')],
      matrix: [mx('m9', '改过的'), mx('m10', '新加的')],
    })
  })

  it('写第二实例的四象限不动同模块的第三张', () => {
    const d = src('', undefined, [], [])
    writeMatrix(d, 'matrix', 'matrix:2', [mx('m2', '甲')])
    writeMatrix(d, 'matrix', 'matrix:3', [mx('m3', '乙')])
    expect(d.byInstance?.['matrix:2']).toEqual({ matrix: [mx('m2', '甲')] })
    expect(d.byInstance?.['matrix:3']).toEqual({ matrix: [mx('m3', '乙')] })
  })

  it('拿不到模块 id 时写 ⇒ 写顶层（与读的回落同一条口径）', () => {
    const d = src('', undefined, [], [mx('m1', '旧的')])
    writeMatrix(d, undefined, 'matrix:2', [mx('m2', '新的')])
    expect(d.matrix).toEqual([mx('m2', '新的')])
    expect(d.byInstance).toBeUndefined()
  })
})

describe('ledgerEntriesOf / writeLedgerEntries：读哪一份账、写哪一份账', () => {
  /** 一条记账：id 只要唯一，日期/类目固定，本层只看读哪一份 */
  const row = (id: string, cents: number, note = ''): LedgerRow => ({ id, date: '2026-10-31', cents, category: '餐饮', note })

  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [row('e1', 100)] }
    expect(ledgerEntriesOf(d, 'ledger', 'ledger')).toEqual([row('e1', 100)])
  })

  it('第二实例有自己的账 ⇒ 读自己的，不串账', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [row('e1', 100)] }
    d.byInstance = { 'ledger:2': { ledger: [row('e2', 200)] } }
    expect(ledgerEntriesOf(d, 'ledger', 'ledger:2')).toEqual([row('e2', 200)])
  })

  it('第二实例还没写过 ⇒ 空账，不继承顶层（第二条口径）', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [row('e1', 100)] }
    expect(ledgerEntriesOf(d, 'ledger', 'ledger:2')).toEqual([])
  })

  it('byInstance 里那一份没有 ledger 字段 ⇒ 空账', () => {
    const d = src('', { 'ledger:2': {} })
    d.ledger = { symbol: '¥', entries: [row('e1', 100)] }
    expect(ledgerEntriesOf(d, 'ledger', 'ledger:2')).toEqual([])
  })

  it('顶层没有 ledger 字段（坏数据 / 形状更窄的取数来源）⇒ 空账，不抛', () => {
    const d = src('')
    expect(ledgerEntriesOf(d, 'ledger', 'ledger')).toEqual([])
  })

  it('写第一实例 ⇒ 写顶层条目、**符号保住**，不建 byInstance', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [] }
    writeLedgerEntries(d, 'ledger', 'ledger', [row('e1', 100)])
    expect(d.ledger).toEqual({ symbol: '¥', entries: [row('e1', 100)] })
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的账本，顶层账不动；符号仍在顶层（不分实例）', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [row('e1', 100)] }
    writeLedgerEntries(d, 'ledger', 'ledger:2', [row('e2', 200)])
    expect(d.ledger).toEqual({ symbol: '¥', entries: [row('e1', 100)] })
    expect(d.byInstance).toEqual({ 'ledger:2': { ledger: [row('e2', 200)] } })
    expect(ledgerEntriesOf(d, 'ledger', 'ledger:2')).toEqual([row('e2', 200)])
  })

  it('同一实例里记账与待办互不覆盖（两张卡可能摆在一起）', () => {
    const d = src('')
    writeTodos(d, 'm', 'm:2', [todo('t1', '第二张的待办')])
    writeLedgerEntries(d, 'm', 'm:2', [row('e1', 100)])
    expect(d.byInstance?.['m:2']).toEqual({ todos: [todo('t1', '第二张的待办')], ledger: [row('e1', 100)] })
  })

  it('写第二实例不动同模块的第三张账本', () => {
    const d = src('')
    writeLedgerEntries(d, 'ledger', 'ledger:2', [row('e2', 200)])
    writeLedgerEntries(d, 'ledger', 'ledger:3', [row('e3', 300)])
    expect(d.byInstance?.['ledger:2']).toEqual({ ledger: [row('e2', 200)] })
    expect(d.byInstance?.['ledger:3']).toEqual({ ledger: [row('e3', 300)] })
  })

  it('拿不到模块 id 时读 / 写都回落顶层（不静默变空）', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [] }
    writeLedgerEntries(d, undefined, 'ledger:2', [row('e1', 100)])
    expect(d.ledger.entries).toEqual([row('e1', 100)])
    expect(ledgerEntriesOf(d, undefined, 'ledger:2')).toEqual([row('e1', 100)])
    expect(d.byInstance).toBeUndefined()
  })
})

describe('habitOf / writeHabit：读哪一份习惯、写哪一份习惯', () => {
  /** 一份习惯：名字 + 打过卡的日子，与顶层同形状 */
  const habit = (name: string, days: string[]): HabitSetting => ({ name, days })

  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    const d = src('')
    d.habit = habit('跑步', ['2026-10-20'])
    expect(habitOf(d, 'habit', 'habit')).toEqual(habit('跑步', ['2026-10-20']))
  })

  it('第二实例有自己的习惯 ⇒ 读自己的，不串卡', () => {
    const d = src('')
    d.habit = habit('跑步', ['2026-10-20'])
    d.byInstance = { 'habit:2': { habit: habit('冥想', ['2026-10-21']) } }
    expect(habitOf(d, 'habit', 'habit:2')).toEqual(habit('冥想', ['2026-10-21']))
  })

  it('第二实例还没写过 ⇒ 空习惯，不继承顶层（第二条口径）', () => {
    const d = src('')
    d.habit = habit('跑步', ['2026-10-20'])
    expect(habitOf(d, 'habit', 'habit:2')).toEqual({ name: '', days: [] })
  })

  it('byInstance 里那一份没有 habit 字段 ⇒ 空习惯', () => {
    const d = src('', { 'habit:2': {} })
    d.habit = habit('跑步', [])
    expect(habitOf(d, 'habit', 'habit:2')).toEqual({ name: '', days: [] })
  })

  it('顶层没有 habit 字段（坏数据 / 形状更窄的取数来源）⇒ 空习惯，不抛', () => {
    const d = src('')
    expect(habitOf(d, 'habit', 'habit')).toEqual({ name: '', days: [] })
    expect(habitOf(d, 'habit', 'habit:2')).toEqual({ name: '', days: [] })
  })

  it('写第一实例 ⇒ 仍写顶层，不建 byInstance（旧档形状逐字不变）', () => {
    const d = src('')
    writeHabit(d, 'habit', 'habit', habit('跑步', []))
    expect(d.habit).toEqual(habit('跑步', []))
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的那一份，顶层习惯不动', () => {
    const d = src('')
    d.habit = habit('跑步', ['2026-10-20'])
    writeHabit(d, 'habit', 'habit:2', habit('冥想', ['2026-10-21']))
    expect(d.habit).toEqual(habit('跑步', ['2026-10-20']))
    expect(d.byInstance).toEqual({ 'habit:2': { habit: habit('冥想', ['2026-10-21']) } })
    expect(habitOf(d, 'habit', 'habit:2')).toEqual(habit('冥想', ['2026-10-21']))
  })

  it('写第二实例不动同模块的第三张', () => {
    const d = src('')
    writeHabit(d, 'habit', 'habit:2', habit('甲', []))
    writeHabit(d, 'habit', 'habit:3', habit('乙', []))
    expect(d.byInstance?.['habit:2']?.habit).toEqual(habit('甲', []))
    expect(d.byInstance?.['habit:3']?.habit).toEqual(habit('乙', []))
  })

  it('同一实例里习惯与记账互不覆盖（两张卡可能摆在一起）', () => {
    const d = src('')
    writeHabit(d, 'm', 'm:2', habit('跑步', []))
    writeLedgerEntries(d, 'm', 'm:2', [{ id: 'e1', date: '2026-10-31', cents: 100, category: '餐饮', note: '' }])
    expect(d.byInstance?.['m:2']).toEqual({
      habit: habit('跑步', []),
      ledger: [{ id: 'e1', date: '2026-10-31', cents: 100, category: '餐饮', note: '' }],
    })
  })

  it('拿不到模块 id 时读 / 写都回落顶层（不静默变空）', () => {
    const d = src('')
    writeHabit(d, undefined, 'habit:2', habit('跑步', []))
    expect(d.habit).toEqual(habit('跑步', []))
    expect(habitOf(d, undefined, 'habit:2')).toEqual(habit('跑步', []))
    expect(d.byInstance).toBeUndefined()
  })
})

describe('allHabits：提醒那一路要的是全部', () => {
  const habit = (name: string, days: string[]): HabitSetting => ({ name, days })

  it('没有 byInstance ⇒ 只有顶层那一份（id 为 null）', () => {
    const d = src('')
    d.habit = habit('跑步', [])
    expect(allHabits(d)).toEqual([{ id: null, habit: habit('跑步', []) }])
  })

  it('实例切片里设过习惯的都铺平进来；没设的切片不出现在结果里', () => {
    const d = src('')
    d.habit = habit('跑步', [])
    d.byInstance = {
      'habit:2': { habit: habit('冥想', ['2026-10-20']) },
      'habit:3': {},
      'sticky:4': { sticky: '我不是习惯' },
    }
    expect(allHabits(d)).toEqual([
      { id: null, habit: habit('跑步', []) },
      { id: 'habit:2', habit: habit('冥想', ['2026-10-20']) },
    ])
  })

  it('顶层空（第一张没起名）时也不少：第二张的仍然在结果里（判空名字是提醒那一路的事）', () => {
    const d = src('', { 'habit:2': { habit: habit('冥想', []) } })
    expect(allHabits(d)).toEqual([{ id: null, habit: { name: '', days: [] } }, { id: 'habit:2', habit: habit('冥想', []) }])
  })

  it('顶层这份本身没设过（坏数据）⇒ 结果里仍有它的位置（第一项是空），实例切片照常铺平', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: blankDay(),
      elapsed: blankDay(),
      byInstance: { 'habit:2': { habit: habit('冥想', []) } },
    }
    expect(allHabits(d)).toEqual([{ id: null, habit: { name: '', days: [] } }, { id: 'habit:2', habit: habit('冥想', []) }])
  })
})

/**
 * 聚合口径（2026-11-01）：把这块板当整体看的读点 —— 图表卡 / 热力图 / 今日聚焦 /
 * 月度统计 / 备份文案。与上面那些 `*Of` **方向相反**：那些问"这张卡有什么"（第二张没写
 * 就是空，不回落），这些问"这块板一共有什么"（一张都不能漏）。
 *
 * 这里钉的正是两种问法的分界：同样的 `byInstance`，`todosOf` 只看一张，`allTodos` 全算。
 */
describe('聚合取数：顶层 + 每个实例切片（求和 / 并集 / 任一）', () => {
  const row = (id: string, date: string, cents: number): LedgerRow => ({ id, date, cents, category: '餐饮', note: id })
  const dayOf = (label: string, date: string): CountdownSetting => ({ label, date })
  const habitOf2 = (name: string, days: string[]): HabitSetting => ({ name, days })

  it('allTodos：顶层在前，各实例接着排；没有 byInstance 就是顶层那一份', () => {
    const d = src('', undefined, [todo('a', '第一张的'), todo('b', '第一张的第二条')])
    expect(allTodos(d).map((t) => t.id)).toEqual(['a', 'b'])
    d.byInstance = {
      'todo:2': { todos: [todo('c', '第二张的')] },
      'todo:3': { todos: [todo('d', '第三张的'), todo('e', '第三张的另一条')] },
      'sticky:4': { sticky: '我不是待办' },
    }
    expect(allTodos(d).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('allTodos：顶层空、只有第二张有 ⇒ 照样拿到第二张的（这正是"只认第一张"漏掉的那些）', () => {
    const d = src('', { 'todo:2': { todos: [todo('c', '第二张的')] } })
    expect(allTodos(d)).toEqual([todo('c', '第二张的')])
    // 对照：单卡口径读第一张 ⇒ 空。两种问法都各自对，混着用才是错的
    expect(todosOf(d, 'todo', 'todo')).toEqual([])
  })

  it('allTodos：两份都空 ⇒ 空数组（不给 null，渲染侧直接 filter）', () => {
    expect(allTodos(src(''))).toEqual([])
  })

  it('allLedgerEntries：顶层条目 + 各实例条目，币种符号不在结果里（它是偏好，只有顶层那份）', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [row('l1', '2026-10-28', 1250)] }
    d.byInstance = {
      'ledger:2': { ledger: [row('l2', '2026-10-29', 3900)] },
      'ledger:3': { ledger: [row('l3', '2026-10-30', 100)] },
      'sticky:4': { sticky: '我不是账本' },
    }
    const all = allLedgerEntries(d)
    expect(all.map((r) => r.id)).toEqual(['l1', 'l2', 'l3'])
    expect(all.reduce((sum, r) => sum + r.cents, 0)).toBe(5250)
    expect(all.every((r) => !('symbol' in r))).toBe(true)
  })

  it('allLedgerEntries：第二张有账、第一张空 ⇒ 只拿到第二张的', () => {
    const d = src('')
    d.ledger = { symbol: '¥', entries: [] }
    d.byInstance = { 'ledger:2': { ledger: [row('l2', '2026-10-29', 3900)] } }
    expect(allLedgerEntries(d).map((r) => r.id)).toEqual(['l2'])
    expect(ledgerEntriesOf(d, 'ledger', 'ledger')).toEqual([])
  })

  it('allHabitDays：两张卡打过的日子取**并集**（同一天都打过只算一天）', () => {
    const d = src('')
    d.habit = habitOf2('跑步', ['2026-10-01', '2026-10-02'])
    d.byInstance = {
      'habit:2': { habit: habitOf2('冥想', ['2026-10-02', '2026-10-03']) },
      'habit:3': { habit: habitOf2('早睡', []) },
      'sticky:4': { sticky: '我不是习惯' },
    }
    expect([...allHabitDays(d)].sort()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(allHabitDays(d)).toHaveLength(3)
  })

  it('allHabitDays：同一天在两张卡里都出现 —— 不能变成两条（打卡位是 0/1，不是次数）', () => {
    const d = src('')
    d.habit = habitOf2('跑步', ['2026-10-05'])
    d.byInstance = { 'habit:2': { habit: habitOf2('冥想', ['2026-10-05']) } }
    expect(allHabitDays(d)).toEqual(['2026-10-05'])
  })

  it('habitLabel：一张卡报名字，几张卡报张数，同名不重复数', () => {
    expect(habitLabel(src(''))).toBe('')
    const one = src('')
    one.habit = habitOf2('跑步', [])
    expect(habitLabel(one), '只有一张 ⇒ 报它的名字').toBe('跑步')

    const two = src('')
    two.habit = habitOf2('跑步', [])
    two.byInstance = { 'habit:2': { habit: habitOf2('冥想', []) } }
    expect(habitLabel(two)).toBe('2 张习惯卡')

    const same = src('')
    same.habit = habitOf2('跑步', [])
    same.byInstance = { 'habit:2': { habit: habitOf2('跑步', []) } }
    expect(habitLabel(same), '两张都叫「跑步」⇒ 不写 2 张，写名字').toBe('跑步')

    const second = src('')
    second.byInstance = { 'habit:2': { habit: habitOf2('冥想', []) } }
    expect(habitLabel(second), '第一张没起名、第二张起了 ⇒ 报第二张的名字').toBe('冥想')
  })

  it('anyCountdownSet：只要有一张设过日子就算设过（不只看第一张）', () => {
    const d = src('')
    d.countdown = dayOf('', '')
    d.byInstance = { 'countdown:2': { countdown: dayOf('体检', '2026-12-20') } }
    expect(anyCountdownSet(d)).toBe(true)
    const onlyLabel = src('')
    onlyLabel.countdown = dayOf('体检', '')
    expect(anyCountdownSet(onlyLabel)).toBe(false)
    expect(anyCountdownSet(src(''))).toBe(false)
  })

  /**
   * 缺字段 / 空切片：来源形状不可信时（AI 摘录那种只读来源、旧档里少字段）一律按"没有"处理。
   * 这几条同时把每个 `?.` / `??` 的另一半走一遍 —— 判定层锁 100，不覆盖就等于没验证过坏输入。
   */
  it('缺字段 / 空切片：一律按"没有"处理，不抛也不编', () => {
    // 连 `ledger` / `habit` 字段都没有的来源（`InstanceSource` 里这两个是可选）
    const bare: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
    }
    expect(allTodos(bare)).toEqual([])
    expect(allLedgerEntries(bare)).toEqual([])
    expect(allHabitDays(bare)).toEqual([])
    expect(habitLabel(bare)).toBe('')
    expect(anySticky(bare)).toBe(false)
    expect(anyCountdownSet(bare)).toBe(false)

    // 切片里混进 undefined / 空名字的习惯 / 空正文的便签：跳过它们，不数成东西
    const messy: InstanceSource = {
      ...bare,
      // 类型上 `sticky` / `todos` 是必填，但运行时来源不可信（AI 摘录那种只读来源、坏档）——
      // 字段真的不在时走的是 `?? ''` / `?? []` 那一半，不覆盖就等于没验过坏输入
      sticky: undefined as unknown as string,
      todos: undefined as unknown as Todo[],
      byInstance: {
        'todo:9': undefined as unknown as InstanceData,
        'habit:9': { habit: { name: '   ', days: [] } },
        'sticky:9': { sticky: '' },
      },
    }
    expect(allTodos(messy)).toEqual([])
    expect(allLedgerEntries(messy)).toEqual([])
    expect(allHabitDays(messy)).toEqual([])
    expect(habitLabel(messy), '名字只有空白 ⇒ 不算起了名').toBe('')
    expect(anySticky(messy), '第二张只有空白 ⇒ 没有正文').toBe(false)
  })

  it('anySticky：第二张写了字就算有便签正文；只有空白不算', () => {
    expect(anySticky(src('第一张的字')), '第一张有正文 ⇒ 直接真（早退那一半）').toBe(true)
    const d = src('')
    d.byInstance = { 'sticky:2': { sticky: '第二张的字' } }
    expect(anySticky(d), '第一张空、第二张有 ⇒ 也要真').toBe(true)
    const blank = src('', { 'sticky:2': { sticky: '   ' } })
    expect(anySticky(blank), '全是空白 ⇒ 没有正文').toBe(false)
    expect(anySticky(src(''))).toBe(false)
  })
})

describe('notesOf / writeNotes / allNotes（F-01 阶段 2 第八个字段，速记，2026-11-05）', () => {
  /** 一条速记：id + 标题 + 正文 + 时间戳，与顶层同形状 */
  const note = (id: string, title: string, body: string, at: number): Note => ({ id, title, body, at })

  it('口径一：第一实例读顶层那份（实例 id 等于模块 id）', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '周会', '三件事', 10)] }
    expect(notesOf(d, 'notes', 'notes')).toEqual([note('n1', '周会', '三件事', 10)])
  })

  it('口径一（缺 id 兜底）：只拿到模块 id / 一个 id 都没有 ⇒ 回落顶层，不许静默变空', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '周会', '三件事', 10)] }
    expect(notesOf(d, 'notes', undefined)).toEqual([note('n1', '周会', '三件事', 10)])
    expect(notesOf(d, undefined, 'notes')).toEqual([note('n1', '周会', '三件事', 10)])
    expect(notesOf(d)).toEqual([note('n1', '周会', '三件事', 10)])
  })

  it('口径二：第二实例读自己那份、没有就是空白（不回落顶层——那正是阶段 1 的缺陷）', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '第一张的', '内容', 10)] }
    expect(notesOf(d, 'notes', 'notes:2')).toEqual([])
    d.byInstance = { 'notes:2': { notes: [note('n2', '第二张的', '内容', 20)] } }
    expect(notesOf(d, 'notes', 'notes:2')).toEqual([note('n2', '第二张的', '内容', 20)])
  })

  it('读返回的是新数组：调用方 slice/filter 不会原地污染顶层', () => {
    const top = [note('n1', '周会', '三件事', 10)]
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: top }
    const got = notesOf(d)
    got.push(note('nx', '外来', '污染', 99))
    expect(top).toHaveLength(1)
  })

  it('writeNotes 顶层：整条替换（不 unshift 原地改——深层 watch 看不见）', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '旧', '内容', 10)] }
    writeNotes(d, 'notes', 'notes', [note('n1', '新', '内容', 20)])
    expect(d.notes).toEqual([note('n1', '新', '内容', 20)])
  })

  it('writeNotes 第二实例：写才建立；已有切片就整条替换那个切片', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '第一张', '内容', 10)] }
    writeNotes(d, 'notes', 'notes:2', [note('n2', '第二张', '内容', 20)])
    expect(d.byInstance).toEqual({ 'notes:2': { notes: [note('n2', '第二张', '内容', 20)] } })
    expect(d.notes, '顶层不能被带上一层写动').toEqual([note('n1', '第一张', '内容', 10)])
    writeNotes(d, 'notes', 'notes:2', [note('n3', '第二张又一条', '内容', 30)])
    expect(d.byInstance?.['notes:2']?.notes).toEqual([note('n3', '第二张又一条', '内容', 30)])
  })

  it('allNotes：顶层 + 各实例铺平，按 at 倒序（recent 卡与备份文案的聚合口径）', () => {
    const d: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: [note('n1', '顶层的', '内容', 10)],
      byInstance: {
        'notes:2': { notes: [note('n2', '第二张新的', '内容', 30)] },
        'notes:3': { notes: [note('n3', '第三张中间的', '内容', 20)] },
      },
    }
    expect(allNotes(d).map((n) => n.id)).toEqual(['n2', 'n3', 'n1'])
  })

  it('allNotes：切片里 undefined / 坏形状不数成东西；空板返回空数组', () => {
    const messy: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
      notes: undefined as unknown as Note[],
      byInstance: { 'notes:9': undefined as unknown as InstanceData, 'notes:8': { notes: [] } },
    }
    expect(allNotes(messy)).toEqual([])
  })

  /**
   * 缺字段来源的兜底那一半（AI 摘录那种只读来源、坏档）：`notes` / `byInstance`
   * 整个不在时也是空数组，不抛 —— 与其他字段的 `?? []` 同一条纪律。
   */
  it('notes / byInstance 整个缺失：读与聚合都按空，不抛', () => {
    const bare: InstanceSource = {
      sticky: '',
      todos: [],
      countdown: { label: '', date: '' },
      elapsed: { label: '', date: '' },
    }
    expect(notesOf(bare, 'notes', 'notes')).toEqual([])
    expect(allNotes(bare)).toEqual([])
    expect(notesOf(bare, 'notes', 'notes:2'), '第二实例且没有 byInstance ⇒ 也是空').toEqual([])
  })
})
