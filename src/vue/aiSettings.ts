/**
 * AI 模型服务配置的**纯函数层**（F-12 一期，设计稿 `docs/design/F-12-AI-WIRING.md` §4）。
 *
 * 为什么单独成文件：地址判据、文档解析、增删改、密钥草稿这四件事都不碰 IO，也不碰组件状态，
 * 满足本仓受测层的纳入判据（「不开浏览器也能断言」）。留在 `AiLabSection.vue` 里的话，
 * 「填 `http://ai.example.com` 该不该拒」这种判据就只能靠 E2E 兜底 —— 而 E2E 一跑十几分钟。
 *
 * 三条纪律：
 * 1. **地址判据与 Rust 同一张表**：私网/保留地址的名单不在这里另抄一份，直接用
 *    `@levango7/engine/watch` 的 `blockedReason`（与 `src-tauri/src/net.rs` 已经对齐两轮）。
 *    这里的文案只是输入时的即时反馈，真值与最终裁决都在 Rust（`ai::protocol::validate_base_url`）。
 * 2. **文档解析不可信输入**：盘上的 JSON 可能是手改的、旧版的、写坏的。逐条清洗，
 *    坏条目丢弃而不是整份报废 —— 一条坏数据不该让用户另外三条配置一起消失。
 * 3. **密钥不进这份文档**（AC-09）：这里只有 `keyConfigured` 布尔与输入框草稿，
 *    真正的密钥从 `AiLabSection` 直接交给 `ai_set_key`，不经过任何序列化。
 */

import { blockedReason } from '@levango7/engine/watch'

/** 配置文档名。**必须与 Rust 的 `ai::settings::SETTINGS_DOC` 一字不差** —— 它按名字读盘 */
export const AI_DOC_KEY = 'ai-settings.v1'

/** 契约枚举（与 Rust `ProviderCfg.kind` 同名） */
export type ProviderKind = 'openai-compatible' | 'ollama'
export const PROVIDER_KINDS: readonly ProviderKind[] = ['openai-compatible', 'ollama']

export interface AiProvider {
  id: string
  kind: ProviderKind
  baseUrl: string
  model: string
}

/** `ai_providers` 的返回条目（Rust `ProviderView`，camelCase） */
export interface ProviderView {
  id: string
  kind: string
  baseUrl: string
  model: string
  keyConfigured: boolean
  ready: boolean
}

/** 编辑表单里正在敲的那份（保存前不落盘） */
export interface ProviderDraft {
  kind: ProviderKind
  baseUrl: string
  model: string
}

/** 本机三个写法：Ollama / LM Studio 就住这儿，明文 http 也放行（与 Rust 的 `is_local_host` 同集） */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * 从 authority 段取主机：去 userinfo、去端口、去 IPv6 的方括号，统一小写。
 *
 * **userinfo 必须先剥**：`https://evil.com@169.254.169.254/` 的实际主机是后面那个，
 * 不剥就按 `evil.com` 判成公网地址放行 —— 而请求会打到云元数据端点。Rust 侧同样的剥法。
 */
function hostOf(authority: string): string {
  const at = authority.lastIndexOf('@')
  const bare = at < 0 ? authority : authority.slice(at + 1)
  if (bare.startsWith('[')) {
    const end = bare.indexOf(']')
    // 未闭合的畸形串整段当主机（与 Rust 的 extract_host 同处置）：剥掉方括号后
    // 引擎的 blockedReason 仍会把它认成 `::1` 并拒掉
    return (end < 0 ? bare : bare.slice(1, end)).toLowerCase()
  }
  const colon = bare.indexOf(':')
  return (colon < 0 ? bare : bare.slice(0, colon)).toLowerCase()
}

/**
 * 地址判据。返回 `null` 表示放行，否则是给人看的一句话。
 *
 * 与 Rust `validate_base_url` 逐条对齐（空格、大小写、本机豁免、黑名单），
 * 差别只有一处：空输入这里给"不能为空"，Rust 那边落到 scheme 那条 —— 两边结论都是拒。
 */
export function checkBaseUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return '模型服务地址不能为空'
  // 只认小写 scheme：Rust 的 strip_prefix 是大小写敏感的，这里放宽就会出现
  // 「前端放行、Rust 拒绝」那种最难解释的分叉
  const m = /^(https?):\/\//.exec(raw)
  if (!m) return '模型服务地址必须以 https:// 或 http:// 开头'
  const authority = raw.slice(m[0].length).split('/')[0]
  const host = hostOf(authority)
  if (m[1] === 'http') {
    return LOCAL_HOSTS.has(host) ? null : '明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https'
  }
  if (!host) return '模型服务地址缺少主机名'
  if (LOCAL_HOSTS.has(host)) return null
  const reason = blockedReason(host)
  return reason ? `${reason}（${host}）—— 模型服务要么是公网 https 地址，要么是本机地址` : null
}

