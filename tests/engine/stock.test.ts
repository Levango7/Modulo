import { describe, expect, it } from 'vitest'
import {
  MAX_STOCKS,
  bareToMarket,
  formatChange,
  formatPrice,
  normalizeCode,
  parseQuotes,
  quotesUrl,
  sanitizeStocks,
  toSecid,
} from '../../packages/engine/src/stock'

describe('normalizeCode / toSecid：同码不同所，前缀必须留', () => {
  it('显式前缀保留；大小写与空白被规范化', () => {
    expect(normalizeCode('  SH600519 ')).toBe('sh600519')
    expect(normalizeCode('sz000001')).toBe('sz000001')
    expect(normalizeCode('sh000001')).toBe('sh000001')
  })
  it('裸 6 位按交易所前缀段猜：6/5/9 → 沪，0/2/3 → 深', () => {
    expect(bareToMarket('600519')).toBe('sh')
    expect(bareToMarket('510300')).toBe('sh')
    expect(normalizeCode('300750')).toBe('sz300750')
    expect(toSecid('600519')).toBe('1.600519')
    expect(toSecid('000001')).toBe('0.000001')
  })
  it('4/7/8 开头猜不出 → null（用户必须带前缀重输，不猜）', () => {
    expect(bareToMarket('400001')).toBeNull()
    expect(normalizeCode('700001')).toBeNull()
    expect(toSecid('不是代码')).toBeNull()
  })
  it('quotesUrl 只带合法 secid', () => {
    expect(quotesUrl(['sh000001', '坏代码', '600519'])).toBe(
      'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,1.600519&fields=f2,f3,f12,f14',
    )
  })
})

describe('sanitizeStocks：名单清洗', () => {
  it('坏代码丢、去重（规范化后同码）、空名用代码兜底、按名排序', () => {
    const out = sanitizeStocks([
      { id: 's1', label: '茅台', code: '600519' },
      { id: 's2', label: '同码重复', code: 'SH600519' },
      { id: 's3', label: '', code: 'sz000001' },
      { id: 's4', label: '坏', code: '789' },
    ])
    expect(out).toEqual([
      { id: 's1', label: '茅台', code: 'sh600519' },
      { id: 's3', label: 'SZ000001', code: 'sz000001' },
    ])
  })
  it('截上限；坏输入给空表', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `股${i}`, code: String(i).padStart(6, '0') }))
    expect(sanitizeStocks(many)).toHaveLength(Math.min(20, MAX_STOCKS))
    expect(sanitizeStocks([])).toEqual([])
    expect(sanitizeStocks([{ code: 42 }, null, 'x'] as never)).toEqual([])
  })
})

describe('parseQuotes：东财响应解析（真实形状）', () => {
  it('按请求顺序对位；f2=分、f3=×100', () => {
    const raw = {
      rc: 0,
      data: { total: 2, diff: [{ f2: 381379, f3: 5, f12: '000001', f14: '上证指数' }, { f2: 1689800, f3: -1150, f12: '600519', f14: '贵州茅台' }] },
    }
    const q = parseQuotes(raw, 2)
    expect(q).toEqual([
      { code: '000001', name: '上证指数', priceCents: 381379, changePctX100: 5 },
      { code: '600519', name: '贵州茅台', priceCents: 1689800, changePctX100: -1150 },
    ])
  })
  it('停牌字段 `-` 如实给 null（不拿 0 冒充）', () => {
    const q = parseQuotes({ data: { diff: [{ f2: '-', f3: '-', f12: '600519', f14: '贵州茅台' }] } }, 1)
    expect(q[0].priceCents).toBeNull()
    expect(q[0].changePctX100).toBeNull()
  })
  it('坏响应（缺 data / diff 非数组）给空表，绝不抛', () => {
    expect(parseQuotes(null, 2)).toEqual([])
    expect(parseQuotes({ data: null }, 2)).toEqual([])
    expect(parseQuotes({ data: { diff: 'x' } }, 2)).toEqual([])
  })
})

describe('formatPrice / formatChange：整数到最后一刻', () => {
  it('分 → 价格文本：千分位 + 两位小数；null 给 —', () => {
    expect(formatPrice(381379)).toBe('3,813.79')
    expect(formatPrice(1689800)).toBe('16,898.00')
    expect(formatPrice(505)).toBe('5.05')
    expect(formatPrice(null)).toBe('—')
  })
  it('涨跌幅：+0.05% / -11.50% / — ', () => {
    expect(formatChange(5)).toBe('+0.05%')
    expect(formatChange(-1150)).toBe('-11.50%')
    expect(formatChange(0)).toBe('0.00%')
    expect(formatChange(null)).toBe('—')
  })
})
