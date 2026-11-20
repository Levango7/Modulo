/**
 * `useMcp` 的胶水层单测（backlog ①「composable 层补测」第三十三笔）。
 *
 * 判定层（`mcp.ts` / `mcpCore.ts` / `mcpDoc.ts`）已有独立测试，这里**不重复测判定** ——
 * 只钉「必须活在 composable 里」的那几条：
 * ① 总开关与服务器列表是**同一份文档、同一个键**：拨完 gate 再做增删改不会把 gate 写丢；
 * ② 构造时只读档一次（种子必须在 `createMcp` 之前写进去），坏档不抛；
 * ③ add / update 失败把判定层的文案**原样**回传，且一次空写都不做；
 * ④ remove / toggle 无条件 save —— 连「设成同一个值」也写盘（按源码实际行为断言，不猜）。
 *
 * 夹具照 `useCron.test.ts` 前 60 行：`memoryStorage()` 给内存实现；这里多包一层 `vi.fn`
 * 计数并记下所有写过的键 —— 「写没写盘 / 写了几个键」光看最后内容是看不出来的。
 */
import { describe, expect, it, vi } from 'vitest'
import { memoryStorage, type StorageAdapter } from '../../src/vue/store'
import { MCP_DOC_KEY, serializeServers, validateDraft, type McpDraft, type McpServer } from '../../src/vue/mcp'
import { createMcp } from '../../src/vue/useMcp'

const draft = (over: Partial<{ name: string; command: string; args: string }> = {}): McpDraft => ({
  name: '文件',
  command: 'npx',
  args: '-y @modelcontextprotocol/server-filesystem',
  ...over,
})

const server = (over: Partial<McpServer> = {}): McpServer => ({
  id: 's1',
  name: '文件',
  command: 'npx',
  args: ['-y', 'server-filesystem'],
  enabled: true,
  ...over,
})

/** 带 set 调用记录的 storage：既能读回盘上内容，也能数「写了几次 / 写了哪几个键」。 */
function spyStorage(seed?: string) {
  const inner = memoryStorage()
  if (seed !== undefined) inner.set(MCP_DOC_KEY, seed)
  const set = vi.fn((key: string, value: string) => inner.set(key, value))
  const storage: StorageAdapter = { get: inner.get, set }
  return { storage, set, read: () => inner.get(MCP_DOC_KEY) }
}

describe('useMcp：总开关与列表共用一份文档', () => {
  it('构造时读档：种子必须在 createMcp 之前写入，servers 与 gate 从同一份文档读出', () => {
    const { storage } = spyStorage(serializeServers([server({ name: '种下的' })], true))
    const mcp = createMcp(storage)
    expect(mcp.servers.value.map((s) => s.name)).toEqual(['种下的'])
    expect(mcp.gate.value).toBe(true)
  })

  it('setGate 立即落盘：gate 与 servers 写进同一个键、形状齐全，不另开一把键', () => {
    const { storage, set, read } = spyStorage()
    const mcp = createMcp(storage)
    expect(mcp.add(draft())).toBeNull()
    set.mockClear()
    mcp.setGate(false)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls.map((c) => c[0])).toEqual([MCP_DOC_KEY])
    const doc = JSON.parse(read()!)
    expect(doc).toMatchObject({ version: 1, gate: false })
    expect(doc.servers).toHaveLength(1)
    expect(doc.servers[0].name).toBe('文件')
  })

  it('拨完 gate 再 add：落盘仍带着刚拨的值，不被「按启用条目推导」顶回 true', () => {
    const { storage, read } = spyStorage()
    const mcp = createMcp(storage)
    expect(mcp.add(draft())).toBeNull()
    mcp.setGate(false)
    expect(mcp.add(draft({ name: '第二个' }))).toBeNull()
    const doc = JSON.parse(read()!)
    expect(doc.gate).toBe(false)
    expect(doc.servers).toHaveLength(2)
    expect(doc.servers.map((s: McpServer) => s.name)).toEqual(['文件', '第二个'])
  })

  it('remove 之后 gate 与 servers 仍在同一份文档里，gate 不随删除丢失', () => {
    const { storage, read } = spyStorage()
    const mcp = createMcp(storage)
    mcp.add(draft())
    mcp.setGate(false)
    mcp.remove('s1')
    expect(mcp.servers.value).toEqual([])
    expect(JSON.parse(read()!)).toMatchObject({ gate: false, servers: [] })
  })
})

