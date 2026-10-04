import { describe, expect, it } from 'vitest'
import { applyRate, fixedPlan, formatFixed, formatRate, parseMoney, parseRate, roundHalfAwayFromZero } from '../../packages/engine/src/fixed'

describe('parseRate：按数值大小判「百分数还是小数」，不看写法', () => {
  it('>= 1 就是百分数：`6` = 6%（**不是 600%** —— 那种读法差 100 倍且界面看不出错在哪）', () => {
    expect(parseRate('6')).toBe(600)
    expect(parseRate('6%')).toBe(600)
    expect(parseRate('6.5')).toBe(650)
    expect(parseRate('6.5%')).toBe(650)
    expect(parseRate('100')).toBe(10_000)
    expect(parseRate('600')).toBe(60_000)
  })

  it('< 1 是小数：`0.06` = 6%', () => {
    expect(parseRate('0.06')).toBe(600)
    expect(parseRate('0.065')).toBe(650)
    expect(parseRate('0.06%')).toBe(600)
  })

  it('带不带 % 等价 —— % 只是给人看的提示', () => {
    expect(parseRate('6')).toBe(parseRate('6%'))
    expect(parseRate(' 2.5 % ')).toBe(250)
  })

  it('拒收：空、字母、负号、千分位、多重百分号', () => {
    for (const bad of ['', '   ', 'abc', '-5%', '1,000', '5%%', '%']) {
      expect(parseRate(bad), bad).toBeNull()
    }
  })

  it('超上限（10000% 以上）→ null，明显是敲错了', () => {
    expect(parseRate('10001')).toBeNull()
  })
})

describe('parseMoney：与记账同一套口径（整数分、至多两位小数）', () => {
  it('整数 / 一位 / 两位小数、千分位', () => {
    expect(parseMoney('12')).toBe(1200)
    expect(parseMoney('12.5')).toBe(1250)
    expect(parseMoney('1,280.00')).toBe(128_000)
  })

  it('第三位小数拒收；负数 / 字母拒收', () => {
    for (const bad of ['12.345', '-5', 'abc', '1,28', '', '1e3']) {
      expect(parseMoney(bad), bad).toBeNull()
    }
  })
})

describe('roundHalfAwayFromZero：财务口径与 JS 的 Math.round 不同', () => {
  it('正数就是 Math.round', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1)
    expect(roundHalfAwayFromZero(1.4)).toBe(1)
    expect(roundHalfAwayFromZero(1.5)).toBe(2)
  })

  it('**负数远离零**（Math.round(-0.5) 给 -0，往 +∞ 取整）', () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1)
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2)
    // 这条差异会让一张退款单和一张发票对不上，所以引擎里不用 Math.round
    expect(Math.round(-0.5)).toBe(-0)
  })
})

describe('applyRate：金额 × 率，中间不丢精度', () => {
  it('1280 元 × 6% = 76.80 元', () => {
    expect(applyRate(128_000, 600)).toBe(7680)
  })

  it('整数全程，不出现浮点尾巴', () => {
    expect(applyRate(333, 333)).toBe(11)
    expect(applyRate(1, 5000)).toBe(1) // 1 分的一半 → 进位到 1 分
    expect(applyRate(1, 1)).toBe(0)
  })

  it('坏参数 → null，不给一个编出来的数', () => {
    expect(applyRate(-1, 600)).toBeNull()
    expect(applyRate(12.5, 600)).toBeNull()
    expect(applyRate(128_000, -1)).toBeNull()
    expect(applyRate(128_000, Number.NaN)).toBeNull()
    expect(applyRate(1e12, 600)).toBeNull()
  })
})

describe('formatFixed / formatRate', () => {
  it('`dp` 是这个整数自己带几位小数，不是"折成元" —— 口径写清楚才不会用错', () => {
    // 7680 分 = 76.80 元
    expect(formatFixed(7680, 2)).toBe('¥76.80')
    expect(formatFixed(7680, 0)).toBe('¥7,680')
    expect(formatFixed(123456, 2)).toBe('¥1,234.56')
    expect(formatFixed(123456, 3)).toBe('¥123.456')
    expect(formatFixed(-500, 2)).toBe('-¥5.00')
  })

  it('小数位夹到 0–4', () => {
    expect(formatFixed(100, 9)).toBe('¥0.0100')
    expect(formatFixed(100, -3)).toBe('¥100')
  })

  it('率的单位是万分之一、显示是百分之一 —— 换算要除 100 而不是 10000', () => {
    expect(formatRate(600)).toBe('6%')
    expect(formatRate(650)).toBe('6.5%')
    expect(formatRate(10_000)).toBe('100%')
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(60_000)).toBe('600%')
    expect(formatRate(1)).toBe('0.1%')
  })
})

describe('fixedPlan：一套结果一次算完', () => {
  it('基数 / 小额 / 含率总额 / 去率净额', () => {
    const p = fixedPlan(128_000, 600)!
    expect(p).toEqual({ base: 128_000, rate: 600, result: 7680, total: 135_680, net: 120_320 })
  })

  it('**去率净额用除法而不是 base − result** —— 后者会被四舍五入误差放大', () => {
    // 1 分 × 50%：result 被舍成 1，base − result = 0；但净额应是 1 分的一半 → 进位到 1
    const p = fixedPlan(1, 5000)!
    expect(p.result).toBe(1)
    expect(p.net).toBe(1)
    expect(1 - p.result).toBe(0) // 减法给出的错答案
  })

  it('率 ≥ 100% → 净额无意义，给 0 并在界面上说明', () => {
    const p = fixedPlan(1000, 20_000)!
    expect(p.result).toBe(2000)
    expect(p.net).toBe(0)
  })

  it('坏参数 → null', () => {
    expect(fixedPlan(-1, 600)).toBeNull()
    expect(fixedPlan(128_000, Number.NaN)).toBeNull()
  })
})