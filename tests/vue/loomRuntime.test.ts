import { describe, expect, it } from 'vitest'
import {
  humanBytes,
  mcpConfigSnippet,
  parseLoomManifest,
  planPaths,
  safeLoomDashboardUrl,
  verifyDigest,
  versionChoices,
} from '../../src/vue/loomRuntime'

/** 一条合法的清单（字段全齐） */
const good = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    version: 'v0.1.0',
    url: 'https://example.com/loom-runtime-v0.1.0.tar.bz2',
    sha256: 'a'.repeat(64),
    bytes: 70 * 1024 * 1024,
    note: '核心集',
    ...over,
  })

describe('织布机运行时：清单清洗（β1）', () => {
  it('合法清单逐字回来；空 / 坏 JSON / 非对象 ⇒ null（设置页显示「还没配清单」）', () => {
    const m = parseLoomManifest(good())
    expect(m).toEqual({
      version: 'v0.1.0',
      url: 'https://example.com/loom-runtime-v0.1.0.tar.bz2',
      sha256: 'a'.repeat(64),
      bytes: 70 * 1024 * 1024,
      note: '核心集',
    })
    for (const raw of [null, '', 'not-json', '[]', '42', '"x"']) expect(parseLoomManifest(raw)).toBeNull()
  })

  it('schemaVersion 必须恰好是 1（0 / 2 / 缺 ⇒ null），不许兼容未声明的形状', () => {
    expect(parseLoomManifest(good({ schemaVersion: 0 }))).toBeNull()
    expect(parseLoomManifest(good({ schemaVersion: 2 }))).toBeNull()
    expect(parseLoomManifest(good({ schemaVersion: '1' }))).toBeNull()
    const { schemaVersion: _drop, ...rest } = JSON.parse(good())
    expect(parseLoomManifest(JSON.stringify(rest))).toBeNull()
  })

  it('url 只认 http(s)（ftp / 空 / 相对路径一律拒），sha256 只认 64 位小写 hex', () => {
    expect(parseLoomManifest(good({ url: 'ftp://example.com/x' }))).toBeNull()
    expect(parseLoomManifest(good({ url: 'loom.tar.bz2' }))).toBeNull()
    expect(parseLoomManifest(good({ url: '' }))).toBeNull()
    expect(parseLoomManifest(good({ sha256: 'a'.repeat(63) }))).toBeNull()
    expect(parseLoomManifest(good({ sha256: 'A'.repeat(64) }))).toBeNull()
    expect(parseLoomManifest(good({ sha256: 'z'.repeat(64) }))).toBeNull()
    expect(parseLoomManifest(good({ sha256: 42 }))).toBeNull()
  })

  it('版本名守卫：`..` / 分隔符 / 点开头 / 超 32 字符一律拒（这就是路径穿越面）', () => {
    for (const v of ['..', 'a/b', 'a\\b', '.hidden', '', 'a'.repeat(33)]) {
      expect(parseLoomManifest(good({ version: v }))).toBeNull()
    }
  })

  it('bytes / note 是可选的：缺了不补默认值，给了非法值也拒绝兜底', () => {
    const m = parseLoomManifest(good({ bytes: undefined, note: undefined }))
    expect(m).toEqual({ version: 'v0.1.0', url: 'https://example.com/loom-runtime-v0.1.0.tar.bz2', sha256: 'a'.repeat(64) })
  })
})

