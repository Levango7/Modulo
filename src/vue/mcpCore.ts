/**
 * MCP 配置的**字段规则层**（从 `mcp.ts` 拆出，第二十九笔；判据与行为逐字不变）。
 *
 * 这里只放「一条配置算不算合法」与「参数那行怎么切」：常量、类型、字段闸门、
 * `splitArgs` / `joinArgs`、`nextId`。拆出来的理由只有一个 —— `mcp.ts` 已越过
 * 「单文件 ≤300 行」的纪律，而这半是与盘上文档、CRUD 都无关的底座，边界最干净。
 *
 * 对外仍然只认 `mcp.ts`：它 `export *` 本文件，既有调用点无需改 import。
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
  /** 是否启用。盘上缺这一格按 false（见 `mcp.ts` 文件头第 4 条） */
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

/** 换行 / 回车 / NUL：命令与参数都不许有（见 `mcp.ts` 文件头第 3 条）。 */
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
export function checkFields(name: string, command: string, args: readonly string[]): DraftResult {
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