/** 表单整体校验：地址先过判据，模型名必填（Rust 侧不校验模型名，它只影响服务端 404） */
export function checkDraft(draft: ProviderDraft): string | null {
  const urlError = checkBaseUrl(draft.baseUrl)
  if (urlError) return urlError
  if (!draft.model.trim()) return '模型名不能为空（例如 gpt-4o-mini 或 qwen2.5:7b）'
  return null
}

function asKind(v: unknown): ProviderKind {
  return typeof v === 'string' && (PROVIDER_KINDS as readonly string[]).includes(v) ? (v as ProviderKind) : 'openai-compatible'
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 读配置文档。坏条目逐条丢弃：
 * - 没有非空 `id` 的条目**没法寻址**（密钥、探测、删除全按 id），留着只会变成点不动的行；
 * - 重复 id 只留第一条（后一条会覆盖前一条的密钥，两种结果都错）；
 * - `kind` 缺省/不认识 → `openai-compatible`（契约枚举的第一个，也是存量文档的形状）。
 */
export function parseAiDoc(raw: string | null): AiProvider[] {
  if (!raw) return []
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof obj !== 'object' || obj === null) return []
  const list = (obj as { providers?: unknown }).providers
  if (!Array.isArray(list)) return []
  const out: AiProvider[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const id = asText(o.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, kind: asKind(o.kind), baseUrl: asText(o.baseUrl), model: asText(o.model) })
  }
  return out
}

/**
 * 写配置文档。字段逐个点名而不是展开对象：盘上多出来的键（将来的、手改的）不该被
 * 悄悄带回去 —— Rust 那边 `ProviderCfg` 只认这四个字段，多写就是对不上的第二套 schema。
 */
export function serializeAiDoc(list: readonly AiProvider[]): string {
  return JSON.stringify({
    providers: list.map((p) => ({ id: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.model })),
  })
}

/**
 * 新 provider 的 id：`p-<36 进制毫秒>`。Rust 只按 id 查找、不校验格式，但**密钥库**那边
 * 要求 id 只含小写字母/数字/连字符（`keys::validate_provider_id`），36 进制正好满足。
 * 毫秒撞车（同一毫秒点两次）加 `-2`、`-3` 后缀，保证文档内唯一。
 */
export function makeProviderId(nowMs: number, existing: readonly AiProvider[]): string {
  const base = `p-${Math.max(0, Math.floor(nowMs)).toString(36)}`
  let id = base
  let n = 2
  while (existing.some((p) => p.id === id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

/** 追加一条。地址与模型先去首尾空格 —— 用户从文档里复制过来常带 */
export function addProvider(list: readonly AiProvider[], id: string, draft: ProviderDraft): AiProvider[] {
  return [
    ...list,
    { id, kind: draft.kind, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() },
  ]
}

/** 就地改一条（id 不变）。找不到就原样返回 —— 并发删掉后再保存不该凭空复活一条 */
export function updateProvider(list: readonly AiProvider[], id: string, draft: ProviderDraft): AiProvider[] {
  return list.map((p) =>
    p.id === id ? { id, kind: draft.kind, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() } : p,
  )
}

export function removeProvider(list: readonly AiProvider[], id: string): AiProvider[] {
  return list.filter((p) => p.id !== id)
}

/**
 * 列表上显示的那行字：地址里的主机名（本仓没有"名称"字段，Rust 的 `ProviderCfg`
 * 只有 id/kind/baseUrl/model —— 加第五个字段就是第二套 schema 的开端）。
 */
export function providerHost(baseUrl: string): string {
  const m = /^https?:\/\//.exec(baseUrl.trim())
  if (!m) return baseUrl.trim() || '（未填地址）'
  return hostOf(baseUrl.trim().slice(m[0].length).split('/')[0]) || '（未填地址）'
}

/**
 * 把 `ai_providers` 的返回折成两张按 id 查的表。
 *
 * 状态**不落盘**：它是一次探测的结果，重启后回到「未测试」，不假装记得。
 */
export function mergeProbe(views: readonly ProviderView[]): {
  ready: Record<string, boolean>
  keys: Record<string, boolean>
} {
  const ready: Record<string, boolean> = {}
  const keys: Record<string, boolean> = {}
  for (const v of views) {
    ready[v.id] = v.ready
    keys[v.id] = v.keyConfigured
  }
  return { ready, keys }
}

/**
 * 保存密钥这一步的裁决（纯函数，方便断言）：空密钥不保存 —— Rust 那边也会拒，
 * 但让它走到 IPC 再弹错，用户看到的是"点了保存没反应"之后的一条红字。
 * 成功时输入框**立刻清空**，草稿不留在任何地方（口令不回显）。
 */
export function keySaveOutcome(input: string): { ok: boolean; error: string | null; draftAfter: string } {
  if (!input.trim()) return { ok: false, error: '密钥不能为空', draftAfter: input }
  return { ok: true, error: null, draftAfter: '' }
}
