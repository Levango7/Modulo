/**
 * `useMcpExecution` 的胶水层单测（J1 执行半）。
 *
 * 这一层不做什么判定，它的全部价值就三件事 —— **参数名对不对**、**状态什么时候改**、
 * **失败折成了哪句话**。所以下面钉的都是这三类的具体事实，不是"调用过"这种弱断言：
 *
 * ① `serverId` 而不是 `server_id`（Tauri 2 的 camelCase 映射；写错不报错，只是 Rust 取到
 *    None 然后说"这个服务已经不在配置里了" —— 最难查的那类病）；
 * ② `confirmed` 只由 `mcp_confirm` **成功**驱动，且幂等；`forget` 之后两样都清；
 * ③ 失败一律折成人话（`{ error }` / `skipped` / 抛一句人话），成功的结果不缓存到失败上。
 *
 * 环境手法照 `tests/vue/shell.test.ts`：`isDesktop` 在模块加载时求值，所以每个用例
 * `vi.resetModules()` + 动态 import，非桌面那条只需把 `window` 换成 `{}`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { MCP_OFFLINE, type McpExecutionApi } from '../../src/vue/useMcpExecution'
import type { McpServer } from '../../src/vue/mcp'

const server = (over: Partial<McpServer> = {}): McpServer => ({
  id: 's1',
  name: '文件服务',
  command: 'npx',
  args: ['-y', '@mcp/files'],
  enabled: true,
  ...over,
})

/** Rust `ToolsOut` 的线上形状（`Option` 一律序列化成 null），两条工具覆盖可选字段的两侧 */
const toolsOut = (serverId: string, notice: string | null = null) => ({
  tools: [
    {
      serverId,
      name: 'read_file',
      title: '读文件',
      description: null,
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    { serverId, name: 'list_dir', title: null, description: '列目录', inputSchema: { type: 'object' } },
  ],
  notice,
})

/** 每次一个**新模块实例**：`isDesktop` 是模块加载期常量，换环境必须先 resetModules */
async function make(): Promise<McpExecutionApi> {
  vi.resetModules()
  const { createMcpExecution } = await import('../../src/vue/useMcpExecution')
  return createMcpExecution()
}

const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd)

beforeEach(() => {
  // 默认桌面态：`__TAURI_INTERNALS__` 在 `window` 上 = 真壳（同 useShell 的判据）
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  invoke.mockReset()
})

describe('确认态：前端自持，只由 mcp_confirm 成功驱动', () => {
  it('confirm 传的是 { serverId } 而不是 { server_id }（camelCase 钉死）', async () => {
    invoke.mockResolvedValue(null)
    const api = await make()
    await expect(api.confirm(server())).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledWith('mcp_confirm', { serverId: 's1' })
    const sent = invoke.mock.calls[0][1] as Record<string, unknown>
    expect('server_id' in sent, 'snake_case 传过去 Rust 会取到 undefined').toBe(false)
  })

  it('确认成功才进 confirmed；失败返回要念给用户听的那句话，且不进', async () => {
    invoke.mockRejectedValueOnce('MCP 功能总开关关着，先在设置里打开')
    const api = await make()
    const msg = await api.confirm(server())
    expect(msg).toContain('总开关')
    expect(api.confirmed.value).toEqual([])
    expect(api.isConfirmed('s1')).toBe(false)

    invoke.mockResolvedValueOnce(null)
    await expect(api.confirm(server())).resolves.toBeNull()
    expect(api.confirmed.value).toEqual(['s1'])
    expect(api.isConfirmed('s1')).toBe(true)
  })

  it('重复 confirm 不重复入数组（幂等），但每次都真的问过后端', async () => {
    invoke.mockResolvedValue(null)
    const api = await make()
    await api.confirm(server())
    await api.confirm(server())
    await api.confirm(server({ id: 's2', name: '另一个服务' }))
    expect(api.confirmed.value).toEqual(['s1', 's2'])
    expect(calls('mcp_confirm')).toHaveLength(3)
  })
})

