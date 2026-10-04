import { describe, expect, it } from 'vitest'
import { birthdayText, isValidBirthday, nextBirthday, parseMonthDay, upcomingBirthdays } from '../../packages/engine/src/birthday'

/** 本地时间，避开 UTC：生日是日历概念，测试里也不该有"时区决定今天是哪天"这种噪音 */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 0, 0)

describe('parseMonthDay / isValidBirthday：形状不对就不认', () => {
  it('认 3-5 / 03-05 两种写法', () => {
    expect(parseMonthDay('3-5')).toEqual({ month: 3, day: 5 })
    expect(parseMonthDay(' 03-05 ')).toEqual({ month: 3, day: 5 })
  })

  it('月份越界、日子为 0 一律 null（不猜、不补全）', () => {
    expect(parseMonthDay('13-1')).toBeNull()
    expect(parseMonthDay('0-5')).toBeNull()
    expect(parseMonthDay('3-0')).toBeNull()
    expect(parseMonthDay('3-32')).toBeNull()
    expect(parseMonthDay('')).toBeNull()
    expect(parseMonthDay('三月五日')).toBeNull()
    expect(parseMonthDay('1988-03-05')).toBeNull()
  })

  it('2 月 29 日放行，2 月 30 日不放', () => {
    expect(isValidBirthday({ month: 2, day: 29 })).toBe(true)
    expect(isValidBirthday({ month: 2, day: 30 })).toBe(false)
    expect(isValidBirthday({ month: 4, day: 31 })).toBe(false)
    expect(isValidBirthday({ month: 4, day: 30 })).toBe(true)
  })

  it('月份是 2.5 这种小数也不认', () => {
    expect(isValidBirthday({ month: 2.5, day: 5 })).toBe(false)
  })
})

describe('nextBirthday：下一次，而不是最远的一次', () => {
  it('今天就是生日 → 0 天（不是 365）', () => {
    const n = nextBirthday({ name: '妈妈', month: 10, day: 4 }, at(2026, 10, 4))
    expect(n?.days).toBe(0)
    expect(n?.date).toBe('2026-10-04')
  })

  it('明天 → 1 天', () => {
    expect(nextBirthday({ name: 'x', month: 10, day: 5 }, at(2026, 10, 4))?.days).toBe(1)
  })

  it('过了就滚到明年，日期里的年份跟着滚', () => {
    const n = nextBirthday({ name: 'x', month: 1, day: 2 }, at(2026, 10, 4))
    expect(n?.days).toBe(90)
    expect(n?.date).toBe('2027-01-02')
  })

  it('12 月 31 日看 1 月 1 日 → 跨年只有 1 天（不按"还剩 365 天"算）', () => {
    const n = nextBirthday({ name: 'x', month: 1, day: 1 }, at(2026, 12, 31))
    expect(n?.days).toBe(1)
    expect(n?.date).toBe('2027-01-01')
  })

  it('12 月 31 日看 12 月 31 日 → 就是今天，不是明年', () => {
    expect(nextBirthday({ name: 'x', month: 12, day: 31 }, at(2026, 12, 31))?.days).toBe(0)
  })

  it('闰日 2/29 在平年落到 2/28', () => {
    const n = nextBirthday({ name: 'x', month: 2, day: 29 }, at(2026, 3, 1))
    expect(n?.date).toBe('2027-02-28')
    expect(n?.days).toBe(364)
  })

  it('闰日 2/29 在闰年就是 2/29', () => {
    expect(nextBirthday({ name: 'x', month: 2, day: 29 }, at(2028, 1, 5))?.date).toBe('2028-02-29')
  })

  it('1900 年不是闰年（能被 100 整除），2000 是', () => {
    // 2100-03-01 看 2/29：2100 平年 → 落到 2/28
    expect(nextBirthday({ name: 'x', month: 2, day: 29 }, at(2100, 3, 1))?.date).toBe('2101-02-28')
    // 2000 是闰年
    expect(nextBirthday({ name: 'x', month: 2, day: 29 }, at(2000, 1, 5))?.date).toBe('2000-02-29')
  })

  it('认不出的生日返回 null —— 界面据此显示"没设"，不编一个日子', () => {
    expect(nextBirthday({ name: 'x', month: 2, day: 30 }, at(2026, 1, 1))).toBeNull()
    expect(nextBirthday({ name: 'x', month: 13, day: 1 }, at(2026, 1, 1))).toBeNull()
  })
})

