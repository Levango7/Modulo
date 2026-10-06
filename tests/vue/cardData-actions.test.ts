import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createCardData } from '../../src/vue/cardData'

/**
 * `createCardData()` 的**写入动作**层。
 *
 * ## 为什么单独开这份测试
 * `tests/vue/cardData.test.ts` 测的是 `sanitizeCardData` —— 那是"别人给的数据先进一遍筛"，
 * 纯函数。而**用户在界面上敲的那条路径**（`addTodo` / `addLedger` / `toggleMeetingCity` …）
 * 此前一条单测都没有：它只在 E2E 里被点过几下，而 E2E 不开覆盖率、也不判边界。
 * 2026-10-07 升 vitest 5 时这条空缺被量出来了 —— `cardData.ts` 的分支覆盖 72.5%，
 * 漏的 40 处里绝大多数就在这段动作代码里。
 *
 * 这些动作各自都立着一条**用户看得见的规则**：空输入不入库、超限静默拒、
 * 取消勾选要把"完成时刻"抹掉、权重坏值回 1 而不是 0（0 = 永远抽不到）。
 * 规则该由测试钉住，而不是靠注释。
 */

/** 内存版 storage：`createCardData` 只用到 get/set 两个方法 */
function memStorage(initial: string | null = null) {
  let value = initial
  const writes: string[] = []
  return {
    writes,
    api: () => createCardData({ get: () => value, set: (_key: string, v: string) => { value = v; writes.push(v) } }),
  }
}

describe('待办与便签的写入规则', () => {
  it('空白文本不入库，正常文本去掉首尾空格', () => {
    const { api } = memStorage()
    const d = api()
    const before = d.state.todos.length
    d.addTodo('')
    d.addTodo('    ')
    expect(d.state.todos.length).toBe(before)
    d.addTodo('  买奶油  ')
    expect(d.state.todos.at(-1)?.text).toBe('买奶油')
    expect(d.state.todos.at(-1)?.done).toBe(false)
  })

  it('打勾记完成时刻，取消勾把它抹掉（否则会算进一个它并没有完成的月份）', () => {
    const d = memStorage().api()
    const id = d.state.todos[1].id
    d.toggleTodo(id)
    expect(d.state.todos[1].done).toBe(true)
    expect(typeof d.state.todos[1].doneAt).toBe('number')
    d.toggleTodo(id)
    expect(d.state.todos[1].done).toBe(false)
    expect('doneAt' in d.state.todos[1]).toBe(false)
  })

  it('toggleTodo 撞不到号就不改任何东西；removeTodo 按 id 过滤', () => {
    const d = memStorage().api()
    const snapshot = JSON.stringify(d.state.todos)
    d.toggleTodo('不存在的 id')
    expect(JSON.stringify(d.state.todos)).toBe(snapshot)
    const n = d.state.todos.length
    d.removeTodo(d.state.todos[0].id)
    expect(d.state.todos.length).toBe(n - 1)
  })

  it('便签标题留空时显示「无标题」，正文照原样存', () => {
    const d = memStorage().api()
    const before = d.state.notes.length
    d.addNote('   ', '一段正文')
    expect(d.state.notes.length).toBe(before + 1)
    expect(d.state.notes[0].title).toBe('无标题')
    expect(d.state.notes[0].body).toBe('一段正文')
    d.addNote('有标题', 'b')
    expect(d.state.notes[0].title).toBe('有标题')
  })
})