describe('listTools：补 serverName、透传 notice、只缓存成功', () => {
  it('条目补上传入服务的 name，serverId 与 inputSchema 照原样；notice 透传', async () => {
    invoke.mockResolvedValue(toolsOut('s1', '还有下一页工具，这一版只取第一页'))
    const api = await make()
    const r = await api.listTools(server({ name: '文件服务' }))
    if ('error' in r) throw new Error(r.error)
    expect(r.tools.map((t) => t.name)).toEqual(['read_file', 'list_dir'])
    expect(r.tools[0]).toMatchObject({
      serverId: 's1',
      serverName: '文件服务',
      title: '读文件',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    })
    // 线上是 null 的可选字段：折成「缺键」，别把 null 漏给 mergeToolLists
    expect(r.tools[0].description).toBeUndefined()
    expect(r.tools[1].title).toBeUndefined()
    expect(r.tools[1].description).toBe('列目录')
    expect(r.notice).toBe('还有下一页工具，这一版只取第一页')
  })

  it('没有 notice 时结果里就没有这个键（不是 notice: undefined）', async () => {
    invoke.mockResolvedValue(toolsOut('s1'))
    const api = await make()
    const r = await api.listTools(server())
    expect(r).not.toHaveProperty('notice')
  })

  it('第二次命中缓存：mcp_list_tools 只发过一次', async () => {
    invoke.mockResolvedValue(toolsOut('s1'))
    const api = await make()
    const a = await api.listTools(server())
    const b = await api.listTools(server())
    expect(calls('mcp_list_tools')).toHaveLength(1)
    expect(b).toEqual(a)
  })

  it('失败返回 { error } 且**不写缓存** —— 再点一次会重试，不是把故障钉住', async () => {
    invoke.mockRejectedValueOnce('列工具失败：子进程起不来（ENOENT）')
    const api = await make()
    const bad = await api.listTools(server())
    expect(bad).toEqual({ error: '列工具失败：子进程起不来（ENOENT）' })

    invoke.mockResolvedValueOnce(toolsOut('s1'))
    const good = await api.listTools(server())
    expect('error' in good).toBe(false)
    expect(calls('mcp_list_tools')).toHaveLength(2)
  })
})

describe('gather：只拉「已确认且 enabled」，失败折成 skipped 且不拖垮整批', () => {
  const three = [
    server(),
    server({ id: 's2', name: '停用的服务', enabled: false }),
    server({ id: 's3', name: '没确认的服务' }),
  ]

  it('未确认的一个都不拉；已停用的即使确认过也不拉', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'mcp_confirm' ? null : toolsOut('s1'),
    )
    const api = await make()
    await api.confirm(server()) // s1 确认
    await api.confirm(server({ id: 's2', name: '停用的服务', enabled: false })) // s2 确认但停用
    invoke.mockClear()
    invoke.mockResolvedValue(toolsOut('s1'))

    const g = await api.gather(three)
    expect(calls('mcp_list_tools').map((c) => (c[1] as { serverId: string }).serverId)).toEqual(['s1'])
    expect(g.entries.map((e) => e.serverName)).toEqual(['文件服务', '文件服务'])
    // 未确认 / 已停用是界面上已经写着的状态，不往 skipped 里重复念
    expect(g.skipped).toEqual([])
  })

  it('单个服务失败折成一条人话进 skipped，其它服务照常返回', async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'mcp_confirm') return null
      if (cmd === 'mcp_list_tools') {
        if (args?.serverId === 's2') throw new Error('列工具失败：握手超时')
        return toolsOut('s1')
      }
      return null
    })
    const api = await make()
    const a = server()
    const b = server({ id: 's2', name: '慢服务' })
    await api.confirm(a)
    await api.confirm(b)
    const g = await api.gather([a, b])
    expect(g.entries.every((e) => e.serverId === 's1')).toBe(true)
    expect(g.skipped).toHaveLength(1)
    expect(g.skipped[0]).toContain('慢服务')
    expect(g.skipped[0]).toContain('握手超时')
  })

  it('notice 也进 skipped（「没拿全」要如实说，不静默）', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'mcp_confirm' ? null : toolsOut('s1', '还有下一页工具，这一版只取第一页'),
    )
    const api = await make()
    const a = server()
    await api.confirm(a)
    const g = await api.gather([a])
    expect(g.entries).toHaveLength(2)
    expect(g.skipped[0]).toContain('文件服务')
    expect(g.skipped[0]).toContain('还有下一页工具')
  })
})

