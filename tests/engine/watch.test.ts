import { describe, expect, it } from 'vitest'
import { blockedReason, ipv6Bytes, normalizeWatchLabel, normalizeUrl, sanitizeWatch, MAX_WATCH } from '@modulo/engine/watch'

/**
 * 边界就是这张卡全部的承诺，所以这些断言盯的就是边界本身。
 * 每一类私网地址背后都是一个真实用途或真实攻击面。
 */
describe('normalizeUrl：只收 https', () => {
  it('明文 http 一律拒绝', () => {
    expect(normalizeUrl('http://example.com/')).toBeNull()
    expect(normalizeUrl('HTTP://example.com/')).toBeNull()
  })

  it('其他协议也别想混进来', () => {
    for (const bad of [
      'ftp://example.com/',
      'file:///C:/Windows/System32/',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ws://example.com/',
    ]) {
      expect(normalizeUrl(bad), bad).toBeNull()
    }
  })

  it('无 scheme 的按 https 补齐（用户敲 example.com 是常态）', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl('  example.com/path  ')).toBe('https://example.com/path')
  })

  it('含空白的一律拒绝 —— 那能被拿去伪装主机名', () => {
    expect(normalizeUrl('evil.com\t@127.0.0.1')).toBeNull()
    expect(normalizeUrl('example.com/a b')).toBeNull()
  })

  it('userinfo 会把凭据带进备份，不要', () => {
    expect(normalizeUrl('https://user:pass@example.com/')).toBeNull()
  })
})

describe('blockedReason：私有与保留网段', () => {
  const bad = [
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254', // 云实例元数据端点 = 临时凭据
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf:ffff::1',
    '::ffff:127.0.0.1', // IPv4-mapped 绕过
  ]
  it.each(bad)('%s 应当被拒', (ip) => {
    expect(blockedReason(ip), ip).not.toBeNull()
    expect(normalizeUrl(`https://${ip}/`), ip).toBeNull()
  })

  /** 上下沿之外必须放行，否则会误伤正常公网地址 */
  const ok = [
    '172.15.0.1',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '11.0.0.1',
    '1.1.1.1',
    '2606:4700::1111',
    'fec0::1', // fe80::/10 的后一格
    'fbff::1', // fc00::/7 的上沿后一格
  ]
  it.each(ok)('%s 应当放行', (ip) => {
    expect(blockedReason(ip), ip).toBeNull()
  })

  it('域名不走 IP 判定 —— DNS rebinding 明确不防', () => {
    expect(blockedReason('localhost')).toBeNull()
    expect(blockedReason('router.local')).toBeNull()
    expect(blockedReason('metadata.google.internal')).toBeNull()
    expect(normalizeUrl('https://1.1.1.1.example.com/')).not.toBeNull()
  })
})

describe('sanitizeWatch：导入备份时的边界', () => {
  it('夹带的私网地址被丢掉并计数', () => {
    const r = sanitizeWatch([
      { url: 'https://ok.example.com/' },
      { url: 'https://127.0.0.1/' },
      { url: 'http://明文.example.com/' },
      { url: 'https://169.254.169.254/' },
    ])
    expect(r.watch.map((w) => w.url)).toEqual(['https://ok.example.com/'])
    expect(r.rejected).toBe(3)
  })

  it('去重，且按上限截断', () => {
    const many = Array.from({ length: MAX_WATCH + 5 }, (_, i) => ({ url: `https://e${i}.example.com/` }))
    expect(sanitizeWatch(many).watch).toHaveLength(MAX_WATCH)
    const dup = sanitizeWatch([
      { url: 'https://a.example.com/' },
      { url: 'https://a.example.com/' },
    ])
    expect(dup.watch).toHaveLength(1)
  })

  it('不是字符串的 url 也算被拒，不该让导入崩掉', () => {
    const r = sanitizeWatch([{ url: 123 }, { url: null }, { url: 'https://ok.example.com/' }] as never)
    expect(r.watch).toHaveLength(1)
    expect(r.rejected).toBe(2)
  })

  it('规范化后的 url 超长就整个不收 —— 备份里塞一个巨长的字符串没有意义', () => {
    expect(normalizeUrl(`https://e.example.com/${'a'.repeat(400)}`)).toBeNull()
  })

  it('带 id 的条目保留 id，label 不是字符串时取主机名', () => {
    const r = sanitizeWatch([
      { id: 'custom-id', url: 'https://a.example.com/' },
      { id: 123, url: 'https://b.example.com/', label: 456 } as never,
    ])
    expect(r.watch[0].id).toBe('custom-id')
    expect(r.watch[1].id).toBe('https://b.example.com/')
    expect(r.watch[1].label).toBe('b.example.com')
  })

  it('标签留空时取主机名', () => {
    const r = sanitizeWatch([{ url: 'https://status.example.com/x' }])
    expect(r.watch[0].label).toBe('status.example.com')
    expect(normalizeWatchLabel('  我的服务  ', 'https://x.example.com/')).toBe('我的服务')
  })

  /** 标签截断与兜底：url 坏掉时不能跟着崩，label 至少要有个能显示的东西 */
  it('标签会被截断，url 坏掉时回落到「未命名」', () => {
    expect(normalizeWatchLabel('x'.repeat(50), 'https://a.example.com/')).toHaveLength(24)
    expect(normalizeWatchLabel('', '这不是一个 url')).toBe('未命名')
  })
})

describe('ipv6Bytes：解析不了就返回 null，而不是给个错的字节数', () => {
  it('展开 :: 简写', () => {
    expect(ipv6Bytes('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(ipv6Bytes('2001:db8::1')?.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8])
  })

  it('尾部内嵌 IPv4 会转成两组十六进制', () => {
    expect(ipv6Bytes('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1])
  })

  it('各种坏的写法一律 null，而不是半展开的字节', () => {
    for (const bad of [
      'zz::1', // 非法十六进制
      '1:2:3:4:5:6:7', // 组数不够又没写 ::
      '1:2:3:4:5:6:7:8:9', // 组数超了
      '1::2::3', // 两个 ::
      '1:2:3:4:5:6:7:12345', // 单组超过 4 位
      '::ffff:999.1.1.1', // IPv4 段越界
      'not-an-ip',
      '1.2.3.4',
    ]) {
      expect(ipv6Bytes(bad), bad).toBeNull()
    }
  })
})