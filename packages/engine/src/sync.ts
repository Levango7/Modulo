/**
 * 多端同步的**判据层**（纯函数，不开浏览器、不碰网络、不碰磁盘）。
 *
 * 为什么这一层要独立存在：同步真正危险的不是传输，而是**「谁覆盖谁」**——判错一次就把
 * 用户另一台机器上的版面/便签/待办洗掉了，而且是在他点「同步」之后才发生，人来不及拦。
 * 所以把裁决做成纯函数：`(本机各段的时间戳+内容指纹, 远端各段) → 逐段动作`，
 * 每条判据都能在没有网络、没有磁盘的情况下逐条钉住；传输（Rust 侧 WebDAV）只是执行结果。
 *
 * 三条设计立场：
 *  ① **按段裁决，不整包覆盖**。一次同步里 layout 可能是本机新、cardData 可能是远端新，
 *     整包二选一一定会把一边洗掉。段清单见 `SYNC_SECTIONS`，只收"恢复后应该长得一样"的段
 *     （与 `src/vue/backup.ts` 同一口径），密钥、快捷键、各类缓存**一律不同步**。
 *  ② **不猜**。缺时间戳、时间戳不是有限正数、形状不认识 —— 一律判 `invalid` 并**什么都不动**，
 *     而不是按 0 参与比较（按 0 比较的代价是"一份坏远端文件把本机所有段判成更新"）。
 *  ③ **内容相同就不算冲突**。两台机器改同一份数据但改成同一个结果，用时间戳裁决会凭空多出
 *     一次覆盖，所以先比内容指纹（`hashOf`），相等直接 `skip`。
 *
 * `hashOf` 是 FNV-1a + djb2 两路拼出来的**非密码学**指纹，只用来回答"内容变没变"，
 * 不许当成完整性或身份凭据（真需要防篡改得走签名，那是另一件事）。
 */

import { normalizeUrl } from './watch.js'

/** 同步包格式版本；与 `LayoutDoc.schemaVersion`、备份包的 version 是三件不同的事 */
export const SYNC_KIND = 'modulo.sync'
export const SYNC_VERSION = 1

/**
 * 参与同步的段。**显式清单，不是扫出来的** —— 少一段顶多是"这个字段没同步"，
 * 多一段（比如把 `modulo.ai-settings.v1` 塞进来）就是密钥上云。
 * 口径抄 `src/vue/backup.ts`：外观与模板 id 进，桌面开关（快捷键要在 Rust 侧重新注册，
 * 写进去不等于生效）与各类机器缓存不进。
 */
export const SYNC_SECTIONS = ['layout', 'schemes', 'cardData', 'settings'] as const
export type SyncSection = (typeof SYNC_SECTIONS)[number]

export function isSyncSection(x: unknown): x is SyncSection {
  return typeof x === 'string' && (SYNC_SECTIONS as readonly string[]).includes(x)
}

/** 远端历史副本保留几份（与本地自动备份的环形 7 份同一条节奏） */
export const HISTORY_KEEP = 7
/** 设备标识的长度与字符集上限（它会被拼进远端文件名与日志，必须收紧） */
export const DEVICE_ID_MAX = 32
const DEVICE_ID_RE = /^[A-Za-z0-9._-]+$/
/** 段内时间戳：epoch 毫秒。用数字而不是 ISO 字符串是刻意的 —— 字符串比较依赖同一偏移量与小数位 */
export type StampMs = number

export interface SectionStamp {
  /** 这一段最后一次被谁改的时刻（epoch ms） */
  at: StampMs
  /** 改动者是哪台设备（用于"同一设备的重复上传"不算冲突） */
  dev: string
  /** 内容指纹（`hashOf`） */
  hash: string
}

export interface SyncSlot extends SectionStamp {
  body: unknown
}

