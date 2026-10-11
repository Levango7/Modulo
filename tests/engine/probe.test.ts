import { describe, expect, it } from 'vitest'
import { PROBE_WINDOW, probeLevel, probeStats, pushSample, sanitizeProbes, sanitizeSamples } from '../../packages/engine/src/probe'

describe('pushSample：环形窗口', () => {
  it('追加并封顶：超窗砍最老的', () => {
    let w: ReturnType<typeof pushSample> = []
    for (let i = 0; i < PROBE_WINDOW + 5; i += 1) w = pushSample(w, { at: i, ms: 10 + i })
    expect(w).toHaveLength(PROBE_WINDOW)
    expect(w[0].at).toBe(5) // 最老的 5 个被砍掉
    expect(w[w.length - 1].at).toBe(PROBE_WINDOW + 4)
  })
  it('ms 负数/坏值按 0（失败样本），at 截整', () => {
    const w = pushSample([], { at: 1234.7, ms: -3 })
    expect(w).toEqual([{ at: 1234, ms: 0 }])
  })
})

describe('probeStats：统计', () => {
  it('空窗口全 0（界面显示还没探过，而不是 NaN）', () => {
    expect(probeStats([])).toEqual({ count: 0, okCount: 0, latest: 0, avg: 0, worst: 0 })
  })
  it('0ms 是失败样本：不计入延迟均值，但计入 count', () => {
    const s = probeStats([
      { at: 1, ms: 100 },
      { at: 2, ms: 0 },
      { at: 3, ms: 200 },
    ])
    expect(s).toEqual({ count: 3, okCount: 2, latest: 200, avg: 150, worst: 200 })
  })
  it('全是失败样本：avg/worst 给 0 不给 NaN', () => {
    const s = probeStats([
      { at: 1, ms: 0 },
      { at: 2, ms: 0 },
    ])
    expect(s.avg).toBe(0)
    expect(s.worst).toBe(0)
  })
})

describe('probeLevel：延迟分档', () => {
  it('0/坏值 = down；<150 fast；<400 ok；其余 slow', () => {
    expect(probeLevel(0)).toBe('down')
    expect(probeLevel(-1)).toBe('down')
    expect(probeLevel(45)).toBe('fast')
    expect(probeLevel(200)).toBe('ok')
    expect(probeLevel(800)).toBe('slow')
  })
})

describe('sanitizeSamples：历史清洗', () => {
  it('形状不对的丢、封顶、非法 ms 丢', () => {
    const out = sanitizeSamples([
      { at: 1, ms: 20 },
      null,
      'x',
      { at: 2, ms: -5 },
      { at: 3, ms: 30.6 },
      { at: 'x', ms: 10 },
    ])
    expect(out).toEqual([
      { at: 1, ms: 20 },
      { at: 3, ms: 31 },
    ])
  })
  it('非数组 / 坏 localStorage 给空表', () => {
    expect(sanitizeSamples(null)).toEqual([])
    expect(sanitizeSamples('x')).toEqual([])
    expect(sanitizeSamples(42)).toEqual([])
  })
})

describe('sanitizeProbes：端点名单（与 watch 同一条边界）', () => {
  it('合规 https 保留、空名用主机名、按名字排序', () => {
    const out = sanitizeProbes([
      { id: 'p1', label: '', url: 'https://api.example.com/health' },
      { id: 'p2', label: 'B 服务', url: 'https://b.test' },
      { id: 'p3', label: 'A 服务', url: 'https://a.test' },
    ])
    expect(out.map((p) => p.label)).toEqual(['A 服务', 'api.example.com', 'B 服务']) // localeCompare zh-Hans 的实际序
    expect(out[1].url).toBe('https://api.example.com/health')
  })
  it('私网 / 明文 http 进不了名单（导入别人备份时同样生效）', () => {
    expect(sanitizeProbes([{ url: 'http://a.test' }, { url: 'https://127.0.0.1/' }, { url: 'https://169.254.169.254/' }, { url: 'https://192.168.1.1/' }])).toEqual([])
  })
  it('去重（同 URL 只留一条）与封顶', () => {
    const dup = sanitizeProbes([{ label: '同', url: 'https://a.test' }, { label: '不同名', url: 'https://a.test' }])
    expect(dup).toHaveLength(1)
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `端点${i}`, url: `https://h${i}.test` }))
    expect(sanitizeProbes(many)).toHaveLength(12)
  })
})
