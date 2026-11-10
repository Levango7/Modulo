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
 */

/** 存储文档名。**必须登记进 `fileStorage.ts` 的 `DATA_KEYS`** —— 那张表是桌面 `get`
 * 的唯一来源（启动 hydrate 成内存镜像），漏登记的症状不是报错，而是「写得下去、
 * 重启读不到」（同 F1 资料、F2 定时、F3 技能）。 */
export const MCP_DOC_KEY = 'modulo.mcp.v1'

/** 最多几个服务：再多就不是「接了几个工具」，是拿 MCP 当插件市场。 */
export const MCP_MAX = 8
/** 服务显示名上限（码点）。只进界面，所以按码点量一次。 */
export const MCP_NAME_MAX = 40
/** 命令长度上限（码点）。够放一个绝对路径 + 长参数名。 */
export const MCP_CMD_MAX = 260
/** 单个服务的参数个数上限。再多就该写成一个脚本了。 */
export const MCP_ARGS_MAX = 12
/** 单个参数长度上限（码点）。 */
export const MCP_ARG_MAX = 260

/** 一个已保存的服务。`id` 只在本机有意义（UI 的 key、删除的目标）。 */
export interface McpServer {
  id: string
  /** 显示名，用户自己起 */
  name: string
  /** 可执行文件或命令名（如 `npx` / `C:\tools\mcp.exe`） */
  command: string
  /** argv，不含命令本身 */
  args: string[]
  /** 是否启用。盘上缺这一格按 false（见文件头第 4 条） */
  enabled: boolean
}

/** 表单里的原始输入：参数是一整行文本，入库时才切成数组。 */
export interface McpDraft {
  name: string
  command: string
  args: string
}

/** 按码点数长度。与 `knowledge.ts` 同源（那边也要「共 N 字」对得上 emoji）。 */
function pointCount(s: string): number {
  return Array.from(s).length
}

/** 换行 / 回车 / NUL：命令与参数都不许有（见文件头第 3 条）。 */
function hasControl(s: string): boolean {
  return s.includes('\n') || s.includes('\r') || s.includes('\0')
}

/**
 * 把一行参数切成 argv，支持用**双引号**包住带空格的参数（`--root "C:\My Docs"`）。
 *
 * 手写一个 40 行的状态机，而不是 `shell-quote` 之类：我们**不经过 shell**，
 * 参数原样交给 `spawn`，所以不需要转义、变量展开、管道这些语义 —— 引入一个
 * shell 解析器会给人「支持 `|` 与 `&&`」的错觉，那正是要避免的。
 *
 * 引号没配对就返回错误（**不猜**用户想切到哪里）；`""` 是合法的空参数。
 */
export function splitArgs(text: string): { ok: true; args: string[] } | { ok: false; error: string } {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let started = false
  for (const ch of text) {
    if (ch === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && (ch === ' ' || ch === '\t')) {
      if (started) {
        out.push(cur)
        cur = ''
        started = false
      }
      continue
    }
    cur += ch
    started = true
  }
  if (quoted) return { ok: false, error: '参数里的双引号没有配对' }
  if (started) out.push(cur)
  return { ok: true, args: out }
}

/**
 * `splitArgs` 的**真逆函数**：argv → 一行文本（表单初值、界面展示都用它）。
 *
 * 这是 B1 的修法。此前 `openEdit` 用 `args.join(' ')` 拼初值：带空格的参数一进表单，
 * 引号就没了；点「保存」再被 `splitArgs` 按空白切开 —— 用户一个字没改，argv 却被
 * 静默拆成多段（`C:\My Docs` → `C:\My` + `Docs`），而下一笔要把它原样交给 `spawn`。
 *
 * 能保证 `splitArgs(joinArgs(a)).args` 与 `a` 逐项相等，**前提是每个参数都不含 `"`**
 * —— 这个前提由 `checkFields` 拒收来保证（语法里没有转义，含引号的参数无法用一行
 * 文本无歧义地表示）。空参数写成 `""`，否则会被空白直接吞掉。
 */
export function joinArgs(args: readonly string[]): string {
  return args.map((a) => (a === '' || /\s/.test(a) ? `"${a}"` : a)).join(' ')
}