export interface SyncBundle {
  kind: typeof SYNC_KIND
  version: number
  deviceId: string
  /** 这个包生成的时刻（只为"这份是哪天推上来的"，不参与裁决） */
  createdAt: StampMs
  sections: Partial<Record<SyncSection, SyncSlot>>
}

/** 裁决结果。`skip` = 两边一样；`upload`/`download` = 只有一边有；`local-wins`/`remote-wins` = 都有但不同 */
export type MergeAction = 'skip' | 'upload' | 'download' | 'local-wins' | 'remote-wins' | 'invalid'

export interface MergeDecision {
  section: SyncSection
  action: MergeAction
  /** 给人看的一句话（同时是单测的断言面：判据必须能自证为什么这么判） */
  reason: string
  /** 生效的那一份来自哪一侧；`skip`/`invalid` 时为 null */
  winner: 'local' | 'remote' | null
}

export interface BundleIssue {
  section: SyncSection
  problem: string
}

/**
 * 稳定的序列化：对象键**按字典序**输出，数组保持原序。
 *
 * 为什么要有它：内容指纹必须对"键的顺序"不敏感，否则 A 机存 `{"a":1,"b":2}`、
 * B 机存 `{"b":2,"a":1}`（同一份数据，序列化顺序不同）会被判成冲突并触发一次多余覆盖。
 * 顺序在这里不是格式差异，是同一件事的两种写法。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const parts = keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${parts.join(',')}}`
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** 内容指纹（**非密码学**，只回答"变没变"）。对键序不敏感，见 `stableStringify` */
export function hashOf(value: unknown): string {
  const s = stableStringify(value)
  return `${fnv1a(s)}${djb2(s)}`
}

/** 时间戳可用性：必须是有限正数。0 / 负数 / NaN / Infinity / 字符串都算坏 —— 不猜、不参与比较 */
export function stampOk(at: unknown): at is StampMs {
  return typeof at === 'number' && Number.isFinite(at) && at > 0
}

export function normalizeDeviceId(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.trim()
  if (!t || t.length > DEVICE_ID_MAX || !DEVICE_ID_RE.test(t)) return null
  return t
}

/**
 * 造一个设备标识。随机源注入而不是自己调 `Math.random`：
 * 这样"同一个种子造出来的 id 形状合法且落在字符集内"能被钉死，而不是靠运气。
 */
export function makeDeviceId(rand: () => number = Math.random): string {
  let out = 'dev-'
  for (let i = 0; i < 8; i += 1) {
    const r = rand()
    const safe = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0
    out += Math.floor(safe * 36).toString(36)
  }
  return out
}

/**
 * 逐段裁决。
 *
 * 输入两侧都是"段 → 戳"（远端那份从 `SyncBundle.sections` 摘出来，见 `stampsOf`）。
 * 清单固定按 `SYNC_SECTIONS` 走，**不 union 调用方多塞的键** —— 有人把
 * `ai-settings` 塞进来时，这里必须当它不存在，而不是替它做一次裁决。
 */
