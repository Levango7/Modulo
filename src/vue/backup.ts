/**
 * 完整备份 = 布局 + 方案册 + **卡片内容**。
 *
 * 为什么单独有这一份：原来「导出当前布局」只走 `docToJson`，卡片内容（便签 / 待办 / 速记）
 * 存在另一个 key（`modulo.carddata.v1`）里，从来不在导出链上 —— 换机器时版面回来了、
 * 写的东西留在旧机器上，而用户以为"导出过了"。这不是缺功能，是数据会静默丢。
 *
 * 这里是纯函数层：拼包、认包、清洗都不碰 DOM，所以能被 node 环境直接测。
 * 落盘 / 下载 / 覆盖动作在 `useBackup.ts`（胶水层）。
 */

import { parseBook, parseLayout, type LayoutDoc, type ModuleRegistry, type SchemeBook } from '@levango7/engine'
import { sanitizeCardData, type CardData } from './cardData'

export const BACKUP_KIND = 'modulo.backup'
export const BACKUP_VERSION = 1

export interface BackupPayload {
  kind: typeof BACKUP_KIND
  /** 备份格式版本，与 `LayoutDoc.schemaVersion` 是两件事：后者管版面数据，前者管这个包 */
  version: number
  /** 导出时的应用版本，只用于排查"这份备份是哪一版排出来的"，不参与任何解析判断 */
  app: string
  /**
   * 导出时刻（ISO 8601）。加它的理由不是"好看"：一份备份会跟着用户换机器、换版本到处搬，
   * 恢复前能回答"这份是哪天、哪一版导出的"才敢覆盖。v1 老包没有这个字段，按缺省处理，不算错。
   */
  createdAt?: string
  layout: LayoutDoc
  schemes: SchemeBook
  cardData: CardData
}

export interface BackupInput {
  layout: LayoutDoc
  schemes: SchemeBook
  cardData: CardData
  app: string
  /** 注入而非直接 `new Date()`：让"包里带导出时刻"这件事可测，也免得测试依赖真实时钟 */
  now?: () => Date
}

/**
 * 复原一份"什么都是空"的卡片数据：导入时不拿示例内容兜底，否则会凭空多出三条待办。
 * 每次调用都给新对象 —— 导出成常量的话，某个调用方改了返回值就会污染后面所有次导入的兜底。
 */
export function emptyCardData(): CardData {
  return {
    sticky: '',
    todos: [],
    notes: [],
    countdown: { label: '', date: '' },
    elapsed: { label: '', date: '' },
    habit: { name: '', days: [] },
    birthdays: [],
    pickList: [],
    ledger: { symbol: '', entries: [] },
    meeting: { cityIds: [], at: '', minutes: 0, title: '' },
    timers: {
      stopwatch: { accumulatedMs: 0, startedAt: null },
      countdown: { minutes: 25, accumulatedMs: 0, startedAt: null },
      interval: { presetId: 'pomodoro', completedFocus: 0, phaseIndex: 0, accumulatedMs: 0, startedAt: null },
      breath: { patternId: 'box', accumulatedMs: 0, startedAt: null },
    },
    links: [],
    commands: [],
    matrix: [],
    probes: [],
  watch: [],
    fixed: { base: '', rate: '', symbol: '' },
    duty: { roster: [], anchor: '' },
  }
}

export function buildBackup(input: BackupInput): BackupPayload {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    app: input.app,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    layout: input.layout,
    schemes: input.schemes,
    // 深拷贝：这里返回的对象会被 JSON.stringify 之后再喂回导入路径，
    // 不拷贝的话导出期间用户新敲的一个字会跟着进包，备份就不是"按下按钮那一刻"的快照。
    // `doneAt` 用展开而不是直接赋值：undefined 是"没有这个键"，直接带上去会在包里留一个 null。
    cardData: {
      sticky: input.cardData.sticky,
      todos: input.cardData.todos.map((t) => ({ ...t })),
      notes: input.cardData.notes.map((n) => ({ ...n })),
      countdown: { ...input.cardData.countdown },
      elapsed: { ...input.cardData.elapsed },
      habit: { ...input.cardData.habit, days: [...input.cardData.habit.days] },
      birthdays: input.cardData.birthdays.map((b) => ({ ...b })),
      pickList: input.cardData.pickList.map((p) => ({ ...p })),
      ledger: {
        symbol: input.cardData.ledger.symbol,
        entries: input.cardData.ledger.entries.map((r) => ({ ...r })),
      },
      meeting: { ...input.cardData.meeting, cityIds: [...input.cardData.meeting.cityIds] },
      timers: {
        stopwatch: { ...input.cardData.timers.stopwatch },
        countdown: { ...input.cardData.timers.countdown },
        interval: { ...input.cardData.timers.interval },
        breath: { ...input.cardData.timers.breath },
      },
      links: input.cardData.links.map((l) => ({ ...l })),
      commands: input.cardData.commands.map((c) => ({ ...c })),
      matrix: input.cardData.matrix.map((m) => ({ ...m })),
      probes: input.cardData.probes.map((p) => ({ ...p })),
  watch: input.cardData.watch.map((w) => ({ ...w })),
      fixed: { ...input.cardData.fixed },
      duty: { ...input.cardData.duty, roster: [...input.cardData.duty.roster] },
    },
  }
}

export function backupToJson(p: BackupPayload): string {
  return JSON.stringify(p)
}