describe('生日提醒的边界', () => {
  it('空名、非法月日都不入库', () => {
    const d = memStorage().api()
    const n = d.state.birthdays.length
    d.addBirthday('  ', 12, 31)
    d.addBirthday('张三', 13, 1) // 月份越界
    d.addBirthday('李四', 2, 30) // 2 月没有 30 日
    expect(d.state.birthdays.length).toBe(n)
  })

  it('闰日可以填；有出生年才算年龄，没有就只算月日', () => {
    const d = memStorage().api()
    d.addBirthday('闰生', 2, 29)
    d.addBirthday('有年', 5, 5, 1990)
    expect(d.state.birthdays[0].year).toBeUndefined()
    expect(d.state.birthdays[1].year).toBe(1990)
  })

  it('出生年只认 1–9999 的整数，别的写法一律当"没填"', () => {
    const d = memStorage().api()
    d.addBirthday('零', 1, 1, 0)
    d.addBirthday('超', 1, 1, 10_000)
    d.addBirthday('小数', 1, 1, 1990.5)
    d.addBirthday('负', 1, 1, -3)
    for (const b of d.state.birthdays.slice(-4)) expect(b.year).toBeUndefined()
  })

  it('名字截到 24 字，条数到上限就静默拒绝', () => {
    const d = memStorage().api()
    d.addBirthday('字'.repeat(30), 1, 1)
    expect(d.state.birthdays[0].name.length).toBe(24)
    for (let i = 0; i < 120; i++) d.addBirthday(`第${i}个`, 6, 6)
    expect(d.state.birthdays.length).toBe(100) // MAX_BIRTHDAYS
  })

  it('removeBirthday 按 id 删', () => {
    const d = memStorage().api()
    d.addBirthday('要删', 3, 3)
    const id = d.state.birthdays[0].id
    d.removeBirthday(id)
    expect(d.state.birthdays.some((b) => b.id === id)).toBe(false)
  })
})

describe('随机抽签', () => {
  it('空标签、超过 60 条都不入库；标签截到 24 字', () => {
    const d = memStorage().api()
    d.addPick('  ')
    expect(d.state.pickList.length).toBe(0)
    d.addPick('x'.repeat(40))
    expect(d.state.pickList[0].label.length).toBe(24)
    for (let i = 0; i < 70; i++) d.addPick(`名单${i}`)
    expect(d.state.pickList.length).toBe(60) // MAX_PICKS
  })

  it('新加的项默认等概率 1；坏值回 1 而不是 0（0 意味着永远抽不到）', () => {
    const d = memStorage().api()
    d.addPick('甲')
    const id = d.state.pickList[0].id
    expect(d.state.pickList[0].weight).toBe(1)
    d.setPickWeight(id, Number.NaN)
    expect(d.state.pickList[0].weight).toBe(1)
    d.setPickWeight(id, -5)
    expect(d.state.pickList[0].weight).toBe(0) // 明确填 0 是"这一条不参抽"
    d.setPickWeight(id, 10_000)
    expect(d.state.pickList[0].weight).toBe(99) // MAX_PICK_WEIGHT
    d.setPickWeight(id, 2.6)
    expect(d.state.pickList[0].weight).toBe(3) // 四舍五入成整数
    const n = d.state.pickList.length
    d.setPickWeight('查无此人', 7)
    expect(d.state.pickList.length).toBe(n)
  })

  it('removePick 按 id 删', () => {
    const d = memStorage().api()
    d.addPick('删我')
    const id = d.state.pickList[0].id
    d.removePick(id)
    expect(d.state.pickList.some((p) => p.id === id)).toBe(false)
  })
})

