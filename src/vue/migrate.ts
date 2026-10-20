/**
 * 启动前的数据迁移（P0-⑤，2026-10-21）。
 *
 * 三件事，缺一不可：
 *  ① **每个 key 自己带版本**、各自一张迁移表；版面复用引擎里那张 `MIGRATIONS`
 *     （它已经有真实调用方与用例），方案册 / 卡片内容各留一张空表 —— 加第一条迁移时
 *     只需往对应表里填一行。
 *  ② **写回**：此前版面只在"读的时候"迁移，迁移结果从不落盘 ⇒ 每次启动重迁一遍；
 *     更要命的是将来删掉一条旧步骤后，老数据就再也读不出来了。现在迁移过就写回去。
 *  ③ **写入前留现场**：先把原样 JSON 全部快照到 `modulo.migration.backup.v1`，再写新值。
 *     快照键必须进 `DATA_KEYS`（桌面 `get` 只读启动 hydrate 的镜像），最多留最近 3 次。
 *
 * **绝不阻塞启动**：读失败 / 解析失败 / 迁移函数抛错都只写进 notes，原件原样不动。
 * 引擎的 `migrateWith` 已经保证"抛错停在已经升到的版本"，这里再加一层"写盘之前不落任何东西"。
 */

import { CURRENT_SCHEMA_VERSION, migrateWith, MIGRATIONS, type Migration } from '@levango7/engine'
import type { StorageAdapter } from './store'

export const MIGRATE_BACKUP_KEY = 'modulo.migration.backup.v1'
const BACKUP_RUNS = 3

/** 方案册 / 卡片内容各自的当前版本（它们没有跨版本历史，缺版本号按 v1 读）。升版时改这里并填表。 */
const BOOK_VERSION = 1
const CARD_DATA_VERSION = 1

export interface KeyPlan {
  key: string
  /** `table[from]` 把 from 版升到 from+1 版；版面直接用引擎那张表 */
  table: Record<number, Migration>
  /** 目标版本；不传 = 该 key 当前支持的版本 */
  to: number
}

/**
 * 生产计划：版面走引擎的迁移表（当前 1 版，表为空）；方案册与卡片内容各有独立版本线。
 * 三者都没有"缺版本号"的额外约定 —— 缺省按 v1 读（与 `migrate` 的 `versionOf` 同口径）。
 */
export const MIGRATION_PLAN: readonly KeyPlan[] = [
  // 版面**跟着引擎的版本走**（写死 1 的话，SCHEMA_VERSION 升到 2 时这里还在要 1，迁移永远不跑）
  { key: 'modulo.layout.v1', table: MIGRATIONS, to: CURRENT_SCHEMA_VERSION },
  { key: 'modulo.schemes.v1', table: {}, to: BOOK_VERSION },
  { key: 'modulo.carddata.v1', table: {}, to: CARD_DATA_VERSION },
]

export interface MigrationReport {
  /** 给界面看的一句话（迁移过的 key 各一条） */
  notes: string[]
  /** 实际被改写的 key */
  changed: string[]
  /** 这次是否写了现场快照（没有迁移就不写） */
  snapshotAt: string | null
}

interface BackupRun {
  at: string
  keys: { key: string; raw: string }[]
}
interface BackupState {
  runs: BackupRun[]
}

/** 盘上不可信：坏形状当作没有历史，不要因为"上次快照坏了"就拒绝这次迁移 */
function readBackup(storage: StorageAdapter): BackupState {
  try {
    const raw = storage.get(MIGRATE_BACKUP_KEY)
    if (!raw) return { runs: [] }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { runs: [] }
    const runs = (parsed as { runs?: unknown }).runs
    if (!Array.isArray(runs)) return { runs: [] }
    const clean = runs.filter((r): r is BackupRun => {
      if (typeof r !== 'object' || r === null) return false
      const run = r as Partial<BackupRun>
      return typeof run.at === 'string' && Array.isArray(run.keys)
    })
    return { runs: clean.map((r) => ({ at: r.at, keys: r.keys.filter((k) => typeof k?.key === 'string' && typeof k?.raw === 'string') })) }
  } catch {
    return { runs: [] }
  }
}

/**
 * 跑一遍迁移。`plan` 可注入（测试用来装一条假想迁移，验证整条链真的会走）。
 * 返回的 notes 由 App 显示一次；没有任何迁移时 `changed` 为空、不写盘。
 */
export function migrateStorage(storage: StorageAdapter, plan: readonly KeyPlan[] = MIGRATION_PLAN, now: () => Date = () => new Date()): MigrationReport {
  const report: MigrationReport = { notes: [], changed: [], snapshotAt: null }
  /** 先全部算完：任何一个 key 出错，都还没有写过盘 */
  const pending: { key: string; raw: string; next: string; note: string }[] = []

  for (const item of plan) {
    let raw: string | null = null
    try {
      raw = storage.get(item.key)
    } catch {
      continue
    }
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 坏 JSON 由各自的解析层去兜（它们有 warnings）；这里不碰，避免把"坏"写成"空"
      continue
    }
    const result = migrateWith(parsed, item.table, item.to)
    if (!result.applied.length) continue
    pending.push({
      key: item.key,
      raw,
      next: JSON.stringify(result.raw),
      note: `已迁移「${item.key}」：${result.note ?? `升到 v${item.to}`}`,
    })
  }

  if (!pending.length) return report

  // ① 先留现场（一次写入包含本次所有 key 的原样内容），再写迁移结果
  try {
    const state = readBackup(storage)
    const at = now().toISOString()
    const runs = [...state.runs, { at, keys: pending.map((p) => ({ key: p.key, raw: p.raw })) }].slice(-BACKUP_RUNS)
    storage.set(MIGRATE_BACKUP_KEY, JSON.stringify({ runs }))
    report.snapshotAt = at
  } catch {
    // 快照都写不出去就不迁移：宁可这次不升版，也不能在没有退路的情况下改用户数据
    report.notes.push('迁移前的现场快照写入失败，本次没有改动任何数据')
    return report
  }

  // ② 逐个写回。某个 key 写失败就跳过它（原样的那份在快照里），其余照常
  for (const p of pending) {
    try {
      storage.set(p.key, p.next)
      report.changed.push(p.key)
      report.notes.push(p.note)
    } catch {
      report.notes.push(`「${p.key}」迁移结果写入失败，已保留原数据`)
    }
  }
  return report
}