export function planMerge(
  local: Partial<Record<SyncSection, SectionStamp | null>>,
  remote: Partial<Record<SyncSection, SectionStamp | null>>,
): MergeDecision[] {
  const out: MergeDecision[] = []
  for (const section of SYNC_SECTIONS) {
    const l = local[section] ?? null
    const r = remote[section] ?? null

    if (l && !stampOk(l.at)) {
      out.push({ section, action: 'invalid', winner: null, reason: '本机这一段的时间戳不可用，不动任何一边' })
      continue
    }
    if (r && !stampOk(r.at)) {
      out.push({ section, action: 'invalid', winner: null, reason: '远端这一段的时间戳不可用，不动任何一边' })
      continue
    }

    if (!l && !r) continue // 两边都没有这一段：没有可裁决的对象，不产出行

    if (l && !r) {
      out.push({ section, action: 'upload', winner: 'local', reason: '只有本机有这一段，推上去' })
      continue
    }
    if (!l && r) {
      out.push({ section, action: 'download', winner: 'remote', reason: '只有远端有这一段，拉下来' })
      continue
    }
    const a = l as SectionStamp
    const b = r as SectionStamp
    if (a.hash === b.hash) {
      out.push({ section, action: 'skip', winner: null, reason: '两边内容一致（指纹相同），不搬运' })
      continue
    }
    if (b.at > a.at) {
      out.push({ section, action: 'remote-wins', winner: 'remote', reason: `远端更新（远端 ${b.at} > 本机 ${a.at}）` })
      continue
    }
    if (a.at > b.at) {
      out.push({ section, action: 'local-wins', winner: 'local', reason: `本机更新（本机 ${a.at} > 远端 ${b.at}）` })
      continue
    }
    // 时间戳相等而内容不同：真冲突。平局判本机，理由有两层 ——
    // ① 确定性：两侧都判"自己赢"才会收敛，都判对方赢会把同一次同步跑成乒乓；
    // ② 本机这份是用户眼前正在看的那份，覆盖它的视觉代价立刻可见，而远端那份要下次才发现。
    // 前提是设备标识不同（同一台设备重复上传不算冲突，两边时间戳本来就相等）。
    if (a.dev === b.dev) {
      out.push({ section, action: 'skip', winner: null, reason: '同一台设备推的同一时刻，按已同步处理' })
      continue
    }
    out.push({
      section,
      action: 'local-wins',
      winner: 'local',
      reason: `同一时刻两边内容不同（平局判本机，远端那份留在历史副本里）`,
    })
  }
  return out
}

/** 从包里摘戳（只认 `SYNC_SECTIONS` 里的段，包里的多余键忽略） */
export function stampsOf(bundle: Pick<SyncBundle, 'sections'>): Partial<Record<SyncSection, SectionStamp>> {
  const out: Partial<Record<SyncSection, SectionStamp>> = {}
  for (const section of SYNC_SECTIONS) {
    const slot = bundle.sections[section]
    if (slot) out[section] = { at: slot.at, dev: slot.dev, hash: slot.hash }
  }
  return out
}

/** 把本地各段组装成要推出去的包 */
export function buildBundle(
  input: Partial<Record<SyncSection, unknown>>,
  deviceId: string,
  now: number,
): SyncBundle {
  const dev = normalizeDeviceId(deviceId)
  if (!dev) throw new Error('buildBundle: 设备标识不合法（字符集或长度）')
  if (!stampOk(now)) throw new Error('buildBundle: 生成时刻不可用')
  const sections: Partial<Record<SyncSection, SyncSlot>> = {}
  for (const section of SYNC_SECTIONS) {
    const body = input[section]
    if (body === undefined) continue
    sections[section] = { at: now, dev, hash: hashOf(body), body }
  }
  return { kind: SYNC_KIND, version: SYNC_VERSION, deviceId: dev, createdAt: now, sections }
}

export interface BundleParse {
  bundle: SyncBundle | null
  /** 为什么不认这个包；空数组 = 认 */
  problems: string[]
  /** 形状对但某段坏掉时点名是哪段（界面要说"哪段没同步"，不能只说"失败了"） */
  sections: BundleIssue[]
}

/**
 * 容错解析远端那份 JSON。**坏包不等于空包**：解析不出来的时候必须让调用方拿到
 * 一条明确的"不认"，否则一个被截断的文件会被当成"远端没有这一段"，于是本机把远端覆盖掉。
 */
