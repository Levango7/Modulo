/**
 * MCP 执行半的**胶水层**（J1 执行半）：把「界面上的一个服务」变成「真去连子进程的三条命令」。
 *
 * 分工不变：纯判定在 [`mcpTools`](./mcpTools.ts)（清单合并 / 调用分流 / 结果回喂人话），
 * 传输在 Rust `ai::mcp`（§12.86，真 spawn stdio 子进程说 JSON-RPC）。这一层只干三件事 ——
 * 发命令、把返回值折成前端形状、把失败折成**一句人话**。
 *
 * ## ① 为什么确认态只能在前端自持
 *
 * Rust 侧 `McpState.confirmed: Mutex<HashSet<String>>` 按 `server_id` 记，**默认全空、仅内存、
 * 重启即清**，而且**没有「查是否已确认」的命令** —— 前端问不到。所以只剩一条路：前端自己拿
 * 一份，由 `mcp_confirm` 成功来驱动，与后端同生命周期（本会话）。两条推论写死在这里：
 * - `confirm` **失败绝不能**记进 `confirmed` —— 那会让前端以为已放行、工具清单照列，而 Rust
 *   那道 J4 闸门其实还在拒，症状是「界面说能用，一调就报没确认」。
 * - `confirmed` 不落盘。Rust 重启就清，前端若把它存进 storage，重启后前端说「已确认」、
 *   后端说「没确认」，两端永久分叉。
 *
 * ## ② 为什么必须写成字面 `invoke('x')`
 *
 * `scripts/cmd-surface.mjs`（F-11②）只认 `src/` 里**字面**的 `invoke('x')` / `invoke<T>('x')`。
 * 为了可测性把 invoke 抽成注入参数（`createMcpExecution({ invoke })`）会让门禁判「注册了却没有
 * 调用点」当场红。可测性走 `vi.mock('@tauri-apps/api/core', …)`（`tests/vue/shell.test.ts` 同款），
 * 不为测试改生产形状。
 *
 * ## ③ 线上三条形状（参数名一律 camelCase）
 *
 * - `mcp_list_tools(serverId)` → `{ tools: ToolOut[], notice }`；
 *   `ToolOut { serverId, name, title, description, inputSchema }`（`Option` 序列化成 `null`）
 * - `mcp_call(serverId, tool, args)` → `{ text, isError, truncated, notice }`
 * - `mcp_confirm(serverId)` → `null`（Rust 是 `Result<(), String>`，`()` 序列化成 `null`）
 *
 * Tauri 2 默认做 `server_id` → `serverId` 的 camelCase 映射，传 snake_case 会取到 `undefined`；
 * `args` 必须是**对象**（Rust 侧 `Option<Value>`，给 JSON 字符串会变成「参数是一个字符串」）。
 */
