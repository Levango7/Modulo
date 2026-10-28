import { describe, expect, it } from 'vitest'
import { DATA_KEYS } from '../../src/vue/fileStorage'
import {
  addProvider,
  AI_DOC_KEY,
  checkBaseUrl,
  checkDraft,
  keySaveOutcome,
  makeProviderId,
  mergeProbe,
  parseAiDoc,
  PROVIDER_KINDS,
  providerHost,
  removeProvider,
  serializeAiDoc,
  updateProvider,
  type AiProvider,
  type ProviderView,
} from '../../src/vue/aiSettings'

/**
 * AI 配置的纯函数层。
 *
 * 最要紧的一组是**地址判据**：它与 `src-tauri/src/ai/protocol.rs::validate_base_url` 走
 * 同一张表（黑名单直接复用 `@levango7/engine/watch` 的 `blockedReason`），所以这里的断言
 * 与 Rust 那组用例是同一批输入 —— 任一侧放宽，另一侧的单测不会跟着变，两边都得改才算过。
 */

const P = (over: Partial<AiProvider> = {}): AiProvider => ({
  id: 'p-1',
  kind: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o-mini',
  ...over,
})

describe('地址判据（与 Rust 同一张表）', () => {
  it('设计稿 §4 那张表的七行逐条对齐', () => {
    expect(checkBaseUrl('https://api.openai.com/v1')).toBeNull()
    expect(checkBaseUrl('https://')).toBe('模型服务地址缺少主机名')
    expect(checkBaseUrl('http://localhost:11434')).toBeNull()
    expect(checkBaseUrl('http://127.0.0.1:8080/v1')).toBeNull()
    expect(checkBaseUrl('http://ai.example.com')).toBe('明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https')
    expect(checkBaseUrl('ftp://x')).toBe('模型服务地址必须以 https:// 或 http:// 开头')
    expect(checkBaseUrl('api.example.com')).toBe('模型服务地址必须以 https:// 或 http:// 开头')
    // 本期新增的黑名单
    expect(checkBaseUrl('https://169.254.169.254/')).toContain('169.254')
    expect(checkBaseUrl('https://router.internal/')).toContain('internal')
  })

  it('本机豁免是"整个主机相等"，不是"包含这几个字"', () => {
    expect(checkBaseUrl('https://LOCALHOST:8443/v1')).toBeNull()
    expect(checkBaseUrl('https://[::1]:11434/v1')).toBeNull()
    // 公网域名里带 localhost 不能被误伤 —— 误伤边界等于逼用户绕过边界
    expect(checkBaseUrl('https://localhost.example.com/v1')).toBeNull()
    expect(checkBaseUrl('https://local.example.com/v1')).toBeNull()
  })

  it('私网与保留网段整片拒掉，理由能看懂', () => {
    for (const [url, hint] of [
      ['https://10.0.0.5/v1', '10/8'],
      ['https://192.168.1.10:8080/v1', '192.168'],
      ['https://172.20.1.1/v1', '172.16'],
      ['https://100.64.1.1/v1', '100.64'],
    ] as const) {
      const msg = checkBaseUrl(url)
      expect(msg, url).toContain(hint)
      expect(msg, url).toContain('模型服务要么是公网 https 地址，要么是本机地址')
    }
  })

  it('userinfo 改不了真正要连的主机', () => {
    // 实际主机是后面那个（云元数据端点），前面那截只是 rc
    expect(checkBaseUrl('https://evil.com@169.254.169.254/latest')).toContain('169.254')
    // 带 userinfo 的本机地址仍然放行
    expect(checkBaseUrl('http://user:pw@localhost:11434/v1')).toBeNull()
    // 畸形未闭合的 IPv6 也整段当主机看（Rust 的 extract_host 同处置），仍然是回环
    expect(checkBaseUrl('https://[::1')).toContain('本机回环')
  })

  it('空输入与大小写 scheme：结论与 Rust 一致（都拒）', () => {
    expect(checkBaseUrl('')).toBe('模型服务地址不能为空')
    expect(checkBaseUrl('   ')).toBe('模型服务地址不能为空')
    // Rust 的 strip_prefix 大小写敏感，前端放宽就会变成"前端放行、Rust 拒绝"
    expect(checkBaseUrl('HTTPS://api.example.com/v1')).toBe('模型服务地址必须以 https:// 或 http:// 开头')
  })

  it('表单校验：地址先过判据，模型名必填', () => {
    const draft = { kind: 'openai-compatible' as const, baseUrl: 'https://api.example.com/v1', model: '' }
    expect(checkDraft({ ...draft, baseUrl: 'http://ai.example.com' })).toContain('明文 http')
    expect(checkDraft(draft)).toBe('模型名不能为空（例如 gpt-4o-mini 或 qwen2.5:7b）')
    expect(checkDraft({ ...draft, model: 'gpt-4o-mini' })).toBeNull()
  })
})

