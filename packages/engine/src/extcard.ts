/**
 * 原生卡扩展（路线第三层，2026-10-27）：用户导入一个「卡包」—— 一段 JSON（manifest +
 * 入口 HTML）—— 宿主把它注册成一张**一等公民卡片**：进模块库、按 manifest 的尺寸契约
 * 钳制与降档、可多开、可脱离浮窗。
 *
 * ## 与前两层的关系（三层各补一块，别互相越界）
 *
 *   声明式扩展（`http.ts`）：填 URL + 取值路径 —— 零代码，但只能"取数"。
 *   HTML 扩展（`htmlcard.ts`）：写一段片段 —— 任意前端能力，但它是孤儿：没有尺寸契约、
 *     进不了模块库、没有自己的持久状态、碰不到宿主。
 *   原生卡扩展（本文件）：补上最后三块 —— **manifest 给它尺寸契约与库位**、
 *     **extState 给它记忆**、**桥给它最小的宿主能力**。入口 HTML 与片段同构，
 *     注入防线原样复用 `snippetLiteral`（那一行 `</` 转义就是全部防线，别在输入层重造）。
 *
 * ## 安全模型（与 `htmlcard.ts` 同一条实测边界，不重新发明）
 *
 * - 渲染仍是 `sandbox="allow-scripts"`（无 `allow-same-origin` ⇒ opaque origin）：
 *   父级 DOM / 浏览器存储 / cookie 全部 SecurityError。桥是**唯一**新增通道，
 *   每条请求过 `parseBridgeRequest`（方法白名单 + 朴素 JSON + 字节上限）；
 *   信封三查（来源 / 标记 / 朴素 JSON）仍由宿主侧的 `isExtMessage` 承担。
 * - 能力面刻意小：getState / setState / notify 三个方法，**没有**"执行任意命令 /
 *   读任意数据"的方法 —— 能力每扩一个都要在这里过一遍理由，不是在组件里顺手加。
 * - manifest 是粘贴进来的**不可信数据**：`parseExtManifest` 逐字段校验并给一句人话原因，
 *   `sanitizeExtCards` 丢坏条、去重、砍上限 —— 与其它名单同一套骨架。
 * - 状态按**扩展**共享而不是按实例：与「卡内容按模块共享」的既有口径一致
 *   （两张待办卡本来就是同一份 todos），扩展没有理由独树一帜。
 */
import { LOGICAL_COLS, type ModuleDef, type ModuleRegistry, type VariantDef } from './types.js'
import { plainJson } from './htmlcard.js'

/** 一个工作台最多装几张扩展卡（与自定卡同量级，别让人把备份撑爆） */
export const MAX_EXT_CARDS = 8
/** 入口 HTML 上限（字符）—— 与自定卡的片段同一条线 */
export const MAX_EXT_HTML_BYTES = 16_000
export const MAX_EXT_TITLE = 24
/** 一句话说明（模块库里显示），超了截断而不是拒绝 —— 说明是给人看的，不是契约 */
export const MAX_EXT_BLURB = 60
export const MAX_EXT_GROUP = 12
export const MAX_EXT_VARIANTS = 4
/** 形态 minH 上限：12 行的卡已经占满一屏，再大的"最小高度"只可能是写错了 */
export const MAX_EXT_MIN_H = 12
/** 每份扩展状态的字节上限（`JSON.stringify` 后）—— 桥写盘前最后一道闸 */
export const MAX_EXT_STATE_BYTES = 16_384
/** notify 的正文上限（截断，不拒绝） */
export const MAX_EXT_NOTICE = 200
/** 扩展卡的模块 id 前缀：`ext:<id>`。冒号在浮窗 label 的允许字符集里（`floatwin.rs`） */
export const EXT_PREFIX = 'ext:'
/** 管理卡（导入 / 删除扩展卡的地方）的模块 id —— 与其它内置卡一样是静态注册表的一员 */
export const EXT_MANAGER_ID = 'extcard'
/** manifest 不写 group 时的默认分组 */
export const DEFAULT_EXT_GROUP = '扩展'

export interface ExtCard {
  id: string
  title: string
  group: string
  blurb: string
  variants: VariantDef[]
  html: string
}

/** 卡包 id：小写字母开头的小写字母/数字/连字符。它会进实例 id（`ext:<id>:2`）与浮窗 label，字符集必须安全 */
const EXT_ID_RE = /^[a-z][a-z0-9-]{0,23}$/

function intIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
}

export type ExtManifestResult = { ok: true; card: ExtCard } | { ok: false; reason: string }

