import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createCardData, sanitizeCardData } from '../../src/vue/cardData'
import { emptyCardData } from '../../src/vue/backup'

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

describe('网页取数端点：加一条过同一条边界，删一条按 id，显示参数可改', () => {
  it('加：正常 https 收下；非 https / 私网 / 保留主机名一律拒绝（返回 false，不静默丢）', () => {
    const d = memStorage().api()
    expect(d.addEndpoint('汇率', 'https://open.er-api.com/v6/latest/CNY')).toBe(true)
    expect(d.state.endpoints).toHaveLength(1)
    expect(d.state.endpoints[0].refreshSec).toBe(300)
    for (const bad of ['http://x.com/a', 'https://127.0.0.1/a', 'https://router.local/a', '']) {
      expect(d.addEndpoint('坏', bad), `不该收下 ${bad}`).toBe(false)
    }
    expect(d.state.endpoints, '被拒的不该进名单').toHaveLength(1)
  })

  it('同 URL 去重（sanitizeEndpoints 的骨架与 watch 同源）', () => {
    const d = memStorage().api()
    d.addEndpoint('甲', 'https://a.example/x')
    d.addEndpoint('乙', 'https://a.example/x')
    expect(d.state.endpoints).toHaveLength(1)
  })

  it('删：按 id；改：路径/刷新/金额模式原地生效，URL 不动', () => {
    const d = memStorage().api()
    d.addEndpoint('甲', 'https://a.example/x')
    const id = d.state.endpoints[0].id
    d.tuneEndpoint(id, { path: 'data[0].price', refreshSec: 60, scale100: true, label: '股价' })
    const e = d.state.endpoints[0]
    expect(e.url, 'URL 不动').toBe('https://a.example/x')
    expect(e.path).toBe('data[0].price')
    expect(e.refreshSec).toBe(60)
    expect(e.scale100).toBe(true)
    expect(e.label).toBe('股价')
    d.removeEndpoint(id)
    expect(d.state.endpoints).toHaveLength(0)
  })

  it('改路径到非法形状 → 归零（取整份响应），刷新越界 → 夹到区间', () => {
    const d = memStorage().api()
    d.addEndpoint('甲', 'https://a.example/x')
    const id = d.state.endpoints[0].id
    d.tuneEndpoint(id, { path: 'a["b"]', refreshSec: 1 })
    expect(d.state.endpoints[0].path).toBe('')
    expect(d.state.endpoints[0].refreshSec).toBe(30)
  })

  it('改一个不碰另一个：tuneEndpoint 按 id 定点映射', () => {
    const d = memStorage().api()
    d.addEndpoint('甲', 'https://a.example/x')
    d.addEndpoint('乙', 'https://b.example/y')
    const [first, second] = d.state.endpoints
    d.tuneEndpoint(first.id, { path: 'data[0].price', refreshSec: 60, scale100: true, label: '股价' })
    expect(d.state.endpoints[0].path).toBe('data[0].price')
    expect(d.state.endpoints[1], '另一个的显示参数原样').toMatchObject({
      id: second.id,
      label: '乙',
      path: '',
      refreshSec: 300,
      scale100: false,
    })
  })
})

