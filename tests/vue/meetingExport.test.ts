/**
 * 会议转写导出的纯判定层（`src/vue/meetingExport.ts`）。
 *
 * ## 为什么单独给这一层写测试
 * 导出是「把本机数据带出去」的入口：文件名与正文格式都由这里的纯函数决定，
 * 留在组件里就只剩 E2E 一层兜底（而 E2E 只能钉「点按钮 → 有个 blob」，
 * 钉不住「分隔符坍缩、空白句跳过、时间戳和界面同源」这些边角）。
 *
 * ## 这条断言在守什么（每条都写清了"没有它会挂成什么样"）
 * - 文件名**白名单**：`/`、`\`、`:`、全角标点这类若靠"去掉危险字符"（黑名单）来挡，
 *   漏一个就是一次写盘事故；这里只放行字母（含 CJK）/数字/`_`/`-`，同 Rust `is_safe_id`
 *   的纪律。标题全是标点的会议真实存在（手滑建的空标题），落空时退回无标题文件名；
 * - 时间格式与界面**同源**（`formatSegmentTime` / `formatDuration`）：导出文件读起来
 *   和详情页不是一个口径时，用户会对着两份"时长"猜哪个是真的；
 * - 头里写**绝对日期**不写"今天"：文件会被翻出来看很久以后；
 * - 全空白的句子不收、整场无内容给一句明话：否则导出的是一份"看起来下了、
 *   打开全空"的文件，比导出失败更难解释。
 */

import { describe, expect, it } from 'vitest'
import {
  buildMeetingExport,
  EXPORT_PREFIX,
  formatExportedAt,
  safeFileName,
  transcriptToText,
} from '../../src/vue/meetingExport'
import { formatDuration, formatSegmentTime } from '../../src/vue/minutesLive'
import type { MeetingTranscript } from '../../src/vue/meetings'

/** 这台"钟"：2026-10-28 14:05 本地时间。文件名时间戳与导出头都对齐它。 */
const STAMP_AT = new Date(2026, 9, 28, 14, 5).getTime()

function transcript(over: Partial<MeetingTranscript>): MeetingTranscript {
  return {
    id: 'm1',
    createdAt: new Date(2026, 9, 28, 9, 30).getTime(),
    durationMs: 754_000,
    speakerNames: {},
    summary: null,
    segments: [],
    ...over,
  }
}

describe('safeFileName', () => {
  it('字母（含 CJK）/数字/_/- 原样保留，其余成段替换成 -', () => {
    expect(safeFileName('发布计划 v2')).toBe('发布计划-v2')
    expect(safeFileName('meeting-2026_final')).toBe('meeting-2026_final')
  })

  it('斜杠与全角标点这类路径危险字符一个都不许过（白名单，不是黑名单）', () => {
    expect(safeFileName('周四/线下')).toBe('周四-线下')
    expect(safeFileName('a:b\\c*d?e')).toBe('a-b-c-d-e')
    expect(safeFileName('发布会：最终版')).toBe('发布会-最终版')
  })

  it('头尾与重复的分隔符压掉，不出现 `--` 或以 - 开头', () => {
    expect(safeFileName(' --- 速记 --- ')).toBe('速记')
    expect(safeFileName('a--b')).toBe('a-b')
  })

  it('超长标题截到 40 字符且不留尾随 -', () => {
    const long = '速记'.repeat(30) // 60 字符
    const got = safeFileName(long)
    expect(got.length).toBe(40)
    expect(got).not.toMatch(/-$/)
  })

  it('标题全是非白名单字符时落空 → 由调用方退回无标题文件名', () => {
    expect(safeFileName('！@#￥%……&*')).toBe('')
    expect(safeFileName('   ')).toBe('')
  })
})

describe('formatExportedAt', () => {
  it('本地时区的绝对时刻：YYYY-MM-DD HH:mm', () => {
    expect(formatExportedAt(new Date(2026, 9, 28, 9, 30).getTime())).toBe('2026-10-28 09:30')
    expect(formatExportedAt(new Date(2026, 0, 5, 8, 7).getTime())).toBe('2026-01-05 08:07')
  })

  it('非法时间戳给空串：头里不许摆一个 NaN-NaN-NaN 出来', () => {
    expect(formatExportedAt(Number.NaN)).toBe('')
    expect(formatExportedAt(-1)).toBe('')
  })
})

