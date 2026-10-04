import { describe, expect, it } from 'vitest'
import {
  categoryTotals,
  dailyTotals,
  formatMoney,
  formatMoneyShort,
  monthEntries,
  monthSummary,
  parseAmount,
  sumCents,
  type LedgerEntry,
} from '../../packages/engine/src/ledger'

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0)

let seq = 0
const row = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  date: '2026-10-05',
  cents: 100,
  category: '餐饮',
  note: '',
  ...over,
})

describe('parseAmount：金额唯一的浮点入口，用字符串切分绕开二进制小数', () => {
  it('整数 / 一位 / 两位小数', () => {
    expect(parseAmount('12')).toBe(1200)
    expect(parseAmount('12.5')).toBe(1250)
    expect(parseAmount('12.50')).toBe(1250)
    expect(parseAmount('0.05')).toBe(5)
    expect(parseAmount('0')).toBe(0)
  })

  it('去空白、去千分位', () => {
    expect(parseAmount('  1,234.56  ')).toBe(123456)
  })

  it('第三位小数直接拒收，不四舍五入 —— "该不该进位"比"这条输了"更糟', () => {
    expect(parseAmount('12.345')).toBeNull()
    expect(parseAmount('12.0001')).toBeNull()
  })

  it('拒收：空、字母、负数、科学计数、单独的点', () => {
    for (const bad of ['', '   ', 'abc', '-5', '1e3', '.', '-', '1 2']) {
      expect(parseAmount(bad), bad).toBeNull()
    }
  })

  it('超过上限 → null（约一亿元以上多半是敲错了）', () => {
    expect(parseAmount('100000001')).toBeNull()
  })

  it('经典浮点陷阱：0.1 + 0.2 那条链在这里不会出现', () => {
    // 30 笔 0.1 元 = 300 分 = 3.00 元，精确到分（浮点会给出 2.9999999999999996）
    const entries = Array.from({ length: 30 }, () => row({ cents: parseAmount('0.1')! }))
    expect(sumCents(entries)).toBe(300)
    // 0.1 + 0.2 用浮点会是 0.30000000000000004 —— 这里必须是 30
    expect(parseAmount('0.1')! + parseAmount('0.2')!).toBe(30)
  })

  it('千分位分组写错要拒收（12,34 不是金额，不能被悄悄当成 1234）', () => {
    expect(parseAmount('12,34')).toBeNull()
    expect(parseAmount('1,23,4')).toBeNull()
    expect(parseAmount(',123')).toBeNull()
    expect(parseAmount('1,234')).toBe(123400)
    expect(parseAmount('1,234.56')).toBe(123456)
  })
})

describe('formatMoney：只有显示才除以 100', () => {
  it('分位补零', () => {
    expect(formatMoney(5, '¥')).toBe('¥0.05')
    expect(formatMoney(50, '¥')).toBe('¥0.50')
    expect(formatMoney(500, '¥')).toBe('¥5.00')
    expect(formatMoney(2550, '¥')).toBe('¥25.50')
  })

  it('千分位', () => {
    expect(formatMoney(123456789, '¥')).toBe('¥1,234,567.89')
  })

  it('负数给明确的负号（不用括号：括号在窄卡里会被截）', () => {
    expect(formatMoney(-2550, '¥')).toBe('-¥25.50')
  })

  it('默认符号是 ¥，可换', () => {
    expect(formatMoney(100)).toBe('¥1.00')
    expect(formatMoney(100, '$')).toBe('$1.00')
    expect(formatMoney(100, '€')).toBe('€1.00')
  })

  it('坏输入当 0，不显示 NaN', () => {
    expect(formatMoney(Number.NaN, '¥')).toBe('¥0.00')
    expect(formatMoney(Number.POSITIVE_INFINITY, '¥')).toBe('¥0.00')
  })

  it('short 版本：整数元不带 .00，两位小数带上', () => {
    expect(formatMoneyShort(500, '¥')).toBe('¥5')
    expect(formatMoneyShort(550, '¥')).toBe('¥5.50')
    expect(formatMoneyShort(123456, '¥')).toBe('¥1,234.56')
  })
})

