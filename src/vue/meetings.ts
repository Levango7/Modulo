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
 * - `meeting_diarized` 事件 → `DiarizedEvent`（D-14b/c/d 接线后）：stop 后后台跑
 *   说话人分离，完成时原子重写 transcript.json 并 emit 这一事件；失败/跳过带
 *   `error` 人话串且不动正文。前端按 `sessionId` 领，`mergeSpeakers` 负责对齐回填。
 *
 * 字段全部 camelCase（serde `rename_all`）。`speaker` 在**接线前**的落盘文件里恒 null，
 * 类型上保留字段是为了契约对齐 —— 渲染层对 null/undefined 一律按「无说话人」降级。
 */

/** Rust `session_store::Segment`（camelCase）。 */
export interface MeetingSegment {
  startMs: number
  endMs: number
  text: string
  /** 说话人 key（`spk{n}`，D-14 后台回填后非 null）；旧文件与降级路径仍是 null。 */
  speaker?: string | null
}

/** Rust `diarize.rs::DiarizedSegment`（camelCase）。**没有 text** —— 它是「给哪句补标」的坐标，不是正文。 */
export interface DiarizedSegment {
  startMs: number
  endMs: number
  speaker: string | null
}

/** Rust `diarize.rs::DiarizedEvent`（camelCase）。`error` 有人话串 = 降级信号，正文不受影响。 */
export interface DiarizedEvent {
  sessionId: string
  speakerNames: Record<string, string>
  segments: DiarizedSegment[]
  error: string | null
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

/**
 * 把 `meeting_diarized` 的回填合进当前段表：按 `(startMs, endMs)` 双键对齐，
 * 对上的补 `speaker`（key 原样，标签映射在渲染层做），对不上的**原样保留**
 * （既不凭空加句也不乱改正文 —— 事件里没有 text，前端无权造）。
 *
 * 两侧样本都要有：事件空 / 无一对上 → **返回原数组本身**（引用不变，同
 * `capMeetings` 的理由：响应式值不该在「没变化」时也重渲染）。
 */
export function mergeSpeakers(
  segments: readonly MeetingSegment[],
  diar: readonly DiarizedSegment[],
): MeetingSegment[] {
  if (!diar.length) return segments as MeetingSegment[]
  let changed = false
  const out = segments.map((s) => {
    const hit = diar.find((d) => d.startMs === s.startMs && d.endMs === s.endMs)
    if (!hit || hit.speaker == null) return s
    changed = true
    return { ...s, speaker: hit.speaker }
  })
  return changed ? out : (segments as MeetingSegment[])
}
