import { describe, expect, it } from 'vitest'
import { groupByHost, normalizeHref, normalizeLabel, sanitizeLinks } from '../../packages/engine/src/links'

describe('normalizeHref：协议白名单，不是黑名单', () => {
  it('无协议按 https 补齐 —— 用户敲 example.com 是常态', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com')
    expect(normalizeHref('  github.com/Levango7  ')).toBe('https://github.com/Levango7')
    expect(normalizeHref('sub.example.co.uk/a/b?c=1#d')).toBe('https://sub.example.co.uk/a/b?c=1#d')
  })

  it('认 http/https 与几个常见自定义协议', () => {
    expect(normalizeHref('http://a.test')).toBe('http://a.test')
    expect(normalizeHref('mailto:a@b.test')).toBe('mailto:a@b.test')
    expect(normalizeHref('obsidian://open?vault=x')).toBe('obsidian://open?vault=x')
    expect(normalizeHref('vscode://file/f:/x.ts')).toBe('vscode://file/f:/x.ts')
  })

  it('**javascript: / data: 一律拒收** —— 黑名单永远漏得掉下一个危险协议，所以用白名单', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd']) {
      // `file:` 在白名单里，但它要求非空 rest；这里验证的是 javascript/data/vbscript
      if (bad.startsWith('file:')) {
        expect(normalizeHref(bad)).toBe('file:///etc/passwd')
        continue
      }
      expect(normalizeHref(bad), bad).toBeNull()
    }
  })

  it('空 / 超长 / 只有协议没有内容 → null', () => {
    expect(normalizeHref('')).toBeNull()
    expect(normalizeHref('   ')).toBeNull()
    expect(normalizeHref('https://')).toBeNull()
    expect(normalizeHref('mailto:')).toBeNull()
    expect(normalizeHref('x'.repeat(400))).toBeNull()
  })
})

describe('normalizeLabel', () => {
  it('给了名字就去空白并截短', () => {
    expect(normalizeLabel('  我的仓库  ', 'https://github.com')).toBe('我的仓库')
    expect(normalizeLabel('x'.repeat(40), 'https://a.test')).toHaveLength(24)
  })

  it('没给名字就从链接猜主机名 —— 仍然一眼认得出是哪条', () => {
    expect(normalizeLabel('', 'https://github.com/Levango7')).toBe('github.com')
    expect(normalizeLabel('   ', 'https://news.ycombinator.com/')).toBe('news.ycombinator.com')
  })

  it('连主机名都猜不出就退回链接原文（截短）', () => {
    expect(normalizeLabel('', 'mailto:a@b.test')).toBe('mailto:a@b.test')
  })
})

describe('sanitizeLinks', () => {
  it('丢掉坏的、留下好的', () => {
    const out = sanitizeLinks([{ href: 'https://a.test' }, { href: 'javascript:alert(1)' }, { href: '' }, { href: 'b.test' }])
    expect(out.map((l) => l.href)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('同名同链去重', () => {
    const out = sanitizeLinks([
      { label: 'A', href: 'https://a.test' },
      { label: 'A', href: 'https://a.test' },
      { label: 'B', href: 'https://a.test' },
    ])
    expect(out).toHaveLength(2)
  })

  it('按标签排序，且与输入顺序无关（界面不会因录入顺序变）', () => {
    const a = sanitizeLinks([
      { label: '仓库', href: 'https://github.com' },
      { label: '新闻', href: 'https://news.test' },
    ])
    const b = sanitizeLinks([
      { label: '新闻', href: 'https://news.test' },
      { label: '仓库', href: 'https://github.com' },
    ])
    expect(a.map((l) => l.label)).toEqual(['仓库', '新闻'])
    expect(a.map((l) => l.label)).toEqual(b.map((l) => l.label))
  })

  it('**id 必须唯一** —— 删一条 / 改一条都按 id 找，撞号会连坐', () => {
    const out = sanitizeLinks([
      { id: 'x', label: 'A', href: 'https://a.test' },
      { id: 'x', label: 'B', href: 'https://b.test' },
    ])
    expect(new Set(out.map((l) => l.id)).size).toBe(2)
  })

  it('缺 id 会补出稳定的 id', () => {
    expect(sanitizeLinks([{ href: 'https://a.test' }])[0].id).toBe('l0')
  })

  it('空名单 → 空数组（不返回第一条）', () => {
    expect(sanitizeLinks([])).toEqual([])
  })

  it('砍到上限', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ label: `L${i}`, href: `https://s${i}.test` }))
    expect(sanitizeLinks(many).length).toBeLessThanOrEqual(60)
  })
})

describe('groupByHost', () => {
  it('按主机分组，同主机内保持排序', () => {
    const out = groupByHost(
      sanitizeLinks([
        { label: 'B', href: 'https://a.test/2' },
        { label: 'A', href: 'https://b.test/1' },
        { label: 'C', href: 'https://a.test/1' },
      ]),
    )
    expect(out.map((g) => g.host)).toEqual(['a.test', 'b.test'])
    expect(out[0].links.map((l) => l.label)).toEqual(['B', 'C'])
  })

  it('空名单 → 空数组', () => {
    expect(groupByHost([])).toEqual([])
  })

  it('非 http 协议也能落到一个组里（不让它消失）', () => {
    const out = groupByHost(sanitizeLinks([{ label: '邮件', href: 'mailto:a@b.test' }]))
    expect(out).toHaveLength(1)
  })
})