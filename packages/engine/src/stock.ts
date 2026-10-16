/**
 * 股票行情：自选名单清洗 + 东财 push2 接口的解析。
 *
 * ## 为什么是东财 push2
 * 实测（2026-10-11）：CORS 全开（`Access-Control-Allow-Origin: *`）、UTF-8 JSON、
 * **价格给的是「分」的整数**（f2 = 价格 × 100）—— 最后一格正好对上这个仓
 * "记账不碰浮点"的口径，显示才除 100，全程整数运算。
 * 备选过新浪 hq.sinajs.cn：要 Referer 头且返回 GBK，网页版做不了，桌面版也得
 * 伪装 Referer —— 取数口径越干净越好，选了东财。
 *
 * ## secid 的坑：同码不同所
 * `000001` 在沪市是**上证指数**、在深市是**平安银行** —— 一个是指数一个是股票，
 * 裸代码有歧义。所以：显式 `sh`/`sz` 前缀永远保留；裸 6 位按交易所前缀段猜
 * （6/5/9 开头 → 沪，0/2/3 开头 → 深），猜不出返回 null 让用户带前缀重输。
 */

/** 东财 ulist 接口：一行自选，一次拉回 */
export const QUOTES_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
/** 只要四个字段：现价(分)、涨跌幅(×100)、代码、名称 —— 多要一个字段都是浪费 */
export const QUOTES_FIELDS = 'f2,f3,f12,f14'

export interface StockEntry {
  id: string
  label: string
  /** 规范化后的代码：`sh000001` / `600519` —— 原样显示给用户 */
  code: string
}

export const MAX_STOCKS = 12

/** 裸 6 位代码猜交易所：6/5/9 → 沪(1)，0/2/3 → 深(0)；猜不出 null（指数必须带前缀） */
export function bareToMarket(code: string): 'sh' | 'sz' | null {
  if (!/^\d{6}$/.test(code)) return null
  if (/^[659]/.test(code)) return 'sh'
  if (/^[023]/.test(code)) return 'sz'
  return null
}

/** 规范化一个代码：`SH600519`/`600519`/`600519 ` → `sh600519`；不认识返回 null */
export function normalizeCode(input: string): StockEntry['code'] | null {
  const s = input.trim().toLowerCase()
  if (/^s[hz]\d{6}$/.test(s)) return s
  if (/^\d{6}$/.test(s)) {
    const m = bareToMarket(s)
    return m ? `${m}${s}` : null
  }
  return null
}

/** 代码 → 东财 secid（`sh600519` → `1.600519`；sz → 0） */
export function toSecid(code: string): string | null {
  const n = normalizeCode(code)
  if (!n) return null
  return `${n.startsWith('sh') ? 1 : 0}.${n.slice(2)}`
}

/** 自选名单的取数 URL（一次拉全） */
export function quotesUrl(codes: readonly string[]): string {
  const secids = codes.map((c) => toSecid(c)).filter((x): x is string => x !== null)
  return `${QUOTES_URL}?secids=${secids.join(',')}&fields=${QUOTES_FIELDS}`
}

/** 清洗自选名单：代码规范化、去重、截上限、id 唯一、空名用代码兜底 */
export function sanitizeStocks(list: Readonly<{ id?: unknown; label?: unknown; code?: unknown }[]>): StockEntry[] {
  const seen = new Set<string>()
  const out: StockEntry[] = []
  for (let i = 0; i < list.length && out.length < MAX_STOCKS; i += 1) {
    const raw = list[i]
    const code = typeof raw?.code === 'string' ? normalizeCode(raw.code) : null
    if (!code) continue
    if (seen.has(code)) continue
    seen.add(code)
    const label =
      (typeof raw?.label === 'string' && raw.label.trim().slice(0, 24)) || code.toUpperCase()
    let id = typeof raw?.id === 'string' && raw.id ? raw.id : `s${i}`
    while (out.some((x) => x.id === id)) id = `${id}-${out.length}`
    out.push({ id, label, code })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
}

export interface StockQuote {
  /** 接口回的代码（不含交易所前缀） */
  code: string
  name: string
  /** 现价，单位「分」；停牌/取不到时为 null —— 界面显示「—」，不拿 0 冒充 */
  priceCents: number | null
  /** 涨跌幅 ×100（25 = +0.25%）；取不到为 null */
  changePctX100: number | null
}

/**
 * 解析东财 ulist 响应。**按请求顺序对位**（接口的返回序 = secids 的请求序）；
 * 任何一个字段是 `-`（停牌）或非数字都如实给 null，防御坏响应不抛错。
 */
export function parseQuotes(raw: unknown, wantCount: number): StockQuote[] {
  const diff = (raw as { data?: { diff?: unknown[] } })?.data?.diff
  if (!Array.isArray(diff)) return []
  const out: StockQuote[] = []
  const n = Math.min(diff.length, wantCount)
  for (let i = 0; i < n; i += 1) {
    const d = diff[i] as Record<string, unknown> | null
    if (!d || typeof d !== 'object') continue
    const code = typeof d.f12 === 'string' ? d.f12 : ''
    const name = typeof d.f14 === 'string' ? d.f14 : ''
    // f2/f3 在停牌时是字符串 "-"：数字校验不过 → null（如实，不编）
    const price = typeof d.f2 === 'number' && Number.isFinite(d.f2) ? Math.trunc(d.f2) : null
    const pct = typeof d.f3 === 'number' && Number.isFinite(d.f3) ? Math.trunc(d.f3) : null
    out.push({ code, name, priceCents: price, changePctX100: pct })
  }
  return out
}

/** 「分」→ 价格文本（整数运算到最后一刻，只有显示才除 100；负数给出 `-`） */
export function formatPrice(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return '—'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(cents))
  const yuan = Math.floor(abs / 100)
  const rest = abs % 100
  return `${sign}${yuan.toLocaleString('en-US')}.${rest < 10 ? '0' : ''}${rest}`
}

/** 涨跌幅文本：`+0.25%` / `-1.30%` / `—`；×100 的整数只用一次除法 */
export function formatChange(pctX100: number | null): string {
  if (pctX100 === null || !Number.isFinite(pctX100)) return '—'
  const sign = pctX100 > 0 ? '+' : ''
  const v = pctX100 / 100
  return `${sign}${v.toFixed(2)}%`
}