export function parseBundle(raw: string): BundleParse {
  const problems: string[] = []
  const sections: BundleIssue[] = []
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return { bundle: null, problems: ['不是合法 JSON，没有解析出任何段'], sections }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { bundle: null, problems: ['顶层不是对象'], sections }
  }
  const o = obj as Record<string, unknown>
  if (o.kind !== SYNC_KIND) problems.push(`kind 不是 ${SYNC_KIND}`)
  const version = o.version
  if (typeof version !== 'number' || !Number.isFinite(version)) problems.push('version 不是数字')
  else if (version > SYNC_VERSION) problems.push(`包格式 v${version} 高于本程序支持的 v${SYNC_VERSION}，拒绝按本格式读`)
  const deviceId = normalizeDeviceId(o.deviceId)
  if (!deviceId) problems.push('deviceId 缺失或不合法')
  if (!stampOk(o.createdAt)) problems.push('createdAt 不可用')
  if (typeof o.sections !== 'object' || o.sections === null || Array.isArray(o.sections)) {
    problems.push('sections 不是对象')
  }
  if (problems.length) return { bundle: null, problems, sections }

  const src = o.sections as Record<string, unknown>
  const out: Partial<Record<SyncSection, SyncSlot>> = {}
  for (const key of Object.keys(src)) {
    if (!isSyncSection(key)) {
      // 多余的键**不报错**：老版本或第三方写进来的段该被忽略，而不是让整包不可读。
      // 但密钥类段要单独喊一声 —— 它出现在远端包里意味着有人把不该同步的东西推上来了。
      sections.push({
        section: key as SyncSection,
        problem: /key|secret|token|ai-settings/i.test(key)
          ? '远端包里出现了疑似凭据的段，已忽略（本程序从不同步凭据）'
          : '不认识这一段，已忽略',
      })
      continue
    }
    const slot = src[key] as Partial<SyncSlot> | null
    if (
      !slot ||
      typeof slot !== 'object' ||
      !stampOk(slot.at) ||
      !normalizeDeviceId(slot.dev) ||
      typeof slot.hash !== 'string' ||
      !slot.hash
    ) {
      sections.push({ section: key, problem: '这一段的戳记不完整（时间戳/设备/指纹），已丢弃该段' })
      continue
    }
    out[key] = { at: slot.at, dev: slot.dev as string, hash: slot.hash, body: slot.body }
  }
  return {
    bundle: {
      kind: SYNC_KIND,
      version: version as number,
      deviceId: deviceId as string,
      createdAt: o.createdAt as number,
      sections: out,
    },
    problems,
    sections,
  }
}

export interface EndpointVerdict {
  ok: boolean
  /** 规范化后的端点（以 `/` 结尾）；`ok` 为 false 时不存在 */
  url?: string
  reason?: string
}

/**
 * 认一个 WebDAV 目录端点。
 *
 * 复用 `watch.ts` 那套边界判据而不是另写一份：https only、拒 userinfo、拒私有/保留网段与
 * 保留主机名。**代价要说清**：自家 NAS 的 `http://192.168.x.x` 或 `nas.local` 会被拒 ——
 * 与"连通性监控"那张卡同一条取舍，理由也一样（这条通道由程序真的去发请求，不是复制一段文字）。
 * 要同步自家 NAS 得给它一个公网 https 域名或反代。
 */
export function validateSyncEndpoint(input: string): EndpointVerdict {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, reason: '地址是空的' }
  if (raw.includes('?')) return { ok: false, reason: '同步端点不该带查询串' }
  // 百分号编码要先解一遍再查穿越：`..%2Fetc` 是同一件事的另一种写法，而 WebDAV 服务器会解它。
  // 解码失败（畸形编码）按"不认识"处理，不猜用户想指哪个目录。
  let decoded = raw
  if (raw.includes('%')) {
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return { ok: false, reason: '地址里有无法解析的百分号编码' }
    }
  }
  for (const form of [raw, decoded]) {
    if (/(^|[/.])\.\.([/.]|$)/.test(form)) return { ok: false, reason: '地址里有 ../，不允许目录穿越' }
  }
  const norm = normalizeUrl(raw)
  if (!norm) return { ok: false, reason: '要 https，且不能是内网/本机/云元数据地址' }
  const url = norm.endsWith('/') ? norm : `${norm}/`
  return { ok: true, url }
}

