/**
 * 会议历史的纯逻辑层（`src/vue/meetings.ts`）。
 *
 * ## 为什么单独给这一层写测试
 * 列表/详情/摘要这三块 UI 的判定全在这层：日界（今天/昨天/跨年）、列表截断、字数统计。
 * E2E 造不出"跨年夜录的一场会"或"200 场历史"这类局面，纯函数这里都能钉死。
 *
 * ## 这条断言在守什么（每条都写清了"没有它会挂成什么样"）
 * - 日界按**本地日历日**比而不是 86400000 减法：夏令时地区"减一天"会偏出日界（今天的
 *   会标成昨天）。中国无夏令时，但判定写法不该埋这个雷；
 * - 截断必须**引用不变**地放过全量列表：列表是响应式值，每次新建数组 = 无变化也重渲染；
 * - 非法时间戳给 `''`：组件据此隐藏，不能摆一个 1970 出来吓人。
 */

import { describe, expect, it } from 'vitest'
import {
  capMeetings,
  formatMeetingWhen,
  groupMeetings,
  MEETING_LIST_CAP,
  wordCountOf,
  type MeetingItem,
  type MeetingTranscript,
} from '../../src/vue/meetings'

/** 固定"现在"：2026-10-17 12:00 本地时间。所有断言都对齐这台"钟"。 */
const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime()

function item(createdAt: number, id = `m-${createdAt}`): MeetingItem {
  return { id, title: `速记 ${id}`, createdAt, durationMs: 60_000, hasSummary: false }
}

describe('formatMeetingWhen', () => {
  it('今天与昨天', () => {
    const today930 = new Date(2026, 9, 17, 9, 30, 0).getTime()
    const yest1823 = new Date(2026, 9, 16, 18, 23, 0).getTime()
    expect(formatMeetingWhen(today930, NOW)).toBe('今天 09:30')
    expect(formatMeetingWhen(yest1823, NOW)).toBe('昨天 18:23')
  })

  it('日界：昨天最后一毫秒与今天零点各归各类', () => {
    const lastMsOfYesterday = new Date(2026, 9, 16, 23, 59, 59, 999).getTime()
    const firstMsOfToday = new Date(2026, 9, 17, 0, 0, 0, 0).getTime()
    expect(formatMeetingWhen(lastMsOfYesterday, NOW)).toBe('昨天 23:59')
    expect(formatMeetingWhen(firstMsOfToday, NOW)).toBe('今天 00:00')
  })

  it('同年更早给 MM-DD，跨年补全年份', () => {
    const sameYear = new Date(2026, 9, 15, 8, 5, 0).getTime()
    const crossYear = new Date(2025, 11, 31, 23, 59, 0).getTime()
    expect(formatMeetingWhen(sameYear, NOW)).toBe('10-15 08:05')
    expect(formatMeetingWhen(crossYear, NOW)).toBe('2025-12-31 23:59')
  })

  /** 未来时间戳（时钟回拨前的旧录、或机器时钟错了）也按日历日归类：同一天就是今天。 */
  it('未来时间戳：同日按今天、隔日按更早，不做特殊分支', () => {
    const laterToday = new Date(2026, 9, 17, 20, 0, 0).getTime()
    const nextYear = new Date(2027, 0, 1, 8, 0, 0).getTime()
    expect(formatMeetingWhen(laterToday, NOW)).toBe('今天 20:00')
    expect(formatMeetingWhen(nextYear, NOW)).toBe('2027-01-01 08:00')
  })

  /** 非法值给空串：调用方隐藏这一格。摆 "1970-01-01" 出来是在展示坏数据。 */
  it('非法时间戳（0 / 负数 / NaN）返回空串', () => {
    expect(formatMeetingWhen(0, NOW)).toBe('')
    expect(formatMeetingWhen(-5, NOW)).toBe('')
    expect(formatMeetingWhen(Number.NaN, NOW)).toBe('')
  })
})

