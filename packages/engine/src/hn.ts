/**
 * HN 热榜：解析 hacker-news 的 topstories（一串 id）与单条 item。
 *
 * 这个数据源是"一个列表 + 每条一次请求"的结构，所以**一次刷新 = 1 + N 个小请求**
 * （N 默认 5）—— 卡片里把这件事写清楚，别让人以为它只发一次。
 */

export interface HnStory {
  id: number
  title: string
  score: number
  comments: number
  /** 外部链接；没有（Ask HN 这类）时回落到讨论页 */
  url: string
}

export const HN_TOP_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json'

export function hnItemUrl(id: number): string {
  return `https://hacker-news.firebaseio.com/v0/item/${id}.json`
}

export function hnDiscussionUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`
}

/** 取前 `limit` 个正整数 id；不是数组/没有可用 id 就 null */
export function parseTopIds(payload: unknown, limit = 5): number[] | null {
  if (!Array.isArray(payload)) return null
  const ids = payload.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)
  if (ids.length === 0) return null
  return ids.slice(0, Math.max(1, limit))
}

export function parseStory(payload: unknown): HnStory | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id)) return null
  if (typeof o.title !== 'string' || !o.title) return null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const url = typeof o.url === 'string' && /^https?:\/\//.test(o.url) ? o.url : hnDiscussionUrl(o.id)
  return { id: o.id, title: o.title, score: num(o.score), comments: num(o.descendants), url }
}