/**
 * 解析并校验一份卡包。**给明确原因，不静默改写** —— 用户是把这段 JSON 粘进文本框的，
 * 校验失败时那句原因就是全部的错误提示，写不清等于没写。
 * 成功时返回的 card 是**归一化**过的（trim、默认值、形态表），调用方直接可用。
 */
export function parseExtManifest(raw: unknown): ExtManifestResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: '卡包必须是一个 JSON 对象（manifest 字段 + html 入口）' }
  }
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!EXT_ID_RE.test(id)) {
    return { ok: false, reason: 'id 只能是小写字母开头的小写字母/数字/连字符（1–24 位），比如 my-card' }
  }
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!title) return { ok: false, reason: 'title 不能为空 —— 模块库里它就是卡片名' }
  if (title.length > MAX_EXT_TITLE) return { ok: false, reason: `title 太长（上限 ${MAX_EXT_TITLE} 字）` }
  const group = typeof o.group === 'string' ? o.group.trim().slice(0, MAX_EXT_GROUP) : ''
  const blurb = typeof o.blurb === 'string' ? o.blurb.trim().slice(0, MAX_EXT_BLURB) : ''
  const html = typeof o.html === 'string' ? o.html : ''
  if (!html.trim()) return { ok: false, reason: 'html 不能为空 —— 卡包的入口就是这段 HTML' }
  if (html.length > MAX_EXT_HTML_BYTES) {
    return { ok: false, reason: `html 太长（${html.length} 字符，上限 ${MAX_EXT_HTML_BYTES}）` }
  }
  const rawVariants = Array.isArray(o.variants) ? o.variants : []
  if (rawVariants.length === 0) return { ok: false, reason: 'variants 至少要有一个形态（尺寸契约）' }
  if (rawVariants.length > MAX_EXT_VARIANTS) {
    return { ok: false, reason: `形态最多 ${MAX_EXT_VARIANTS} 个` }
  }
  const variants: VariantDef[] = []
  const seenVar = new Set<string>()
  for (const rv of rawVariants) {
    if (!rv || typeof rv !== 'object' || Array.isArray(rv)) {
      return { ok: false, reason: '每个形态必须是一个对象（id / name / minW / minH / idealW / idealH）' }
    }
    const vo = rv as Record<string, unknown>
    const vid = typeof vo.id === 'string' ? vo.id.trim() : ''
    if (!vid || vid.length > 16) return { ok: false, reason: '形态 id 必须是 1–16 位的字符串' }
    if (seenVar.has(vid)) return { ok: false, reason: `形态 id 重复：${vid}` }
    const vname = typeof vo.name === 'string' ? vo.name.trim() : ''
    if (!vname) return { ok: false, reason: `形态 ${vid} 的 name 不能为空` }
    const { minW, minH, idealW, idealH } = vo as {
      minW: unknown
      minH: unknown
      idealW: unknown
      idealH: unknown
    }
    if (!intIn(minW, 1, LOGICAL_COLS) || !intIn(minH, 1, MAX_EXT_MIN_H)) {
      return {
        ok: false,
        reason: `形态 ${vid} 的 minW/minH 必须是整数：minW 1–${LOGICAL_COLS}、minH 1–${MAX_EXT_MIN_H}`,
      }
    }
    if (
      !intIn(idealW, 1, LOGICAL_COLS) ||
      !intIn(idealH, 1, MAX_EXT_MIN_H) ||
      (idealW as number) < (minW as number) ||
      (idealH as number) < (minH as number)
    ) {
      return { ok: false, reason: `形态 ${vid} 的 idealW/idealH 不能小于 minW/minH` }
    }
    seenVar.add(vid)
    variants.push({ id: vid, name: vname, minW, minH, idealW, idealH })
  }
  return {
    ok: true,
    card: { id, title, group: group || DEFAULT_EXT_GROUP, blurb, variants, html },
  }
}

/** 清洗整份已装扩展名单：丢坏条、去重、砍上限（与 `sanitizeHtmlCards` 同一骨架） */
export function sanitizeExtCards(list: readonly unknown[]): { cards: ExtCard[]; rejected: number } {
  const cards: ExtCard[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const raw of list) {
    if (cards.length >= MAX_EXT_CARDS) break
    const r = parseExtManifest(raw)
    if (!r.ok) {
      rejected++
      continue
    }
    if (seen.has(r.card.id)) {
      rejected++
      continue
    }
    seen.add(r.card.id)
    cards.push(r.card)
  }
  return { cards, rejected }
}

export function extModuleId(id: string): string {
  return EXT_PREFIX + id
}

