/**
 * 会议转写导出的纯判定层：一场落盘的转写 → 「带头的纯文本」+「安全文件名」。
 *
 * 为什么单独抽出来（同 `meetings.ts` 的分工理由）：导出文案与文件名的每一条判定
 * 都该是**能被断言的** —— 留在组件里就只剩 E2E 一层兜底，而本仓组件层没有测试设施。
 * 组件只做胶水（`meeting_get` → 这里的纯函数 → `downloadText`），下载本身是 DOM 的事。
 *
 * **格式与界面同源**：每句的 `[mm:ss]` 前缀与详情页头的时长，逐字复用 `minutesLive.ts`
 * 的 `formatSegmentTime` / `formatDuration` —— 导出文件读起来和用户在详情页看到的是同一口径，
 * 不是另发明一套。
 *
 * **头里不写「今天 / 昨天」**：相对标签属于正打开着的界面；文件会被翻出来看很久以后，
 * 所以头里写绝对时刻（本地时区 `YYYY-MM-DD HH:mm`）。
 *
 * **文件名走白名单**：同 Rust `is_safe_id`「黑名单永远漏」的纪律 —— 只留字母（`\p{L}`，
 * 含 CJK —— 会议标题基本都是中文）/ 数字 / `_` / `-`，其余成段替换成 `-`。恒定的
 * `EXPORT_PREFIX` 前缀顺带杜绝 Windows 保留设备名（`CON.txt` 这类在 Windows 上仍非法）。
 */
import { formatDuration, formatSegmentTime } from './minutesLive'
import type { MeetingTranscript } from './meetings'
import { wordCountOf } from './meetings'

/** 文件名里标题段的上限：太长既看不清也不好存。短于 Rust `is_safe_id` 的 64，文件名还要带时间戳。 */
const NAME_CAP = 40

/** 导出文件名的常量前缀；兼作 Windows 保留名的免疫（见文件头）。 */
export const EXPORT_PREFIX = 'modulo-minutes'

/** 句内空白压成单空格：转写里夹的换行会让「一句一行」的格式断掉。 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 标题 → 文件名安全的一段。只返回这一段而不是整个文件名：**拼前缀 / 时间戳是
 * 调用面的事**（时间戳传进来，单测才能钉死整段判定，不用造假时钟）。
 */
export function safeFileName(raw: string): string {
  const squeezed = raw.replace(/[^\p{L}\p{N}_-]+/gu, '-')
  const collapsed = squeezed.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  return collapsed.length > NAME_CAP ? collapsed.slice(0, NAME_CAP).replace(/-+$/, '') : collapsed
}

/** 导出头里的绝对时刻；时间戳非有限或 ≤ 0 返回 `''`（同 `formatMeetingWhen` 的防守）。 */
export function formatExportedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 一场转写 → 纯文本。头 = 标题 / 时刻 / 时长 / 字数 / 句数，有摘要跟一行 `摘要：…`，
 * 正文一句一行。**全空白的句子不收**：文件里一行只剩时间戳是噪声。
 */
export function transcriptToText(t: MeetingTranscript, title: string): string {
  const lines: string[] = []
  if (title) lines.push(title)
  lines.push(
    [formatExportedAt(t.createdAt), formatDuration(t.durationMs), `${wordCountOf(t)} 字`, `${t.segments.length} 句`]
      .filter((s) => s.length > 0)
      .join(' · '),
  )
  if (t.summary) lines.push(`摘要：${t.summary}`)
  lines.push('')
  const body = t.segments
    .filter((s) => oneLine(s.text).length > 0)
    .map((s) => `[${formatSegmentTime(s.startMs)}] ${oneLine(s.text)}`)
  if (body.length > 0) {
    lines.push(...body)
  } else {
    // 与详情页空态同一句话：导出一份「其实没内容」的文件时把话说明白，别交一份空文件
    lines.push('（这场速记没有转写出内容）')
  }
  return `${lines.join('\n')}\n`
}

export interface MeetingExport {
  filename: string
  text: string
}

/** 转写 + 标题 + 「现在」→ 一份待下载的导出（文件名与正文一次性算齐）。 */
export function buildMeetingExport(t: MeetingTranscript, title: string, nowMs: number): MeetingExport {
  const stamp = formatStamp(nowMs)
  const slug = safeFileName(title)
  return {
    filename: slug ? `${EXPORT_PREFIX}-${slug}-${stamp}.txt` : `${EXPORT_PREFIX}-${stamp}.txt`,
    text: transcriptToText(t, title),
  }
}

/** 本地时区的时间戳段，格式与备份导出（`fileIo.ts` 的 `stamp`）同族：`YYYYMMDD-HHmm`。 */
function formatStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
