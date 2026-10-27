/**
 * 完整备份的胶水层：拼包在 `backup.ts`（纯函数），这里只做"下载 / 读文件 / 自动备份 / 问一句再覆盖"。
 *
 * 覆盖是破坏性的，所以导入走两步：**先解析并把事实摆出来（几个模块、几条待办、有没有便签），
 * 用户点了确认才落**。理由与 §10.12 那条一致 —— 破坏性动作可以简陋，但不能没有安全网；
 * 而这里比"载入推荐布局"更该有网，因为它动的是用户自己写的字。
 *
 * 2026-10-20（P0-③）加了两件事：
 *  ① **恢复改成整份回填**：此前只回填便签 / 待办 / 速记 / 倒数日，其余字段（记账、四象限、
 *     习惯、生日、链接、订阅、自选、自定卡……）静默丢失 —— 导出是全的、恢复是残的。
 *  ② **自动备份**：每日首次启动 / 恢复前 / 版本变化后的首启各留一份，环形 7 份。
 *     只存桌面（网页版 localStorage 有配额，不适合放 7 份整包）。
 */

import { computed, ref } from 'vue'
import * as E from '@levango7/engine'
import {
  applyCardData,
  BACKUP_VERSION,
  backupToJson,
  buildBackup,
  parseBackup,
  type BackupSettings,
  type BackupSummary,
  type ParsedBackup,
} from './backup'
import { downloadText, pickTextFile, stamp } from './fileIo'
import type { CardData } from './cardData'
import type { LayoutStore, StorageAdapter } from './store'
import type { SchemesApi } from './useSchemes'
import { isDesktop } from './useShell'

/** 与 package.json / Cargo.toml / Cargo.lock / tauri.conf.json 同源；发布时四处一起对齐 */
export const APP_VERSION = '0.8.7'

export interface PendingRestore extends BackupSummary {
  parsed: ParsedBackup
}

export type AutoReason = 'daily' | 'pre-restore' | 'pre-upgrade' | 'manual'

export interface AutoBackupMeta {
  slot: number
  at: string
  reason: AutoReason
  app: string
  version: number
  bytes: number
}

/**
 * 自动备份用的三个键名，**必须**逐个登记进 `fileStorage.ts` 的 `DATA_KEYS`：
 * 桌面壳的存储适配器是同步接口，`get` 只读启动时 hydrate 好的内存镜像，而镜像内容 = 那张表。
 * 漏登记不会报错，只会让"重启后读不到自己刚写的备份"（有单测钉住这条，见 tests/vue/useBackup.test.ts）。
 */
export const AUTO_INDEX_KEY = 'modulo.autobackup.index.v1'
export const AUTO_SLOT_COUNT = 7
const DAY_MS = 24 * 60 * 60 * 1000
export const autoSlotKey = (slot: number): string => `modulo.autobackup.slot.${slot}.v1`

const REASON_LABEL: Record<AutoReason, string> = {
  daily: '每日',
  'pre-restore': '恢复前',
  'pre-upgrade': '版本变化',
  manual: '手动',
}

/** 索引是盘上的不可信数据：逐项校验，坏条目丢掉而不是整份报废 */
function readAutoIndex(storage: StorageAdapter): AutoBackupMeta[] {
  try {
    const raw = storage.get(AUTO_INDEX_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is AutoBackupMeta => {
      if (typeof x !== 'object' || x === null) return false
      const m = x as Partial<AutoBackupMeta>
      return (
        typeof m.slot === 'number' &&
        Number.isInteger(m.slot) &&
        m.slot >= 0 &&
        m.slot < AUTO_SLOT_COUNT &&
        typeof m.at === 'string' &&
        Number.isFinite(Date.parse(m.at)) &&
        typeof m.reason === 'string' &&
        m.reason in REASON_LABEL &&
        typeof m.app === 'string' &&
        typeof m.version === 'number' &&
        typeof m.bytes === 'number'
      )
    })
  } catch {
    return []
  }
}

export interface ApplyTargets {
  store: LayoutStore
  schemes: SchemesApi
  cardData: CardData
  settings?: { apply(s: BackupSettings): void }
}

/**
 * 把一份**已解析**的备份落到内存与存储里：版面 / 方案册 / 卡片内容 / 设置，四处各过自己的清洗。
 *
 * 抽出来是给同步用的（多端同步拉下来的那几段走**同一条恢复管道** —— 远端文件同样是
 * 不可信输入，不该有第二条"更宽松"的落地路径），备份自己的 `confirmRestore` 也改调它，
 * 于是"恢复怎么做"只有一份实现。返回给人看的逐项说明。
 */
export function applyParsedSections(parsed: ParsedBackup, t: ApplyTargets): string[] {
  const done: string[] = []
  if (parsed.layout) {
    t.store.importJson(E.docToJson(parsed.layout))
    done.push(`版面 ${parsed.layout.items.length} 个模块`)
  }
  if (parsed.schemes) {
    const before = t.schemes.book.value.schemes.length
    t.schemes.mergeBook(parsed.schemes)
    done.push(`方案册 +${t.schemes.book.value.schemes.length - before} 条`)
  }
  if (parsed.cardData) {
    // 2026-10-20：整份回填（此前只回填四个字段，其余静默丢失）
    applyCardData(t.cardData, parsed.cardData)
    done.push(
      `内容 ${parsed.cardData.todos.length} 条待办 / ${parsed.cardData.notes.length} 条速记 / ${parsed.cardData.ledger.entries.length} 笔账`,
    )
  }
  if (parsed.settings && t.settings) {
    t.settings.apply(parsed.settings)
    done.push('外观设置')
  }
  return done
}

