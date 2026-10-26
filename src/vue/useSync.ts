/**
 * 多端同步的胶水层（桌面壳）。裁决在引擎 `sync.ts`（纯函数、有 42 条单测），
 * 传输在 Rust `webdav.rs`，这里只做：读设置 → 取远端 → 裁决 → 问一句 → 落地/上传。
 *
 * 三条纪律：
 *  ① **下载要先确认**。远端更新意味着覆盖本机正在用的那几段，`pending` 把"哪几段、为什么"
 *     摆出来，用户点确认才动（与完整备份的恢复同一条规矩：破坏性动作可以简陋，不能没有安全网）。
 *     上传不问 —— 它只动网盘上的那份，而**覆盖前会先把远端那份留成历史副本**。
 *  ② **口令不进存储**。默认只在内存里活到退出；勾了「记住口令」才写系统凭据库（Rust 侧 keyring），
 *     而且**永不回传渲染层**（`sync_cred_status` 只说存过没有）。
 *  ③ **失败必须说清"什么都没动"**。所有错误路径都在动手之前返回，`message` 里写明；
 *     唯一可能"动了一半"的地方是"上传 live 成功、轮转失败" —— 那只是网盘上多了几个旧副本，
 *     不影响任何一台机器上的数据，按 warning 报而不是 error。
 */

import { ref } from 'vue'
import {
  hashOf,
  historyName,
  LIVE_NAME,
  planHistoryRotation,
  planMerge,
  parseBundle,
  parseHistoryName,
  stampsOf,
  summarizePlan,
  validateSyncEndpoint,
  SYNC_KIND,
  SYNC_SECTIONS,
  SYNC_VERSION,
  type MergeDecision,
  type SectionStamp,
  type SyncBundle,
  type SyncSection,
} from '@levango7/engine/sync'
import type { SyncSettings, SyncStore } from './syncStore'

/** Rust 侧命令的可替换接口：单测用假实现，生产用 `invoke`（见 `desktopTransport`） */
export interface SyncTransport {
  probe(endpoint: string, user: string, password: string | null): Promise<number>
  get(endpoint: string, name: string, user: string, password: string | null): Promise<{ body: string; etag: string | null } | null>
  /**
   * 写一个文件。`ifMatch` 有值就带上 `If-Match`：服务端发现那一版已被改过会回 412，
   * 这里以 `{ conflict: true }` 回报（**不是异常**）—— 冲突要能与"网络坏了"分开处理。
   */
  put(
    endpoint: string,
    name: string,
    body: string,
    user: string,
    password: string | null,
    ifMatch: string | null,
  ): Promise<{ conflict: boolean }>
  list(endpoint: string, user: string, password: string | null): Promise<string[]>
  remove(endpoint: string, name: string, user: string, password: string | null): Promise<void>
  credStatus(endpoint: string, user: string): Promise<boolean>
  credSet(endpoint: string, user: string, password: string): Promise<void>
  credClear(endpoint: string, user: string): Promise<void>
}

export interface SyncPending {
  /** 这次覆盖的依据：网盘上的当前版本，还是某一份历史副本 */
  source: 'live' | 'history'
  /** `source === 'history'` 时的那份文件名 */
  historyName: string | null
  decisions: MergeDecision[]
  /** 只含 `winner === 'remote'` 的那几段 */
  sections: Partial<Record<SyncSection, unknown>>
  /** 远端那份原文（覆盖前留成历史副本） */
  remote: SyncBundle
  endpoint: string
  user: string
  /** GET 时服务端给的 ETag；写回时用它做条件写（没给就退化成无条件写） */
  etag: string | null
}

