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
  countdownOf,
  elapsedOf,
  stickyOf,
  todosOf,
  writeCountdown,
  writeElapsed,
  writeSticky,
  writeTodos,
  type InstanceSource,
} from '../../src/vue/instanceData'
import type { CountdownSetting, ElapsedSetting, Todo } from '../../src/vue/cardDataTypes'

/** 空的"名字 + 日子"：与顶层 `emptyCardData` 那一份逐字相同 */
const blankDay = (): { label: string; date: string } => ({ label: '', date: '' })

const src = (sticky: string, byInstance?: InstanceSource['byInstance'], todos: Todo[] = []): InstanceSource => ({
  sticky,
  todos,
  countdown: blankDay(),
  elapsed: blankDay(),
  ...(byInstance ? { byInstance } : {}),
})

/** 一条待办的最简形状（id 只要唯一，本层不看它怎么生成） */
const todo = (id: string, text: string, done = false): Todo => ({ id, text, done })

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
