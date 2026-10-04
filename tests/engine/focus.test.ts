import { describe, expect, it } from 'vitest'
import { focusToday, monthStat, nextUp, type TodoLike } from '../../packages/engine/src/focus'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 0, 0)
/** `doneAt` 落在指定月份，用来钉死"按完成时刻算"这条口径 */
const doneIn = (y: number, m: number, d = 15) => new Date(y, m - 1, d, 10, 0, 0).getTime()

const todo = (over: Partial<TodoLike> & { id: string }): TodoLike => ({ text: over.id, done: false, ...over })

describe('nextUp：第一个没做完的', () => {
  it('按用户自己的顺序取第一条未完成', () => {
    const out = nextUp([todo({ id: 'a', done: true }), todo({ id: 'b' }), todo({ id: 'c' })])
    expect(out?.id).toBe('b')
  })

  it('全做完 → null', () => {
    expect(nextUp([todo({ id: 'a', done: true })])).toBeNull()
  })

  it('空清单 → null', () => {
    expect(nextUp([])).toBeNull()
  })

  it('不重排：待办是用户排的顺序，替他排序等于替他做决定', () => {
    // 明显"更短"的排在后面，仍然取第一条
    const out = nextUp([todo({ id: 'first', text: '很长很长很长一件事' }), todo({ id: 'second', text: '短' })])
    expect(out?.id).toBe('first')
  })
})

describe('focusToday：今天完成多少', () => {
  const now = at(2026, 10, 4)

  it('完成 / 未完成分开数', () => {
    const out = focusToday(
      [
        todo({ id: 'a', done: true, doneAt: doneIn(2026, 10) }),
        todo({ id: 'b', done: true, doneAt: doneIn(2026, 10, 3) }),
        todo({ id: 'c' }),
        todo({ id: 'd' }),
      ],
      now,
    )
    expect(out).toMatchObject({ doneToday: 2, remaining: 2, total: 4 })
    expect(out.ratio).toBe(0.5)
  })

  it('没有 doneAt 的已完成条目不算进今天（它属于哪一天无从得知，不猜）', () => {
    const out = focusToday([todo({ id: 'a', done: true }), todo({ id: 'b' })], now)
    expect(out.doneToday).toBe(0)
    expect(out.remaining).toBe(1)
  })

  it('上个月完成的不算今天', () => {
    expect(focusToday([todo({ id: 'a', done: true, doneAt: doneIn(2026, 9) })], now).doneToday).toBe(0)
  })

  it('跨年：今年 1 月完成的，在今年 12 月看也不是"今天"', () => {
    expect(focusToday([todo({ id: 'a', done: true, doneAt: doneIn(2026, 1) })], at(2026, 12, 4)).doneToday).toBe(0)
  })

  it('空清单 ratio = 1 —— "没事可做"不是"完成度 0%"', () => {
    expect(focusToday([], now)).toEqual({ doneToday: 0, remaining: 0, total: 0, ratio: 1 })
  })
})

describe('monthStat：分母是"本月碰过的条目"，不是全部待办', () => {
  const now = at(2026, 10, 4)

  it('本月完成的进分母，未完成的也算"本月欠着"', () => {
    const out = monthStat(
      [
        todo({ id: 'a', done: true, doneAt: doneIn(2026, 10) }),
        todo({ id: 'b', done: true, doneAt: doneIn(2026, 10, 2) }),
        todo({ id: 'c' }),
      ],
      now,
    )
    expect(out).toMatchObject({ label: '2026 年 10 月', year: 2026, month: 10, completed: 2, outstanding: 1 })
    expect(out.ratio).toBeCloseTo(2 / 3, 10)
  })

  it('上月完成的、没碰过的都不稀释本月完成率', () => {
    // 上月写了 9 条、全部完成，本月一条没碰 → 本月不该显示 100% 完成率，也不该显示 0%
    const list: TodoLike[] = Array.from({ length: 9 }, (_, i) =>
      todo({ id: `old${i}`, done: true, doneAt: doneIn(2026, 9) }),
    )
    expect(monthStat(list, now)).toMatchObject({ completed: 0, outstanding: 0, ratio: 1 })
  })

  it('没有 doneAt 的已完成条目不进任何月份', () => {
    const out = monthStat([todo({ id: 'a', done: true }), todo({ id: 'b' })], now)
    expect(out).toMatchObject({ completed: 0, outstanding: 1 })
  })

  it('坏时间戳（NaN）不会被"碰巧"算进本月', () => {
    const out = monthStat([todo({ id: 'a', done: true, doneAt: Number.NaN })], now)
    expect(out.completed).toBe(0)
  })

  it('没有条目 → ratio 1，不是 0%（界面上不该出现一条空的进度）', () => {
    expect(monthStat([], now).ratio).toBe(1)
  })

  it('12 月看 12 月完成的算本月；1 月看 1 月的也算本月', () => {
    expect(monthStat([todo({ id: 'a', done: true, doneAt: doneIn(2026, 12) })], at(2026, 12, 20)).completed).toBe(1)
    expect(monthStat([todo({ id: 'a', done: true, doneAt: doneIn(2027, 1) })], at(2027, 1, 3)).completed).toBe(1)
  })

  it('月底跨月不串：3 月 31 日完成的，在 4 月 1 日看属于 3 月', () => {
    const out = monthStat([todo({ id: 'a', done: true, doneAt: doneIn(2026, 3, 31) })], at(2026, 4, 1))
    expect(out).toMatchObject({ label: '2026 年 4 月', completed: 0 })
  })
})
