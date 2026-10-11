/**
 * RSS 2.0 / Atom 的容忍式解析。
 *
 * ## 为什么是正则而不是 XML 解析器
 * 野外的 feed 很脏：CDATA 与转义混用、`<atom:link rel="self">` 混进 channel、
 * 日期格式三四种、标签大小写不一。一张工作台卡片只需要"标题 + 链接 + 日期"
 * 的列表，装一棵完整的 XML 树不划算 —— 容忍式（认得出就收、认不出给空）比
 * 严格解析更符合"取不到如实说"的产品口径。已知局限如实记录在解析函数注释里。
 *
 * 实测夹具来自真实源（Solidot RSS 2.0 / 阮一峰 Atom），测试里嵌的是原文片段。
 */

export interface FeedItem {
  title: string
  link: string
  /** 归一成 `YYYY-MM-DD`；认不出给空串（卡上只显示标题） */
  date: string
}

export interface FeedSummary {
  title: string
  items: FeedItem[]
}

/** 剥 CDATA 包装：`<![CDATA[x]]>` → `x`（没包着的原样返回） */
export function unwrapCdata(s: string): string {
  const t = s.trim()
  const m = /^<!\[CDATA\[([\s\S]*)\]\]>$/i.exec(t)
  return (m ? m[1] : t).trim()
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
}

/** 解码常见实体：命名的、十进制 `&#8211;`、十六进制 `&#x2014;`；不认识的原样留着 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (/^#x/i.test(body)) {
      const cp = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : whole
    }
    if (/^#/.test(body)) {
      const cp = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : whole
    }
    const hit = NAMED_ENTITIES[body.toLowerCase()]
    return hit ?? whole
  })
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * 日期归一成 `YYYY-MM-DD`。认两族格式：
 * RFC 822（RSS pubDate，`Sun, 11 Oct 2026 15:24:51 +0800`）与
 * ISO（Atom published/updated，`2026-10-08T15:04:46Z`）。认不出给空串。
 */
export function normalizeDate(s: string): string {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const rfc = /(\d{1,2})\s+([a-z]{3})\s+(\d{4})/i.exec(s)
  if (rfc) {
    const m = MONTHS.indexOf(rfc[2].toLowerCase())
    if (m >= 0) return `${rfc[3]}-${String(m + 1).padStart(2, '0')}-${rfc[1].padStart(2, '0')}`
  }
  return ''
}

function pick(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return m ? decodeEntities(unwrapCdata(m[1])) : null
}

/** Atom 的 `<link href="…">`：优先 `rel="alternate"`，其次任何带 href 的（`rel="self"` 是订阅自己，不能当文章链接） */
function pickAtomLink(block: string): string {
  const hrefs: { href: string; alternate: boolean }[] = []
  for (const m of block.matchAll(/<link\b[^>]*>/gi)) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? ''
    if (!href) continue
    hrefs.push({ href: decodeEntities(href), alternate: /rel\s*=\s*"alternate"/i.test(m[0]) })
  }
  return hrefs.find((x) => x.alternate)?.href ?? hrefs[0]?.href ?? ''
}

/**
 * 解析一份 feed 文本。RSS 2.0 与 Atom 都认；一条条目都认不出时返回 null
 * （调用方显示「解析不到条目」而不是一个空列表假装成功）。
 * 已知局限：正文里出现字面 `<item>` 字样的极端 feed 会解析歪 —— 工作台卡片
 * 不为这种 pathological 输入建一棵 XML 树。
 */
export function parseFeed(text: string, cap = 8): FeedSummary | null {
  if (!text || !/<(rss|feed)\b/i.test(text)) return null
  const blocks = [...text.matchAll(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0])
  const firstBlockAt = text.search(/<item\b|<entry\b/i)
  const head = firstBlockAt > 0 ? text.slice(0, firstBlockAt) : text
  const feedTitle = pick(head, 'title') ?? '订阅'

  const items: FeedItem[] = []
  for (const b of blocks) {
    if (items.length >= cap) break
    const title = pick(b, 'title')
    if (!title) continue
    const link = /<link\b[^>]*href=/i.test(b) ? pickAtomLink(b) : (pick(b, 'link') ?? '')
    const dateRaw =
      pick(b, 'pubDate') ?? pick(b, 'published') ?? pick(b, 'updated') ?? pick(b, 'date') ?? ''
    items.push({ title, link, date: normalizeDate(dateRaw) })
  }
  if (!items.length) return null
  return { title: feedTitle, items }
}

/** 订阅名单清洗：URL 必须过 `normalizeUrl`（https 白名单 + 私网边界，与 watch/probe 同源） */
import { normalizeUrl } from './watch.js'

export interface FeedSource {
  id: string
  label: string
  url: string
}

export const MAX_FEEDS = 12

export function sanitizeFeeds(list: Readonly<{ id?: unknown; label?: unknown; url?: unknown }[]>): FeedSource[] {
  const seen = new Set<string>()
  const out: FeedSource[] = []
  for (let i = 0; i < list.length && out.length < MAX_FEEDS; i += 1) {
    const raw = list[i]
    const url = normalizeUrl(typeof raw?.url === 'string' ? raw.url : '')
    if (!url) continue
    if (seen.has(url)) continue
    seen.add(url)
    const label =
      (typeof raw?.label === 'string' && raw.label.trim().slice(0, 24)) ||
      (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).slice(0, 24)
    let id = typeof raw?.id === 'string' && raw.id ? raw.id : `f${i}`
    while (out.some((x) => x.id === id)) id = `${id}-${out.length}`
    out.push({ id, label, url })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
}