export function isExtModule(moduleId: string): boolean {
  return moduleId.startsWith(EXT_PREFIX)
}

export function extIdOf(moduleId: string): string {
  return moduleId.slice(EXT_PREFIX.length)
}

/** 扩展卡 → 注册表条目。第一个形态即默认形态（manifest 不单设 defaultVariant，少一个要校验的字段） */
export function extModuleDef(card: ExtCard): ModuleDef {
  return {
    id: extModuleId(card.id),
    title: card.title,
    group: card.group,
    blurb: card.blurb || undefined,
    defaultVariant: card.variants[0]?.id ?? 'std',
    variants: card.variants,
  }
}

/**
 * 合成「内置注册表 + 已装扩展」的扩展段。防御性再查一次 id 撞车（`ext:` 前缀在
 * 内置表里不存在，但 guard 花一行钱买"将来谁改了前缀也不炸"）。
 * **ext 段永远在尾部**：store 的原地 splice 依赖这一点。
 */
export function extModuleDefs(base: ModuleRegistry, cards: readonly ExtCard[]): ModuleDef[] {
  const baseIds = new Set(base.map((m) => m.id))
  const defs: ModuleDef[] = []
  const seen = new Set<string>()
  for (const c of cards) {
    const id = extModuleId(c.id)
    if (baseIds.has(id) || seen.has(id)) continue
    seen.add(id)
    defs.push(extModuleDef(c))
  }
  return defs
}

export type ExtMethod = 'getState' | 'setState' | 'notify'
export const EXT_METHODS: readonly ExtMethod[] = ['getState', 'setState', 'notify']

export interface BridgeRequest {
  rid: string
  method: ExtMethod
  args: unknown
}

/**
 * 桥请求解析。入口是**已经过了 `isExtMessage` 三查**的 payload —— 这里只管方法面：
 * rid 是 1–64 位字符串；method 在白名单里；args 按方法各自的形状与上限校验，
 * 不合规返回 null（宿主对 null 的处置是**不回话** —— 桥不回应不认识的请求，
 * 让枚举方法面的探测得不到任何回声）。
 */
export function parseBridgeRequest(payload: unknown): BridgeRequest | null {
  if (!payload || typeof payload !== 'object') return null
  const b = (payload as { bridge?: unknown }).bridge
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null
  const o = b as Record<string, unknown>
  const rid = o.rid
  if (typeof rid !== 'string' || !rid || rid.length > 64) return null
  const method = o.method
  if (typeof method !== 'string' || !EXT_METHODS.includes(method as ExtMethod)) return null
  const args = o.args
  if (method === 'setState') {
    const st = sanitizeExtState(args)
    if (!st.ok) return null
    return { rid, method, args: st.value }
  }
  if (method === 'notify') {
    const text =
      args && typeof args === 'object' && !Array.isArray(args) ? (args as { text?: unknown }).text : undefined
    if (typeof text !== 'string') return null
    const t = text.trim()
    if (!t) return null
    return { rid, method, args: { text: t.slice(0, MAX_EXT_NOTICE) } }
  }
  // getState：无参数。多余的 args 忽略 —— 宽进，能力面收在方法清单上
  return { rid, method, args: undefined }
}

export interface BridgeReply {
  __modulo: 'bridge'
  rid: string
  ok: boolean
  value?: unknown
  error?: string
}

/** 宿主 → 扩展的应答信封。失败也回（扩展在等一个 Promise），错误翻成一句话 */
export function bridgeReply(rid: string, ok: boolean, value?: unknown, error?: string): BridgeReply {
  if (ok) return { __modulo: 'bridge', rid, ok, value }
  return { __modulo: 'bridge', rid, ok: false, error: error || '桥请求没有完成' }
}

/**
 * 扩展状态校验：朴素 JSON（深度 ≤ 6、节点 ≤ 512，复用 `plainJson`）+ 序列化后字节上限。
 * `undefined` 归一成 null —— "清空状态"就是 setState(null)，不必单设 clear 方法。
 */
export function sanitizeExtState(v: unknown): { ok: boolean; reason?: string; value?: unknown } {
  if (!plainJson(v, 0)) {
    return { ok: false, reason: '状态必须是朴素 JSON（深度 ≤ 6、节点 ≤ 512）' }
  }
  const json = JSON.stringify(v ?? null)
  if (json.length > MAX_EXT_STATE_BYTES) {
    return { ok: false, reason: `状态太大（${json.length} 字节，上限 ${MAX_EXT_STATE_BYTES}）` }
  }
  return { ok: true, value: v ?? null }
}