/** 认得出三种包：新备份包、旧版布局导出、旧版方案册导出 —— 旧文件不该因为格式升级就导不进来 */
export type BackupKind = 'backup' | 'layout' | 'schemes' | 'unknown'

export interface BackupSummary {
  modules: number
  todos: number
  notes: number
  sticky: boolean
  schemes: number
  /** 倒数日有没有设过（设过才值得在确认框里提一句） */
  countdown: boolean
}

/** 一份备份的来历。恢复前摊给用户看，覆盖才有意义 —— 拿不到就摊 `null`，不编 */
export interface BackupMeta {
  app: string | null
  version: number | null
  createdAt: string | null
}

export interface ParsedBackup {
  kind: BackupKind
  layout: LayoutDoc | null
  schemes: SchemeBook | null
  cardData: CardData | null
  warnings: string[]
  /** 给确认框看的事实：用户要在覆盖之前知道这份包里到底有什么 */
  summary: BackupSummary
  /** 只有完整备份包才有；旧版布局 / 方案册导出是 `null` */
  meta: BackupMeta | null
}

const EMPTY_SUMMARY: BackupSummary = { modules: 0, todos: 0, notes: 0, sticky: false, schemes: 0, countdown: false }

function summarize(layout: LayoutDoc | null, schemes: SchemeBook | null, cardData: CardData | null): BackupSummary {
  return {
    modules: layout?.items.length ?? 0,
    todos: cardData?.todos.length ?? 0,
    notes: cardData?.notes.length ?? 0,
    sticky: Boolean(cardData?.sticky.trim()),
    schemes: schemes?.schemes.length ?? 0,
    countdown: Boolean(cardData?.countdown.date),
  }
}

/**
 * 解析任意一种导出文件。**永不抛异常** —— 与 `parseLayout` / `parseBook` 同一口径：
 * 坏数据回退成"什么都没有"并把原因写进 warnings，界面必须能只靠 warnings 解释这次导入做了什么。
 *
 * 认包的顺序有讲究：先看 `kind`，再看有没有 `items` / `schemes` 数组。
 * 反过来先判数组的话，备份包里的 `schemes` 字段（是个对象）会被旧分支误当成别的格式。
 */
export function parseBackup(raw: string, reg: ModuleRegistry): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unknown', layout: null, schemes: null, cardData: null, warnings: ['JSON 解析失败，没有导入任何东西'], summary: EMPTY_SUMMARY, meta: null }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'unknown', layout: null, schemes: null, cardData: null, warnings: ['顶层不是对象，没有导入任何东西'], summary: EMPTY_SUMMARY, meta: null }
  }
  const obj = parsed as Record<string, unknown>

  if (obj.kind === BACKUP_KIND) {
    const meta: BackupMeta = {
      app: typeof obj.app === 'string' ? obj.app : null,
      version: typeof obj.version === 'number' ? obj.version : null,
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : null,
    }
    const warnings: string[] = []
    const version = typeof obj.version === 'number' ? obj.version : 0
    if (version > BACKUP_VERSION) warnings.push(`备份格式 v${version} 高于当前支持的 v${BACKUP_VERSION}，按 v${BACKUP_VERSION} 读取`)
    if (meta.createdAt === null) warnings.push('这份备份没有记录导出时间（v1 旧包如此），无法判断新旧')
    else if (!Number.isFinite(Date.parse(meta.createdAt))) warnings.push(`备份里的导出时间读不懂（${meta.createdAt}），已忽略`)

    const layoutResult = parseLayout(JSON.stringify(obj.layout ?? null), reg)
    warnings.push(...layoutResult.warnings)

    let schemes: SchemeBook | null = null
    if (obj.schemes !== undefined) {
      const r = parseBook(JSON.stringify(obj.schemes), reg)
      schemes = r.book
      warnings.push(...r.warnings)
    } else {
      warnings.push('这份备份里没有方案册，只恢复版面与内容')
    }

    const cardData = sanitizeCardData(obj.cardData, emptyCardData())
    if (obj.cardData !== undefined && !Array.isArray((obj.cardData as CardData | undefined)?.todos)) {
      warnings.push('卡片内容形状不对，已按空内容处理（便签清空、待办 / 速记 / 倒数日为空）')
    }

    return { kind: 'backup', layout: layoutResult.doc, schemes, cardData, warnings, summary: summarize(layoutResult.doc, schemes, cardData), meta }
  }

  // 旧版布局导出：`{schemaVersion, cols, items}`。**逐条清洗照旧**，不能因为是老格式就放行。
  if (Array.isArray(obj.items)) {
    const r = parseLayout(raw, reg)
    return { kind: 'layout', layout: r.doc, schemes: null, cardData: null, warnings: r.warnings, summary: summarize(r.doc, null, null), meta: null }
  }

  // 旧版方案册导出：`{schemaVersion, activeId, schemes: [...]}`
  if (Array.isArray(obj.schemes)) {
    const r = parseBook(raw, reg)
    return { kind: 'schemes', layout: null, schemes: r.book, cardData: null, warnings: r.warnings, summary: summarize(null, r.book, null), meta: null }
  }

  return { kind: 'unknown', layout: null, schemes: null, cardData: null, warnings: ['认不出这是什么文件，没有导入任何东西'], summary: EMPTY_SUMMARY, meta: null }
}