describe('记账：宁可少记一条，也不记半条错账', () => {
  it('非法日期 / 非整数分 / 负数 / 超上限都不入库', () => {
    const d = memStorage().api()
    d.addLedger('不是日期', 100, '餐饮', '')
    d.addLedger('2026-13-45', 100, '餐饮', '')
    d.addLedger('2026-01-05', 10.5, '餐饮', '') // 小数分
    d.addLedger('2026-01-05', -1, '餐饮', '')
    d.addLedger('2026-01-05', Number.NaN, '餐饮', '')
    d.addLedger('2026-01-05', 10_000_000_001, '餐饮', '') // > MAX_CENTS
    expect(d.state.ledger.entries.length).toBe(0)
    d.addLedger('2026-01-05', 1234, '餐饮', '午饭')
    expect(d.state.ledger.entries.length).toBe(1)
  })

  it('分类不在固定 8 类里就归「其他」，备注 trim 后截到 40 字', () => {
    const d = memStorage().api()
    d.addLedger('2026-01-05', 100, '  ', '   ')
    d.addLedger('2026-01-06', 100, '乱写的类目', 'z'.repeat(60))
    expect(d.state.ledger.entries[0].category).toBe('其他')
    expect(d.state.ledger.entries[1].note.length).toBe(40)
  })

  it('到 2000 行上限后静默拒绝；removeLedger 按 id 删', () => {
    const d = memStorage().api()
    const seed = Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, date: '2026-01-01', cents: 1, category: '餐饮' }))
    const big = createCardData({
      get: () =>
        JSON.stringify({
          ledger: { symbol: '¥', entries: seed },
        }),
      set: () => {},
    })
    expect(big.state.ledger.entries.length).toBe(2000)
    big.addLedger('2026-01-02', 1, '餐饮', '')
    expect(big.state.ledger.entries.length).toBe(2000)
    const id = d.state.ledger.entries.length ? d.state.ledger.entries[0].id : ''
    d.removeLedger(id)
    expect(d.state.ledger.entries.length).toBe(0)
  })
})

describe('会议规划：最多四个城市', () => {
  it('已有的再点一次是移除，没满四个就加，第五个静默拒绝', () => {
    const d = memStorage().api()
    expect(d.state.meeting.cityIds.length).toBe(3) // 示例：上海 / 伦敦 / 纽约
    d.toggleMeetingCity('shanghai')
    expect(d.state.meeting.cityIds).not.toContain('shanghai')
    d.toggleMeetingCity('tokyo')
    expect(d.state.meeting.cityIds.length).toBe(3)
    d.toggleMeetingCity('sydney')
    expect(d.state.meeting.cityIds.length).toBe(4)
    d.toggleMeetingCity('berlin') // 满 4 个：不是"再加一个"，而是先去掉一个
    expect(d.state.meeting.cityIds).not.toContain('berlin')
    expect(d.state.meeting.cityIds.length).toBe(4)
  })

  it('时间只接受能归一化的写法；分钟夹在 5–600，非数字就当没填', () => {
    const d = memStorage().api()
    d.setMeetingTime('9:5', 30)
    expect(d.state.meeting.at).toBe('09:05')
    d.setMeetingTime('不是时间', 30)
    expect(d.state.meeting.at).toBe('09:05') // 非法输入不覆盖已有值
    d.setMeetingTime('20:00', Number.NaN)
    expect(d.state.meeting.minutes).toBe(30) // 非数字 = 不改已有值（上一步刚把分钟设成 30）
    d.setMeetingTime('20:00', 7)
    expect(d.state.meeting.minutes).toBe(7)
    d.setMeetingTime('20:00', 1)
    expect(d.state.meeting.minutes).toBe(5) // 下限
    d.setMeetingTime('20:00', 9999)
    expect(d.state.meeting.minutes).toBe(600) // 上限
  })

  it('标题 trim 后截到 24 字', () => {
    const d = memStorage().api()
    d.setMeetingTitle(`  ${'会'.repeat(30)}  `)
    expect(d.state.meeting.title.length).toBe(24)
    d.setMeetingTitle('  周会  ')
    expect(d.state.meeting.title).toBe('周会')
  })
})

