import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  localOffsetMinutes,
  meetingAdvice,
  meetingCityById,
  meetingSlot,
  meetingSlots,
  minutesUntil,
  normalizeHhmm,
  sanitizeMeetingCityIds,
  slotVerdict,
  weekdayInTz,
  worstSlot,
} from '../../packages/engine/src/meeting'
import { worldCityById } from '../../packages/engine/src/worldclock'

/** 固定 UTC 瞬间：本地时区由参数传入，测试因此不依赖跑测机器的时区 */
const UTC = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm, 0))

const shanghai = worldCityById('shanghai')!
const london = worldCityById('london')!
const newYork = worldCityById('new-york')!

/** 本地按上海算：offset +480（注意世界时钟的 relativeLabel 里"早/晚"说的是**时钟领先**，见下面的断言） */
const LOCAL_OFFSET = 480
const inShanghai = (cities: typeof shanghai[], at: Date) =>
  meetingSlots(cities, at, LOCAL_OFFSET, '')

describe('weekdayInTz：星期几也交给 Intl', () => {
  // 已核对：2026-10-05 是周一；UTC+8 的上海此刻已是 10-06 周二
  it('同一个瞬间在不同时区可能是不同的星期几 —— 跨日那一刻最明显', () => {
    const at = UTC(2026, 10, 5, 22)
    expect(weekdayInTz('Asia/Shanghai', at)).toBe(2) // 10-06 周二
    expect(weekdayInTz('America/New_York', at)).toBe(1) // 10-05 周一
    expect(weekdayInTz('Europe/London', at)).toBe(1) // 10-05 周一
  })
})

describe('slotVerdict：周末优先于时段，且没有走不到的分支', () => {
  it('五段各自的落点', () => {
    expect(slotVerdict(0, 3).verdict).toBe('sleep') // 半夜
    expect(slotVerdict(4, 3).verdict).toBe('sleep')
    expect(slotVerdict(5, 3).verdict).toBe('early') // 太早
    expect(slotVerdict(8, 3).verdict).toBe('early')
    expect(slotVerdict(9, 3).verdict).toBe('work') // 工作时间
    expect(slotVerdict(17, 3).verdict).toBe('work')
    expect(slotVerdict(18, 3).verdict).toBe('evening') // 下班后
    expect(slotVerdict(21, 3).verdict).toBe('evening')
    expect(slotVerdict(22, 3).verdict).toBe('sleep')
    expect(slotVerdict(23, 3).verdict).toBe('sleep')
  })

  it('**五种判定都真的能走到**（回归：早先写成 `hour < 9 → sleep` 之后紧跟 `hour < 8 → early`，early 永远到不了）', () => {
    const verdicts = new Set<string>()
    for (let h = 0; h < 24; h += 1) verdicts.add(slotVerdict(h, 3).verdict)
    expect([...verdicts].sort()).toEqual(['early', 'evening', 'sleep', 'work'])
  })

  it('周末优先：周六上午 10 点在工作区间内，但它不是工作时间', () => {
    expect(slotVerdict(10, 6).verdict).toBe('weekend')
    expect(slotVerdict(10, 0).verdict).toBe('weekend')
    // 周六半夜仍是"周末"而不是"半夜" —— 前者更具体
    expect(slotVerdict(2, 6).verdict).toBe('weekend')
  })

  it('每种判定都有一句人话', () => {
    for (const h of [0, 7, 10, 19, 23]) expect(slotVerdict(h, 3).label.length).toBeGreaterThan(0)
  })
})