describe('sumCents / categoryTotals', () => {
  it('求和是整数加法，可预期', () => {
    expect(sumCents([row({ cents: 1 }), row({ cents: 2 }), row({ cents: 300 })])).toBe(303)
  })

  it('空清单 → 0', () => {
    expect(sumCents([])).toBe(0)
  })

  it('按类汇总，**按金额从大到小**（这张卡回答的是"钱去哪了"）', () => {
    const out = categoryTotals([
      row({ category: '交通', cents: 1200 }),
      row({ category: '餐饮', cents: 2550 }),
      row({ category: '餐饮', cents: 450 }),
      row({ category: '购物', cents: 30000 }),
    ])
    expect(out.map((t) => t.category)).toEqual(['购物', '餐饮', '交通'])
    expect(out[1]).toEqual({ category: '餐饮', cents: 3000, count: 2 })
  })

  it('金额相同时按类目名排，顺序稳定不跳', () => {
    const a = categoryTotals([row({ category: '交通', cents: 100 }), row({ category: '餐饮', cents: 100 })])
    const b = categoryTotals([row({ category: '餐饮', cents: 100 }), row({ category: '交通', cents: 100 })])
    expect(a.map((t) => t.category)).toEqual(b.map((t) => t.category))
  })

  it('分类为空 / 空白 → 归到「其他」，不生成一个空类', () => {
    const out = categoryTotals([row({ category: '' }), row({ category: '   ' })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ category: '其他', cents: 200 })
  })
})

describe('monthEntries / monthSummary', () => {
  const now = at(2026, 10, 15)
  const list = [
    row({ date: '2026-10-01', cents: 1000 }),
    row({ date: '2026-10-15', cents: 500 }),
    row({ date: '2026-10-15', cents: 300 }),
    row({ date: '2026-09-30', cents: 99999 }),
    row({ date: '2025-10-15', cents: 88888 }),
  ]

  it('只留本月，日期倒序，同日保持录入顺序', () => {
    const out = monthEntries(list, now)
    expect(out.map((e) => e.cents)).toEqual([500, 300, 1000])
  })

  it('上一年同月不算本月', () => {
    expect(monthEntries([row({ date: '2025-10-15' })], now)).toEqual([])
  })

  it('日期形状不对的条目不进汇总', () => {
    expect(monthEntries([row({ date: '2026-13-01' }), row({ date: 'x' })], now)).toEqual([])
  })

  it('本月总额 / 日均 / 整月预测', () => {
    const s = monthSummary(list, now)
    expect(s.label).toBe('2026 年 10 月')
    expect(s.total).toBe(1800)
    expect(s.dayOfMonth).toBe(15)
    expect(s.daysInMonth).toBe(31)
    expect(s.dailyAvg).toBe(120)
    // 1800/15*31 = 3720
    expect(s.projected).toBe(3720)
  })

  it('本月一条都没有 → 全 0（不是 NaN，界面上不能出现 NaN）', () => {
    const s = monthSummary([], now)
    expect(s).toMatchObject({ total: 0, dailyAvg: 0, projected: 0, entries: [] })
  })

  it('只写了一笔 100 分且今天 1 号：日均 100，预测 = 100 × 当月天数', () => {
    const s = monthSummary([row({ date: '2026-10-01', cents: 100 })], at(2026, 10, 1))
    expect(s.dailyAvg).toBe(100)
    expect(s.projected).toBe(3100)
  })

  it('翻到上个月就是上个月的数据（月份索引 8 = 九月）', () => {
    const s = monthSummary(list, new Date(2026, 8, 1))
    expect(s.label).toBe('2026 年 9 月')
    expect(s.total).toBe(99999)
  })
})

describe('dailyTotals：给趋势条用', () => {
  const now = at(2026, 10, 15)

  it('从早到晚，空日期补 0 不留空洞（10-15 往前 5 天 = 10-11 起）', () => {
    const out = dailyTotals([row({ date: '2026-10-15', cents: 300 }), row({ date: '2026-10-13', cents: 100 })], now, 5)
    expect(out.map((d) => d.cents)).toEqual([0, 0, 100, 0, 300])
    expect(out[0].date).toBe('2026-10-11')
    expect(out[4].date).toBe('2026-10-15')
  })

  it('同一天多笔合并成一格', () => {
    const out = dailyTotals([row({ date: '2026-10-15', cents: 100 }), row({ date: '2026-10-15', cents: 200 })], now, 1)
    expect(out[0].cents).toBe(300)
  })

  it('跨月也对：5 月 30 日往前 3 天跨进 5 月 28 日；4 月 30 日往前 3 天跨进 4 月 28 日', () => {
    expect(dailyTotals([], new Date(2026, 4, 30), 3).map((d) => d.date)).toEqual(['2026-05-28', '2026-05-29', '2026-05-30'])
    expect(dailyTotals([], new Date(2026, 3, 30), 3).map((d) => d.date)).toEqual(['2026-04-28', '2026-04-29', '2026-04-30'])
  })

  it('跨年也对：1 月 2 日往前 3 天跨进上一年 12 月 31 日', () => {
    expect(dailyTotals([], new Date(2027, 0, 2), 3).map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('天数夹到 1–62，0 / 负数 / NaN 不至于死循环', () => {
    expect(dailyTotals([], now, 0)).toHaveLength(1)
    expect(dailyTotals([], now, -5)).toHaveLength(1)
    expect(dailyTotals([], now, Number.NaN)).toHaveLength(1)
    expect(dailyTotals([], now, 999)).toHaveLength(62)
  })
})