import { ref, shallowRef, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './useShell'
import type { McpServer } from './mcp'
import type { McpCallResult, McpToolEntry } from './mcpTools'

/** 非桌面（vite dev / 网页构建 / E2E 的 Chrome）统一的那句话：三条命令一条都不发。 */
export const MCP_OFFLINE = '网页版没有桌面壳，连不上本机 MCP 服务'

/** Rust `ToolOut` 的线上形状：`Option<String>` 序列化成 `null`（不是缺键）。 */
interface ToolWire {
  serverId: string
  name: string
  title: string | null
  description: string | null
  inputSchema: unknown
}

interface ToolsWire {
  tools: ToolWire[]
  notice: string | null
}

interface CallWire {
  text: string
  isError: boolean
  truncated: boolean
  notice: string | null
}

/** 一次 `listTools` 的结果。成功与失败互斥，调用方靠 `'error' in r` 分（同 `mcp.ts` 的 AddResult）。 */
export type ListToolsResult = { tools: McpToolEntry[]; notice?: string } | { error: string }

export interface McpExecutionApi {
  /** 本会话已确认的 server id（仅内存，重启即清 —— 与 Rust `McpState.confirmed` 同生命周期） */
  confirmed: Ref<string[]>
  isConfirmed(id: string): boolean
  /** 记确认；成功返回 null，失败返回要念给用户听的那句话 */
  confirm(server: McpServer): Promise<string | null>
  /** 拉一个服务的工具清单；成功返回条目（已补 serverName），失败返回 `{ error }` */
  listTools(server: McpServer): Promise<ListToolsResult>
  /** 调一个工具；RPC 层失败抛错由调用方折成人话，工具自己报的失败在返回值的 `isError` 里 */
  callTool(
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<McpCallResult>
  /** 一批服务里「已确认且 enabled」的逐条拉清单，失败折成 skipped 人话（不抛） */
  gather(servers: readonly McpServer[]): Promise<{ entries: McpToolEntry[]; skipped: string[] }>
  /** 服务被删 / 停用 / 改了命令：清掉它的确认态与清单缓存 */
  forget(id: string): void
}

export function createMcpExecution(): McpExecutionApi {
  const confirmed = ref<string[]>([])
  /**
   * serverId → 一次**成功**的清单。失败不进缓存：缓存失败等于把一次瞬时故障变成用户
   * 点「重试」也永远好不了。用 `Object.hasOwn` 取（不用 `in` / 直接下标）—— 手改坏的 id
   * 万一是 `constructor`，`in` 会命中原型链，返回一个不是清单的东西。
   *
   * `shallowRef`：内层对象一律**整份替换**（从不原地改），所以只需要「换了一张表」这一层
   * 的响应式；深代理会让同一个 entry 在两次调用里拿到不同对象，白花开销还搅乱身份比较。
   */
  const cache = shallowRef<Record<string, { tools: McpToolEntry[]; notice?: string }>>({})

  const isConfirmed = (id: string): boolean => confirmed.value.includes(id)

  async function confirm(server: McpServer): Promise<string | null> {
    if (!isDesktop) return MCP_OFFLINE
    try {
      // 字面 invoke：见文件头 ②。这条命令只回 null，成功与否看 reject。
      await invoke('mcp_confirm', { serverId: server.id })
      // 幂等：重复确认不重复入数组（与 Rust 侧 `HashSet::insert` 同一条语义）
      if (!isConfirmed(server.id)) confirmed.value = [...confirmed.value, server.id]
      return null
    } catch (err) {
      return String(err)
    }
  }

  async function listTools(server: McpServer): Promise<ListToolsResult> {
    if (Object.hasOwn(cache.value, server.id)) return cache.value[server.id]
    if (!isDesktop) return { error: MCP_OFFLINE }
    try {
      const out = await invoke<ToolsWire>('mcp_list_tools', { serverId: server.id })
      const tools: McpToolEntry[] = out.tools.map((t) => {
        // serverId 用传入的（它同时是缓存键与 `mcp_call` 的入参），线上那个字段是同一值的回声
        const entry: McpToolEntry = {
          serverId: server.id,
          serverName: server.name,
          name: t.name,
          inputSchema: t.inputSchema,
        }
        // 可选的空值不写成 `title: undefined`：`mergeToolLists` 会 `join`，undefined 与缺键
        // 在它那边等价，但界面拿到的形状越干净越好（对象里有 undefined 键不好 diff）
        if (t.title) entry.title = t.title
        if (t.description) entry.description = t.description
        return entry
      })
      const fresh: { tools: McpToolEntry[]; notice?: string } = { tools }
      if (out.notice) fresh.notice = out.notice
      cache.value = { ...cache.value, [server.id]: fresh }
      return fresh
    } catch (err) {
      return { error: String(err) }
    }
  }

  async function callTool(
    serverId: string,
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<McpCallResult> {
    // 非桌面**抛**而不是回 isError：isError 是「工具跑了但失败」的专用通道（见 mcpTools 头注释），
    // 这里连进程都没起，混进去会让调用方分不清「服务坏了」和「这个工具坏了」。
    if (!isDesktop) throw new Error(MCP_OFFLINE)
    // 省略时也传 `{}`：Rust 是 `Option<Value>`，不给就 unwrap 成 `{}`，但显式给更省一次猜
    const out = await invoke<CallWire>('mcp_call', { serverId, tool, args: args ?? {} })
    const r: McpCallResult = { text: out.text, isError: out.isError, truncated: out.truncated }
    if (out.notice) r.notice = out.notice
    return r
  }

  async function gather(
    servers: readonly McpServer[],
  ): Promise<{ entries: McpToolEntry[]; skipped: string[] }> {
    const entries: McpToolEntry[] = []
    const skipped: string[] = []
    for (const s of servers) {
      // 只取「已确认且 enabled」。未确认 / 已停用的一条都不拉 —— 未确认时 Rust 那道 J4 闸门
      // 也会拒，白起一个子进程（首次列工具就要 spawn，那正是闸门守的东西）。
      // 这两类**不进 skipped**：它们是用户在界面上自己摆的状态，界面已经写着「未确认 / 已停用」，
      // 而 gather 每一轮请求都会跑一遍，写进去等于把同一句话重复念给用户听。
      if (!s.enabled || !isConfirmed(s.id)) continue
      const r = await listTools(s)
      if ('error' in r) {
        // 单个服务失败不拖垮整批：折成一条人话进 skipped，别的服务照常列
        skipped.push(`「${s.name}」的工具没有列出来：${r.error}`)
        continue
      }
      entries.push(...r.tools)
      // notice 不是失败，但它是「没拿全」的如实标注，不能静默丢（§12.86 设计里的判据）
      if (r.notice) skipped.push(`「${s.name}」的工具没列全：${r.notice}`)
    }
    return { entries, skipped }
  }

  function forget(id: string): void {
    if (isConfirmed(id)) confirmed.value = confirmed.value.filter((x) => x !== id)
    if (Object.hasOwn(cache.value, id)) {
      const next = { ...cache.value }
      delete next[id]
      cache.value = next
    }
  }

  return { confirmed, isConfirmed, confirm, listTools, callTool, gather, forget }
}