describe('transcriptToText', () => {
  it('头 = 标题/时刻/时长/字数/句数，摘要独立一行，正文一句一行', () => {
    const t = transcript({
      summary: '要点：改到周四',
      segments: [
        { startMs: 0, endMs: 2100, text: '今天讨论发布计划', speaker: null },
        { startMs: 2100, endMs: 4300, text: '先过一遍门禁清单', speaker: null },
      ],
    })
    expect(transcriptToText(t, '发布计划讨论')).toBe(
      [
        '发布计划讨论',
        '2026-10-28 09:30 · 12:34 · 16 字 · 2 句',
        '摘要：要点：改到周四',
        '',
        '[00:00] 今天讨论发布计划',
        '[00:02] 先过一遍门禁清单',
        '',
      ].join('\n'),
    )
  })

  it('每句的时间戳与时长和详情页同源（复用 minutesLive，不是另写一套格式）', () => {
    const seg = { startMs: 3665_000, endMs: 3667_000, text: '中段一句', speaker: null }
    const t = transcript({ durationMs: 3667_000, segments: [seg] })
    const line = transcriptToText(t, '标题')
    expect(line).toContain(`[${formatSegmentTime(seg.startMs)}] 中段一句`)
    expect(line).toContain(` · ${formatDuration(3667_000)} · `)
  })

  it('句内换行/多空格压成单空格：一句不许在文件里断成两行', () => {
    const t = transcript({ segments: [{ startMs: 0, endMs: 1000, text: '先过一遍\n  门禁清单', speaker: null }] })
    expect(transcriptToText(t, '标题')).toContain('[00:00] 先过一遍 门禁清单')
  })

  it('全空白的句子不收（一行只剩时间戳是噪声）', () => {
    const t = transcript({
      segments: [
        { startMs: 0, endMs: 1000, text: '   ', speaker: null },
        { startMs: 1000, endMs: 2000, text: '有用的一句', speaker: null },
      ],
    })
    const text = transcriptToText(t, '标题')
    expect(text).toContain('[00:01] 有用的一句')
    expect(text).not.toContain('[00:00]')
    expect(text).toContain('2 句') // 句数按原始段数算：跳过的是排版，不是事实
  })

  it('整场没有一句内容时给一句明话，不交一份空文件', () => {
    const t = transcript({ segments: [] })
    expect(transcriptToText(t, '空场')).toContain('（这场速记没有转写出内容）')
    const t2 = transcript({ segments: [{ startMs: 0, endMs: 1000, text: '\n  \t', speaker: null }] })
    expect(transcriptToText(t2, '空白场')).toContain('（这场速记没有转写出内容）')
  })

  it('没有摘要不出现摘要行；标题为空时头里不摆空行', () => {
    const t = transcript({ segments: [{ startMs: 0, endMs: 1000, text: '一句', speaker: null }] })
    const text = transcriptToText(t, '')
    expect(text).not.toContain('摘要')
    expect(text.startsWith('2026-10-28 09:30 · ')).toBe(true)
  })

  it('非法 createdAt 不毁掉整份导出：时刻那格省略，其余照常', () => {
    const t = transcript({ createdAt: Number.NaN, segments: [{ startMs: 0, endMs: 1000, text: '一句', speaker: null }] })
    const text = transcriptToText(t, '标题')
    expect(text).toContain('12:34 · 2 字 · 1 句')
    // 时刻那格被过滤掉后不许留一个开头的「 ·」（那比缺一行还难看）
    expect(text).not.toContain(' · 12:34')
  })
})

describe('buildMeetingExport', () => {
  it('文件名 = 前缀-安全标题-时间戳.txt，与备份导出的命名同族', () => {
    const t = transcript({ segments: [{ startMs: 0, endMs: 1000, text: '一句', speaker: null }] })
    const e = buildMeetingExport(t, '发布计划', STAMP_AT)
    expect(e.filename).toBe(`${EXPORT_PREFIX}-发布计划-20261028-1405.txt`)
    expect(EXPORT_PREFIX).toBe('modulo-minutes')
  })

  it('标题落空（全是标点）时退回无标题文件名，不出现 `--` 或以 - 开头', () => {
    const t = transcript({ segments: [{ startMs: 0, endMs: 1000, text: '一句', speaker: null }] })
    expect(buildMeetingExport(t, '！@#', STAMP_AT).filename).toBe(`${EXPORT_PREFIX}-20261028-1405.txt`)
  })

  it('正文与 transcriptToText 逐字一致（胶水层不许二次加工）', () => {
    const t = transcript({ summary: '摘要一句', segments: [{ startMs: 0, endMs: 1000, text: '一句', speaker: null }] })
    const e = buildMeetingExport(t, '标题', STAMP_AT)
    expect(e.text).toBe(transcriptToText(t, '标题'))
  })
})
