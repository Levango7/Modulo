import { describe, expect, it } from 'vitest'
import { compareVersions, isNewer, pickUpdate, plainText } from '../../src/engine/update'

function release(over: Record<string, unknown> = {}) {
  return { tag_name: 'v0.3.0', html_url: 'https://github.com/Levango7/Modulo/releases/tag/v0.3.0', body: '', published_at: '2026-10-03T00:00:00Z', ...over }
}

describe('compareVersions：只比三段数字，不管后缀', () => {
  it('逐段比大小', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBe(1)
    expect(compareVersions('0.2.0', '0.3.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  })

  it('相同为 0', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
  })

  it('前缀与后缀都不影响判定：0.3.0-rc1 视为 0.3.0', () => {
    expect(compareVersions('0.3.0-rc1', '0.2.0')).toBe(1)
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0)
    expect(compareVersions('0.2.0+build7', '0.2.0')).toBe(0)
  })

  it('缺段按 0 补，垃圾段按 0 算而不是崩掉或当 Infinity', () => {
    expect(compareVersions('1', '0.0.1')).toBe(1)
    expect(compareVersions('0.2.x', '0.2.0')).toBe(0)
    expect(compareVersions('', '0.0.1')).toBe(-1)
  })

  it('isNewer 与 compare 口径一致', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.1', '0.2.0')).toBe(false)
  })
})

describe('pickUpdate：只有真的有新版才给东西', () => {
  it('有新版：给出 tag、地址与摘要', () => {
    const r = pickUpdate(release({ body: '## 新增\n- 大字时钟模板' }), '0.2.0')
    expect(r?.latest).toBe('0.3.0')
    expect(r?.url).toContain('/releases/tag/v0.3.0')
    expect(r?.notes).toContain('大字时钟模板')
  })

  it('已是最新：返回 null，不打扰用户', () => {
    expect(pickUpdate(release({ tag_name: 'v0.2.0' }), '0.2.0')).toBeNull()
  })

  it('比自己还旧（预发布缓存、用户装的是 dev 版）：返回 null', () => {
    expect(pickUpdate(release({ tag_name: 'v0.1.1' }), '0.2.0')).toBeNull()
  })

  it('拿不到 tag / 不是对象：一律 null，绝不把坏数据当新版', () => {
    expect(pickUpdate(null, '0.2.0')).toBeNull()
    expect(pickUpdate('字符串', '0.2.0')).toBeNull()
    expect(pickUpdate({}, '0.2.0')).toBeNull()
    expect(pickUpdate({ tag_name: '' }, '0.2.0')).toBeNull()
  })

  it('没有 tag_name 时退化看 name', () => {
    expect(pickUpdate({ name: 'v0.4.0' }, '0.2.0')?.latest).toBe('0.4.0')
  })

  it('html_url 不是 https 就退回仓库发布页，不把任意地址当下载链接', () => {
    const evil = pickUpdate(release({ html_url: 'javascript:alert(1)' }), '0.2.0')
    expect(evil?.url).toBe('https://github.com/Levango7/Modulo/releases')
    const http = pickUpdate(release({ html_url: 'http://example.com/x' }), '0.2.0')
    expect(http?.url).toBe('https://github.com/Levango7/Modulo/releases')
  })

  it('摘要只取纯文本前 200 字：markdown 不进界面', () => {
    const long = 'x'.repeat(500)
    const r = pickUpdate(release({ body: `**加粗** [链接](https://a.b) \`code\` ${long}` }), '0.2.0')
    expect(r?.notes.length).toBeLessThanOrEqual(200)
    expect(r?.notes).not.toContain('**')
    expect(r?.notes).not.toContain('](')
  })
})

describe('plainText：markdown → 一行纯文本', () => {
  it('去掉标题、列表、强调、代码块与链接', () => {
    expect(plainText('## 标题\n- **要点一**\n- [链接](https://x.y)\n`code`')).toBe('标题 要点一 链接 code')
  })

  it('代码块整块丢掉，不留里面的话', () => {
    expect(plainText('前\n```\nsecret()\n```\n后')).toBe('前 后')
  })

  it('HTML 标签去掉（远端内容不可信）', () => {
    expect(plainText('<img src=x onerror=1>文字')).toBe('文字')
  })

  it('多余空白压成一个空格', () => {
    expect(plainText('a\n\n\n  b   c')).toBe('a b c')
  })
})