describe('速达：加一条只认绝对路径/http(s)，删一条按 id', () => {
  it('加：合法收下并兜底显示名；裸命令名/空目标拒绝（返回 false）', () => {
    const d = memStorage().api()
    expect(d.addLaunch('', 'C:\\Apps\\Code.exe')).toBe(true)
    expect(d.state.launch).toHaveLength(1)
    expect(d.state.launch[0].label, '空 label 兜底取末段').toBe('Code')
    expect(d.state.launch[0].kind).toBe('file')
    for (const bad of ['explorer.exe', '', 'ms-settings:']) {
      expect(d.addLaunch('坏', bad), `不该收下 ${bad}`).toBe(false)
    }
    expect(d.state.launch).toHaveLength(1)
  })

  it('删：按 id；同目标重复加会被去重', () => {
    const d = memStorage().api()
    d.addLaunch('甲', 'https://e.com/a')
    d.addLaunch('乙', 'https://e.com/a')
    expect(d.state.launch).toHaveLength(1)
    d.removeLaunch(d.state.launch[0].id)
    expect(d.state.launch).toHaveLength(0)
  })

  it('导入路径：不是数组回退；坏条目丢弃并告警（同 watch/endpoints 骨架）', () => {
    // fallback 用**真实的** emptyCardData()：手搓一个薄对象会缺嵌套结构（ledger/duty…），
    // sanitizeCardData 读它会炸 —— 这不是它在测的形状
    const fallback = emptyCardData()
    expect(sanitizeCardData({ launch: 'x' }, fallback).launch).toEqual([])
    const warned: string[] = []
    const orig = console.warn
    console.warn = (m) => void warned.push(String(m))
    try {
      const r = sanitizeCardData({ launch: [{ target: 'C:\\a\\b.exe' }, { target: 'cmd.exe' }] }, fallback)
      expect(r.launch.map((x) => x.target)).toEqual(['C:\\a\\b.exe'])
      expect(warned.some((m) => m.includes('速达')), '丢弃要回显').toBe(true)
    } finally {
      console.warn = orig
    }
  })
})

