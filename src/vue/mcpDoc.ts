/**
 * MCP 配置的**盘上文档层**（从 `mcp.ts` 拆出，第二十九笔；判据与行为逐字不变）。
 *
 * 这里只回答两个问题：盘上那份 JSON 能解析出什么（逐条清洗），以及**功能总开关**
 * 该是开还是关。真正去 spawn 子进程的那半在 Rust（F4c）；增删改的纯变换在 `mcp.ts`。
 *
 * 总开关与 `servers` 是**同一个键**（`modulo.mcp.v1`），不新开 `DATA_KEYS`。
 *
 * 对外仍只认 `mcp.ts`：它 `export *` 本文件，既有调用点无需改 import。
 */
import { MCP_MAX, checkFields, nextId, type McpServer } from './mcpCore'

/** id 形状：`s` + 数字。盘上来的 id 不合形状就重新分配，不照抄。 */
const ID_RE = /^s[1-9][0-9]*$/

/**
 * 解析盘上的文档。**逐条清洗，坏条目丢弃**，最多留前 `MCP_MAX` 条。
 *
 * 容忍三种历史形态：`null` / 空串、裸数组、`{ version, servers }` 对象 ——
 * 后一种是现在写出去的形状，前两种是手改或早期试验留下的，没有理由因此把用户的
 * 配置整份作废。
 */
export function parseServers(raw: string | null | undefined): McpServer[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { servers?: unknown }).servers)
      ? (data as { servers: unknown[] }).servers
      : []
  const out: McpServer[] = []
  for (const row of rows) {
    if (out.length >= MCP_MAX) break
    const parsed = parseServer(row, out)
    if (parsed) out.push(parsed)
  }
  return out
}

/** 单条清洗。给不出合法的一条就返回 null（**不替用户补**，见 `mcp.ts` 文件头第 4 条）。 */
function parseServer(row: unknown, taken: readonly McpServer[]): McpServer | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  if (typeof r.name !== 'string' || typeof r.command !== 'string') return null
  if (!Array.isArray(r.args) || r.args.some((a) => typeof a !== 'string')) return null
  // 与表单**同一道闸门**（不是把 argv 拼成字符串再切回来 —— 那会把含引号的参数弄坏）
  const checked = checkFields(r.name, r.command, r.args as string[])
  if (!checked.ok) return null
  const id =
    typeof r.id === 'string' && ID_RE.test(r.id) && !taken.some((s) => s.id === r.id)
      ? r.id
      : nextId(taken)
  return { id, enabled: r.enabled === true, ...checked.value }
}

/**
 * 总开关推导的**唯一实现**：有启用条目 ⇒ true。解析回落与序列化缺省都走这里，
 * 不许两处各写一遍（Rust 侧 `pure::parse_doc` 的推导与它同一张表）。
 */
function deriveGate(list: readonly McpServer[]): boolean {
  return list.some((s) => s.enabled)
}

/** 盘上**显式**写的 gate：只有真 bool 才算；`"true"` / `1` / 缺失一律当没写。 */
function explicitGate(raw: string | null | undefined): boolean | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const g = (data as { gate?: unknown }).gate
  return typeof g === 'boolean' ? g : null
}

/**
 * 总开关的推导（与 Rust `pure::parse_doc` 同一张表）：
 *
 * - 盘上 `gate` 是真 bool ⇒ 用它（**显式优先于推导**，用户关过就一直是关）；
 * - 缺失 / 非 bool + 有启用条目 ⇒ `true`（存量兼容：用户已经在用，升级不能突然断）；
 * - 缺失 / 非 bool + 没有启用条目 ⇒ `false`（新装默认关 = 灰度）。
 *
 * **两个方向都不能简单默认**：默认 false 会把存量用户的配置变成死数据（行为倒退）；
 * 默认 true 就没有灰度可言，新装用户直接暴露外部进程执行能力。与 Rust 侧同一条注释。
 */
export function parseGate(raw: string | null | undefined): boolean {
  const explicit = explicitGate(raw)
  if (explicit !== null) return explicit
  return deriveGate(parseServers(raw))
}

/**
 * 落盘形状带 `version`：将来加 transport 字段时要能分辨「老数据缺字段」与「真的没填」。
 * `gate` 与 `servers` 同一个键（不新开 `DATA_KEYS`）；不传 `gate` 时按「有启用条目 ⇒ true」
 * 推导，保证老调用点不改也不会把总开关写丢成 false。
 */
export function serializeServers(list: readonly McpServer[], gate?: boolean): string {
  return JSON.stringify({ version: 1, gate: gate ?? deriveGate(list), servers: list })
}