describe('useMcp：读档容错与总开关两条路径', () => {
  it('坏档不抛：坏 JSON 落成空列表 + 总开关关', () => {
    const { storage } = spyStorage('{oops')
    expect(() => createMcp(storage)).not.toThrow()
    const mcp = createMcp(storage)
    expect(mcp.servers.value).toEqual([])
    expect(mcp.gate.value).toBe(false)
  })

  it('盘上显式 bool 优先：gate: false 即使有启用条目也保持关', () => {
    const { storage } = spyStorage(serializeServers([server({ enabled: true })], false))
    expect(createMcp(storage).gate.value).toBe(false)
  })

  it.each([
    { label: '有启用条目', list: [server({ enabled: true })], want: true },
    { label: '全部停用', list: [server({ enabled: false })], want: false },
    { label: '空列表', list: [], want: false },
  ])('盘上缺 gate（老档）时按启用条目推导：$label ⇒ $want', ({ list, want }) => {
    const seed = JSON.stringify({ version: 1, servers: list })
    const { storage } = spyStorage(seed)
    expect(createMcp(storage).gate.value).toBe(want)
  })
})

describe('useMcp：失败文案如实回传且不空写盘', () => {
  it.each([
    { label: '名字空', bad: draft({ name: '   ' }) },
    { label: '命令含换行', bad: draft({ command: 'npx\r\nwhoami' }) },
    { label: '参数含全角空格', bad: draft({ args: '-y\u3000server' }) },
    { label: '参数超过 12 个', bad: draft({ args: Array.from({ length: 13 }, (_, i) => `a${i}`).join(' ') }) },
  ])('add 失败（$label）：原样回传判定层文案，且一次都不写盘', ({ bad }) => {
    const { storage, set, read } = spyStorage()
    const mcp = createMcp(storage)
    const expected = validateDraft(bad)
    expect(expected.ok).toBe(false)
    const err = mcp.add(bad)
    expect(err).toBe(expected.ok ? null : expected.error)
    expect(err).not.toBeNull()
    expect(read()).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })

  it('update 失败：文案如实回传，盘上文档一字不变', () => {
    const before = serializeServers([server()], true)
    const { storage, read } = spyStorage(before)
    const mcp = createMcp(storage)
    const err = mcp.update('s1', draft({ name: '' }))
    expect(err).toContain('起个名字')
    expect(read()).toBe(before)
  })
})

describe('useMcp：无条件落盘的两种操作', () => {
  it('toggle 设成同一个值也写盘（源码无条件 save，按实际行为钉住）', () => {
    const { storage, set, read } = spyStorage()
    const mcp = createMcp(storage)
    expect(mcp.add(draft())).toBeNull()
    expect(mcp.servers.value[0]!.enabled).toBe(true)
    set.mockClear()
    mcp.toggle('s1', true)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(MCP_DOC_KEY, expect.any(String))
    expect(JSON.parse(read()!).servers[0].enabled).toBe(true)
  })

  it('toggle 改值时同样写盘，且 gate 跟着一起落到同一份文档', () => {
    const { storage, read } = spyStorage()
    const mcp = createMcp(storage)
    mcp.add(draft())
    mcp.setGate(true)
    mcp.toggle('s1', false)
    const doc = JSON.parse(read()!)
    expect(doc.gate).toBe(true)
    expect(doc.servers[0].enabled).toBe(false)
  })
})
