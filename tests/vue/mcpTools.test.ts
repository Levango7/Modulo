/**
 * 「MCP 工具消费」纯函数层的钉子（第二十七笔）。
 *
 * 输入是**服务端返回 + 模型的调用名** —— 都不是本仓能控制的形状。测的重点：
 * 合并（撞名 / 非法名 / 坏 schema / 超帽全 skip 且说人话）、分流（本地 / MCP / 未知名
 * 三分）、回喂（成功 / 失败 / 截断 / notice 各自的人话形状）。
 */
import { describe, expect, it } from 'vitest'
import {
  MCP_RESULT_MAX,
  MCP_TOOLS_MAX,
  MCP_TOOL_NAME_RE,
  mcpResultLine,
  mergeToolLists,
  routeToolCall,
  type McpToolEntry,
} from '../../src/vue/mcpTools'
import type { ToolSpecLite } from '../../src/vue/aiActions'

const local = (name: string): ToolSpecLite => ({
  name,
  description: `内置 ${name}`,
  parameters: { type: 'object', properties: {} },
})

const mcp = (over: Partial<McpToolEntry> = {}): McpToolEntry => ({
  serverId: 's1',
  serverName: '示例服务',
  name: 'get_weather',
  description: '查天气',
  inputSchema: { type: 'object', properties: {} },
  ...over,
})

describe('MCP 工具消费：清单合并', () => {
  it('合法工具折成 ToolSpecLite 追加在本地之后（本地保序），索引可路由', () => {
    const r = mergeToolLists([local('todo_add'), local('context_read')], [
      mcp(),
      mcp({ serverId: 's2', serverName: '另一服务', name: 'list_notes', title: '列便签', description: undefined }),
    ])
    expect(r.tools).toHaveLength(4)
    expect(r.tools[0]).toEqual(local('todo_add'))
    expect(r.tools[1]).toEqual(local('context_read'))
    expect(r.tools[2]).toEqual({
      name: 'get_weather',
      description: '查天气',
      parameters: { type: 'object', properties: {} },
    })
    expect(r.tools[3].description).toBe('列便签')
    expect(r.skipped).toEqual([])
    expect(r.index.get('get_weather')).toBe('s1')
    expect(r.index.get('list_notes')).toBe('s2')
  })

  it('title + description 拼接；只给其一时用那一个；都空 / 纯空白走兜底文案', () => {
    const r = mergeToolLists([], [
      mcp({ name: 'a1', title: '标题', description: '说明' }),
      mcp({ name: 'a2', title: undefined, description: '只有说明' }),
      mcp({ name: 'a3', title: '只有标题', description: undefined }),
      mcp({ name: 'a4', title: undefined, description: undefined }),
      mcp({ name: 'a5', title: '   ', description: '  ' }),
    ])
    expect(r.tools.map((t) => t.description)).toEqual([
      '标题：说明',
      '只有说明',
      '只有标题',
      '（该服务未提供工具说明）',
      '（该服务未提供工具说明）',
    ])
    expect(r.skipped).toEqual([])
  })

  it('非法名 / 撞本地 / 彼此撞名 / 坏 schema，各自 skip 并说人话（合法的照收）', () => {
    const r = mergeToolLists([local('todo_add')], [
      mcp({ name: '查天气', serverName: '甲' }),
      mcp({ name: 'todo_add', serverName: '乙' }),
      mcp({ name: 'dup', serverId: 's1', serverName: '丙' }),
      mcp({ name: 'dup', serverId: 's2', serverName: '丁' }),
      mcp({ name: 'bad_schema', inputSchema: [1, 2] }),
      mcp({ name: 'null_schema', inputSchema: null }),
      mcp({ name: 'str_schema', inputSchema: '{}', serverName: '戊' }),
    ])
    expect(r.skipped).toEqual([
      '「查天气」（服务「甲」）没有列：工具名只能用字母 / 数字 / 下划线 / 连字符（≤ 64 字）',
      '「todo_add」（服务「乙」）没有列：与内置工具撞名（内置的优先）',
      '「dup」没有列：多个服务提供了同名工具（先列的优先）',
      '「bad_schema」（服务「示例服务」）没有列：inputSchema 不是对象',
      '「null_schema」（服务「示例服务」）没有列：inputSchema 不是对象',
      '「str_schema」（服务「戊」）没有列：inputSchema 不是对象',
    ])
    expect(r.tools.map((t) => t.name)).toEqual(['todo_add', 'dup'])
    expect(r.index.get('dup')).toBe('s1')
  })

  it('数量帽：恰好在帽上收，第 MCP_TOOLS_MAX + 1 个合法工具被 skip', () => {
    const many = Array.from({ length: MCP_TOOLS_MAX + 1 }, (_, i) => mcp({ name: `t_${i}` }))
    const r = mergeToolLists([], many)
    expect(r.tools).toHaveLength(MCP_TOOLS_MAX)
    expect(r.index.size).toBe(MCP_TOOLS_MAX)
    expect(r.skipped).toEqual([
      `「t_${MCP_TOOLS_MAX}」（服务「示例服务」）没有列：MCP 工具总数已到上限 ${MCP_TOOLS_MAX}`,
    ])
  })

  it('名字正则边界：64 字过、65 字拒、大写 / 连字符 / 下划线 / 数字过、中文拒', () => {
    expect(MCP_TOOL_NAME_RE.test('a'.repeat(64))).toBe(true)
    expect(MCP_TOOL_NAME_RE.test('a'.repeat(65))).toBe(false)
    expect(MCP_TOOL_NAME_RE.test('A-b_9')).toBe(true)
    expect(MCP_TOOL_NAME_RE.test('查天气')).toBe(false)
  })
})

