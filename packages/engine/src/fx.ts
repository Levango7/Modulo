/**
 * 汇率：解析 open.er-api 的响应 + 交叉换算。
 *
 * 数据源实测过（可达 + CORS `*` + **不要 key**）：`https://open.er-api.com/v6/latest/USD`
 * 一次给 166 种货币、以 USD 为基准。交叉汇率自己算（`rate[to] / rate[from]`），
 * 不为每个货币对再发请求。
 */

export interface FxSnapshot {
  /** 基准货币（数据源固定给 USD） */
  base: string
  /** 相对基准的汇率表 */
  rates: Record<string, number>
  /** 上游自己说这次数据是什么时候的（展示用，不参与判断） */
  updatedAt: string
  fetchedAt: number
}

/** 卡上默认摆这几种；换算行的下拉用全表（`rates` 里有什么就给什么） */
export const FX_CURRENCIES: readonly { code: string; name: string }[] = [
  { code: 'USD', name: '美元' },
  { code: 'CNY', name: '人民币' },
  { code: 'EUR', name: '欧元' },
  { code: 'JPY', name: '日元' },
  { code: 'HKD', name: '港币' },
  { code: 'GBP', name: '英镑' },
]

export const FX_URL = 'https://open.er-api.com/v6/latest/USD'

/**
 * 收窄响应。`result !== 'success'`、rates 不是对象、值不是正有限数的一律不认 ——
 * 汇率是钱，宁可显示"取不到"也不显示一个编出来的数。
 */
export function parseRates(payload: unknown, now: number): FxSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  if (o.result !== 'success') return null
  if (typeof o.rates !== 'object' || o.rates === null || Array.isArray(o.rates)) return null
  const rates: Record<string, number> = {}
  for (const [code, value] of Object.entries(o.rates as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value
  }
  if (Object.keys(rates).length === 0) return null
  return {
    base: typeof o.base_code === 'string' ? o.base_code : 'USD',
    rates,
    updatedAt: typeof o.time_last_update_utc === 'string' ? o.time_last_update_utc : '',
    fetchedAt: now,
  }
}

/** 交叉换算：表以 USD 为基准，所以任意两币的汇率是 `rate[to] / rate[from]` */
export function crossRate(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (!Number.isFinite(amount)) return null
  const f = rates[from]
  const t = rates[to]
  if (typeof f !== 'number' || typeof t !== 'number' || f <= 0 || t <= 0) return null
  return (amount * t) / f
}

export function currencyName(code: string): string {
  return FX_CURRENCIES.find((c) => c.code === code)?.name ?? code
}
