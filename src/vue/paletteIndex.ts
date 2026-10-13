/**
 * 命令面板的**数据索引**（2026-10-13 批 2）—— 纯函数，不碰 DOM。
 *
 * 面板有三个相互独立的查询域，刻意不混作一锅（x-hub 把三类混成一列，是它没做透的地方）：
 *
 * | 域 | 查什么 | 结果的动作 |
 * |---|---|---|
 * | 命令 | `COMMANDS`（命令表） | 派发命令（可撤销、有可用性谓词） |
 * | 卡片 | 注册表里的模块名与说明 | 跳到布局编辑并高亮那张卡 |
 * | 内容 | 用户写的字（便签/待办/速记/链接/命令/订阅/自选/生日） | 跳到对应卡片并高亮 |
 *
 * 三个域各自独立排序（命令按 scope 与表序；卡片/内容按匹配位置与长度），
 * 面板把它们分区呈现，而不是塞进同一个列表里比分数 —— 分数跨域没有可比性。
 */
import type { CardData } from './cardData'
import type { ModuleRegistry } from '@levango7/engine'

/** 面板结果行的统一形状（三个域共用渲染） */
export interface PaletteHit {
  /** `${kind}:${id}` —— 稳定 key，也用于测试断言 */
  key: string
  kind: 'command' | 'card' | 'content'
  /** 主行（标题） */
  title: string
  /** 次行（说明 / 命中摘要） */
  sub: string
  /** 该结果要跳去的卡片 id（card/content 域有；command 域为空） */
  cardId?: string
  /** 匹配得分（越大越靠前；仅同域内可比） */
  score: number
}

/**
 * 极简子序列模糊匹配（大小写不敏感）。返回 null = 不匹配，否则返回得分。
 *
 * 为什么不用第三方 fuzzy：规则要能**写进测试**。这里的分数规则是三句话：
 * 连续命中比断开的得分高、命中位置越靠前得分越高、命中占比越高得分越高。
 * 命令面板的查询量级是几十到几百条，O(n) 扫描远远够用。
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  let first = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (first < 0) first = ti
      streak++
      score += 2 + streak * 2 // 连续命中权重更高
      qi++
    } else {
      streak = 0
    }
  }
  if (qi < q.length) return null
  // 起点越靠前越好；命中占比越高越好
  score += Math.max(0, 12 - first)
  score += Math.round((q.length / Math.max(1, t.length)) * 10)
  return score
}

/** 命中摘要：把匹配处前后截一小段（内容域用；标题域不需要） */
export function excerpt(text: string, query: string, width = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!query) return flat.slice(0, width)
  const i = flat.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return flat.slice(0, width)
  const start = Math.max(0, i - Math.floor(width / 3))
  const cut = flat.slice(start, start + width)
  return (start > 0 ? '…' : '') + cut + (start + width < flat.length ? '…' : '')
}

/** 卡片域：模块名 + 说明（只在"已登记"的模块里找，扩展卡将来也走同一入口） */
export function searchCards(reg: ModuleRegistry, query: string): PaletteHit[] {
  const hits: PaletteHit[] = []
  for (const m of reg) {
    const s = fuzzyScore(query, `${m.title} ${m.blurb ?? ''}`)
    if (s === null) continue
    hits.push({
      key: `card:${m.id}`,
      kind: 'card',
      title: m.title,
      sub: m.blurb ?? '在布局编辑里定位这张卡',
      cardId: m.id,
      score: s,
    })
  }
  return hits.sort((a, b) => b.score - a.score)
}

/**
 * 内容域：把用户**写下的字**铺平成可搜条目。
 * 只收"有可读文本"的字段；机器采的数据（行情/探测历史/RSS 条目）不在 `CardData` 里，
 * 天然不会被搜到 —— 这是数据分层的直接收益，不需要额外排除。
 */
export function contentIndex(data: CardData): { cardId: string; title: string; text: string }[] {
  const out: { cardId: string; title: string; text: string }[] = []
  if (data.sticky.trim()) out.push({ cardId: 'sticky', title: '便签', text: data.sticky })
  for (const t of data.todos) out.push({ cardId: 'todo', title: `待办 · ${t.done ? '已完成' : '未完成'}`, text: t.text })
  for (const m of data.matrix) out.push({ cardId: 'matrix', title: '四象限待办', text: m.text })
  for (const n of data.notes) out.push({ cardId: 'notes', title: `速记 · ${n.title || '无标题'}`, text: `${n.title} ${n.body}` })
  for (const l of data.links) out.push({ cardId: 'links', title: `快捷链接 · ${l.label}`, text: `${l.label} ${l.href}` })
  for (const c of data.commands) out.push({ cardId: 'commands', title: `命令速查 · ${c.label}`, text: `${c.label} ${c.cmd}` })
  for (const f of data.feeds) out.push({ cardId: 'rss', title: `RSS · ${f.label}`, text: `${f.label} ${f.url}` })
  for (const s of data.stocks) out.push({ cardId: 'stock', title: `自选 · ${s.label}`, text: `${s.label} ${s.code}` })
  for (const b of data.birthdays) out.push({ cardId: 'birthday', title: `生日 · ${b.name}`, text: b.name })
  return out
}

export function searchContent(data: CardData, query: string): PaletteHit[] {
  const hits: PaletteHit[] = []
  for (const entry of contentIndex(data)) {
    const s = fuzzyScore(query, entry.text)
    if (s === null) continue
    hits.push({
      key: `content:${entry.cardId}:${entry.title}`,
      kind: 'content',
      title: entry.title,
      sub: excerpt(entry.text, query),
      cardId: entry.cardId,
      score: s,
    })
  }
  const seen = new Set<string>()
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => {
      if (seen.has(h.key)) return false
      seen.add(h.key)
      return true
    })
}
