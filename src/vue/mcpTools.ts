/**
 * 「MCP 工具进 agent 循环」的**纯函数层**（第二十七笔；F4c 归属裁定 2026-11-16 —— 传输面在
 * Rust 侧 `ai::mcp`（#309，§12.86），动作语义面在本线。契约节见 `docs/design/F-13-AI-ACTIONS.md`
 * 的「F4c 消费端契约」）。
 *
 * 这一层解决的是：模型怎么**看见** MCP 工具（工具清单合并）、调用怎么**分流**（本地白名单 vs
 * `mcp_call`）、结果怎么**回喂**（与 F4c-1 的工具结果行同族的人话）。全部零副作用 —— 真正去
 * invoke `mcp_list_tools` / `mcp_call` / `mcp_confirm` 的胶水半（J1 执行半）不在这笔里。
 *
 * 三条纪律（与 `aiActions.ts` 同一族）：
 * 1. **只有已确认服务的工具才进清单** —— Rust 侧「未确认即拒，列工具也算」（§12.86 设计 3）；
 *    确认态在前端由 `mcp_confirm` 成功驱动（Rust 无查询命令，重启两端同清），所以本层的输入
 *    就是「已确认服务的工具条目」，未确认的进不来。
 * 2. **看不懂的不硬塞**：工具名不合法 / 与本地或彼此撞名 / `inputSchema` 不是对象 / 超出总数帽
 *    —— 一律 skip 并说人话，宁可少列也不给模型一个会炸的名字。
 * 3. **结果回喂与本地工具同族**：`mcpResultLine` 与 `actionResultLines` / `toolResultText`
 *    同一形状（`名：结果`），界面与回喂复用同一条渲染规则。
 */

import type { ToolSpecLite } from './aiActions'

/** `mcp_list_tools` 返回的单条工具（Rust `ToolOut` 的 camelCase 镜像 + 来源服务名） */
export interface McpToolEntry {
  serverId: string
  serverName: string
  name: string
  title?: string
  description?: string
  inputSchema: unknown
}

/** `mcp_call` 的返回（Rust `CallOut` 的 camelCase 镜像；`isError` 是工具自己报的执行失败） */
export interface McpCallResult {
  text: string
  isError: boolean
  truncated: boolean
  notice?: string
}

/** 工具名约束：与 OpenAI `tools[].function.name` 同一条（`aiActions.ts` 的 `TOOL_NAME_OF` 同款口径） */
export const MCP_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

/** 合并进请求的 MCP 工具总数帽 —— 本地 10 条之外也要防「清单爆炸撑上下文」 */
export const MCP_TOOLS_MAX = 20

/** MCP 结果回喂的码点帽（与工具 args 截到 8000 同族口径：回喂文本会进会话历史） */
export const MCP_RESULT_MAX = 8000

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** 码点截断（与 `knowledge.ts` 的 `cutPoints` 同口径：中文与 emoji 各算一个字） */
const cutAt = (s: string, max: number): { text: string; cut: boolean } => {
  const chars = Array.from(s)
  return chars.length <= max
    ? { text: s, cut: false }
    : { text: chars.slice(0, max).join(''), cut: true }
}

export interface MergeResult {
  /** 可下发清单：本地在前（保序），合法的 MCP 工具随后 */
  tools: ToolSpecLite[]
  /** 没列进去的，一条一个人话 —— 界面 / 回喂都要看得见，不静默丢 */
  skipped: string[]
  /** name → serverId 的路由索引（只含合并成功的 MCP 工具） */
  index: Map<string, string>
}

/**
 * 工具清单合并：本地清单原样在前（保序、一个不动），已确认服务的 MCP 工具逐条过闸门后折成
 * 同一形状追加。撞名 / 非法名 / 坏 schema / 超帽都走 `skipped` 说人话 —— 宁可少列，不猜。
 */
export function mergeToolLists(
  local: readonly ToolSpecLite[],
  mcp: readonly McpToolEntry[],
): MergeResult {
  const tools: ToolSpecLite[] = [...local]
  const skipped: string[] = []
  const index = new Map<string, string>()
  const localNames = new Set(local.map((t) => t.name))
  for (const e of mcp) {
    const from = `（服务「${e.serverName}」）`
    if (!MCP_TOOL_NAME_RE.test(e.name)) {
      skipped.push(`「${e.name}」${from}没有列：工具名只能用字母 / 数字 / 下划线 / 连字符（≤ 64 字）`)
      continue
    }
    if (localNames.has(e.name)) {
      skipped.push(`「${e.name}」${from}没有列：与内置工具撞名（内置的优先）`)
      continue
    }
    if (index.has(e.name)) {
      skipped.push(`「${e.name}」没有列：多个服务提供了同名工具（先列的优先）`)
      continue
    }
    if (!isRec(e.inputSchema)) {
      skipped.push(`「${e.name}」${from}没有列：inputSchema 不是对象`)
      continue
    }
    if (index.size >= MCP_TOOLS_MAX) {
      skipped.push(`「${e.name}」${from}没有列：MCP 工具总数已到上限 ${MCP_TOOLS_MAX}`)
      continue
    }
    const description = [e.title, e.description]
      .filter((x) => typeof x === 'string' && x.trim())
      .join('：')
    tools.push({
      name: e.name,
      description: description || '（该服务未提供工具说明）',
      parameters: e.inputSchema,
    })
    index.set(e.name, e.serverId)
  }
  return { tools, skipped, index }
}

export type ToolRoute =
  | { kind: 'local' }
  | { kind: 'mcp'; serverId: string; tool: string }
  | { kind: 'unknown' }

/**
 * 模型调了一个工具名 → 该走哪条执行路。本地优先（内置白名单是封闭的），MCP 次之，
 * 都不认识 = unknown（调用方按「未知名拒收」的既有口径说人话）。
 */
export function routeToolCall(
  name: string,
  localNames: readonly string[],
  index: ReadonlyMap<string, string>,
): ToolRoute {
  if (localNames.includes(name)) return { kind: 'local' }
  const serverId = index.get(name)
  if (serverId !== undefined) return { kind: 'mcp', serverId, tool: name }
  return { kind: 'unknown' }
}

/**
 * 一条 MCP 调用结果的人话行（与 `actionResultLines` 的「名：结果」同族；回喂与时间线共用）。
 * `isError` 是工具自己报的执行失败（RPC 本身是成功的），文案与传输错误分开；`truncated` /
 * `notice` 如实缀在行尾，不静默。
 */
export function mcpResultLine(name: string, r: McpCallResult): string {
  const cut = cutAt(r.text, MCP_RESULT_MAX)
  const body = cut.text.trim() || '（工具没有返回文字内容）'
  const tail: string[] = []
  if (cut.cut) tail.push(`原文共 ${Array.from(r.text).length} 字`)
  if (r.truncated) tail.push('服务端已截断')
  if (r.notice) tail.push(r.notice)
  const suffix = tail.length ? `（${tail.join('；')}）` : ''
  if (r.isError) return `${name}：失败（${body}）${suffix}`
  return `${name}：${body}${suffix}`
}