describe('meetingSlot：一次会议在某城的当地读数', () => {
  it('上海本地 20:00 = UTC 12:00', () => {
    const s = meetingSlot(shanghai, UTC(2026, 10, 5, 12), LOCAL_OFFSET, '10-05')
    expect(s.hhmm).toBe('20:00')
    expect(s.relative).toBe('与本地同时')
    expect(s.otherDay).toBe(false)
    expect(s.info.verdict).toBe('evening')
  })

  it('同一瞬间伦敦 13:00（10 月英国是 BST = UTC+1）—— 比上海**晚** 7 小时', () => {
    const s = meetingSlot(london, UTC(2026, 10, 5, 12), LOCAL_OFFSET, '10-05')
    expect(s.hhmm).toBe('13:00')
    expect(s.offsetMin).toBe(60)
    // relativeLabel 说的是"时钟领先多少"：伦敦落后，所以是"晚"
    expect(s.relative).toBe('晚 7 小时')
    expect(s.info.verdict).toBe('work')
  })

  it('同一瞬间纽约 08:00（EDT = UTC-4）—— 比上海晚 12 小时，但落在工作区间', () => {
    const s = meetingSlot(newYork, UTC(2026, 10, 5, 12), LOCAL_OFFSET, '10-05')
    expect(s.hhmm).toBe('08:00')
    expect(s.offsetMin).toBe(-240)
    expect(s.relative).toBe('晚 12 小时')
    expect(s.info.verdict).toBe('early')
  })

  it('真跨日要标出来：本地周六 08:00（UTC 10-04 00:00）时纽约还是周六晚上（10-03 是周六）', () => {
    const s = meetingSlot(newYork, UTC(2026, 10, 4, 0), LOCAL_OFFSET, '10-04')
    expect(s.dateStr).toBe('10-03')
    expect(s.otherDay).toBe(true)
    // 已核对：2026-10-05 是周一 → 10-03 是周六 → 该城那边"周末"，而本地这边是周六
    expect(s.weekday).toBe(6)
    expect(s.weekdayLabel).toBe('六')
    expect(s.info.verdict).toBe('weekend')
  })

  it('半小时时区也说得出来（不看手写偏移表的另一个理由）', () => {
    const kolkata = meetingCityById('kolkata') ?? { id: 'kolkata', name: '加尔各答', tz: 'Asia/Kolkata' }
    const s = meetingSlot(kolkata, UTC(2026, 10, 5, 12), LOCAL_OFFSET, '10-05')
    expect(s.hhmm).toBe('17:30')
    expect(s.relative).toBe('晚 2.5 小时')
  })
})

describe('meetingSlots：排序按「离本地时差从小到大」', () => {
  it('与本地同时的排最前 —— 那是最不需要操心的那个', () => {
    expect(inShanghai([newYork, london, shanghai], UTC(2026, 10, 5, 12)).map((s) => s.city.id)).toEqual([
      'shanghai',
      'london',
      'new-york',
    ])
  })

  it('时差相同按城市名排，顺序稳定不跳', () => {
    const a = inShanghai([newYork, london], UTC(2026, 10, 5, 12))
    const b = inShanghai([london, newYork], UTC(2026, 10, 5, 12))
    expect(a.map((s) => s.city.id)).toEqual(b.map((s) => s.city.id))
  })

  it('空名单 → 空数组', () => {
    expect(meetingSlots([], UTC(2026, 10, 5, 12), LOCAL_OFFSET, '')).toEqual([])
  })
})

describe('worstSlot / meetingAdvice：给一句总评，而不是让人自己扫六行', () => {
  it('全员落在工作时间 → 说现状', () => {
    // UTC 04:00 = 上海 12:00（工作）
    const w = worstSlot(inShanghai([shanghai], UTC(2026, 10, 5, 4)))
    expect(w?.info.verdict).toBe('work')
    expect(meetingAdvice(w)).toBe('这几点大家都还行')
  })

  it('有人半夜 → 建议换时间，并点名是谁', () => {
    // UTC 23:00 = 上海次日 07:00（太早）、伦敦 10-06 00:00（半夜）、纽约 19:00（下班后）
    const out = inShanghai([shanghai, london, newYork], UTC(2026, 10, 5, 23))
    const w = worstSlot(out)!
    expect(w.city.id).toBe('london')
    expect(w.info.verdict).toBe('sleep')
    expect(meetingAdvice(w)).toContain('伦敦')
    expect(meetingAdvice(w)).toContain('换时间')
  })

  it('只是下班后 → 提醒别太长，不至于建议换时间', () => {
    const w = worstSlot(inShanghai([shanghai], UTC(2026, 10, 5, 12)))
    expect(w?.info.verdict).toBe('evening')
    expect(meetingAdvice(w)).toContain('注意别太长')
  })

  it('没人挑（空名单）→ 提示先挑城市', () => {
    expect(meetingAdvice(null)).toBe('先挑几个参会城市')
    expect(worstSlot([])).toBeNull()
  })
})