describe('年龄：没有年就没有年龄', () => {
  it('填了出生年 → 到那天几岁', () => {
    expect(nextBirthday({ name: '妈妈', month: 10, day: 4, year: 1962 }, at(2026, 10, 4))?.turns).toBe(64)
  })

  it('明年过生日 → 在今年已经长了一岁', () => {
    expect(nextBirthday({ name: '妈妈', month: 1, day: 2, year: 1962 }, at(2026, 10, 4))?.turns).toBe(65)
  })

  it('没填年份 → null，不拿"猜一个"糊过去', () => {
    expect(nextBirthday({ name: '老陈', month: 11, day: 30 }, at(2026, 10, 4))?.turns).toBeNull()
  })

  it('出生年在未来 / 是 0 / 不是整数 → 不给年龄（不是负岁）', () => {
    const now = at(2026, 10, 4)
    expect(nextBirthday({ name: 'x', month: 10, day: 4, year: 2030 }, now)?.turns).toBeNull()
    expect(nextBirthday({ name: 'x', month: 10, day: 4, year: 0 }, now)?.turns).toBeNull()
    expect(nextBirthday({ name: 'x', month: 10, day: 4, year: 1988.5 }, now)?.turns).toBeNull()
  })
})

describe('upcomingBirthdays：最近的在前，同一天按名字', () => {
  it('按天数排', () => {
    const now = at(2026, 10, 4)
    const out = upcomingBirthdays(
      [
        { name: '远的', month: 12, day: 1 },
        { name: '今天', month: 10, day: 4 },
        { name: '近的', month: 10, day: 9 },
      ],
      now,
    )
    expect(out.map((o) => o.b.name)).toEqual(['今天', '近的', '远的'])
    expect(out.map((o) => o.days)).toEqual([0, 5, 58])
  })

  it('同一天按名字排，且排的是拼音序（李 li < 张 zhang），不是输入顺序', () => {
    const now = at(2026, 10, 4)
    const out = upcomingBirthdays(
      [
        { name: '张三', month: 5, day: 1 },
        { name: '李四', month: 5, day: 1 },
      ],
      now,
    )
    expect(out.map((o) => o.b.name)).toEqual(['李四', '张三'])
    // 反过来输入也要得到同一个顺序 —— 界面上顺序不能随输入飘
    const flipped = upcomingBirthdays(
      [
        { name: '李四', month: 5, day: 1 },
        { name: '张三', month: 5, day: 1 },
      ],
      now,
    )
    expect(flipped.map((o) => o.b.name)).toEqual(['李四', '张三'])
  })

  it('认不出的条目丢掉，不占位', () => {
    const now = at(2026, 10, 4)
    const out = upcomingBirthdays([{ name: '坏的', month: 2, day: 31 }, { name: '好的', month: 10, day: 5 }], now)
    expect(out.map((o) => o.b.name)).toEqual(['好的'])
  })

  it('空名单 → 空数组（不是 null，界面直接 v-for 就行）', () => {
    expect(upcomingBirthdays([], at(2026, 10, 4))).toEqual([])
  })

  it('id 原样带出来 —— 界面要靠它删人', () => {
    const out = upcomingBirthdays([{ id: 'b7', name: '妈妈', month: 3, day: 5 }], at(2026, 10, 4))
    expect(out[0].b.id).toBe('b7')
  })
})

describe('birthdayText：三句人话', () => {
  const now = at(2026, 10, 4)
  it('今天 / 明天 / N 天', () => {
    expect(birthdayText(nextBirthday({ name: 'a', month: 10, day: 4 }, now)!)).toEqual({ head: '就是今天', age: null })
    expect(birthdayText(nextBirthday({ name: 'a', month: 10, day: 5 }, now)!)).toEqual({ head: '明天', age: null })
    expect(birthdayText(nextBirthday({ name: 'a', month: 10, day: 14 }, now)!)).toEqual({ head: '还有 10 天', age: null })
  })

  it('有出生年才带年龄', () => {
    expect(birthdayText(nextBirthday({ name: 'a', month: 10, day: 4, year: 2000 }, now)!)).toEqual({
      head: '就是今天',
      age: '26 岁',
    })
  })
})