export interface BackupOptions {
  /** 自动备份要一个能按 key 读写的适配器；不传 = 只支持手动导出/导入 */
  storage?: StorageAdapter
  /** 覆盖"是不是桌面壳"（测试缝；生产不传，走 useShell 的判定） */
  desktop?: boolean
  /** 与外观实现解耦：useBackup 不知道 Appearance 的形状，只拿到"取一份 / 套一份" */
  settings?: { get(): BackupSettings; apply(s: BackupSettings): void }
}

export function useBackup(store: LayoutStore, schemes: SchemesApi, cardData: () => CardData, opts: BackupOptions = {}) {
  const storage = opts.storage
  const desktop = opts.desktop ?? isDesktop
  /** 待确认的恢复动作；非 null 时设置面板显示确认块 */
  const pending = ref<PendingRestore | null>(null)
  const notices = ref<string[]>([])
  const autoBackups = ref<AutoBackupMeta[]>([])
  const autoSupported = computed(() => desktop && !!storage)

  const snapshot = () =>
    buildBackup({
      layout: store.doc.value,
      schemes: schemes.book.value,
      cardData: cardData(),
      app: APP_VERSION,
      now: () => new Date(),
      settings: opts.settings?.get(),
    })

  function exportBackup(): void {
    const payload = snapshot()
    downloadText(`modulo-backup-${stamp()}.json`, backupToJson(payload))
    notices.value = [
      `已导出：${payload.layout.items.length} 个模块、${payload.cardData.todos.length} 条待办、${payload.cardData.notes.length} 条速记${payload.cardData.countdown.date ? '、倒数日' : ''}${payload.settings ? '、外观设置' : ''}`,
    ]
  }

  function ingest(raw: string, note: string | null): void {
    const parsed = parseBackup(raw, store.reg)
    if (parsed.kind === 'unknown') {
      pending.value = null
      notices.value = parsed.warnings
      return
    }
    pending.value = { ...parsed.summary, parsed }
    notices.value = note ? [note] : []
  }

  /** 选文件 → 解析 → 停在确认块。**不直接写**：解析结果要先给用户看 */
  async function chooseBackupToRestore(): Promise<void> {
    const raw = await pickTextFile()
    if (raw === null) return
    ingest(raw, null)
  }

  function refreshAuto(): void {
    autoBackups.value = storage
      ? readAutoIndex(storage).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      : []
  }

  /**
   * 写一份自动备份。环形 7 个槽：先找空槽，满了就覆盖最老的那份。
   * 返回 false = 环境不支持或写失败（调用方不该据此阻塞任何用户动作）。
   */
  function runAutoBackup(reason: AutoReason): boolean {
    if (!storage || !desktop) return false
    try {
      // 恢复前那份要快照"恢复前"的状态 —— 必须在 apply 之前调用（confirmRestore 开头就是这么排的）
      const json = backupToJson(snapshot())
      const list = readAutoIndex(storage)
      let slot = [...Array(AUTO_SLOT_COUNT).keys()].find((n) => !list.some((m) => m.slot === n))
      if (slot === undefined) {
        const oldest = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
        slot = oldest.slot
        const i = list.indexOf(oldest)
        if (i >= 0) list.splice(i, 1)
      }
      storage.set(autoSlotKey(slot), json)
      list.push({ slot, at: new Date().toISOString(), reason, app: APP_VERSION, version: BACKUP_VERSION, bytes: json.length })
      storage.set(AUTO_INDEX_KEY, JSON.stringify(list))
      refreshAuto()
      return true
    } catch {
      return false
    }
  }

  /**
   * 启动时调一次：没有自动备份 → 建基线；版本变过 → 换版后首次启动留一份；
   * 最近一份超过 24h → 每日备份。**不做定时器**：每日一次在"打开应用"这个动作上判定就够了，
   * 常驻定时器只会增加一个没人看的心跳。
   */
  function initAutoBackup(): void {
    if (!storage || !desktop) return
    refreshAuto()
    const newest = autoBackups.value[0]
    if (!newest) {
      runAutoBackup('manual')
      return
    }
    if (autoBackups.value.every((m) => m.app !== APP_VERSION)) {
      runAutoBackup('pre-upgrade')
      return
    }
    if (Date.now() - Date.parse(newest.at) >= DAY_MS) runAutoBackup('daily')
  }

  function restoreAuto(meta: AutoBackupMeta): void {
    if (!storage) return
    const raw = storage.get(autoSlotKey(meta.slot))
    if (!raw) {
      pending.value = null
      notices.value = [`自动备份槽 ${meta.slot} 读不出来（可能被清理过），没有改动任何东西`]
      return
    }
    ingest(raw, `从自动备份恢复：${REASON_LABEL[meta.reason]} · ${meta.at}`)
  }

  /** 确认执行。分四处落地，每处都过自己的清洗 */
  function confirmRestore(): void {
    const p = pending.value
    if (!p) return
    // 覆盖前先留一份现场（桌面）。失败不阻塞恢复 —— 用户此刻的意图是恢复，不是"备份成功才允许"。
    if (desktop) runAutoBackup('pre-restore')
    const done = applyParsedSections(p.parsed, { store, schemes, cardData: cardData(), settings: opts.settings })
    pending.value = null
    notices.value = [...p.parsed.warnings, `已恢复：${done.join('、')}`]
  }

  function cancelRestore(): void {
    pending.value = null
    notices.value = ['已取消，没有改动任何东西']
  }

  return {
    pending,
    notices,
    autoBackups,
    autoSupported,
    reasonLabel: (r: AutoReason) => REASON_LABEL[r],
    exportBackup,
    chooseBackupToRestore,
    confirmRestore,
    cancelRestore,
    initAutoBackup,
    runAutoBackup,
    restoreAuto,
    refreshAuto,
  }
}

export type BackupApi = ReturnType<typeof useBackup>