describe('自定卡（HTML 扩展）：加/改/删与校验原因', () => {
  it('加：合法片段收下；空片段/超长返回原因（不静默丢）', () => {
    const d = memStorage().api()
    expect(d.addHtmlCard('测试', '<b>你好</b>')).toBeNull()
    expect(d.state.htmlCards).toHaveLength(1)
    expect(d.state.htmlCards[0].title).toBe('测试')
    expect(d.addHtmlCard('', '  '), '空片段要给原因').toContain('写点什么')
    expect(d.addHtmlCard('', 'x'.repeat(17000)), '超长要给原因').toContain('太长')
    expect(d.state.htmlCards, '被拒的不进名单').toHaveLength(1)
  })

  it('带脚本的片段是正常写法（不得被拒）——早先拦 </script> 的校验已撤', () => {
    const d = memStorage().api()
    expect(d.addHtmlCard('脚本', '<b>x</b><script>1</' + 'script>')).toBeNull()
    expect(d.state.htmlCards).toHaveLength(1)
  })

  it('改：合法改标题/片段；非法片段返回原因且**不改动**', () => {
    const d = memStorage().api()
    d.addHtmlCard('甲', '<b>1</b>')
    const id = d.state.htmlCards[0].id
    expect(d.updateHtmlCard(id, { title: '乙', html: '<i>2</i>' })).toBeNull()
    expect(d.state.htmlCards[0]).toMatchObject({ title: '乙', html: '<i>2</i>' })
    expect(d.updateHtmlCard(id, { html: '' }), '非法改要给原因').toBeTruthy()
    expect(d.state.htmlCards[0].html, '拒绝时不该动原值').toBe('<i>2</i>')
    d.removeHtmlCard(id)
    expect(d.state.htmlCards).toHaveLength(0)
  })

  it('改一张不碰另一张：updateHtmlCard 按 id 定点映射', () => {
    const d = memStorage().api()
    d.addHtmlCard('甲', '<b>1</b>')
    d.addHtmlCard('乙', '<b>2</b>')
    const id = d.state.htmlCards[0].id
    expect(d.updateHtmlCard(id, { title: '丙', html: '<i>3</i>' })).toBeNull()
    expect(d.state.htmlCards[0]).toMatchObject({ title: '丙', html: '<i>3</i>' })
    expect(d.state.htmlCards[1], '另一张原样').toMatchObject({ title: '乙', html: '<b>2</b>' })
  })

  it('只改片段不动标题；标题洗空保留原值', () => {
    const d = memStorage().api()
    d.addHtmlCard('甲', '<b>1</b>')
    d.addHtmlCard('乙', '<b>2</b>')
    const [first, second] = d.state.htmlCards
    expect(d.updateHtmlCard(first.id, { html: '<i>新</i>' }), 'patch 不带 title：原标题不动').toBeNull()
    expect(d.state.htmlCards[0]).toMatchObject({ title: '甲', html: '<i>新</i>' })
    expect(d.updateHtmlCard(second.id, { title: '   ' }), '标题洗空：不该把卡片改成无标题').toBeNull()
    expect(d.state.htmlCards[1].title, '洗空回落到原值').toBe('乙')
  })

  it('导入路径：不是数组回退；坏条目丢弃并告警', () => {
    const fallback = emptyCardData()
    expect(sanitizeCardData({ htmlCards: 'x' }, fallback).htmlCards).toEqual([])
    const warned: string[] = []
    const orig = console.warn
    console.warn = (m) => void warned.push(String(m))
    try {
      const r = sanitizeCardData({ htmlCards: [{ html: '<b>ok</b>' }, { html: 7 }] }, fallback)
      expect(r.htmlCards.map((c) => c.html)).toEqual(['<b>ok</b>'])
      expect(warned.some((m) => m.includes('自定卡'))).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})

describe('各家动作的"坏输入不落库"边界（棘轮缺口补齐）', () => {
  it('空输入一律不动状态：命令/待办/四象限/探测/自选/订阅', () => {
    const d = memStorage().api()
    const before = JSON.stringify(d.state)
    d.addCommand('名', '   ') // 空命令文本：sanitizeCommands 会丢掉 → 长度不变 → 早退
    d.addTodo('   ')
    d.addProbe('甲', '   ')
    d.addStock('甲', '   ')
    d.addFeed('甲', '   ')
    d.addMatrixTodo('   ', 'do')
    expect(JSON.stringify(d.state), '空输入不该动任何字段').toBe(before)
  })

  it('四象限：坏象限归到 do；勾选/挪动对不存在的 id 是 no-op', () => {
    const d = memStorage().api()
    d.addMatrixTodo('条目', '不存在的象限' as never)
    expect(d.state.matrix[0].q, '坏象限归位 do').toBe('do')
    const before = JSON.stringify(d.state.matrix)
    d.toggleMatrixTodo('不存在')
    d.moveMatrixTodo('不存在', 'plan')
    expect(JSON.stringify(d.state.matrix)).toBe(before)
  })

  it('倒数日：坏日期在清洗层当"没设"（countdown.date 的守卫）', () => {
    const r = sanitizeCardData({ countdown: { label: ' 元旦 ', date: '2026-02-30' } }, emptyCardData())
    expect(r.countdown.date, '坏日期当"没设"').toBe('')
    expect(r.countdown.label).toBe('元旦')
    const r2 = sanitizeCardData({ countdown: { label: '元旦', date: '2027-01-01' } }, emptyCardData())
    expect(r2.countdown.date).toBe('2027-01-01')
  })

  it('习惯：days 不是数组就归空；数组里的坏日期被过滤', () => {
    const d = memStorage().api()
    // 直接喂盘上形状（setHabit 的路径经过清洗）
    const r = sanitizeCardData({ habit: { name: '跑步', days: 'not-array' } }, emptyCardData())
    expect(r.habit.days).toEqual([])
    const r2 = sanitizeCardData({ habit: { name: '跑步', days: ['2026-01-01', 'garbage', '2026-02-30'] } }, emptyCardData())
    expect(r2.habit.days).toEqual(['2026-01-01'])
    void d
  })
})

describe('最后一圈边界：坏条目/上限/兜底', () => {
  it('notes：条目既无 title 也无 body 时被丢弃（不是留着空壳）', () => {
    const r = sanitizeCardData({ notes: [{ id: 'n1' }, { id: 'n2', body: '有正文' }] }, emptyCardData())
    expect(r.notes.map((n) => n.id), '空壳丢掉、有正文的留下').toEqual(['n2'])
  })

  it('自定卡：空标题兜底成「自定卡」；到上限后加不进来（返回原因）', () => {
    const d = memStorage().api()
    expect(d.addHtmlCard('   ', '<b>1</b>')).toBeNull()
    expect(d.state.htmlCards[0].title, '空标题兜底').toBe('自定卡')
    // 填到上限
    for (let i = 0; i < 12; i++) d.addHtmlCard(`第${i}张`, `<b>${i}</b>`)
    expect(d.state.htmlCards.length).toBe(8)
    expect(d.addHtmlCard('超标', '<b>x</b>'), '到上限要给原因').toContain('最多')
  })

  it('自定卡：updateHtmlCard 只改标题（html 不动）也走通', () => {
    const d = memStorage().api()
    d.addHtmlCard('甲', '<b>1</b>')
    const id = d.state.htmlCards[0].id
    expect(d.updateHtmlCard(id, { title: '乙' })).toBeNull()
    expect(d.state.htmlCards[0]).toMatchObject({ title: '乙', html: '<b>1</b>' })
  })

  it('命令速查：同名同命令重复加不进来；同名不同命令可以并存', () => {
    const d = memStorage().api()
    d.addCommand('甲', 'echo hi')
    const n = d.state.commands.length
    d.addCommand('甲', 'echo hi') // 完全重复 → 去重 → 长度不变 → 早退
    expect(d.state.commands.length).toBe(n)
    d.addCommand('乙', 'echo hi') // 同名不同名但同命令：两回事，允许并存（去重键是 名字+命令）
    expect(d.state.commands.length).toBe(n + 1)
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
    // 2026-10-21 起写入有 300ms 合并窗口：此刻还没落盘，flush() 之后才写
    expect(s.writes.length, '防抖窗口内不落盘').toBe(0)
    d.flush()
    expect(s.writes.length).toBe(1)
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

describe('命令速查：加一条过同一套清洗，删一条按 id', () => {
  it('空命令不入库；同名字同命令去重；标签不同算两条', () => {
    const d = memStorage().api()
    d.addCommand('重启', 'sudo reboot')
    const n = d.state.commands.length
    d.addCommand('重启', 'sudo reboot') // 同名同命令 → 去重
    expect(d.state.commands.length).toBe(n)
    d.addCommand('看盘', 'df -h') // 不同命令 → 新条目
    expect(d.state.commands.length).toBe(n + 1)
    d.addCommand('另一个名字', 'df -h') // 名字不同 = 两条不同的速查（与链接同一口径）
    expect(d.state.commands.length).toBe(n + 2)
    d.addCommand('没有命令', '   ') // 空命令被 normalizeCommand 丢掉
    expect(d.state.commands.length).toBe(n + 2)
  })

  it('removeCommand 按 id 删', () => {
    const d = memStorage().api()
    d.addCommand('看盘', 'df -h /')
    const id = d.state.commands[0].id
    d.removeCommand(id)
    expect(d.state.commands.some((c) => c.id === id)).toBe(false)
  })
})

describe('四象限待办：加/勾/挪/删', () => {
  it('空文本不入库；象限落位；勾选记完成时刻、取消抹掉', async () => {
    const d = memStorage().api()
    d.addMatrixTodo('  ', 'do')
    expect(d.state.matrix).toHaveLength(0)
    d.addMatrixTodo('季度规划', 'plan')
    expect(d.state.matrix).toEqual([{ id: expect.any(String), text: '季度规划', q: 'plan', done: false }])
    const id = d.state.matrix[0].id
    d.toggleMatrixTodo(id)
    expect(d.state.matrix[0].done).toBe(true)
    expect(d.state.matrix[0].doneAt).toBeGreaterThan(0)
    d.toggleMatrixTodo(id)
    expect(d.state.matrix[0]).not.toHaveProperty('doneAt')
  })
  it('挪象限只在四个合法值间；删按 id', () => {
    const d = memStorage().api()
    d.addMatrixTodo('救火', 'do')
    const id = d.state.matrix[0].id
    d.moveMatrixTodo(id, 'drop')
    expect(d.state.matrix[0].q).toBe('drop')
    d.moveMatrixTodo(id, 'not-a-quadrant' as unknown as never)
    expect(d.state.matrix[0].q).toBe('drop')
    d.removeMatrixTodo(id)
    expect(d.state.matrix).toHaveLength(0)
  })
})

describe('连通性探测名单：加一条过同一条边界', () => {
  it('合规 https 进得来；私网进不来；同 URL 去重；删按 id', () => {
    const d = memStorage().api()
    d.addProbe('健康', 'https://example.com/health')
    expect(d.state.probes).toHaveLength(1)
    d.addProbe('再来一次', 'https://example.com/health') // 同 URL → 去重
    expect(d.state.probes).toHaveLength(1)
    d.addProbe('内网', 'https://192.168.1.1/') // 私网 → 拒
    expect(d.state.probes).toHaveLength(1)
    const id = d.state.probes[0].id
    d.removeProbe(id)
    expect(d.state.probes).toHaveLength(0)
  })
})

describe('股票自选与 RSS 订阅的写入规则', () => {
  it('坏代码不入库；同码去重；明文/私网订阅进不来', () => {
    const d = memStorage().api()
    d.addStock('茅台', '600519')
    const n = d.state.stocks.length
    d.addStock('重复', 'SH600519') // 规范化后同码 → 去重
    expect(d.state.stocks.length).toBe(n)
    d.addStock('坏', '789') // 猜不出交易所 → 拒
    expect(d.state.stocks.length).toBe(n)
    d.addFeed('明文', 'http://x.test/feed')
    d.addFeed('内网', 'https://192.168.1.1/f')
    expect(d.state.feeds).toEqual([])
    d.addFeed('周刊', 'https://www.ruanyifeng.com/blog/atom.xml')
    expect(d.state.feeds).toHaveLength(1)
  })
  it('removeStock / removeFeed 按 id 删', () => {
    const d = memStorage().api()
    d.addStock('上证', 'sh000001')
    d.addFeed('周刊', 'https://www.ruanyifeng.com/blog/atom.xml')
    d.removeStock(d.state.stocks[0].id)
    d.removeFeed(d.state.feeds[0].id)
    expect(d.state.stocks).toEqual([])
    expect(d.state.feeds).toEqual([])
  })
})

describe('原生卡（扩展卡包）：导入/卸载与桥状态', () => {
  const pack = JSON.stringify({
    id: 'hello',
    title: '问候',
    group: '演示',
    blurb: '一句话',
    html: '<b>你好</b>',
    variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
  })

  it('导入：合法卡包收下并归一化；坏 JSON / 非法 manifest 给一句人话原因（不静默丢）', () => {
    const d = memStorage().api()
    expect(d.addExtCard(pack)).toBeNull()
    expect(d.state.extCards).toHaveLength(1)
    expect(d.state.extCards[0]).toMatchObject({ id: 'hello', title: '问候', group: '演示' })
    expect(d.addExtCard('{ 不是 JSON'), 'JSON 解析失败要给原因').toContain('JSON')
    expect(d.addExtCard(JSON.stringify({ id: 'HELLO', title: 'x', html: '<b/>', variants: [{ id: 's', name: 's', minW: 1, minH: 1, idealW: 1, idealH: 1 }] })), '形状错的原因要原样带出').toContain('id')
    expect(d.state.extCards, '被拒的不进名单').toHaveLength(1)
  })

  it('重复 id 与张数上限都在导入端拦下', () => {
    const d = memStorage().api()
    expect(d.addExtCard(pack)).toBeNull()
    expect(d.addExtCard(pack), '重复导入要给原因').toContain('已经装着')
    for (let i = 0; i < 7; i++) {
      expect(d.addExtCard(pack.replace('"hello"', `"p${i}"`))).toBeNull()
    }
    expect(d.addExtCard(pack.replace('"hello"', '"one-more"')), '第 9 张要给原因').toContain('最多')
  })

  it('桥状态：合法写回、超字节给原因、按扩展定点；卸载连状态一起清（不留数据尸体）', () => {
    const d = memStorage().api()
    d.addExtCard(pack)
    expect(d.setExtState('hello', { n: 1 })).toBeNull()
    expect(d.state.extState.hello).toEqual({ n: 1 })
    expect(d.setExtState('hello', 'x'.repeat(17000)), '超上限要给原因').toContain('太大')
    expect(d.state.extState.hello, '被拒的写不进').toEqual({ n: 1 })
    d.setExtState('hello', null)
    expect(d.state.extState.hello).toBeNull()
    d.removeExtCard('hello')
    expect(d.state.extCards).toHaveLength(0)
    expect('hello' in d.state.extState, '状态跟着卡走').toBe(false)
    // 没有状态的扩展卡卸载也要走得通（`id in extState` 的另一侧）
    d.addExtCard(pack)
    d.removeExtCard('hello')
    expect(d.state.extCards).toHaveLength(0)
  })
})