describe('groupMeetings', () => {
  it('三组各归各类，组间恒为 今天 → 昨天 → 更早', () => {
    const today = item(new Date(2026, 9, 17, 9, 0, 0).getTime(), 't1')
    const yesterday = item(new Date(2026, 9, 16, 9, 0, 0).getTime(), 'y1')
    const earlier = item(new Date(2026, 9, 15, 9, 0, 0).getTime(), 'e1')
    // 故意把更早的排前面：组间顺序由分组决定，不由输入顺序决定
    const gs = groupMeetings([earlier, yesterday, today], NOW)
    expect(gs.map((g) => g.label)).toEqual(['今天', '昨天', '更早'])
    expect(gs[0].items.map((m) => m.id)).toEqual(['t1'])
    expect(gs[1].items.map((m) => m.id)).toEqual(['y1'])
    expect(gs[2].items.map((m) => m.id)).toEqual(['e1'])
  })

  it('空组不出现；组内保持输入顺序（后端已倒序，这里不再排）', () => {
    const a = item(new Date(2026, 9, 17, 9, 0, 0).getTime(), 'a')
    const b = item(new Date(2026, 9, 17, 8, 0, 0).getTime(), 'b')
    const gs = groupMeetings([a, b], NOW)
    expect(gs).toHaveLength(1)
    expect(gs[0].label).toBe('今天')
    expect(gs[0].items.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('空列表给空数组', () => {
    expect(groupMeetings([], NOW)).toEqual([])
  })

  /**
   * 时间戳非法的条目**不崩分组、也不消失**：落到「更早」。这条分支只为
   * `groupMeetings` 存在（`formatMeetingWhen` 有自己的同款前置守卫）——
   * 坏数据也要在列表里可见、可删，静默蒸发比摆在"更早"里更糟。
   */
  it('非法时间戳的条目落到「更早」，不崩分组', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const gs = groupMeetings([item(bad, 'bad')], NOW)
      expect(gs.map((g) => g.label)).toEqual(['更早'])
      expect(gs[0].items.map((m) => m.id)).toEqual(['bad'])
    }
  })
})

describe('capMeetings', () => {
  it('没超上限：原数组原样返回（引用不变）+ hidden 0', () => {
    const items = [item(1), item(2)]
    const page = capMeetings(items)
    expect(page.items).toBe(items)
    expect(page.hidden).toBe(0)
  })

  it('超上限：截最近 cap 场，多出的如实报数', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(i + 1))
    const page = capMeetings(items, 5)
    expect(page.items).toHaveLength(5)
    // 截的是**前面**的：后端已倒序，前面就是最近的
    expect(page.items.map((m) => m.id)).toEqual(['m-1', 'm-2', 'm-3', 'm-4', 'm-5'])
    expect(page.hidden).toBe(2)
  })

  it('上限非法（0 / 负数 / NaN）当没设：全量展示，不吞列表', () => {
    const items = [item(1), item(2), item(3)]
    expect(capMeetings(items, 0)).toEqual({ items, hidden: 0 })
    expect(capMeetings(items, -1).hidden).toBe(0)
    expect(capMeetings(items, Number.NaN).items).toBe(items)
  })

  it('默认上限就是导出的 MEETING_LIST_CAP', () => {
    expect(MEETING_LIST_CAP).toBeGreaterThan(0)
    const items = Array.from({ length: MEETING_LIST_CAP + 3 }, (_, i) => item(i + 1))
    const page = capMeetings(items)
    expect(page.items).toHaveLength(MEETING_LIST_CAP)
    expect(page.hidden).toBe(3)
  })
})

describe('wordCountOf', () => {
  it('去掉全部空白后计数（换行/空格不虚高）', () => {
    const t: MeetingTranscript = {
      id: 'x',
      createdAt: NOW,
      durationMs: 0,
      segments: [
        { startMs: 0, endMs: 1000, text: '今天 讨论\n发布 计划', speaker: null },
        { startMs: 1000, endMs: 2000, text: '  好  ', speaker: null },
      ],
    }
    expect(wordCountOf(t)).toBe(9) // 今天讨论发布计划 = 8 + 好 = 1
  })

  it('空段与无段：0', () => {
    const empty: MeetingTranscript = { id: 'x', createdAt: NOW, durationMs: 0, segments: [] }
    expect(wordCountOf(empty)).toBe(0)
    const blank: MeetingTranscript = {
      id: 'x',
      createdAt: NOW,
      durationMs: 0,
      segments: [{ startMs: 0, endMs: 1, text: '   \n\t ', speaker: null }],
    }
    expect(wordCountOf(blank)).toBe(0)
  })
})
