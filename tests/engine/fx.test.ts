import { describe, expect, it } from 'vitest'
import { FX_URL, crossRate, currencyName, parseRates } from '@levango7/engine/fx'

/**
 * 夹具是**真的**：2026-10-04 从 open.er-api 抓到的那份响应（rates 截到卡上会用的几种，
 * 数值逐字照抄 —— 6.714383 这种位数正是判据要看的东西）。
 */
const REAL = {
  result: 'success',
  base_code: 'USD',
  time_last_update_utc: 'Sat, 03 Oct 2026 00:02:32 +0000',
  rates: { USD: 1, CNY: 6.714383, EUR: 0.888752, JPY: 157.81511, HKD: 7.846892, GBP: 0.756313, KRW: 1347.389067 },
}

describe('parseRates：收窄真响应', () => {
  it('真数据逐项落进快照（基准、更新时刻、汇率表）', () => {
    const s = parseRates(REAL, 1000)
    expect(s).not.toBeNull()
    expect(s!.base).toBe('USD')
    expect(s!.updatedAt).toContain('2026')
    expect(s!.fetchedAt).toBe(1000)
    expect(s!.rates.CNY).toBe(6.714383)
    expect(Object.keys(s!.rates)).toHaveLength(7)
  })

  it('result !== success（上游的失败体）一律 null', () => {
    expect(parseRates({ ...REAL, result: 'error' }, 0)).toBeNull()
    expect(parseRates({ error: 'quota' }, 0)).toBeNull()
  })

  it('坏值被逐条剔掉；剔完为空则整份拒收', () => {
    const messy = { ...REAL, rates: { USD: 1, BAD: 'x', NEG: -3, ZERO: 0, NAN: Number.NaN, OK: 2 } }
    const s = parseRates(messy, 0)
    expect(Object.keys(s!.rates).sort()).toEqual(['OK', 'USD'])
    expect(parseRates({ result: 'success', rates: { BAD: 'x' } }, 0)).toBeNull()
  })

  it('形状不对：非对象 / rates 是数组 / rates 缺失', () => {
    expect(parseRates(null, 0)).toBeNull()
    expect(parseRates('x', 0)).toBeNull()
    expect(parseRates({ result: 'success', rates: [1, 2] }, 0)).toBeNull()
    expect(parseRates({ result: 'success' }, 0)).toBeNull()
  })
})

describe('crossRate：表以 USD 为基准，交叉汇率自己算', () => {
  it('USD → CNY 就是表里的数', () => {
    expect(crossRate(1, 'USD', 'CNY', REAL.rates)).toBeCloseTo(6.714383, 6)
  })

  it('CNY → USD 是倒数（钱要对得上）', () => {
    expect(crossRate(671.4383, 'CNY', 'USD', REAL.rates)).toBeCloseTo(100, 4)
  })

  it('两非基准币之间：CNY → JPY = rate[JPY]/rate[CNY]', () => {
    const direct = crossRate(100, 'CNY', 'JPY', REAL.rates)!
    expect(direct).toBeCloseTo((100 * 157.81511) / 6.714383, 6)
    // 走一趟 USD 应该回到原值（不变量）
    const viaUsd = crossRate(crossRate(100, 'CNY', 'USD', REAL.rates)!, 'USD', 'JPY', REAL.rates)!
    expect(viaUsd).toBeCloseTo(direct, 6)
  })

  it('未知货币 / 非有限金额 → null', () => {
    expect(crossRate(1, 'XXX', 'CNY', REAL.rates)).toBeNull()
    expect(crossRate(1, 'USD', 'XXX', REAL.rates)).toBeNull()
    expect(crossRate(Number.NaN, 'USD', 'CNY', REAL.rates)).toBeNull()
  })

  it('URL 与货币名：卡上要用', () => {
    expect(FX_URL).toBe('https://open.er-api.com/v6/latest/USD')
    expect(currencyName('CNY')).toBe('人民币')
    expect(currencyName('XYZ')).toBe('XYZ')
  })
})
