import { describe, expect, it } from 'vitest'
import { decodeEntities, normalizeDate, parseFeed, sanitizeFeeds, unwrapCdata } from '../../packages/engine/src/rss'

/** 实测夹具：Solidot 的 RSS 2.0（原文片段，CDATA + 实体 + atom:link rel=self 一样不缺） */
const SOLIDOT = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>奇客Solidot&#8211;传递最新科技情报</title>
<link>https://www.solidot.org</link>
<atom:link href="https://www.solidot.org/index.rss" rel="self" type="application/rss+xml"></atom:link>
<item>
<title><![CDATA[曾濒临灭绝的象龟数量超过了塞舌尔人口总数]]></title>
<link><![CDATA[https://www.solidot.org/story?sid=85577]]></link>
<pubDate>Sun, 11 Oct 2026 15:24:51 +0800</pubDate>
</item>
<item>
<title><![CDATA[另一个标题 & 带实体]]></title>
<link>https://www.solidot.org/story?sid=85576</link>
<pubDate>Sat, 10 Oct 2026 09:00:00 +0800</pubDate>
</item>
</channel>
</rss>`

/** 实测夹具：阮一峰的 Atom（原文片段，rel=alternate 与 rel=self 并存） */
const RUANYIFENG = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>阮一峰的网络日志</title>
    <link rel="alternate" type="text/html" href="http://www.ruanyifeng.com/blog/" />
    <link rel="self" type="application/atom+xml" href="http://www.ruanyifeng.com/blog/atom.xml" />
    <entry>
        <title>科技爱好者周刊（第 414 期）：Jev 决策模型有什么用</title>
        <link rel="alternate" type="text/html" href="http://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html" />
        <published>2026-10-08T15:04:46Z</published>
        <updated>2026-10-11T03:08:09Z</updated>
    </entry>
</feed>`

describe('unwrapCdata / decodeEntities', () => {
  it('CDATA 剥壳；普通文本原样', () => {
    expect(unwrapCdata('<![CDATA[标题甲]]>')).toBe('标题甲')
    expect(unwrapCdata('  普通文本  ')).toBe('普通文本')
  })
  it('命名实体与数字实体都解；不认识的原样留', () => {
    const named = ['amp', 'lt', 'gt', 'quot', 'apos'].map((n) => '&' + n + ';').join('')
    expect(decodeEntities(named)).toBe('&' + String.fromCharCode(60) + '>' + '"' + "'")
    expect(decodeEntities('&#8211;')).toBe('–')
    expect(decodeEntities('&#x4E2D;')).toBe('中')
    expect(decodeEntities('&未知;')).toBe('&未知;')
  })
})

describe('normalizeDate：两族日期归一', () => {
  it('ISO 与 RFC 822 都给 YYYY-MM-DD；认不出给空串', () => {
    expect(normalizeDate('2026-10-08T15:04:46Z')).toBe('2026-10-08')
    expect(normalizeDate('Sun, 11 Oct 2026 15:24:51 +0800')).toBe('2026-10-11')
    expect(normalizeDate('Sat, 2 Jan 2026 00:00:00 GMT')).toBe('2026-01-02')
    expect(normalizeDate('不知道')).toBe('')
  })
})

describe('parseFeed：RSS 2.0（Solidot 实测原文）', () => {
  it('CDATA 标题/链接、实体、pubDate 全认；atom:link rel=self 不进条目', () => {
    const f = parseFeed(SOLIDOT)!
    expect(f.title).toBe('奇客Solidot–传递最新科技情报')
    expect(f.items).toHaveLength(2)
    expect(f.items[0].title).toBe('曾濒临灭绝的象龟数量超过了塞舌尔人口总数')
    expect(f.items[0].link).toBe('https://www.solidot.org/story?sid=85577')
    expect(f.items[0].date).toBe('2026-10-11')
    expect(f.items[1].title).toBe('另一个标题 & 带实体')
    expect(f.items[1].link).not.toContain('index.rss') // rel=self 是订阅自己
  })
})

describe('parseFeed：Atom（阮一峰实测原文）', () => {
  it('rel=alternate 胜出、feed 头的 rel=self 不掺和', () => {
    const f = parseFeed(RUANYIFENG)!
    expect(f.title).toBe('阮一峰的网络日志')
    expect(f.items[0].title).toContain('第 414 期')
    expect(f.items[0].link).toBe('http://www.ruanyifeng.com/blog/2026/10/weekly-issue-414.html')
    expect(f.items[0].date).toBe('2026-10-08') // published 优先于 updated
  })
})

describe('parseFeed：边界与容忍', () => {
  it('不是 feed 的文本 / 空串 → null；有条目才返回', () => {
    expect(parseFeed('')).toBeNull()
    expect(parseFeed('<html><body>普通网页</body></html>')).toBeNull()
    expect(parseFeed('<rss><channel><title>空订阅</title></channel></rss>')).toBeNull() // 没条目
  })
  it('条目截上限；没日期的条目照收（date 为空串）', () => {
    const many = `<rss><channel>${Array.from({ length: 20 }, (_, i) => `<item><title>条目${i}</title><link>https://x.test/${i}</link></item>`).join('')}</channel></rss>`
    expect(parseFeed(many)!.items).toHaveLength(8)
    const noDate = parseFeed('<rss><channel><item><title>无日期</title><link>https://x.test</link></item></channel></rss>')!
    expect(noDate.items[0].date).toBe('')
  })
})

describe('sanitizeFeeds：订阅名单（与 watch/probe 同一条 URL 边界）', () => {
  it('合规 https 保留、去重、空名取主机名；明文与私网进不来', () => {
    const out = sanitizeFeeds([
      { id: 'f1', label: '周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml' },
      { id: 'f2', label: '重复', url: 'https://www.ruanyifeng.com/blog/atom.xml' },
      { id: 'f3', label: '', url: 'https://www.solidot.org/index.rss' },
      { id: 'f4', label: '明文', url: 'http://x.test/feed' },
      { id: 'f5', label: '内网', url: 'https://192.168.1.1/feed' },
    ])
    expect(out.map((x) => x.label)).toEqual(['周刊', 'www.solidot.org'])
    expect(sanitizeFeeds([])).toEqual([])
  })
})
