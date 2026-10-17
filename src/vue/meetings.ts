/**
 * 会议历史的纯逻辑 —— `minutes` 卡的「历史」半边。
 *
 * 与 `minutesLive.ts` 的分工：那边管「正在录的这场」（模型 / 设备 / 实时字幕），
 * 这边管「录完落盘的那些」（列表 / 详情 / 摘要 / 删除）。
 *
 * Rust 契约（`src-tauri/src/meeting/session.rs` + `session_store.rs`，2026-10-17 实读）：
 * - `meeting_list()` → `MeetingItem[]`，**后端已按 `createdAt` 倒序**（list_meetings 的
 *   `sort_by_key(Reverse(created_at))`），损坏的那份被跳过；这里不再排序，顺序即后端口径；
 * - `meeting_get(id)` → `Transcript`（`segments` / `speakerNames` / `summary?`）；
 * - `meeting_delete(id)` → 后端幂等（不存在也算成功）；
 * - `meeting_summarize(id)` → `{ summary }`，**存过摘要的直接回存值**（不再调模型），
 *   没有 provider 或转写为空时 reject 人话（D-15：契约只给 id，provider 取第一个 ready）。
 *
 * 字段全部 camelCase（serde `rename_all`）。`speaker` 恒 null（D-14：无 diarization），
 * 类型上保留 `speaker` 字段是为了契约对齐，不是预留功能 —— 别按「即将有值」去写 UI。
 */

/** Rust `session_store::Segment`（camelCase）。 */
export interface MeetingSegment {
  startMs: number
  endMs: number
  text: string
  /** D-14：本批恒 null。字段存在只是契约对齐。 */
  speaker?: string | null
}

/** Rust `session_store::Transcript`（camelCase）。 */
export interface MeetingTranscript {
  id: string
  createdAt: number
  durationMs: number
  segments: MeetingSegment[]
  speakerNames?: Record<string, string>
  summary?: string | null
}

/** Rust `session_store::MeetingItem`（camelCase）。 */
export interface MeetingItem {
  id: string
  title: string
  createdAt: number
  durationMs: number
  hasSummary: boolean
}

/**
 * 历史列表的显示上限。落盘由 Rust 负责、无上限，但 DOM 不能被一场场堆死 ——
 * 与 `LIVE_SEGMENT_CAP` 同一条道理：视图留一个确定性的口子，超出部分如实报数，
 * 不做「加载更多」的假分页（真要翻旧账，详情/删除/摘要都只按 id 走，不受此限）。
 */
export const MEETING_LIST_CAP = 50

export interface MeetingPage {
  items: MeetingItem[]
  /** 被截掉多少场；0 = 全量展示（此时 `items` 是**原数组本身**，引用不变） */
  hidden: number
}

/**
 * 截到最近 `cap` 场。没截的返回原数组（引用不变）：列表是响应式值，
 * 每次都新建数组会让「没变化」也触发一轮渲染 —— 同 `appendSegments` 的理由。
 */
export function capMeetings(items: readonly MeetingItem[], cap = MEETING_LIST_CAP): MeetingPage {
  if (!Number.isFinite(cap) || cap <= 0 || items.length <= cap) {
    return { items: items as MeetingItem[], hidden: 0 }
  }
  return { items: items.slice(0, cap), hidden: items.length - cap }
}

/** 日界归类。内部用：同一天 → today，昨天 → yesterday，其余 → earlier。 */
type DayKind = 'today' | 'yesterday' | 'earlier'

function dayKindOf(createdAtMs: number, nowMs: number): DayKind {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return 'earlier'
  const a = new Date(createdAtMs)
  const b = new Date(nowMs)
  if (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  ) {
    // 按日历日（本地时区）比，不用 86400000 做减法 —— 夏令时地区加减一天会偏出日界。
    const yest = new Date(nowMs)
    yest.setDate(yest.getDate() - 1)
    return a.getFullYear() === yest.getFullYear() && a.getMonth() === yest.getMonth() && a.getDate() === yest.getDate()
      ? 'yesterday'
      : 'earlier'
  }
  return 'today'
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * 时刻标签：`今天 14:30` / `昨天 09:12` / 同年 `10-15 09:12` / 跨年 `2025-12-31 09:12`。
 * 时间戳非有限或 ≤ 0 返回 `''`（组件据此隐藏这一格，而不是摆一个 1970 出来）。
 */
export function formatMeetingWhen(createdAtMs: number, nowMs: number): string {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return ''
  const d = new Date(createdAtMs)
  const time = hhmm(createdAtMs)
  const kind = dayKindOf(createdAtMs, nowMs)
  if (kind === 'today') return `今天 ${time}`
  if (kind === 'yesterday') return `昨天 ${time}`
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear()
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return sameYear ? `${md} ${time}` : `${d.getFullYear()}-${md} ${time}`
}

/** 分组标签。空组不该出现 —— 调用方拿到的每一组都有东西。 */
export interface MeetingGroup {
  label: string
  items: MeetingItem[]
}

/**
 * 按 今天 / 昨天 / 更早 分组。后端已倒序，这里**不再排序**（组内顺序 = 后端口径，
 * 组间顺序恒为 今天 → 昨天 → 更早）；空组直接不出现。
 */
export function groupMeetings(items: readonly MeetingItem[], nowMs: number): MeetingGroup[] {
  const groups: MeetingGroup[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]
  for (const m of items) {
    const kind = dayKindOf(m.createdAt, nowMs)
    groups[kind === 'today' ? 0 : kind === 'yesterday' ? 1 : 2].items.push(m)
  }
  return groups.filter((g) => g.items.length > 0)
}

/**
 * 转写总字数（去掉全部空白后的字符数）。详情页头那句「N 字」用它 ——
 * 语音转写里大量换行/空格，按原文长度数会虚高一大截。
 */
export function wordCountOf(t: MeetingTranscript): number {
  let n = 0
  for (const s of t.segments) n += s.text.replace(/\s+/g, '').length
  return n
}
