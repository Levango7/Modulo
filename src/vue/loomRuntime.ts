/**
 * 织布机（nexusloom）运行时的**纯判定层**（β1「可选组件」，用户 2026-11-24 裁决）。
 *
 * 这一层管的是「安装 / 回退 / 展示」里能被离线穷举的那些判定：
 *   清单清洗（`loom-runtime.json` 的形状）、版本目录规划（`..` 与分隔符一律拒）、
 *   sha256 校验文案、版本目录的可删列表、设置页那段「复制 MCP 配置」的 JSON。
 * 真正会碰网络与磁盘的部分在 Rust（`loom_runtime_download` / `_state` / `_remove`），
 * 与 ASR 模型下载同一条分工：判定可测，IO 交给实现层。
 *
 * 四条边界（与 β 决策稿一致）：
 * 1. **校验不过就删，绝不留半个目录**：`.part` 是下载中的临时件、`.staging` 是解压中的临时件，
 *    两者在成功前都**不算安装**；只有校验 + 解压都过了，才改名成 `<version>/`。
 * 2. **当前在用的版本不许删**：`loom.json` 指到哪一版，哪一版就从可删列表里剔掉
 *    （与协调板「删之前先有别的 ref 能到」同一条哲学）。
 * 3. **不静默重试**：下载失败一律人话，可重试由用户决定（与「错过不补跑」同一条纪律）。
 * 4. **不静默改 MCP 配置**：装好只给一段**可复制的配置 JSON**，用户自己决定要不要粘进去
 *    （改配置 = 改用户的工具面，同「AI 永不直接写」）。β1 收尾（r47）加的「一键添加到 MCP 服务」
 *    不违反这条：那是用户**点了按钮**才发生的写入，且只动织布机自己那一条
 *    （`planLoomMcpServer` 按 `run-mcp.py` 签名认条目，不劫持同名的别人的服务）；
 *    总开关与「允许本会话」两道既有闸门依旧由用户自己开。
 */

import { joinArgs, type McpServer } from './mcpCore'

/** 版本目录名：首字符字母或数字，其余字母数字与 `._-`，≤32 字符 —— 路径分隔符与 `..` 天然进不来 */
export const LOOM_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/
/** sha256 只认 64 位小写 hex（与 asr_models 的写法同源） */
export const SHA256_RE = /^[0-9a-f]{64}$/
/** 状态文件：版本目录旁的一个 `loom.json`（{ current, sha256 }） */
export const LOOM_STATE_FILE = 'loom.json'
/** 清单格式版本：形状变更时加一，解析侧据此拒绝不认识的形状 */
export const LOOM_MANIFEST_SCHEMA = 1

export interface LoomManifest {
  version: string
  url: string
  sha256: string
  bytes?: number
  note?: string
}

export interface LoomPaths {
  part: string
  staging: string
  dest: string
  meta: string
}

export interface LoomVersionChoice {
  version: string
  current: boolean
  removable: boolean
}

/**
 * 清单清洗：缺字段 / 坏 sha / 非 http(s) / 版本名越界 ⇒ `null`。
 * 设置页据此显示「还没配清单」，而不是拿一个坏地址去下载（那等于把错误推迟到运行时）。
 */
