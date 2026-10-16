/**
 * 网页取数（声明式扩展，2026-10-13 批 3）
 *
 * ## 这是什么
 *
 * 对标 x-hub 的"扩展"里最实用的一层：**填一个 URL + 选刷新的频率 + 说清要页面上哪个数**，
 * 宿主负责抓取、解析与渲染 —— **零代码**就能把任意 JSON 接口变成工作台的一张卡
 * （热搜条 / 汇率 / 股价 / 服务状态…）。它刻意不做 HTML 抓取（解析网页文本是另一类问题、
 * 而且极易因对方改版而碎），只认 JSON。
 *
 * ## 与既有模块的关系（不另起一套）
 *
 * - **URL 判据复用 `watch.ts`**：`normalizeUrl` 已含"只收 https、拒私网/保留主机名与
 *   userinfo"的全部边界，且与 Rust 侧 `net.rs` 同源。这里只做**长度上限的差异**，
 *   绝不重写判据 —— 两份规则一起漂，安全边界就会从松的那份漏掉。
 * - **取数复用 `net.rs`**：网页版先试原生 `fetch`（`https` + 常见 JSON 接口的 CORS 是开的），
 *   失败则交桌面壳走 Rust（同一条 IPv4/IPv6/DNS 判据）。两条路的**降级文案不同**，
 *   所以 `fetchPlan` 要把它算清楚 —— 用户得知道"取不到"是网络问题还是这条卡在网页版先天不行。
 * - **数值不给浮点**（沿用仓里 cadence）：JSON 里的价格常是整数分/字符串，
 *   本模块只做"取出来并原样显示"，不做单位换算。
 *
 * ## 边界（写在这里因为卡片要照它承诺）
 *
 * - 无自定义请求头、无请求体、无 Cookie —— 与监控卡同一套"只有 URL"的克制
 * - **`path` 只认"点 + [数字]"**，不执行任何表达式（不做 JSONPath 子集解释器：
 *   输入即代码的那类接口，攻击面比它带来的便利大得多）
 * - 响应上限与超时沿用 `net.rs`（1 MiB / 5s）；解析失败如实显示，不猜
 */
import { normalizeUrl } from './watch.js'

/** 一个取数端点（用户写的，进备份） */
export interface HttpEndpoint {
  id: string
  /** 展示名；空则取主机名 */
  label: string
  /** 必须是 https 且主机名过 watch 的同一套边界 */
  url: string
  /** 刷新秒数（夹到区间内） */
  refreshSec: number
  /** 取值路径，如 `data[0].price`；空 = 取整份响应 */
  path: string
  /** 把取到的数当金额：显示时除以 100（东财那类"价格给分"的接口要用） */
  scale100: boolean
}

export const MAX_ENDPOINTS = 24
export const MAX_HTTP_LABEL = 24
/** 与 watch 同一 URL 上限（300）：两侧判据同源，便于对照 */
export const MAX_HTTP_URL = 300
export const MIN_REFRESH_SEC = 30
export const MAX_REFRESH_SEC = 24 * 3600
export const DEFAULT_REFRESH_SEC = 300
export const MAX_PATH_LEN = 200

/** 刷新节奏的档位（卡上的下拉直接用这个，不做任意输入 —— 少的自由度换"不会打出 1 秒狂刷"） */
export const REFRESH_PRESETS: readonly number[] = [30, 60, 300, 900, 3600]

function clampRefresh(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULT_REFRESH_SEC
  return Math.min(MAX_REFRESH_SEC, Math.max(MIN_REFRESH_SEC, v))
}

/**
 * 清洗一个取值路径。只放行 `键` 与 `[数字]`，其余返回空串（= 取整份响应）。
 * 刻意不做转义语法：JSON 的键里出现点或括号时，用户自己换个接口层（或换路径）。
 */
export function cleanPath(input: unknown): string {
  if (typeof input !== 'string') return ''
  const s = input.trim()
  if (!s || s.length > MAX_PATH_LEN) return ''
  return /^[A-Za-z_$][\w$]*((\.[A-Za-z_$][\w$]*)?(\[\d+\])*)*$/.test(s) ? s : ''
}

/**
 * 按路径取值。**不抛异常**：任何一步落空都返回 undefined，调用方显示"—"。
 * 支持 `a.b[0].c` 这一种形状（与 cleanPath 的接受集一一对应）。
 */