describe('织布机运行时：路径规划与校验', () => {
  it('planPaths：part / staging / dest / meta 各司其职；尾随分隔符不再多一个', () => {
    const p = planPaths('C:/loom/', 'v0.1.0')
    expect(p).toEqual({
      part: 'C:/loom/.part-v0.1.0.tar.bz2',
      staging: 'C:/loom/.staging-v0.1.0',
      dest: 'C:/loom/v0.1.0',
      meta: 'C:/loom/loom.json',
    })
    const q = planPaths('C:/loom', 'v0.1.0')
    expect(q?.dest).toBe('C:/loom/v0.1.0')
    // Windows 风格根（没有 `/`）：分隔符回落 `\\` —— 这是唯一一个没被默认形态覆盖的分支
    const win = planPaths('C:\\loom', 'v0.1.0')
    expect(win?.dest).toBe('C:\\loom\\v0.1.0')
    expect(win?.meta).toBe('C:\\loom\\loom.json')
    // 版本名越界 ⇒ null（与 parseLoomManifest 同一条守卫）
    for (const v of ['..', 'a/b', 'a\\b', '']) expect(planPaths('C:/loom', v)).toBeNull()
    expect(planPaths('', 'v0.1.0')).toBeNull()
  })

  it('verifyDigest：一致 ⇒ null；不一致 ⇒ 人话含双方前 8 位；坏 sha 也报得出来', () => {
    expect(verifyDigest('a'.repeat(64), 'a'.repeat(64))).toBeNull()
    const bad = verifyDigest('b'.repeat(64), 'a'.repeat(64))
    expect(bad).toContain('校验和不一致')
    expect(bad).toContain('期望 aaaaaaaa…')
    expect(bad).toContain('实得 bbbbbbbb…')
    expect(verifyDigest('a'.repeat(64), 'x')).toContain('清单里的 sha256')
    expect(verifyDigest('x', 'a'.repeat(64))).toContain('下载件的 sha256')
  })
})

describe('织布机运行时：版本回退与展示', () => {
  it('versionChoices：当前在用的那一版不可删；其余可删；非法目录名被滤掉', () => {
    const list = versionChoices(['v0.1.0', 'v0.0.9', '.part-x', '..', 'v0.2.0'], 'v0.1.0')
    expect(list.map((x) => x.version)).toEqual(['v0.0.9', 'v0.1.0', 'v0.2.0'])
    expect(list.find((x) => x.version === 'v0.1.0')?.removable).toBe(false)
    expect(list.find((x) => x.version === 'v0.1.0')?.current).toBe(true)
    expect(list.find((x) => x.version === 'v0.0.9')?.removable).toBe(true)
  })

  it('mcpConfigSnippet：只有 command + args（Modulo MCP 配置没有 cwd），JSON 可解析且路径含空格不炸', () => {
    const raw = mcpConfigSnippet('C:/loom/v0.1.0/python/python.exe', 'C:/loom/v0.1.0/run-mcp.py')
    const o = JSON.parse(raw) as { command: string; args: string[]; cwd?: string }
    expect(o.command).toBe('C:/loom/v0.1.0/python/python.exe')
    expect(o.args).toEqual(['C:/loom/v0.1.0/run-mcp.py'])
    expect(o.cwd).toBeUndefined()
    const win = mcpConfigSnippet('D:\\Program Files (x86)\\loom\\python.exe', 'D:\\loom\\run-mcp.py')
    expect(JSON.parse(win).command).toContain('Program Files (x86)')
  })

  it('humanBytes：B / KiB / MiB 三档，最多一位小数；非法值不编一个数', () => {
    expect(humanBytes(512)).toBe('512 B')
    expect(humanBytes(2048)).toBe('2.0 KiB')
    expect(humanBytes(70 * 1024 * 1024)).toBe('70.0 MiB')
    expect(humanBytes(-1)).toBe('?')
    expect(humanBytes(Number.NaN)).toBe('?')
  })
})

describe('织布机交付面板：iframe URL 边界（β2）', () => {
  it('只接受显式端口的本机回环 HTTP 根地址；其他协议、主机、路径与凭据一律拒', () => {
    expect(safeLoomDashboardUrl('http://127.0.0.1:8910/')).toBe('http://127.0.0.1:8910/')
    expect(safeLoomDashboardUrl('http://127.0.0.1:8910')).toBe('http://127.0.0.1:8910/')
    for (const bad of [
      null,
      undefined,
      '',
      'https://127.0.0.1:8910/',
      'http://localhost:8910/',
      'http://127.0.0.2:8910/',
      'http://user:pass@127.0.0.1:8910/',
      'http://127.0.0.1/',
      'http://127.0.0.1:0/',
      'http://127.0.0.1:65536/',
      'http://127.0.0.1:8910/tasks',
      'http://127.0.0.1:8910/?x=1',
      'http://127.0.0.1:8910/#x',
      'javascript:alert(1)',
    ]) {
      expect(safeLoomDashboardUrl(bad), String(bad)).toBeNull()
    }
  })
})