describe('四个钟共用的一组动作', () => {
  it('开始是幂等的，暂停累加时长并归位，未运行时的暂停什么都不做', () => {
    const d = memStorage().api()
    d.timerStart('stopwatch')
    expect(typeof d.state.timers.stopwatch.startedAt).toBe('number')
    const first = d.state.timers.stopwatch.startedAt
    d.timerStart('stopwatch') // 已在跑：不能被第二次点击重置
    expect(d.state.timers.stopwatch.startedAt).toBe(first)
    d.timerPause('stopwatch')
    expect(d.state.timers.stopwatch.startedAt).toBeNull()
    expect(d.state.timers.stopwatch.accumulatedMs).toBeGreaterThanOrEqual(0)
    const acc = d.state.timers.stopwatch.accumulatedMs
    d.timerPause('stopwatch') // 没在跑就暂停：不改进度
    expect(d.state.timers.stopwatch.accumulatedMs).toBe(acc)
    d.timerReset('stopwatch')
    expect(d.state.timers.stopwatch.accumulatedMs).toBe(0)
  })

  it('倒计时分钟夹在 1–599，非数字回默认 25', () => {
    const d = memStorage().api()
    d.setCountdownMinutes(0)
    expect(d.state.timers.countdown.minutes).toBe(1)
    d.setCountdownMinutes(9999)
    expect(d.state.timers.countdown.minutes).toBe(599)
    d.setCountdownMinutes(Number.NaN)
    expect(d.state.timers.countdown.minutes).toBe(25)
    d.setCountdownMinutes(12.4)
    expect(d.state.timers.countdown.minutes).toBe(12)
  })

  it('换间歇预设会把相位与已完成段数归零；切段也清空本段进度', () => {
    const d = memStorage().api()
    d.setIntervalPreset('long')
    expect(d.state.timers.interval.presetId).toBe('long')
    expect(d.state.timers.interval.completedFocus).toBe(0)
    expect(d.state.timers.interval.accumulatedMs).toBe(0)
    d.setIntervalPhase(2.6, 1.4)
    expect(d.state.timers.interval.phaseIndex).toBe(3)
    expect(d.state.timers.interval.completedFocus).toBe(1)
    expect(d.state.timers.interval.accumulatedMs).toBe(0)
    d.setIntervalPhase(Number.NaN, Number.NaN)
    expect(d.state.timers.interval.phaseIndex).toBe(0)
    expect(d.state.timers.interval.completedFocus).toBe(0)
  })

  it('换呼吸图案会停钟并清零累计', () => {
    const d = memStorage().api()
    d.timerStart('breath')
    d.setBreathPattern('sleep')
    expect(d.state.timers.breath.patternId).toBe('sleep')
    expect(d.state.timers.breath.startedAt).toBeNull()
    expect(d.state.timers.breath.accumulatedMs).toBe(0)
  })
})

describe('快捷链接与网页监控：加一条要过同一套清洗', () => {
  it('同标签同地址才算重复（NUL 复合键）；坏 href 被丢掉', () => {
    const d = memStorage().api()
    d.addLink('官网', 'https://example.com')
    const n = d.state.links.length
    d.addLink('官网', 'https://example.com') // 标签与地址都重复 → 去重
    expect(d.state.links.length).toBe(n)
    d.addLink('同一个地址换个名字', 'https://example.com') // 标签不同 = 两条不同的快捷方式，这是 sanitizeLinks 的口径
    expect(d.state.links.length).toBe(n + 1)
    d.addLink('没有地址', '') // 空 href 被 normalizeHref 丢掉，不该多出第三条
    expect(d.state.links.length).toBe(n + 1)
  })

  it('removeLink 按 id 删', () => {
    const d = memStorage().api()
    d.addLink('仓库', 'https://github.com/Levango7/Modulo')
    const id = d.state.links[0].id
    d.removeLink(id)
    expect(d.state.links.some((l) => l.id === id)).toBe(false)
  })

  it('前端也先过一遍边界：私网 IP 与保留主机名都进不了名单', () => {
    const d = memStorage().api()
    d.addWatch('本机 IP', 'https://127.0.0.1/')
    d.addWatch('元数据', 'https://169.254.169.254/')
    d.addWatch('本机名', 'https://localhost/')
    d.addWatch('路由器', 'https://router.local/')
    d.addWatch('明文', 'http://example.com/')
    expect(d.state.watch.length).toBe(0)
    d.addWatch('正常站', 'https://example.com/')
    expect(d.state.watch.length).toBe(1)
  })

  it('同一条地址不重复加；到 12 条上限后不再增长；removeWatch 按 id 删', () => {
    const d = memStorage().api()
    d.addWatch('甲', 'https://a.example.com/')
    d.addWatch('乙', 'https://a.example.com/')
    expect(d.state.watch.length).toBe(1)
    for (let i = 0; i < 20; i++) d.addWatch(`站${i}`, `https://s${i}.example.com/`)
    expect(d.state.watch.length).toBe(12) // MAX_WATCH
    const id = d.state.watch[0].id
    d.removeWatch(id)
    expect(d.state.watch.length).toBe(11)
  })
})

