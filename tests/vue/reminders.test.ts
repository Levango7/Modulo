/**
 * 提醒规则表（P0-④ 阶段 1）。全是纯函数，`now` 注入 —— 边界才可能穷举。
 *
 * 重点钉三处容易写错的地方：
 *  ① 日期口径必须是**本地日**（UTC 的 `toISOString` 在 UTC+8 的 23:00 会算成"明天"）；
 *  ② 静默时段跨午夜（22:00–08:00）不能写成"两个都大于 22"；
 *  ③ 闰日生日在平年落到 2 月 28 日（引擎算的，提醒要跟着它走，不许自己再写一套）。
 */
import { describe, expect, it } from 'vitest'
import { lastNDays } from '@levango7/engine'
import {
  DEFAULT_REMINDER_SETTINGS,
  dueReminders,
  hmToMinutes,
  inQuietHours,
  localDay,
  type ReminderInput,
  type ReminderSettings,
} from '../../src/vue/reminders'

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min, 0, 0)

function input(over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    now: at(2026, 10, 21, 9, 0),
    countdowns: [],
    birthdays: [],
    habit: { name: '', days: [] },
    settings: { ...DEFAULT_REMINDER_SETTINGS },
    ...over,
  }
}

describe('日期口径：本地日，不是 UTC 日', () => {
  it('与引擎 habit 的日期格式逐字一致（两侧不许各写一套）', () => {
    for (const d of [at(2026, 1, 1, 0, 0), at(2026, 10, 21, 23, 59), at(2026, 12, 31, 23, 30), at(2027, 3, 1, 0, 0)]) {
      expect(localDay(d)).toBe(lastNDays([], d, 1)[0].date)
    }
  })
  it('午夜后与深夜都按本地日切日（不依赖 runner 的时区）', () => {
    expect(localDay(at(2026, 10, 21, 23, 0))).toBe('2026-10-21')
    expect(localDay(at(2026, 10, 21, 0, 30))).toBe('2026-10-21')
    expect(localDay(at(2026, 10, 20, 23, 59))).toBe('2026-10-20')
  })
})