export function parseLoomManifest(raw: string | null): LoomManifest | null {
  if (!raw) return null
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  const m = o as Record<string, unknown>
  if (typeof m.schemaVersion !== 'number' || m.schemaVersion !== LOOM_MANIFEST_SCHEMA) return null
  if (typeof m.version !== 'string' || !LOOM_VERSION_RE.test(m.version)) return null
  if (typeof m.url !== 'string' || !/^https?:\/\//.test(m.url)) return null
  if (typeof m.sha256 !== 'string' || !SHA256_RE.test(m.sha256)) return null
  return {
    version: m.version,
    url: m.url,
    sha256: m.sha256,
    ...(typeof m.bytes === 'number' && Number.isFinite(m.bytes) && m.bytes > 0 ? { bytes: m.bytes } : {}),
    ...(typeof m.note === 'string' && m.note ? { note: m.note } : {}),
  }
}

/** 版本目录名必须先过守卫（`..` / 分隔符一律拒），再算路径；**不守卫的调用点是 bug，按拒收处理** */
export function planPaths(root: string, version: string): LoomPaths | null {
  if (!root) return null
  if (!LOOM_VERSION_RE.test(version)) return null
  const sep = root.includes('/') ? '/' : '\\'
  const join = (a: string, b: string): string => (a.endsWith(sep) ? a + b : a + sep + b)
  return {
    part: join(root, `.part-${version}.tar.bz2`),
    staging: join(root, `.staging-${version}`),
    dest: join(root, version),
    meta: join(root, LOOM_STATE_FILE),
  }
}

/** 校验结果：`null` = 一致；否则是一句人话（带双方前 8 位，方便肉眼核） */
export function verifyDigest(actual: string, expected: string): string | null {
  if (!SHA256_RE.test(expected)) return '清单里的 sha256 不是 64 位小写 hex（这是清单本身的问题，不是下载的问题）'
  if (!SHA256_RE.test(actual)) return '下载件的 sha256 不是 64 位小写 hex（文件损坏或未写完）'
  if (actual === expected) return null
  return `校验和不一致：期望 ${expected.slice(0, 8)}…，实得 ${actual.slice(0, 8)}… —— 已删掉这份下载件，没装`
}

/** 版本目录的可删列表：**当前在用的那一版永远不可删**（`loom.json` 指到哪一版，哪一版被钉住） */
export function versionChoices(dirs: readonly string[], current: string | null): LoomVersionChoice[] {
  return [...dirs]
    .filter((d) => LOOM_VERSION_RE.test(d))
    .sort((a, b) => a.localeCompare(b))
    .map((version) => ({ version, current: version === current, removable: version !== current }))
}

/** 「复制 MCP 配置」那段 JSON：只含 command + args（Modulo 的 MCP 配置没有 cwd 字段 ——
 *  所以 launcher 必须自己 chdir，α 那轮已经踩过这个坑）。 */
export function mcpConfigSnippet(pythonExe: string, launcher: string): string {
  return JSON.stringify({ command: pythonExe, args: [launcher] }, null, 2)
}

/** 体积的人话（设置行展示用）：B / KiB / MiB 三档，最多一位小数 */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

/** 「一键添加」的计划：新增 / 更新既有条目（换版本后指过去）/ 一模一样就什么都不做 */
export interface LoomMcpPlan {
  action: 'add' | 'update' | 'same'
  /** update / same 时既有条目的 id；add 时没有 */
  id?: string
  /** 直接喂给 `mcp.add` / `mcp.update` 的表单（args 是一行文本，走 `validateDraft` 同一道闸门） */
  draft: { name: string; command: string; args: string }
}

/**
 * 一键添加到 MCP 服务的**纯判定**（β1 收尾 r47）：只认「参数里有 `run-mcp.py`」这一条签名 ——
 * 那是我们出包脚本写下的启动 shim 名，用户改名条目也认得出；**只看名字会把用户自己
 * 叫 loom 的别的服务劫持掉**，所以名字永远不参与匹配。
 * 多条签名命中取第一条（重复添加不会越点越多：第二条起就是 same / update）。
 */
export function planLoomMcpServer(
  list: readonly McpServer[],
  pythonExe: string,
  launcher: string,
): LoomMcpPlan {
  const draft = { name: 'loom', command: pythonExe, args: joinArgs([launcher]) }
  const hit = list.find((s) => s.args.some((a) => a.endsWith('run-mcp.py')))
  if (!hit) return { action: 'add', draft }
  if (hit.command === pythonExe && joinArgs(hit.args) === draft.args) {
    return { action: 'same', id: hit.id, draft }
  }
  return { action: 'update', id: hit.id, draft }
}