describe('MCP 工具消费：调用分流', () => {
  it('本地 / MCP / 未知名 三分（本地优先）', () => {
    const { index } = mergeToolLists([local('todo_add')], [mcp()])
    expect(routeToolCall('todo_add', ['todo_add'], index)).toEqual({ kind: 'local' })
    expect(routeToolCall('get_weather', ['todo_add'], index)).toEqual({
      kind: 'mcp',
      serverId: 's1',
      tool: 'get_weather',
    })
    expect(routeToolCall('nope', ['todo_add'], index)).toEqual({ kind: 'unknown' })
    expect(routeToolCall('get_weather', [], index)).toEqual({ kind: 'mcp', serverId: 's1', tool: 'get_weather' })
  })
})

describe('MCP 工具消费：结果回喂行', () => {
  it('成功：正文原样；截断 / notice 各自缀尾（可叠加）', () => {
    expect(mcpResultLine('get_weather', { text: '晴 25°', isError: false, truncated: false })).toBe(
      'get_weather：晴 25°',
    )
    expect(mcpResultLine('g', { text: 'x'.repeat(MCP_RESULT_MAX + 3), isError: false, truncated: false })).toBe(
      `g：${'x'.repeat(MCP_RESULT_MAX)}（原文共 ${MCP_RESULT_MAX + 3} 字）`,
    )
    expect(mcpResultLine('g', { text: 'ok', isError: false, truncated: true, notice: '没拿全' })).toBe(
      'g：ok（服务端已截断；没拿全）',
    )
  })

  it('空文字 / 失败：各走人话（失败也如实缀截断与 notice）', () => {
    expect(mcpResultLine('g', { text: '   ', isError: false, truncated: false })).toBe(
      'g：（工具没有返回文字内容）',
    )
    expect(mcpResultLine('g', { text: 'boom', isError: true, truncated: false })).toBe('g：失败（boom）')
    expect(mcpResultLine('g', { text: 'bad', isError: true, truncated: true, notice: '重试一次' })).toBe(
      'g：失败（bad）（服务端已截断；重试一次）',
    )
  })
})