describe('callTool：args 一律给对象', () => {
  const okOut = { text: '读到了 3 行', isError: false, truncated: false, notice: null }

  it('省略 args 时传 {}，返回值折成前端形状（notice: null → 缺键）', async () => {
    invoke.mockResolvedValue(okOut)
    const api = await make()
    const r = await api.callTool('s1', 'read_file')
    expect(invoke).toHaveBeenCalledWith('mcp_call', { serverId: 's1', tool: 'read_file', args: {} })
    expect(r).toEqual({ text: '读到了 3 行', isError: false, truncated: false })
    expect(r).not.toHaveProperty('notice')
  })

  it('给了 args 就原样传（仍是对象），notice 透传，isError 是工具自己报的', async () => {
    invoke.mockResolvedValue({
      text: '路径不存在',
      isError: true,
      truncated: false,
      notice: '这一版只收文字结果，另有 1 项非文字内容未展示',
    })
    const api = await make()
    const r = await api.callTool('s1', 'read_file', { path: '/nope' })
    expect(invoke).toHaveBeenCalledWith('mcp_call', {
      serverId: 's1',
      tool: 'read_file',
      args: { path: '/nope' },
    })
    expect(r.isError).toBe(true)
    expect(r.notice).toContain('非文字内容')
  })
})

describe('forget：服务被删 / 停用 / 改命令时两样都清', () => {
  it('清掉确认态与清单缓存：再拉要重新问后端', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'mcp_confirm' ? null : toolsOut('s1'),
    )
    const api = await make()
    const a = server()
    await api.confirm(a)
    await api.listTools(a)
    expect(calls('mcp_list_tools')).toHaveLength(1)

    api.forget('s1')
    expect(api.isConfirmed('s1')).toBe(false)
    expect(api.confirmed.value).toEqual([])

    await api.listTools(a)
    expect(calls('mcp_list_tools'), '缓存没清就会拿旧清单喂模型').toHaveLength(2)
  })

  it('forget 只清那一个，别的服务照旧', async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === 'mcp_confirm' ? null : toolsOut('s1')))
    const api = await make()
    await api.confirm(server())
    await api.confirm(server({ id: 's2', name: '另一个服务' }))
    api.forget('s1')
    expect(api.confirmed.value).toEqual(['s2'])
  })
})

describe('非桌面：三条命令一条都不发，返回人话', () => {
  it('confirm / listTools / callTool / gather 都不 invoke', async () => {
    vi.stubGlobal('window', {}) // vite dev 与 E2E 的 Chrome 就是这样
    const api = await make()
    await expect(api.confirm(server())).resolves.toBe(MCP_OFFLINE)
    await expect(api.listTools(server())).resolves.toEqual({ error: MCP_OFFLINE })
    // 非桌面是**传输层**失败（连进程都没起），不能混进 isError 那条「工具跑了但失败」的通道
    await expect(api.callTool('s1', 'read_file')).rejects.toThrow(MCP_OFFLINE)
    await expect(api.gather([server()])).resolves.toEqual({ entries: [], skipped: [] })
    expect(invoke).not.toHaveBeenCalled()
  })
})
