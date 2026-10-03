import { describe, expect, it } from 'vitest'
import { HN_TOP_URL, hnDiscussionUrl, hnItemUrl, parseStory, parseTopIds } from '@modulo/engine/hn'

/** 真夹具：topstories 的前 5 个 id + 第一条 item 的响应（2026-10-04 抓） */
const TOP_IDS = [49946393, 49947631, 49923873, 49948254, 49946355, 49940877, 49946895, 49942706, 49947051, 49946526]
const REAL_ITEM = { by: 'trwhite', descendants: 48, id: 49946393, kids: [49948572, 49947579], score: 184, time: 1791050805, title: 'Hole Punch: Sling your spaceship around the galaxy' }

describe('parseTopIds：一串 id 里取前 N 个', () => {
  it('真数列取前 5', () => {
    expect(parseTopIds(TOP_IDS, 5)).toEqual([49946393, 49947631, 49923873, 49948254, 49946355])
  })

  it('默认取 5 个；limit 大于总量就全给；limit 至少 1', () => {
    expect(parseTopIds(TOP_IDS)).toHaveLength(5)
    expect(parseTopIds([1, 2], 10)).toEqual([1, 2])
    expect(parseTopIds(TOP_IDS, 0)).toHaveLength(1)
  })

  it('非数组 / 全是垃圾 id / 空数组 → null（一次 HTTP 都不发）', () => {
    expect(parseTopIds(null)).toBeNull()
    expect(parseTopIds('x')).toBeNull()
    expect(parseTopIds([])).toBeNull()
    expect(parseTopIds(['a', 1.5, -3, null])).toBeNull()
  })
})

describe('parseStory：单条 item', () => {
  it('真 item 落进故事（含评论数与分数）', () => {
    const s = parseStory(REAL_ITEM)
    expect(s).toEqual({
      id: 49946393,
      title: 'Hole Punch: Sling your spaceship around the galaxy',
      score: 184,
      comments: 48,
      url: 'https://news.ycombinator.com/item?id=49946393', // 这条没有外链 → 回落讨论页
    })
  })

  it('有外链时用外链（只收 http/https）', () => {
    expect(parseStory({ ...REAL_ITEM, url: 'https://example.com/a' })!.url).toBe('https://example.com/a')
    expect(parseStory({ ...REAL_ITEM, url: 'javascript:alert(1)' })!.url).toBe(hnDiscussionUrl(49946393))
  })

  it('缺 id / 缺 title / 形状不对 → null', () => {
    expect(parseStory({ ...REAL_ITEM, id: undefined })).toBeNull()
    expect(parseStory({ ...REAL_ITEM, title: '' })).toBeNull()
    expect(parseStory(null)).toBeNull()
  })

  it('URL 生成器与常量', () => {
    expect(HN_TOP_URL).toBe('https://hacker-news.firebaseio.com/v0/topstories.json')
    expect(hnItemUrl(1)).toBe('https://hacker-news.firebaseio.com/v0/item/1.json')
    expect(hnDiscussionUrl(1)).toBe('https://news.ycombinator.com/item?id=1')
  })
})
