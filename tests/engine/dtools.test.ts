import { describe, expect, it } from 'vitest'
import { weekdayOf, diffDays, addDays } from '@modulo/engine/dtools'

describe('weekdayOf：星期几（与月历同一套日期事实）', () => {
  it('已知事实：2026-10-16 周五、17 周六、18 周日', () => {
    expect(weekdayOf('2026-10-16')).toBe('周五')
    expect(weekdayOf('2026-10-17')).toBe('周六')
    expect(weekdayOf('2026-10-18')).toBe('周日')
  })

  it('非法日期 null', () => {
    expect(weekdayOf('2026-02-30')).toBeNull()
    expect(weekdayOf('随便')).toBeNull()
  })
})

describe('diffDays：a 比 b 晚几天', () => {
  it('同日 0、往后为正、往前为负', () => {
    expect(diffDays('2026-10-20', '2026-10-16')).toBe(4)
    expect(diffDays('2026-10-16', '2026-10-20')).toBe(-4)
    expect(diffDays('2026-10-16', '2026-10-16')).toBe(0)
  })

  it('跨年与闰日', () => {
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1)
    expect(diffDays('2028-03-01', '2028-02-28')).toBe(2)
  })

  it('任一日期非法 → null', () => {
    expect(diffDays('2026-13-01', '2026-10-16')).toBeNull()
  })
})

describe('addDays：加减 N 天，输出补零的 YYYY-MM-DD', () => {
  it('跨月自动滚（10-16 + 15 = 10-31 + 跨月）', () => {
    expect(addDays('2026-10-16', 15)).toBe('2026-10-31')
    expect(addDays('2026-10-16', 16)).toBe('2026-11-01')
    expect(addDays('2026-10-16', -16)).toBe('2026-09-30')
  })

  it('跨年与闰日（2028-02-28 + 1 = 02-29，平年会滚到 03-01）', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('0 天原样返回（补零归一化也算服务）', () => {
    expect(addDays('2026-1-5', 0)).toBeNull() // 输入本身非法，先过解析关
    expect(addDays('2026-10-16', 0)).toBe('2026-10-16')
  })

  it('非整数天数拒绝（按日历日的口径没有半天）', () => {
    expect(addDays('2026-10-16', 1.5)).toBeNull()
  })
})