describe('配置文档：不可信输入逐条清洗', () => {
  it('读不出东西时是空列表，不抛', () => {
    for (const raw of [null, '', '{oops', '[]', 'null', '{"providers":{}}', '{"providers":"x"}']) {
      expect(parseAiDoc(raw), String(raw)).toEqual([])
    }
  })

  it('缺字段兜底：kind → openai-compatible，地址/模型 → 空串', () => {
    expect(parseAiDoc('{"providers":[{"id":"a"}]}')).toEqual([
      { id: 'a', kind: 'openai-compatible', baseUrl: '', model: '' },
    ])
    // 不认识的 kind 也按同一个兜底（Rust 只把它当字符串转回去，不校验）
    expect(parseAiDoc('{"providers":[{"id":"a","kind":"anthropic","baseUrl":"x","model":"y"}]}')[0].kind).toBe(
      'openai-compatible',
    )
    expect(parseAiDoc('{"providers":[{"id":"a","kind":"ollama"}]}')[0].kind).toBe('ollama')
  })

  it('没有 id 的条目、重复 id 的后来者一律丢', () => {
    const raw = JSON.stringify({
      providers: [
        { id: '', baseUrl: 'https://a.example.com' },
        { id: 'dup', baseUrl: 'https://first.example.com', model: 'm1' },
        { id: 'dup', baseUrl: 'https://second.example.com', model: 'm2' },
        'not-an-object',
        { id: 'ok', baseUrl: 'https://ok.example.com', model: 'm3' },
      ],
    })
    expect(parseAiDoc(raw)).toEqual([
      { id: 'dup', kind: 'openai-compatible', baseUrl: 'https://first.example.com', model: 'm1' },
      { id: 'ok', kind: 'openai-compatible', baseUrl: 'https://ok.example.com', model: 'm3' },
    ])
  })

  it('序列化只写四个契约字段，往返一致', () => {
    const list = [P(), P({ id: 'p-2', kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' })]
    expect(parseAiDoc(serializeAiDoc(list))).toEqual(list)
    // 盘上多出来的键不该被带回去（Rust 的 ProviderCfg 只认这四个）
    const dirty = JSON.stringify({ providers: [{ id: 'a', kind: 'ollama', baseUrl: 'u', model: 'm', name: '旧版' }] })
    expect(JSON.parse(serializeAiDoc(parseAiDoc(dirty))).providers[0]).toEqual({
      id: 'a',
      kind: 'ollama',
      baseUrl: 'u',
      model: 'm',
    })
  })
})

describe('增删改与 id', () => {
  it('id 是 p-<36 进制毫秒>，同毫秒撞车加后缀', () => {
    expect(makeProviderId(0, [])).toBe('p-0')
    expect(makeProviderId(1_700_000_000_000, [])).toBe(`p-${(1_700_000_000_000).toString(36)}`)
    const taken = [P({ id: 'p-abc' }), P({ id: 'p-abc-2' })]
    expect(makeProviderId(parseInt('abc', 36), taken)).toBe('p-abc-3')
    // 负数/小数不炸，也不产出非法字符（密钥库只认小写/数字/连字符）
    expect(makeProviderId(-5, [])).toBe('p-0')
    expect(makeProviderId(1.9, [])).toBe('p-1')
  })

  it('增：地址与模型去首尾空格；不改原数组', () => {
    const before = [P()]
    const after = addProvider(before, 'p-new', { kind: 'ollama', baseUrl: '  http://localhost:11434 ', model: ' qwen2.5:7b ' })
    expect(before).toHaveLength(1)
    expect(after[1]).toEqual({
      id: 'p-new',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:7b',
    })
  })

  it('改：id 不变，找不到就原样返回', () => {
    const after = updateProvider([P()], 'p-1', { kind: 'ollama', baseUrl: ' http://127.0.0.1:11434 ', model: ' llama3 ' })
    expect(after).toEqual([
      { id: 'p-1', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'llama3' },
    ])
    expect(updateProvider([P()], 'nope', { kind: 'ollama', baseUrl: 'x', model: 'y' })).toEqual([P()])
  })

  it('删：删到空列表也不炸', () => {
    expect(removeProvider([P(), P({ id: 'p-2' })], 'p-1')).toEqual([P({ id: 'p-2' })])
    expect(removeProvider([], 'p-1')).toEqual([])
  })
})

describe('展示与探测结果', () => {
  it('列表那行字取地址里的主机名', () => {
    expect(providerHost('https://api.example.com/v1')).toBe('api.example.com')
    expect(providerHost('http://127.0.0.1:11434')).toBe('127.0.0.1')
    expect(providerHost('https://[::1]:8443/v1')).toBe('::1')
    expect(providerHost('https://LOCALHOST/v1')).toBe('localhost')
    expect(providerHost('api.example.com')).toBe('api.example.com')
    expect(providerHost('')).toBe('（未填地址）')
    expect(providerHost('https://')).toBe('（未填地址）')
  })

  it('ai_providers 的返回折成两张按 id 查的表', () => {
    const views: ProviderView[] = [
      { id: 'a', kind: 'ollama', baseUrl: 'u', model: 'm', keyConfigured: false, ready: true },
      { id: 'b', kind: 'openai-compatible', baseUrl: 'u', model: 'm', keyConfigured: true, ready: false },
    ]
    expect(mergeProbe(views)).toEqual({ ready: { a: true, b: false }, keys: { a: false, b: true } })
    expect(mergeProbe([])).toEqual({ ready: {}, keys: {} })
  })

  it('密钥草稿：空的不许保存，存成功后输入框清空', () => {
    expect(keySaveOutcome('')).toEqual({ ok: false, error: '密钥不能为空', draftAfter: '' })
    // 全是空白也算空，且草稿原样留着（用户还能接着改）
    expect(keySaveOutcome('   ')).toEqual({ ok: false, error: '密钥不能为空', draftAfter: '   ' })
    expect(keySaveOutcome('sk-test')).toEqual({ ok: true, error: null, draftAfter: '' })
  })
})

describe('契约与纪律', () => {
  it('文档名与 Rust 的 SETTINGS_DOC 一致，且已登记进 DATA_KEYS', () => {
    expect(AI_DOC_KEY).toBe('ai-settings.v1')
    // 漏登记的症状是"设置页写着三个服务、重启后一个都不见了"（`get` 只读启动时的镜像）
    expect(DATA_KEYS).toContain(AI_DOC_KEY)
    expect(PROVIDER_KINDS).toEqual(['openai-compatible', 'ollama'])
  })

  it('序列化里永远没有密钥 —— 它只经 ai_set_key 进凭据库', () => {
    const raw = serializeAiDoc([P()])
    expect(raw).not.toContain('key')
    expect(Object.keys(JSON.parse(raw).providers[0]).sort()).toEqual(['baseUrl', 'id', 'kind', 'model'])
  })
})