describe('sanitizeMeetingCityIds / meetingCityById：名单也要清洗', () => {
  it('去掉不认识的、去掉重复的、砍到 4 个', () => {
    expect(sanitizeMeetingCityIds(['shanghai', 'shanghai', 'atlantis'])).toEqual(['shanghai'])
    expect(sanitizeMeetingCityIds(['shanghai', 'tokyo', 'london', 'paris', 'new-york', 'sydney'])).toHaveLength(4)
  })

  it('**空名单不回落到默认值** —— 与 worldclock 不同：那里空了就给默认三城，这里空了就该是「用户还没挑」，界面据此显示提示', () => {
    expect(sanitizeMeetingCityIds([])).toEqual([])
    expect(sanitizeMeetingCityIds(['atlantis'])).toEqual([])
  })

  it('认不出的 id → null，不给它编一个城市', () => {
    expect(meetingCityById('atlantis')).toBeNull()
    expect(meetingCityById('shanghai')?.name).toBe('上海')
  })

  it('用的是 worldclock 的同一份城市表，不会出现第二份', () => {
    expect(meetingCityById('tokyo')).toEqual(worldCityById('tokyo'))
  })
})

describe('minutesUntil：还有多久开会', () => {
  const now = new Date(2026, 9, 5, 10, 0, 0, 0)

  it('同一天未来 → 正数；已过去 → 负数（界面据此说「多少分钟前」）', () => {
    expect(minutesUntil('10:30', now)).toBe(30)
    expect(minutesUntil('11:00', now)).toBe(60)
    expect(minutesUntil('09:30', now)).toBe(-30)
  })

  it('认不出 → null，不编一个数字', () => {
    expect(minutesUntil('abc', now)).toBeNull()
    expect(minutesUntil('25:00', now)).toBeNull()
    expect(minutesUntil('10:70', now)).toBeNull()
    expect(minutesUntil('', now)).toBeNull()
  })

  it('24:00 当 0 点处理，而不是「明天」（24 小时制的 24:00 就是 00:00）', () => {
    expect(minutesUntil('24:00', new Date(2026, 9, 5, 0, 0, 0, 0))).toBe(0)
  })
})

describe('normalizeHhmm：外来数据的时间要归一，不是补零', () => {
  it('一位小时也要正确补零（padStart 补长度会把 9:5 变成 009:5）', () => {
    expect(normalizeHhmm('9:5')).toBe('09:05')
    expect(normalizeHhmm('9:05')).toBe('09:05')
    expect(normalizeHhmm('09:05')).toBe('09:05')
    expect(normalizeHhmm('23:59')).toBe('23:59')
  })

  it('也认 HHmm 这种从 `<input type="time">` 抄出来时可能丢冒号的形式', () => {
    expect(normalizeHhmm('0905')).toBe('09:05')
    expect(normalizeHhmm('905')).toBe('09:05')
    expect(normalizeHhmm('2000')).toBe('20:00')
  })

  it('认不出 / 越界 → null，交给调用方回退默认', () => {
    for (const bad of ['', 'abc', '24:00', '25:00', '10:70', '10', '10:', ':30', '-1:00', '95']) {
      expect(normalizeHhmm(bad), bad).toBeNull()
    }
  })

  it('带空白也认（外来数据常带）', () => {
    expect(normalizeHhmm('  20:00 ')).toBe('20:00')
  })
})

describe('localOffsetMinutes / formatDuration', () => {
  it('本地偏移就是一个已知量（测试据此传入，不去猜跑测机器的时区）', () => {
    expect(Number.isInteger(localOffsetMinutes(new Date(2026, 9, 5)))).toBe(true)
  })

  it('formatDuration 三种形态', () => {
    expect(formatDuration(30)).toBe('30 分')
    expect(formatDuration(60)).toBe('1 小时')
    expect(formatDuration(105)).toBe('1 小时 45 分')
  })
})