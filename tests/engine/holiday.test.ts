import { describe, expect, it } from 'vitest'
import {
  HOLIDAYS,
  isAdjustedWorkday,
  newYearEstimate,
  nextHoliday,
  planLength,
  planPhase,
  yearView,
} from '../../packages/engine/src/holiday'
import { parseDate } from '../../packages/engine/src/countdown'

/** 固定"今天"，让断言可复现 */
const at = (ymd: string, h = 12): Date => {
  const p = parseDate(ymd)!
  return new Date(p.y, p.m - 1, p.d, h)
}

describe('节假日：年表数据自检', () => {
  it('每一年：日期可解析、start ≤ end、补班日合法且不落在假期段里、都在同一年', () => {
    for (const [year, plans] of Object.entries(HOLIDAYS)) {
      const y = Number(year)
      expect(plans.length, `${year} 年的条目数`).toBeGreaterThan(0)
      for (const plan of plans) {
        const s = parseDate(plan.start)
        const e = parseDate(plan.end)
        expect(s, `${year} ${plan.name} start`).not.toBeNull()
        expect(e, `${year} ${plan.name} end`).not.toBeNull()
        expect(new Date(e!.y, e!.m - 1, e!.d).getTime()).toBeGreaterThanOrEqual(new Date(s!.y, s!.m - 1, s!.d).getTime())
        expect(s!.y, `${year} ${plan.name} 年份错位`).toBe(y)
        expect(plan.name).toBe(['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'].find((n) => n === plan.name))
        for (const w of plan.workdays) {
          const wp = parseDate(w)
          expect(wp, `${year} ${plan.name} 补班日 ${w}`).not.toBeNull()
          expect(wp!.y, '补班日应同一年').toBe(y)
          expect(wp!.m * 100 + wp!.d >= s!.m * 100 + s!.d && wp!.m * 100 + wp!.d <= e!.m * 100 + e!.d, `补班日 ${w} 不该落在假期里`).toBe(false)
        }
      }
    }
  })

  it('2026 年表与官方通知逐条一致（国办发明电〔2025〕7 号）', () => {
    const plans = HOLIDAYS[2026]!
    expect(plans.map((p) => p.name)).toEqual(['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'])
    expect(planLength(plans[1])).toBe(9) // 春节 2/15~2/23 共 9 天
    expect(plans[1].workdays).toEqual(['2026-02-14', '2026-02-28'])
    expect(planLength(plans[6])).toBe(7) // 国庆 10/1~10/7 共 7 天
    expect(plans[6].workdays).toEqual(['2026-09-20', '2026-10-10'])
  })
})

describe('节假日：阶段判定', () => {
  const guoqing = HOLIDAYS[2026]![6] // 10/1~10/7
  it('开始前一天 = upcoming', () => {
    expect(planPhase(guoqing, at('2026-09-30'))).toBe('upcoming')
  })
  it('首日与末日 = ongoing（末日当天还没走完）', () => {
    expect(planPhase(guoqing, at('2026-10-01'))).toBe('ongoing')
    expect(planPhase(guoqing, at('2026-10-07', 22))).toBe('ongoing')
  })
  it('结束次日 = past', () => {
    expect(planPhase(guoqing, at('2026-10-08'))).toBe('past')
  })
})

describe('节假日：nextHoliday', () => {
  it('年内取最早未过完的（9 月初是中秋，不是国庆）', () => {
    const v = nextHoliday(at('2026-09-01'))
    expect(v?.plan.name).toBe('中秋节')
    expect(v?.daysUntil).toBe(24)
  })
  it('正在放的假期也算"下一个"（显示进行中）', () => {
    expect(nextHoliday(at('2026-02-16'))?.plan.name).toBe('春节')
  })
  it('今年全过完且明年没数据 → null（卡片显示待公布，不编）', () => {
    expect(nextHoliday(at('2026-10-11'))).toBeNull()
    expect(nextHoliday(at('2026-12-20'))).toBeNull() // 2027 未录入；等官方公布后往 HOLIDAYS 加一年即可
  })
})

describe('节假日：yearView 与长度', () => {
  it('2026 全年 7 条、按通知顺序', () => {
    const view = yearView(2026, at('2026-06-01'))
    expect(view.map((v) => v.plan.name)).toEqual(['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'])
    expect(view.map((v) => v.phase)).toEqual(['past', 'past', 'past', 'past', 'upcoming', 'upcoming', 'upcoming'])
    expect(view[4].daysUntil).toBe(18) // 6/1 → 6/19
    expect(view[0].length).toBe(3)
  })
  it('没数据的年份返回空表（不编）', () => {
    expect(yearView(2031, at('2026-06-01'))).toEqual([])
  })
})

describe('节假日：调休补班日与元旦估算', () => {
  it('isAdjustedWorkday 命中与不命中', () => {
    expect(isAdjustedWorkday('2026-10-10')).toBe(true)
    expect(isAdjustedWorkday('2026-02-14')).toBe(true)
    expect(isAdjustedWorkday('2026-10-11')).toBe(false)
    expect(isAdjustedWorkday('不是日期')).toBe(false)
  })
  it('newYearEstimate：2026-10-11 距 2027 元旦 82 天', () => {
    expect(newYearEstimate(at('2026-10-11'))).toEqual({ date: '2027-01-01', days: 82 })
  })
})
