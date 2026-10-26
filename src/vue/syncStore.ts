/**
 * 同步设置 + **各段「本机最后写过」的戳**（`modulo.sync.v1`）。
 *
 * 为什么必须有戳：`planMerge` 比的是"这一段谁更新"，而今天的存储里**没有任何时间戳** ——
 * 直接拿 `Date.now()` 当本机的时间，等于每次同步都宣称"本机最新"，远端的新数据永远拉不下来。
 * 所以在这里记两件事：这一段最后一次被**本机写入**的时刻，以及那一次的**内容指纹**。
 *
 * 戳怎么来：`main.ts` 用一个薄包装器盯 `storage.set`（见 `watchSectionWrites`），
 * 只要写的是参与同步的那几个 key（版面 / 方案册 / 卡片内容 / 外观 / 模板），就记一笔。
 * 不侵入任何调用点 —— 想靠"每处保存时手动调一下"来维护，迟早漏掉一条。
 *
 * **文件里没有口令**：这里只存端点、用户名、是否记住口令、上次同步时刻与各段戳。
 * 口令要么只在内存（默认），要么在系统凭据库（勾了「记住口令」，见 Rust `webdav.rs`）。
 */

import { hashOf, makeDeviceId, type SectionStamp, type SyncSection } from '@levango7/engine/sync'
import type { StorageAdapter } from './store'

export const SYNC_KEY = 'modulo.sync.v1'

export interface SyncSettings {
  endpoint: string
  user: string
  /** 本机标识：第一次进设置页时生成，之后不变（它用来区分"同一台设备的重复上传"） */
  deviceId: string
  /** 勾了才把口令写系统凭据库；没勾就只在本次运行的内存里 */
  remember: boolean
  /**
   * 自动同步（默认关）。**只搬运"不需要抉择"的那一半**：
   * 没有要下载的段才会上传；有下载时只提示、不落地（见 useSync 的 autoTick）。
   */
  auto: boolean
  lastSyncAt: number | null
}

export const EMPTY_SETTINGS: SyncSettings = { endpoint: '', user: '', deviceId: '', remember: false, auto: false, lastSyncAt: null }

/**
 * 参与同步的段 → 对应的存储 key。`settings` 段由两个 key 组成（外观 + 上次选的模板），
 * 谁后写就以谁的时刻为准 —— 它们本来就是同一个"设置段"。
 */
export const SECTION_KEYS: Record<SyncSection, readonly string[]> = {
  layout: ['modulo.layout.v1'],
  schemes: ['modulo.schemes.v1'],
  cardData: ['modulo.carddata.v1'],
  settings: ['modulo.appearance.v1', 'modulo.template.v1'],
}

const KEY_TO_SECTION: ReadonlyMap<string, SyncSection> = new Map(
  (Object.entries(SECTION_KEYS) as [SyncSection, readonly string[]][]).flatMap(([s, keys]) => keys.map((k) => [k, s] as [string, SyncSection])),
)

export interface SyncState {
  settings: SyncSettings
  stamps: Partial<Record<SyncSection, SectionStamp>>
}

function asString(x: unknown): string {
  return typeof x === 'string' ? x : ''
}

/** 盘上不可信：逐字段校验，坏字段回默认而不是整份报废（与备份索引同一条纪律） */
export function parseSyncState(raw: string | null): SyncState {
  const out: SyncState = { settings: { ...EMPTY_SETTINGS }, stamps: {} }
  if (!raw) return out
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return out
  }
  if (typeof obj !== 'object' || obj === null) return out
  const o = obj as Record<string, unknown>
  out.settings = {
    endpoint: asString(o.endpoint),
    user: asString(o.user),
    deviceId: asString(o.deviceId),
    remember: o.remember === true,
    auto: o.auto === true,
    lastSyncAt: typeof o.lastSyncAt === 'number' && Number.isFinite(o.lastSyncAt) && o.lastSyncAt > 0 ? o.lastSyncAt : null,
  }
  const stamps = o.stamps
  if (typeof stamps === 'object' && stamps !== null && !Array.isArray(stamps)) {
    for (const [section, value] of Object.entries(stamps as Record<string, unknown>)) {
      if (!(section in SECTION_KEYS)) continue // 不认识/已下线的段直接丢
      if (typeof value !== 'object' || value === null) continue
      const v = value as Record<string, unknown>
      const at = v.at
      const dev = v.dev
      const hash = v.hash
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) continue
      if (typeof dev !== 'string' || !dev) continue
      if (typeof hash !== 'string' || !hash) continue
      out.stamps[section as SyncSection] = { at, dev, hash }
    }
  }
  return out
}

export function serializeSyncState(state: SyncState): string {
  return JSON.stringify({ ...state.settings, stamps: state.stamps })
}

/**
 * 写的时候顺手记戳。**解析不了就不记** —— 记一个基于原文的指纹会让"同一份数据的两种写法"
 * 永远不相等（远端的指纹是对解析后的对象算的），于是每次同步都判冲突。
 */
export function stampForWrite(value: string, dev: string, now: number): SectionStamp | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return { at: now, dev, hash: hashOf(parsed) }
}

export function sectionOfKey(key: string): SyncSection | null {
  return KEY_TO_SECTION.get(key) ?? null
}

export interface SyncStore {
  state(): SyncState
  /** 改设置（不改戳）。写盘失败会抛给调用方 —— 设置存不下来要让人知道 */
  patch(p: Partial<SyncSettings>): void
  /** 记一次本机写；不是参与同步的 key、或内容解析不了时静默忽略 */
  recordWrite(key: string, value: string): void
  /** 拉下来之后把戳对齐成远端的（内容已经一样，不该再算"本机更新"） */
  setStamps(stamps: Partial<Record<SyncSection, SectionStamp>>): void
}

/**
 * @param now 注入时钟：单测要能钉死"写一笔就是这一毫秒"，不能依赖真实时间
 */
export function createSyncStore(storage: StorageAdapter, opts: { now?: () => number } = {}): SyncStore {
  const now = opts.now ?? (() => Date.now())
  let state = parseSyncState(storage.get(SYNC_KEY))
  // 设备标识：第一次用到时生成并落盘。没有它也能同步（判据只会更保守，多一次"平局判本机"）
  if (!state.settings.deviceId) {
    state = { ...state, settings: { ...state.settings, deviceId: makeDeviceId() } }
    void persist()
  }

  function persist(): boolean {
    try {
      storage.set(SYNC_KEY, serializeSyncState(state))
      return true
    } catch {
      return false
    }
  }

  return {
    state: () => state,
    patch(p) {
      state = { ...state, settings: { ...state.settings, ...p } }
      if (!persist()) throw new Error('同步设置没能写进本机存储')
    },
    recordWrite(key, value) {
      const section = sectionOfKey(key)
      if (!section) return
      const stamp = stampForWrite(value, state.settings.deviceId, now())
      if (!stamp) return
      state = { ...state, stamps: { ...state.stamps, [section]: stamp } }
      persist()
    },
    setStamps(stamps) {
      state = { ...state, stamps: { ...state.stamps, ...stamps } }
      persist()
    },
  }
}

/**
 * 给存储适配器套一层：写参与同步的 key 时顺手记戳。**其它行为一律透传**，
 * 包括 `error` 这类额外字段 —— 包装器不该改变原有契约。
 */
export function watchSectionWrites<T extends StorageAdapter>(inner: T, store: SyncStore): T {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'set') {
        return (key: string, value: string) => {
          target.set(key, value)
          store.recordWrite(key, value)
        }
      }
      return Reflect.get(target, prop, receiver) as unknown
    },
  }) as T
}
