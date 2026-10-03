import { LOGICAL_COLS, SCHEMA_VERSION } from './types.js'
import type { LayoutDoc, ModuleRegistry } from './types.js'
import { sanitizeItems } from './validate.js'

export interface ParseResult {
  doc: LayoutDoc
  warnings: string[]
}

/**
 * 迁移表：`MIGRATIONS[v]` 把 **v 版**的裸数据升到 **v+1 版**，按版本号从小到大连着跑。
 *
 * 为什么现在才摆这张表：早先这里写过一个 `migrations: Record<fromVersion, (doc)=>doc>` 的占位接口，
 * 全仓没有任何调用方 —— 提前摆一个没人调用的接口，就是下一份"文档说有、代码没有"。
 * 现在它有**真实调用方**（`parseLayout` 每次读盘都过一遍）与**真实用例**（`tests/engine/serialize.test.ts`
 * 往表里临时装一条假想迁移，跑通整条链再撤回），下一个 schema 变更只需要往表里加一行。
 *
 * 约定两条：① 迁移函数吃裸数据、吐裸数据，不许碰引擎其它部分（会循环依赖）；
 * ② 每一步都要能被单测单独调用，所以漏写某一步会立刻被红，而不是在用户机器上才暴露。
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

export const MIGRATIONS: Record<number, Migration> = {
  // 还没有跨版本的真实需求，所以这张表此刻是空的。加第一条时记住：键是"来源版本"，值负责升到键+1。
}

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION

/** 版本号从哪来都不可信：不是正整数就当 v1（"没有版本号的老文件"正是 v1） */
function versionOf(raw: unknown): number {
  const v = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

export interface MigrateResult {
  raw: Record<string, unknown>
  /** 实际跑过哪几步；空数组 = 原样 */
  applied: number[]
  /** 给界面看的一句话；没迁移时为 null */
  note: string | null
}

/** 步数上限：不为"版本号写成 1e9"这种坏数据留死循环，32 够任何真实迁移链用 */
const MAX_STEPS = 32

/**
 * 把裸数据从它自称的版本升到 `to`（默认当前支持版本）。**不抛**：任何一步出错都停在它已经升到的版本。
 * 半个版本也好过没有版本 —— v1 的数据按 v1 读永远读得出来。
 *
 * `to` 是参数而不是写死，这样单测能装一条假想迁移跑通整条链；
 * 生产路径不传它，走的就是 `CURRENT_SCHEMA_VERSION`。
 */
export function migrate(raw: unknown, to: number = CURRENT_SCHEMA_VERSION): MigrateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { raw: {}, applied: [], note: null }
  const from = versionOf(raw)
  let cur = raw as Record<string, unknown>
  const applied: number[] = []
  for (let step = 0; step < MAX_STEPS && versionOf(cur) < to; step++) {
    const v = versionOf(cur)
    const step1 = MIGRATIONS[v]
    if (!step1) break
    const next = step1(cur)
    // 坏步骤不许把整份数据变成空：停在它已经升到的地方，剩下的交给按 v1 读
    if (typeof next !== 'object' || next === null || Array.isArray(next)) break
    cur = { ...next, schemaVersion: v + 1 }
    applied.push(v)
  }
  const note = applied.length ? `已从 schemaVersion ${from} 迁移到 ${versionOf(cur)}（${applied.length} 步）` : null
  return { raw: cur, applied, note }
}

export function docToJson(doc: LayoutDoc): string {
  return JSON.stringify(doc)
}

/**
 * 解析布局 JSON；损坏数据回退空布局并给出 warning，绝不抛异常。
 * 每一次读盘都先过 `migrate` —— 这就是那张表现在有真实调用方的原因。
 *
 * `to` 与 `migrate` 同一个口径：生产路径不传（目标就是当前支持版本），
 * 参数存在的唯一理由是让"装一条假想迁移 → 整条读盘路径真的会走那条路"这件事能被单测证明，
 * 而不必等到 `SCHEMA_VERSION` 升到 2 的那天才发现管道其实没接上。
 */
export function parseLayout(raw: string, reg: ModuleRegistry, to: number = CURRENT_SCHEMA_VERSION): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { doc: { schemaVersion: CURRENT_SCHEMA_VERSION, cols: LOGICAL_COLS, items: [] }, warnings: ['JSON 解析失败，已回退空布局'] }
  }
  const version = versionOf(parsed)
  const m = migrate(parsed, to)
  const obj = (m.raw ?? {}) as Partial<LayoutDoc>
  const cols = typeof obj.cols === 'number' && obj.cols > 0 ? Math.min(obj.cols, LOGICAL_COLS) : LOGICAL_COLS
  const { items, warnings } = sanitizeItems(obj.items, reg, cols)
  if (m.note) warnings.unshift(m.note)
  // 迁不动的（缺步骤、数据不是对象）仍按原路径读，让 sanitize 去处理
  else if (version > CURRENT_SCHEMA_VERSION) warnings.push(`schemaVersion ${version} 高于当前支持版本，按 v${CURRENT_SCHEMA_VERSION} 读取`)
  return { doc: { schemaVersion: CURRENT_SCHEMA_VERSION, cols, items }, warnings }
}