/** 校验结果：成功时给出**已清洗**的三格（name/command 已 trim）。 */
export type DraftResult =
  | { ok: true; value: { name: string; command: string; args: string[] } }
  | { ok: false; error: string }

/**
 * 三格字段的**唯一闸门**（名字 / 命令 / 参数数组）。表单与盘上数据都走这里 ——
 * 造第二套判据必然分叉，那正是 F3 栽过的那类病。
 *
 * **顺序固定**：先名字（最容易空）、再命令、最后参数 —— 表单一次只报一条，
 * 报上层的比报下层的有用。
 */
function checkFields(name: string, command: string, args: readonly string[]): DraftResult {
  const trimmedName = name.trim()
  if (!trimmedName) return { ok: false, error: '给它起个名字，方便在列表里认出来' }
  if (hasControl(trimmedName)) return { ok: false, error: '名字里不能有换行或 NUL' }
  const nameLen = pointCount(trimmedName)
  if (nameLen > MCP_NAME_MAX) {
    return { ok: false, error: `名字最多 ${MCP_NAME_MAX} 个字（现在 ${nameLen} 个）` }
  }

  const trimmedCmd = command.trim()
  if (!trimmedCmd) return { ok: false, error: '命令不能为空，比如 npx' }
  if (hasControl(trimmedCmd)) return { ok: false, error: '命令里不能有换行或 NUL' }
  // 命令与参数走**同一套**字符判据（QA 指出过不对称）：命令里一个全角空格会让
  // `spawn` 去找一个根本不存在的可执行文件，且没有任何提示 —— 比参数那边更该拦。
  if (trimmedCmd.includes('"')) return { ok: false, error: '命令里不能有双引号' }
  if (trimmedCmd.includes('\u3000')) {
    return { ok: false, error: '命令里有全角空格，换成半角空格' }
  }
  const cmdLen = pointCount(trimmedCmd)
  if (cmdLen > MCP_CMD_MAX) {
    return { ok: false, error: `命令最多 ${MCP_CMD_MAX} 个字（现在 ${cmdLen} 个）` }
  }

  if (args.length > MCP_ARGS_MAX) {
    return { ok: false, error: `参数最多 ${MCP_ARGS_MAX} 个（现在 ${args.length} 个）` }
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (hasControl(arg)) return { ok: false, error: `第 ${i + 1} 个参数里有换行或 NUL` }
    // 语法里没有转义：引号只能是「包住参数」的那一对。参数自身带引号就无法用一行文本
    // 无歧义地表示 —— 拒收，而不是让它在「编辑 → 保存」时被悄悄改写（那正是 B1）。
    if (arg.includes('"')) {
      return { ok: false, error: `第 ${i + 1} 个参数里有双引号，这一层不支持转义` }
    }
    // 全角空格（中文输入法下常见）不会被当分隔符，混进去就是一个畸形参数 —— 提示换半角
    if (arg.includes('\u3000')) {
      return { ok: false, error: `第 ${i + 1} 个参数里有全角空格，换成半角空格` }
    }
    const len = pointCount(arg)
    if (len > MCP_ARG_MAX) {
      return { ok: false, error: `第 ${i + 1} 个参数太长（最多 ${MCP_ARG_MAX} 个字）` }
    }
  }
  return { ok: true, value: { name: trimmedName, command: trimmedCmd, args: [...args] } }
}

/** 校验一份表单：先把参数那行切成 argv，再走同一道闸门。 */
export function validateDraft(draft: McpDraft): DraftResult {
  const split = splitArgs(draft.args)
  if (!split.ok) return split
  return checkFields(draft.name, draft.command, split.args)
}

/** 取一个没被占用的 id：`s1`、`s2`……取最小空位，删了再加不会一路涨。 */
export function nextId(list: readonly McpServer[]): string {
  const used = new Set(list.map((s) => s.id))
  for (let n = 1; ; n += 1) {
    const id = `s${n}`
    if (!used.has(id)) return id
  }
}

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

/** 单条清洗。给不出合法的一条就返回 null（**不替用户补**，见文件头第 4 条）。 */
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

/** 落盘形状带 `version`：将来加 transport 字段时要能分辨「老数据缺字段」与「真的没填」。 */
export function serializeServers(list: readonly McpServer[]): string {
  return JSON.stringify({ version: 1, servers: list })
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