const NAME_RE = /^[A-Za-z0-9._-]+$/

/**
 * 把段名/文件名拼到端点后面。名字字符集收紧到 `[A-Za-z0-9._-]`，且**再查一遍穿越**：
 * 校验过的端点不该因为一次字符串拼接就变成能爬出目录的输入。
 */
export function joinSyncPath(baseUrl: string, name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`joinSyncPath: 不安全的文件名 ${JSON.stringify(name)}`)
  if (name === '.' || name === '..' || name.includes('..')) throw new Error('joinSyncPath: 目录穿越')
  return `${baseUrl}${name}`
}

/** 远端那份"当前同步状态"的文件名（固定名：覆盖写，历史留在 history 目录里） */
export const LIVE_NAME = 'live.json'
export const HISTORY_DIR = 'history/'

/** `sync-<ms>.json` —— 时间戳进文件名，环形旋转不需要读文件内容 */
export function historyName(at: number): string {
  if (!stampOk(at)) throw new Error('historyName: 时刻不可用')
  return `sync-${Math.floor(at)}.json`
}

/** 认文件名里的时刻；认不出来返回 null（**认不出来的远端文件一律不动**，见 planHistoryRotation） */
export function parseHistoryName(name: string): number | null {
  const m = /^sync-(\d+)\.json$/.exec(name)
  if (!m) return null
  const at = Number(m[1])
  return Number.isFinite(at) && at > 0 ? at : null
}

export interface Rotation {
  /** 该留的名字（含所有认不出时刻的文件 —— 留着不等于删） */
  keep: string[]
  /** 该删的名字：只可能是**认识的历史副本**里最旧的那些 */
  remove: string[]
}

/**
 * 历史副本环形旋转。
 *
 * 一条硬规矩：**不认识的文件名不进删除名单**。远端目录是用户自己的网盘，里面可能有他
 * 别的文件；把它们数进 keep 会误删，不数进 keep 又会算出错误的溢出量 —— 所以既不动它们、
 * 也不让它们占额度（占额度的话用户多放一个文件就能把该留的历史副本挤掉）。
 */
export function planHistoryRotation(names: readonly string[], keep: number = HISTORY_KEEP): Rotation {
  // 先按名字去重：PROPFIND 的清单里同一文件出现两次（分页重叠、或两侧读到同一份）
  // 不该占掉两个额度，否则一个重复项就能把该留的历史副本挤出去。
  const dated: { name: string; at: number }[] = []
  const untouched: string[] = []
  for (const n of new Set(names)) {
    const at = parseHistoryName(n)
    if (at === null) untouched.push(n)
    else dated.push({ name: n, at })
  }
  const limit = Number.isFinite(keep) && keep >= 0 ? Math.floor(keep) : HISTORY_KEEP
  // 毫秒就在名字里，去重后不可能同刻 —— 排序只剩这一个维度，两侧必然算出同一个结果
  dated.sort((a, b) => b.at - a.at)
  return {
    keep: [...dated.slice(0, limit).map((d) => d.name), ...untouched],
    remove: dated.slice(limit).map((d) => d.name),
  }
}

/** 同步一次要搬几段 —— 给界面的一句话口径（`invalid` 单独点名，它意味着"这次什么都别动"） */
export function summarizePlan(decisions: readonly MergeDecision[]): string {
  const count = (a: MergeAction) => decisions.filter((d) => d.action === a).length
  const up = count('upload') + count('local-wins')
  const down = count('download') + count('remote-wins')
  const bad = count('invalid')
  const parts: string[] = []
  if (up) parts.push(`推 ${up} 段`)
  if (down) parts.push(`拉 ${down} 段`)
  if (!parts.length && !bad) parts.push('两边一致，无需搬运')
  if (bad) parts.push(`${bad} 段时间戳不可用，这些段这次不动`)
  return parts.join('，')
}