describe('hmToMinutes / inQuietHours', () => {
  it('HH:MM 只认严格写法', () => {
    expect(hmToMinutes('00:00')).toBe(0)
    expect(hmToMinutes('22:30')).toBe(22 * 60 + 30)
    expect(hmToMinutes('23:59')).toBe(1439)
    for (const bad of ['24:00', '9:05', '22:60', '', ' 22:30x', 'ab:cd']) expect(hmToMinutes(bad)).toBeNull()
    expect(hmToMinutes(' 08:05 ')).toBe(8 * 60 + 5)
  })
  it('同日区间：左闭右开', () => {
    const noon = at(2026, 10, 21, 12, 0)
    const end = at(2026, 10, 21, 14, 0)
    expect(inQuietHours(noon, '12:00', '14:00')).toBe(true)
    expect(inQuietHours(at(2026, 10, 21, 11, 59), '12:00', '14:00')).toBe(false)
    expect(inQuietHours(end, '12:00', '14:00')).toBe(false)
  })
  it('跨午夜区间：22:00–08:00', () => {
    expect(inQuietHours(at(2026, 10, 21, 23, 0), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(at(2026, 10, 21, 7, 59), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(at(2026, 10, 21, 8, 0), '22:00', '08:00')).toBe(false)
    expect(inQuietHours(at(2026, 10, 21, 12, 0), '22:00', '08:00')).toBe(false)
  })
  it('端点坏掉或起止相同 → 不静默（宁可多弹一次，也不闷声不响）', () => {
    expect(inQuietHours(at(2026, 10, 21, 23, 0), '22:00', '22:00')).toBe(false)
    expect(inQuietHours(at(2026, 10, 21, 23, 0), 'nope', '08:00')).toBe(false)
    expect(inQuietHours(at(2026, 10, 21, 23, 0), '22:00', '')).toBe(false)
  })
  it('默认设置是"不静默" —— 静默跨午夜会吞掉当天的事，不能默认开着', () => {
    expect(inQuietHours(at(2026, 10, 21, 23, 0), DEFAULT_REMINDER_SETTINGS.quietStart, DEFAULT_REMINDER_SETTINGS.quietEnd)).toBe(false)
    expect(inQuietHours(at(2026, 10, 21, 3, 0), DEFAULT_REMINDER_SETTINGS.quietStart, DEFAULT_REMINDER_SETTINGS.quietEnd)).toBe(false)
  })
})

describe('dueReminders：今天有什么', () => {
  it('关掉开关就一条都不出（哪怕事实成立）', () => {
    const settings: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, enabled: false }
    const r = dueReminders(input({ countdowns: [{ label: '发布', date: '2026-10-21' }], settings }))
    expect(r).toEqual([])
  })

  it('倒数日就是今天 → 一条；明天 / 空标签 / 空日期 → 不出', () => {
    expect(dueReminders(input({ countdowns: [{ label: '发布', date: '2026-10-21' }] })).map((x) => x.kind)).toEqual(['countdown'])
    expect(dueReminders(input({ countdowns: [{ label: '发布', date: '2026-10-22' }] }))).toEqual([])
    expect(dueReminders(input({ countdowns: [{ label: '发布', date: '2026-10-20' }] }))).toEqual([])
    expect(dueReminders(input({ countdowns: [{ label: '  ', date: '2026-10-21' }] }))).toEqual([])
    expect(dueReminders(input({ countdowns: [{ label: '发布', date: '' }] }))).toEqual([])
  })

  it('同一天到站两张（第二张也设了日子）→ 只一条，名字都列上、key 仍只有一个', () => {
    const r = dueReminders(
      input({
        countdowns: [
          { label: '发布', date: '2026-10-21' },
          { label: '验收', date: '2026-10-21' },
        ],
      }),
    )
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('今天是「发布」「验收」')
    expect(r[0].key).toBe('countdown:2026-10-21')
    expect(r[0].body).toBe('倒数到站了。')
  })

  it('两张里只有一张到站 → 只列到站那张的名字', () => {
    const r = dueReminders(
      input({
        countdowns: [
          { label: '发布', date: '2026-10-21' },
          { label: '验收', date: '2026-10-22' },
        ],
      }),
    )
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('今天是「发布」')
  })

  it('名字带空格的到站也按去空格后的名字列（与单条口径一致）', () => {
    const r = dueReminders(input({ countdowns: [{ label: ' 发布 ', date: '2026-10-21' }] }))
    expect(r[0].title).toBe('今天是「发布」')
  })

  it('生日就是今天 → 一条；没年份不说岁数，有年份说岁数', () => {
    const plain = dueReminders(input({ birthdays: [{ id: 'b1', name: '妈妈', month: 10, day: 21 }] }))
    expect(plain).toHaveLength(1)
    expect(plain[0].key).toBe('birthday:b1:2026-10-21')
    expect(plain[0].body).toBe('别忘了说一声生日快乐。')

    const aged = dueReminders(input({ birthdays: [{ id: 'b2', name: '老陈', month: 10, day: 21, year: 1962 }] }))
    expect(aged[0].body).toBe('今天 64 岁。')
  })

  it('闰日生日在平年落到 2 月 28 日（跟着引擎走，不自己再判一次）', () => {
    const r = dueReminders(
      input({ now: at(2026, 2, 28, 9, 0), birthdays: [{ id: 'b3', name: '闰', month: 2, day: 29 }] }),
    )
    expect(r).toHaveLength(1)
    expect(r[0].key).toBe('birthday:b3:2026-02-28')
  })

  it('同一天两个生日 → 两条，key 不撞', () => {
    const r = dueReminders(
      input({
        birthdays: [
          { id: 'b1', name: '甲', month: 10, day: 21 },
          { id: 'b2', name: '乙', month: 10, day: 21 },
        ],
      }),
    )
    expect(r).toHaveLength(2)
    expect(new Set(r.map((x) => x.key)).size).toBe(2)
  })

  it('生日不是今天 → 不出（循环里 continue 的那条路）', () => {
    const r = dueReminders(input({ birthdays: [{ id: 'b9', name: '明天', month: 10, day: 22 }] }))
    expect(r).toEqual([])
  })

  it('生日没有 id 时用「名字:月-日」兜底做 key（同月同日同名的极端情况才可能撞）', () => {
    const r = dueReminders(input({ birthdays: [{ name: '无名', month: 10, day: 21 }] }))
    expect(r[0].key).toBe('birthday:无名:10-21:2026-10-21')
  })

  it('习惯：到点前不出，到点后没打卡才出，打过就不出', () => {
    const habit = { name: '跑步', days: <string[]>[] }
    expect(dueReminders(input({ now: at(2026, 10, 21, 19, 59), habit }))).toEqual([])
    const after = dueReminders(input({ now: at(2026, 10, 21, 20, 0), habit }))
    expect(after.map((x) => x.kind)).toEqual(['habit'])
    expect(after[0].body).toBe('今天还差一次。')

    const checked = dueReminders(input({ now: at(2026, 10, 21, 21, 0), habit: { name: '跑步', days: ['2026-10-20', '2026-10-21'] } }))
    expect(checked).toEqual([])
    expect(dueReminders(input({ now: at(2026, 10, 21, 21, 0), habit: { name: '  ', days: [] } }))).toEqual([])
  })

  it('习惯有连续天数时，话术带上它', () => {
    const r = dueReminders(input({ now: at(2026, 10, 21, 21, 0), habit: { name: '跑步', days: ['2026-10-19', '2026-10-20'] } }))
    expect(r[0].body).toBe('连续 2 天，今天还差一次。')
  })

  it('顺序固定：倒数日 → 生日 → 习惯', () => {
    const r = dueReminders(
      input({
        now: at(2026, 10, 21, 21, 0),
        countdowns: [{ label: '发布', date: '2026-10-21' }],
        birthdays: [{ id: 'b1', name: '妈妈', month: 10, day: 21 }],
        habit: { name: '跑步', days: [] },
      }),
    )
    expect(r.map((x) => x.kind)).toEqual(['countdown', 'birthday', 'habit'])
  })

  it('key 稳定：同一时刻算两次结果逐字相同（去重靠它）', () => {
    const i = input({ countdowns: [{ label: '发布', date: '2026-10-21' }], birthdays: [{ id: 'b1', name: '妈妈', month: 10, day: 21 }] })
    expect(dueReminders(i)).toEqual(dueReminders({ ...i }))
  })
})
