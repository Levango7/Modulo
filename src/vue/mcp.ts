/**
 * MCP server 配置的**纯函数层**（改天换地 PR-F4a，生态位第四格的第一笔）。
 *
 * 这里只管「不开浏览器也能断言」的那半：字段清洗、上限、参数切分、盘上数据的容错解析、
 * 增删改的纯变换。真正去 spawn 子进程、说 JSON-RPC 的那半在 Rust 侧（F4c），
 * 界面那半（列表 / 表单 / 两步删除）留给组件与 E2E。
 *
 * 五条纪律，前四条与前三条生态位线逐字同源：
 *
 * 1. **盘上的 JSON 不可信**：可能是手改的、旧版的、写坏的 —— **逐条**清洗，坏条目丢弃。
 *    一条坏的不能让另外三个服务一起消失（同 `knowledge.parseKnowledge` /
 *    `aiSettings.parseAiDoc`）。
 *
 * 2. **上限用「码点」这一把尺子，这次不需要双闸门**。F3 栽过一次：入库按码点、引用块
 *    按 UTF-16，于是 1200 个 emoji 合法入库却进块被截。那笔的教训是「入库闸门与消费
 *    预算必须同一把尺子」—— 而这里**消费侧根本不存在**：服务名、命令、参数只进界面与
 *    `spawn` 的 argv，永远不进 `contextBlock`。所以按码点量一次即可，不必再造一道
 *    UTF-16 闸门（那会是一条永远为真的冗余判据，比没有更糟）。
 *
 * 3. **换行与 NUL 一律拒收**，不做「自动折成一行」。命令是要交给进程去执行的：
 *    静默改写用户写的 argv 比报错更危险，而 NUL 会让参数在系统调用边界被截断。
 *
 * 4. **不猜**：字段缺失或类型不对就整条丢弃，不替用户填空。唯一的例外是 `enabled`：
 *    盘上缺这一格按 **false** 处理（宁可少跑一个进程，也不替用户把没确认过的东西打开）。
 *    新建时相反 —— 用户刚填完备就是想让它能用，`addServer` 给 true。
 *
 * 5. **一期没有 transport 字段**。只支持 stdio（本机子进程），数据形态就只放 stdio
 *    需要的东西。等 F4d 真做 Streamable HTTP 时再加字段，并在 `parseServers` 里
 *    给缺字段的老数据回落 `stdio` —— 那时才需要迁移，现在加一个没人读的字段只是噪声。
 *
 * ── 2026-11-17 拆分（第二十九笔）──────────────────────────────────────────
 * 本文件越过「单文件 ≤300 行」后按边界拆成三层，**对外 API 一字不变**：
 * - [`mcpCore`](./mcpCore.ts)：常量 / 类型 / 字段闸门 / 参数切分 / `nextId`；
 * - [`mcpDoc`](./mcpDoc.ts)：盘上文档解析、总开关推导、序列化；
 * - 本文件：增删改的纯变换与门面（`export *` 上面两层）。
 */
import { MCP_MAX, nextId, validateDraft, joinArgs, type McpDraft, type McpServer } from './mcpCore'

/** 新增的结果：错误文案回给界面（界面负责说出来），成功时给出**新数组**（不改入参）。 */
export type AddResult =
  | { ok: true; list: McpServer[] }
  | { ok: false; error: string }

/**
 * 新增一个服务。已满 `MCP_MAX` 时拒收 —— 与 F2「8 个任务」同量级，
 * 再往上不是「接工具」，是给模型灌一堆它用不上的工具描述。
 */
export function addServer(list: readonly McpServer[], draft: McpDraft): AddResult {
  if (list.length >= MCP_MAX) {
    return { ok: false, error: `最多 ${MCP_MAX} 个服务，先删一个再加` }
  }
  const checked = validateDraft(draft)
  if (!checked.ok) return checked
  return {
    ok: true,
    list: [...list, { id: nextId(list), enabled: true, ...checked.value }],
  }
}

/** 改一个服务的表单内容（id / enabled 不动）。未知 id 如实报错 —— 不能"保存成功但什么都没存"。 */
export function updateServer(list: readonly McpServer[], id: string, draft: McpDraft): AddResult {
  if (!list.some((s) => s.id === id)) {
    return { ok: false, error: '这条服务已经不在了，刷新一下列表' }
  }
  const checked = validateDraft(draft)
  if (!checked.ok) return checked
  return {
    ok: true,
    list: list.map((s) => (s.id === id ? { ...s, ...checked.value } : s)),
  }
}

/** 删除。未知 id 原样返回（幂等，不制造无意义的新引用）。 */
export function removeServer(list: readonly McpServer[], id: string): McpServer[] {
  if (!list.some((s) => s.id === id)) return [...list]
  return list.filter((s) => s.id !== id)
}

/** 启用 / 停用。未知 id 或状态没变时原样返回（不制造无意义的新引用）。 */
export function toggleServer(list: readonly McpServer[], id: string, enabled: boolean): McpServer[] {
  const hit = list.find((s) => s.id === id)
  if (!hit || hit.enabled === enabled) return [...list]
  return list.map((s) => (s.id === id ? { ...s, enabled } : s))
}

/**
 * 给界面看的命令行：**与表单初值同一个函数**（`joinArgs`）。
 *
 * 早先这里自己写了一套"给带空格的参数补引号"的逻辑，还额外把 `"` 转成 `\"` ——
 * 那套转义语法 `splitArgs` 根本不认，注释里"看到的能原样粘回去"是假的（QA 实测）。
 * 现在两边共用一个函数，并且含 `"` 的参数在入库时就被拒收，这句话才成立。
 */
export function formatCommand(server: Pick<McpServer, 'command' | 'args'>): string {
  return joinArgs([server.command, ...server.args])
}

// 门面：保持既有 import 路径（`from './mcp'`）一字不改。
export * from './mcpCore'
export * from './mcpDoc'
