import { describe, expect, it } from 'vitest'
import {
  blockTimeLabel,
  currentDuty,
  dayDuties,
  daysBetween,
  DEFAULT_SHIFT_BLOCKS,
  monthDuties,
  whoOnDuty,
  type ShiftBlock,
} from '../../packages/engine/src/shift'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0, 0)
/** 单班：把轮转规则最好验证的那种情形 */
const ONE: ShiftBlock[] = [{ id: 'd', label: '全天', startHour: 0, endHour: 24 }]
const THREE = DEFAULT_SHIFT_BLOCKS

describe('daysBetween：按本地日历日算差', () => {
  it('同一天 = 0；跨月跨年都对', () => {
    expect(daysBetween(at(2026, 10, 1), at(2026, 10, 1))).toBe(0)
    expect(daysBetween(at(2026, 10, 1), at(2026, 10, 2))).toBe(1)
    expect(daysBetween(at(2026, 10, 31), at(2026, 11, 1))).toBe(1)
    expect(daysBetween(at(2026, 12, 31), at(2027, 1, 1))).toBe(1)
    expect(daysBetween(at(2026, 1, 1), at(2026, 10, 1))).toBe(273)
  })

  it('**与时刻无关**：晚上 23:59 和凌晨 00:00 是同一天，差 0', () => {
    expect(daysBetween(at(2026, 10, 1, 23), at(2026, 10, 1, 0))).toBe(0)
    expect(daysBetween(at(2026, 10, 1, 23), at(2026, 10, 2, 0))).toBe(1)
  })

  it('往前算是负数', () => {
    expect(daysBetween(at(2026, 10, 2), at(2026, 10, 1))).toBe(-1)
  })
})

describe('whoOnDuty：索引可手算验证', () => {
  const roster = ['甲', '乙', '丙']
  const anchor = at(2026, 10, 1)

  it('锚点当天从名单第一个人开始', () => {
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 10, 1), 0)).toBe('甲')
  })

  it('单班：每天顺延一位', () => {
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 10, 2), 0)).toBe('乙')
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 10, 3), 0)).toBe('丙')
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 10, 4), 0)).toBe('甲')
  })

  it('三班：同一天内按班次顺延，第 4 天又从甲开始（(天数×3 + 班次) mod 3）', () => {
    const day4 = (b: number) => whoOnDuty(roster, THREE, anchor, at(2026, 10, 4), b)
    expect([day4(0), day4(1), day4(2)]).toEqual(['甲', '乙', '丙'])
    // 跨到第 5 天：5×3 = 15，15 mod 3 = 0 → 又从甲开始
    expect(whoOnDuty(roster, THREE, anchor, at(2026, 10, 5), 0)).toBe('甲')
  })

  it('锚点之前的日子照样轮（往前翻月不会"卡住"）', () => {
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 9, 30), 0)).toBe('丙')
    expect(whoOnDuty(roster, ONE, anchor, at(2026, 9, 29), 0)).toBe('乙')
  })

  it('名单长度大于 1 且只 1 人 → 永远同一个人', () => {
    expect(whoOnDuty(['独'], THREE, anchor, at(2026, 10, 9), 2)).toBe('独')
  })

  it('**名单为空 → null（"待排"），不回落到第一个人**', () => {
    expect(whoOnDuty([], THREE, anchor, at(2026, 10, 1), 0)).toBeNull()
  })

  it('班次序号为负 → 当 0（Oct 2 是 (1×3+0) mod 3 = 0 → 甲）', () => {
    expect(whoOnDuty(roster, THREE, anchor, at(2026, 10, 2), -5)).toBe('甲')
  })
})

describe('dayDuties / monthDuties', () => {
  const roster = ['甲', '乙']
  const anchor = at(2026, 1, 1)
  const now = at(2026, 10, 15, 10)

  it('一天三班，各班有人（也可能是"待排"）', () => {
    const d = dayDuties(roster, THREE, anchor, now, now)
    expect(d).toHaveLength(3)
    expect(d.map((x) => x.block.label)).toEqual(['早班', '中班', '晚班'])
    expect(d.every((x) => typeof x.person === 'string' || x.person === null)).toBe(true)
  })

  it('标出今天与周末', () => {
    const d = dayDuties(roster, THREE, anchor, now, now)
    expect(d[0].isToday).toBe(true)
    // 2026-10-15 是周四
    expect(d[0].isWeekend).toBe(false)
    expect(d[0].weekdayLabel).toBe('四')
  })

  it('未来的日子 future = true', () => {
    const d = dayDuties(roster, THREE, anchor, at(2026, 10, 20), now)
    expect(d[0].future).toBe(true)
  })

  it('整月表固定 6 行 × 7 列，补位格是 null', () => {
    const t = monthDuties(roster, THREE, anchor, now, now)
    expect(t.cells).toHaveLength(6)
    for (const w of t.cells) expect(w).toHaveLength(7)
    expect(t.cells.flat().filter((c) => c === null).length).toBe(42 - 31)
    expect(t.label).toBe('2026 年 10 月')
  })

  it('每格给的是"主班"（第一个班次）—— 竖版格子放不下三行，完整三班用 dayDuties 查', () => {
    const t = monthDuties(roster, THREE, anchor, now, now)
    const d15 = t.cells.flat().find((c) => c?.date === '2026-10-15')!
    expect(d15.block.id).toBe('morning')
    expect(d15.isToday).toBe(true)
  })

  it('名单空时每格 person 都是 null', () => {
    const t = monthDuties([], THREE, anchor, now, now)
    expect(t.cells.flat().filter((c) => c !== null).every((c) => c!.person === null)).toBe(true)
  })
})

describe('blockTimeLabel：跨零点不写成"结束早于开始"', () => {
  it('晚班写成 18:00–24:00', () => {
    expect(blockTimeLabel(THREE[2])).toBe('18:00–24:00')
    expect(blockTimeLabel(THREE[0])).toBe('08:00–12:00')
  })

  it('跨零点的班（如 22→6）也照原样写，不换成 06:00', () => {
    expect(blockTimeLabel({ id: 'n', label: '通宵', startHour: 22, endHour: 6 })).toBe('22:00–06:00')
  })
})

describe('currentDuty：卡上"此刻谁在值"', () => {
  const roster = ['甲', '乙', '丙']
  const anchor = at(2026, 10, 1)

  it('上午 10 点落在早班', () => {
    const c = currentDuty(roster, THREE, anchor, at(2026, 10, 1, 10))
    expect(c?.block.id).toBe('morning')
    expect(c?.person).toBe('甲')
  })

  it('下午 14 点落在中班', () => {
    const c = currentDuty(roster, THREE, anchor, at(2026, 10, 1, 14))
    expect(c?.block.id).toBe('noon')
  })

  it('晚上 20 点落在晚班', () => {
    const c = currentDuty(roster, THREE, anchor, at(2026, 10, 1, 20))
    expect(c?.block.id).toBe('night')
  })

  it('不在任何班次内（班表为空）→ null，不编一个人出来', () => {
    expect(currentDuty(roster, [], anchor, at(2026, 10, 1, 10))).toBeNull()
  })

  it('名单为空 → person 是 null（"待排"）', () => {
    expect(currentDuty([], THREE, anchor, at(2026, 10, 1, 10))?.person).toBeNull()
  })
})