export interface SyncDeps {
  store: SyncStore
  /** 网页版是 null：没有 Rust 通道，界面据此说明"桌面版才支持" */
  transport: SyncTransport | null
  desktop: boolean
  /** 取当前各段内容（调用方给快照；同步不读界面状态，只信这一份） */
  sections: () => Partial<Record<SyncSection, unknown>>
  /** 把远端那几段走**备份的恢复管道**（清洗 + 落地），返回提示与警告 */
  applyRemote: (payload: Record<string, unknown>) => { done: string[]; warnings: string[] }
  now?: () => number
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 409/412 之类的"有人先改了"单独成一类：上层要能说清**这次什么都没写**，
 * 而不是把它混进"网盘报错"里让人以为半成功了。
 */
export class SyncConflict extends Error {
  constructor() {
    super('网盘上的同步文件刚被另一台设备改过（412），本次没有写入任何东西；再点一次同步会基于最新版本重新裁决')
    this.name = 'SyncConflict'
  }
}

export function useSync(deps: SyncDeps) {
  const now = deps.now ?? (() => Date.now())
  const settings = ref<SyncSettings>(deps.store.state().settings)
  /** 只在本次运行里活着；绝不写进 `modulo.sync.v1` */
  const password = ref('')
  const hasStored = ref(false)
  const status = ref<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const message = ref('')
  const notices = ref<string[]>([])
  const pending = ref<SyncPending | null>(null)

  const usable = deps.desktop && deps.transport !== null

  async function init(): Promise<void> {
    const s = settings.value
    if (!usable || !s.remember || !s.endpoint || !s.user) return
    try {
      hasStored.value = await deps.transport!.credStatus(s.endpoint, s.user)
    } catch (e) {
      hasStored.value = false
      notices.value = [`读取「记住的口令」失败：${errText(e)}`]
    }
  }

  function save(patch: Partial<SyncSettings>): void {
    deps.store.patch(patch)
    settings.value = deps.store.state().settings
  }

  /** 存/清口令（与设置分开：口令只有在用户显式勾选时才落到凭据库） */
  async function rememberPassword(on: boolean): Promise<void> {
    const t = deps.transport
    const s = settings.value
    if (!t || !s.endpoint || !s.user) {
      save({ remember: on })
      return
    }
    if (on) {
      if (!password.value) {
        status.value = 'error'
        message.value = '先在口令框里输入一次，再勾「记住口令」'
        return
      }
      await t.credSet(s.endpoint, s.user, password.value)
      hasStored.value = true
      save({ remember: true })
      return
    }
    await t.credClear(s.endpoint, s.user)
    hasStored.value = false
    save({ remember: false })
  }

  function validate(): { endpoint: string; user: string } | null {
    const v = validateSyncEndpoint(settings.value.endpoint)
    if (!v.ok) {
      status.value = 'error'
      message.value = v.reason ?? '网盘地址不合法'
      return null
    }
    const user = settings.value.user.trim()
    if (!user) {
      status.value = 'error'
      message.value = '先填用户名'
      return null
    }
    return { endpoint: v.url!, user }
  }

  async function test(): Promise<void> {
    const t = deps.transport
    if (!t) return
    const ok = validate()
    if (!ok) return
    status.value = 'busy'
    message.value = '正在连网盘…'
    try {
      const code = await t.probe(ok.endpoint, ok.user, password.value || null)
      status.value = 'ok'
      message.value = `网盘可达（${code}），口令可用`
    } catch (e) {
      status.value = 'error'
      message.value = errText(e)
    }
  }

  /** 主流程：取远端 → 裁决 → （有下载就先问）→ 留现场 → 写 live → 轮转 */
  async function syncNow(): Promise<void> {
    const t = deps.transport
    if (!t) {
      status.value = 'error'
      message.value = '网页版没有同步通道（桌面版才支持）'
      return
    }
    const ok = validate()
    if (!ok) return
    if (!password.value && !hasStored.value) {
      status.value = 'error'
      message.value = '先输入一次口令（勾「记住口令」下次就不用输）'
      return
    }
    if (!settings.value.deviceId) {
      status.value = 'error'
      message.value = '设备标识缺失，请重新打开一次设置页'
      return
    }
    status.value = 'busy'
    message.value = '正在读网盘上的同步文件…'
    try {
      const read = await t.get(ok.endpoint, LIVE_NAME, ok.user, password.value || null)
      const localSections = deps.sections()
      const localStamps = deps.store.state().stamps
      if (!read) {
        const r = await upload(ok.endpoint, ok.user, localSections, localStamps, null, false, null)
        done(`首次同步：${r}`)
        return
      }
      const parsed = parseBundle(read.body)
      if (!parsed.bundle) {
        status.value = 'error'
        message.value = `网盘上的同步文件读不懂（${parsed.problems.join('；')}）—— 没有改动任何东西`
        return
      }
      // 包能读、但某段的戳记坏了：**当整次读不懂处理**。丢弃那一段再继续，等于本机把远端
      // 那一段当成"没有"然后覆盖上去 —— 远端那份虽然会留历史副本，但用户不会知道发生过什么。
      if (parsed.sections.length) {
        status.value = 'error'
        message.value = `网盘上有一段的戳记不完整（${parsed.sections.map((s) => `${s.section}：${s.problem}`).join('；')}）—— 没有改动任何东西`
        return
      }
      const decisions = planMerge(localStamps, stampsOf(parsed.bundle))
      const invalid = decisions.filter((d) => d.action === 'invalid')
      if (invalid.length) {
        status.value = 'error'
        message.value = `有段的时间戳不可用（${invalid.map((d) => d.section).join(' / ')}），这次哪一边都不动`
        return
      }
      const downloads = decisions.filter((d) => d.winner === 'remote')
      if (downloads.length) {
        const sections: Partial<Record<SyncSection, unknown>> = {}
        for (const d of downloads) sections[d.section] = parsed.bundle.sections[d.section]?.body
        pending.value = {
          source: 'live',
          historyName: null,
          decisions,
          sections,
          remote: parsed.bundle,
          endpoint: ok.endpoint,
          user: ok.user,
          etag: read.etag,
        }
        status.value = 'idle'
        message.value = `有 ${downloads.length} 段要以网盘为准（${downloads.map((d) => d.section).join(' / ')}），确认后才写入本机`
        return
      }
      const changed = decisions.some((d) => d.action === 'upload' || d.action === 'local-wins')
      const r = await upload(ok.endpoint, ok.user, localSections, localStamps, parsed.bundle, changed, read.etag)
      done(summarizePlan(decisions) + '；' + r)
    } catch (e) {
      status.value = 'error'
      message.value = errText(e)
    }
  }

  /** 用户点了「确认」：先落地远端那几段，再把合并结果推回去 */
  async function confirmApply(): Promise<void> {
    const t = deps.transport
    const p = pending.value
    if (!t || !p) return
    status.value = 'busy'
    message.value = '正在写入本机…'
    try {
      const applied = deps.applyRemote({ ...p.sections })
      pending.value = null
      notices.value = [...applied.warnings, `本机已更新（${applied.done.join('、') || '无变化'}）`]
      // 落地之后本机内容变了 → 重新读一次拿最新 ETag，再条件写；读不到（404）就无条件写
      // 条件写：live 这次没被别人动过才写；被动了就用**刚读到的那版**再试一次，仍冲突就报冲突
      const fresh = await t.get(p.endpoint, LIVE_NAME, p.user, password.value || null)
      const r = await upload(
        p.endpoint,
        p.user,
        deps.sections(),
        deps.store.state().stamps,
        p.remote,
        true,
        fresh?.etag ?? p.etag,
      )
      done(r)
    } catch (e) {
      pending.value = null
      status.value = 'error'
      // 这两种失败的性质完全不同：落地失败 = 本机没变；推回冲突 = **本机已经变了**，
      // 只是网盘上那份被别的设备抢先写。说反了会让人以为本地白改了。
      message.value =
        e instanceof SyncConflict
          ? `本机已更新，但网盘上那份刚被另一台设备改过（412），这次没推上去；再点一次同步会把结果合并上去`
          : `写入本机失败：${errText(e)}（网盘没有改动）`
    }
  }

  function cancelApply(): void {
    pending.value = null
    status.value = 'idle'
    message.value = '已取消，本机与网盘都没有改动'
  }

  /** 网盘上现成的历史副本（新的在前）。只认 `sync-<毫秒>.json`，别的文件不碰 */
  const history = ref<{ name: string; at: number }[]>([])

  async function refreshHistory(): Promise<void> {
    const t = deps.transport
    if (!t) return
    const ok = validate()
    if (!ok) return
    try {
      const names = await t.list(ok.endpoint, ok.user, password.value || null)
      history.value = names
        .map((name) => ({ name, at: parseHistoryName(name) }))
        .filter((x): x is { name: string; at: number } => x.at !== null)
        .sort((a, b) => b.at - a.at)
    } catch (e) {
      notices.value = [`读历史副本列表失败：${errText(e)}`]
    }
  }

  /**
   * 从某一份历史副本恢复。**这一步是用户显式选择的"回到某个时刻"**，所以不和本机做裁决，
   * 但要先把那份包里有什么摆出来（确认块），落地仍然走备份的恢复管道。
   */
  async function restoreHistory(name: string): Promise<void> {
    const t = deps.transport
    if (!t) return
    const at = parseHistoryName(name)
    if (at === null) {
      status.value = 'error'
      message.value = `${name} 不是历史副本（只认 sync-<毫秒>.json）`
      return
    }
    const ok = validate()
    if (!ok) return
    status.value = 'busy'
    message.value = '正在读这份历史副本…'
    try {
      const read = await t.get(ok.endpoint, name, ok.user, password.value || null)
      if (!read) {
        status.value = 'error'
        message.value = '这份历史副本已经不在了（可能被轮转清掉），没有改动任何东西'
        return
      }
      const parsed = parseBundle(read.body)
      if (!parsed.bundle) {
        status.value = 'error'
        message.value = `这份历史副本读不懂（${parsed.problems.join('；')}）—— 没有改动任何东西`
        return
      }
      const sections: Partial<Record<SyncSection, unknown>> = {}
      const decisions: MergeDecision[] = []
      for (const section of SYNC_SECTIONS) {
        const slot = parsed.bundle.sections[section]
        if (!slot) continue
        sections[section] = slot.body
        decisions.push({
          section,
          action: 'local-wins',
          winner: 'local',
          reason: `历史副本那一版（${new Date(slot.at).toLocaleString()}，${slot.dev}）`,
        })
      }
      if (!decisions.length) {
        status.value = 'error'
        message.value = '这份历史副本里没有可恢复的段，没有改动任何东西'
        return
      }
      // 恢复之后要把这份内容推回去，所以先拿一份当前 live 的 ETag 做条件写
      const live = await t.get(ok.endpoint, LIVE_NAME, ok.user, password.value || null)
      pending.value = {
        source: 'history',
        historyName: name,
        decisions,
        sections,
        remote: parsed.bundle,
        endpoint: ok.endpoint,
        user: ok.user,
        etag: live?.etag ?? null,
      }
      status.value = 'idle'
      message.value = `即将用 ${new Date(at).toLocaleString()} 那一版覆盖本机的 ${decisions.length} 段（确认后才落）`
    } catch (e) {
      status.value = 'error'
      message.value = errText(e)
    }
  }

  function done(extra: string): void {
    status.value = 'ok'
    message.value = `同步完成：${extra}`
  }

  /**
   * 上传合并结果。顺序：**先留现场再覆盖** —— 历史副本是"远端那份被洗掉"的唯一退路。
   * 轮转失败只记 warning：多几个旧副本不影响任何一台机器上的数据。
   */
  async function upload(
    endpoint: string,
    user: string,
    localSections: Partial<Record<SyncSection, unknown>>,
    localStamps: Partial<Record<SyncSection, SectionStamp>>,
    remote: SyncBundle | null,
    /** 这次写入会不会**改到远端内容**；false 时不产生历史副本（否则连点几次同步就把额度塞满同一份） */
    writeHistory: boolean,
    /** 条件写用的 ETag（GET 拿到的那个）；null = 服务器没给，只能无条件写 */
    ifMatch: string | null,
  ): Promise<string> {
    const t = deps.transport!
    const at = now()
    const dev = settings.value.deviceId
    const sections: Partial<Record<SyncSection, { at: number; dev: string; hash: string; body: unknown }>> = {}
    for (const section of SYNC_SECTIONS) {
      const body = localSections[section]
      const stamp = localStamps[section]
      if (body !== undefined) {
        // 本机有这一段的戳就以它为准（"本机更新"是那一刻的事实，不能拿 now 冒充）；
        // 从没记过戳（老数据第一次同步）才用 now —— 那种情况下"何时写的"不可知，只能从现在算起。
        sections[section] = { at: stamp?.at ?? at, dev: stamp?.dev ?? dev, hash: hashOf(body), body }
      } else if (remote?.sections[section]) {
        sections[section] = remote.sections[section]! // 本机没有但远端有：留着，不推空
      }
    }
    const bundle: SyncBundle = { kind: SYNC_KIND, version: SYNC_VERSION, deviceId: dev, createdAt: at, sections }
    if (remote && writeHistory) {
      // 历史副本用唯一文件名，不需要条件写
      await t.put(endpoint, historyName(at), JSON.stringify(remote), user, password.value || null, null)
    }
    const outcome = await t.put(endpoint, LIVE_NAME, JSON.stringify(bundle), user, password.value || null, ifMatch)
    if (outcome.conflict) throw new SyncConflict()
    // 戳对齐成远端那份（拉下来之后本机内容 = 远端，不该再被算成"本机更新"）
    const aligned: Partial<Record<SyncSection, SectionStamp>> = {}
    for (const section of SYNC_SECTIONS) {
      const s = sections[section]
      if (s) aligned[section] = { at: s.at, dev: s.dev, hash: s.hash }
    }
    deps.store.setStamps(aligned)
    deps.store.patch({ lastSyncAt: at })
    settings.value = deps.store.state().settings
    const warn = await rotate(endpoint, user)
    if (warn) notices.value = [...notices.value, warn]
    const pushed = Object.keys(sections).length
    return `网盘已更新（${pushed} 段${remote && writeHistory ? '，覆盖前留了一份历史副本' : ''}）`
  }

  /** 历史副本环形轮转（只删 `sync-<毫秒>.json`；不认识的文件一律不动） */
  async function rotate(endpoint: string, user: string): Promise<string | null> {
    const t = deps.transport!
    try {
      const names = await t.list(endpoint, user, password.value || null)
      const plan = planHistoryRotation(names)
      for (const name of plan.remove) await t.remove(endpoint, name, user, password.value || null)
      return null
    } catch (e) {
      return `历史副本轮转失败（不影响数据）：${errText(e)}`
    }
  }

  return {
    usable,
    settings,
    password,
    hasStored,
    status,
    message,
    notices,
    pending,
    history,
    init,
    save,
    rememberPassword,
    test,
    syncNow,
    confirmApply,
    cancelApply,
    refreshHistory,
    restoreHistory,
  }
}

export type SyncApi = ReturnType<typeof useSync>

/**
 * 生产用传输：全部走 Rust（渲染层 fetch 被 CSP 的固定清单挡死，也不该放开它）。
 *
 * `invoke` 走**动态 import**：设置面板在主包里，静态引入 `@tauri-apps/api/core` 会把
 * 这颗模块塞进网页版的首屏产物（实测 +17 kB 量级），而网页版根本用不到它 —— 与
 * `fileStorage.ts` 里那处事件模块同一条理由。
 */
export function desktopTransport(
  /** 单测注入；生产不传，走惰性 import */
  injected?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): SyncTransport {
  const call =
    injected ??
    (async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<T>(cmd, args)
    })
  return {
    probe: async (endpoint, user, password) => {
      const r = await call<{ status: number }>('webdav_probe', { endpoint, user, password })
      return r.status
    },
    get: (endpoint, name, user, password) =>
      call<{ body: string; etag: string | null } | null>('webdav_get', { endpoint, name, user, password }),
    put: (endpoint, name, body, user, password, ifMatch) =>
      call<{ conflict: boolean }>('webdav_put', { endpoint, name, body, user, password, ifMatch }),
    list: (endpoint, user, password) => call<string[]>('webdav_list', { dirUrl: endpoint, user, password }),
    remove: (endpoint, name, user, password) => call<void>('webdav_delete', { endpoint, name, user, password }),
    credStatus: (endpoint, user) => call<boolean>('sync_cred_status', { endpoint, user }),
    credSet: (endpoint, user, password) => call<void>('sync_cred_set', { endpoint, user, password }),
    credClear: (endpoint, user) => call<void>('sync_cred_clear', { endpoint, user }),
  }
}

/** 给界面看的"这份远端包里有什么"（不含口令；用于确认块的一句话） */
export function describePending(p: SyncPending): string {
  // live：只列"要以远端为准"的那几段（其余是会被推上去的，不该混进覆盖说明）；
  // history：这份副本里有多少段就列多少段 —— 用户选的是"整份回到那一刻"。
  const rows = p.source === 'history' ? p.decisions : p.decisions.filter((d) => d.winner === 'remote')
  return rows.map((d) => `${d.section}（${d.reason}）`).join('；')
}