export function pickPath(data: unknown, path: string): unknown {
  if (!path) return data
  let cur: unknown = data
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    const m = /^([A-Za-z_$][\w$]*)?((\[\d+\])*)$/.exec(seg)
    if (!m) return undefined
    if (m[1]) cur = (cur as Record<string, unknown>)[m[1]]
    const idx = m[2]
    if (idx) {
      for (const one of idx.match(/\[\d+\]/g) ?? []) {
        if (!Array.isArray(cur)) return undefined
        cur = cur[Number(one.slice(1, -1))]
      }
    }
  }
  return cur
}

/**
 * 把一个值格式化成卡片上一行字。
 *
 * 只处理四种：数字 / 字符串 / 布尔 / （对象数组走 listOf）。数字按 `scale100` 折成元，
 * 其余原样 —— **不做千分位与单位猜测**（猜出来的"¥"比没有更误导）。
 */
export function formatValue(v: unknown, scale100 = false): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    const n = scale100 ? v / 100 : v
    // 整数不拖小数点；非整数最多两位（价格/汇率的常见精度）
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return `数组（${v.length} 项）`
  return '对象'
}

/** 取到的值是不是"能当主角的大数字"（卡面据此决定大号显示还是列表显示） */
export function isScalar(v: unknown): boolean {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
}

/**
 * 列表提取：某些接口（热搜、条目列表）的响应是对象数组。
 * 只认"数组里的每项能取到 `itemPath` 或本身是标量"这一种形状；
 * 返回最多 `max` 条 `{ label, value }`，label 取 `labelPath`（空则用序号）。
 */
export function listOf(
  v: unknown,
  itemPath: string,
  labelPath: string,
  max = 8,
): { label: string; value: string }[] {
  if (!Array.isArray(v)) return []
  const out: { label: string; value: string }[] = []
  for (let i = 0; i < v.length && out.length < max; i++) {
    const item = v[i]
    const raw = itemPath ? pickPath(item, itemPath) : item
    const labelRaw = labelPath ? pickPath(item, labelPath) : undefined
    const label = labelRaw === undefined || labelRaw === null ? `${i + 1}` : formatValue(labelRaw)
    const value = formatValue(raw)
    if (value === '—') continue
    out.push({ label, value })
  }
  return out
}

/**
 * 取数路径的**降级计划**（纯函数，卡片与测试都照它办）：
 *
 * - `native`：网页版也能直接 fetch 的接口（CORS 开着的少数，如东财 push2）
 * - `desktop-only`：网页版拿不到（CORS 挡住），桌面壳走 Rust 取；文案要说清这一点
 * - `blocked`：URL 本身不合规（进不来端点表的条目不会有这个状态，但运行时数据可能被改）
 */
export type FetchPlan = 'native' | 'desktop-only' | 'blocked'

export function fetchPlan(endpoint: HttpEndpoint, desktop: boolean): FetchPlan {
  if (!normalizeUrl(endpoint.url)) return 'blocked'
  // 网页版：先试原生 fetch；失败如实标注"网页版可能取不到，桌面壳可解决"。
  // 这里不预判具体哪些接口开 CORS（那份名单会过期）—— 运行时试一次最诚实。
  return desktop ? 'native' : 'desktop-only'
}

/**
 * 清洗整份端点表：丢坏的、去重（同 URL 只留一条）、按添加顺序、砍到上限。
 * 与 `sanitizeWatch` 同一套骨架 —— 连"丢掉的数量要回显"这条也继承（导入备份时有意义）。
 */
export function sanitizeEndpoints(
  list: Readonly<{ id?: unknown; label?: unknown; url?: unknown; refreshSec?: unknown; path?: unknown; scale100?: unknown }>[],
): { endpoints: HttpEndpoint[]; rejected: number } {
  const out: HttpEndpoint[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const raw of list) {
    if (out.length >= MAX_ENDPOINTS) break
    if (typeof raw?.url !== 'string') {
      rejected++
      continue
    }
    const url = normalizeUrl(raw.url)
    if (!url) {
      rejected++
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : url,
      label: typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_HTTP_LABEL) : '',
      url,
      refreshSec: clampRefresh(raw.refreshSec),
      path: cleanPath(raw.path),
      scale100: raw.scale100 === true,
    })
  }
  return { endpoints: out, rejected }
}
