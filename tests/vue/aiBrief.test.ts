import { describe, expect, it } from 'vitest'
import { BRIEF_LINE_MAX, CRON_BRIEF_MAX, briefFromCards, cronSystemBlock } from '../../src/vue/aiBrief'

describe('智囊笔：版面简报（第三十九笔）', () => {
  it('每卡一行；空白折叠；空摘要只留标题', () => {
    const s = briefFromCards([
      { title: '待办', excerpt: '  把投影\n跑绿  ' },
      { title: '倒数日', excerpt: '' },
    ])
    expect(s).toBe('- 待办：把投影 跑绿\n- 倒数日')
  })

  it('单行摘要按码点截到 BRIEF_LINE_MAX（emoji 算一个字）', () => {
    const s = briefFromCards([{ title: 't', excerpt: '😀'.repeat(BRIEF_LINE_MAX + 10) }])
    const body = s.split('：')[1]
    expect(Array.from(body).length).toBe(BRIEF_LINE_MAX)
  })

  it('整份预算封顶：超出的卡明说还有几张，不静默丢', () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ title: `卡${i}`, excerpt: 'x'.repeat(BRIEF_LINE_MAX) }))
    const s = briefFromCards(cards, 400)
    const listed = s.split('\n').filter((l) => l.startsWith('- '))
    expect(listed.length).toBe(4)
    expect(s).toContain('（还有 26 张没有列出）')
  })

  it('默认预算就是 CRON_BRIEF_MAX；空清单得空串；空标题兜底', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `卡${i}`, excerpt: 'x'.repeat(BRIEF_LINE_MAX) }))
    const s = briefFromCards(many)
    expect(Array.from(s).length).toBeLessThanOrEqual(CRON_BRIEF_MAX + 20)
    expect(s).toContain('张没有列出')
    expect(briefFromCards([])).toBe('')
    expect(briefFromCards([{ title: '  ', excerpt: 'x' }])).toBe('- （未命名）：x')
  })
})

describe('智囊笔：cron system 块（第三十九笔）', () => {
  it('钉死只读边界：不改版面 / 不输出 @@act / 建议留给用户确认，且带上简报', () => {
    const s = cronSystemBlock('- 待办：把投影跑绿')
    expect(s).toContain('- 待办：把投影跑绿')
    expect(s).toContain('不要修改版面')
    expect(s).toContain('@@act')
    expect(s).toContain('留给用户在场时自己确认')
  })

  it('空简报写明「版面为空」而不是留白', () => {
    expect(cronSystemBlock('   ')).toContain('（版面为空）')
  })
})