describe('固定支出与值班表', () => {
  it('基数与费率各自截长度', () => {
    const d = memStorage().api()
    d.setFixed('x'.repeat(40), '0.123456789012345')
    expect(d.state.fixed.base.length).toBe(20)
    expect(d.state.fixed.rate.length).toBe(12)
  })

  it('值班名单：空、重复、超 30 人都进不去；名字截到 16 字', () => {
    const d = memStorage().api()
    d.addDuty('  ')
    expect(d.state.duty.roster.length).toBe(0)
    d.addDuty('张三')
    d.addDuty('张三') // 重复
    expect(d.state.duty.roster.length).toBe(1)
    d.addDuty('名'.repeat(20))
    expect(d.state.duty.roster[1].length).toBe(16)
    for (let i = 0; i < 40; i++) d.addDuty(`员${i}`)
    expect(d.state.duty.roster.length).toBe(30)
    d.removeDuty(0)
    expect(d.state.duty.roster.length).toBe(29)
    expect(d.state.duty.roster).not.toContain('张三')
  })

  it('轮转起点：空串是合法输入（表示以今天为起点），非法日期一律当空', () => {
    const d = memStorage().api()
    d.setDutyAnchor('2026-01-01')
    expect(d.state.duty.anchor).toBe('2026-01-01')
    d.setDutyAnchor('胡写')
    expect(d.state.duty.anchor).toBe('')
    d.setDutyAnchor('')
    expect(d.state.duty.anchor).toBe('')
  })
})

describe('启动时怎么读盘', () => {
  it('盘上是坏 JSON 就回退示例内容，不阻塞启动', () => {
    const d = createCardData({ get: () => '{这不是 JSON', set: () => {} })
    expect(d.state.todos.length).toBeGreaterThan(0)
    expect(d.state.notes.length).toBeGreaterThan(0)
  })

  it('盘上是好数据就先清洗再用，并且改动会写回', async () => {
    const s = memStorage(
      JSON.stringify({
        todos: [
          { id: 'x1', text: '盘上的待办', done: false },
          { id: 'x1', text: '撞号的第二条', done: false }, // id 重复 → 第二条要被换成新 id
        ],
        sticky: '盘上的便签',
        birthdays: [{ name: '缺 id', month: 2, day: 30 }], // 非法日期 → 丢
      }),
    )
    const d = s.api()
    expect(d.state.sticky).toBe('盘上的便签')
    expect(d.state.todos.length).toBe(2)
    expect(new Set(d.state.todos.map((t) => t.id)).size).toBe(2)
    expect(d.state.birthdays.length).toBe(0)
    d.addTodo('新加的一条')
    await nextTick()
    expect(s.writes.length).toBeGreaterThan(0)
    expect(JSON.parse(s.writes.at(-1) as string).todos.length).toBe(3)
  })

  it('盘上没有数据时用示例内容，并且不会凭空写盘', async () => {
    const s = memStorage(null)
    const d = s.api()
    expect(d.state.meeting.cityIds.length).toBe(3)
    await nextTick()
    expect(s.writes.length).toBe(0)
  })
})
