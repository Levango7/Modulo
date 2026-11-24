import { describe, expect, it } from 'vitest'
import {
  addTask,
  appendRun,
  clipRunText,
  CRON_MAX_TASKS,
  CRON_PROMPT_MAX,
  CRON_RUNS_MAX,
  dueTasks,
  lastRun,
  localHM,
  MONTHLY_REPORT_PROMPT,
  monthdayLabel,
  newTaskId,
  parseCronDoc,
  removeTask,
  serializeCronDoc,
  setTaskEnabled,
  weekdayLabel,
  type CronRun,
  type CronTask,
} from '../../src/vue/cron'

const task = (over: Partial<CronTask> = {}): CronTask => ({
  id: 'c1',
  prompt: '把今天的待办整理成三句话',
  time: '09:00',
  providerId: 'p1',
  enabled: true,
  createdAt: 0,
  ...over,
})

describe('定时任务：盘上的文档不可信（PR-F2）', () => {
  it('没有文档 / 坏 JSON / 形状不对 —— 一律空档，不抛', () => {
    expect(parseCronDoc(null)).toEqual({ tasks: [], runs: [] })
    expect(parseCronDoc('{oops')).toEqual({ tasks: [], runs: [] })
    expect(parseCronDoc('{"tasks":"nope"}')).toEqual({ tasks: [], runs: [] })
  })

  it('坏任务丢弃、好任务留下（缺 id / 重 id / 空提示词 / 坏时间）', () => {
    const raw = JSON.stringify({
      tasks: [
        { id: 'a', prompt: '好的', time: '09:00' },
        { id: '', prompt: '没 id', time: '09:00' },
        { id: 'b', prompt: '  ', time: '09:00' },
        { id: 'c', prompt: '坏时间', time: '9:5' },
        { id: 'a', prompt: '重复 id', time: '10:00' },
        { id: 'd', prompt: ' 补默认 ', time: ' 22:30 ', enabled: false },
      ],
      runs: [{ taskId: 'a', status: 'ok', text: '结果', at: 1 }, null, { taskId: 'a', status: 'wat' }],
    })
    const doc = parseCronDoc(raw)
    expect(doc.tasks.map((t) => t.id)).toEqual(['a', 'd'])
    // 坏掉的 enabled / providerId / createdAt 回默认，不让 undefined 进界面
    expect(doc.tasks[1].enabled).toBe(false)
    expect(doc.tasks[1].providerId).toBe('')
    // 运行记录：合法的留、非法的丢；缺 id 的兜底生成
    expect(doc.runs).toHaveLength(1)
    expect(doc.runs[0].text).toBe('结果')
    expect(doc.runs[0].id).not.toBe('')
  })

  it('份数与记录条数的上限：盘上多出来的尾部丢掉', () => {
    const many = Array.from({ length: CRON_MAX_TASKS + 2 }, (_, i) => ({
      id: `c${i}`,
      prompt: `p${i}`,
      time: '09:00',
    }))
    expect(parseCronDoc(JSON.stringify({ tasks: many })).tasks).toHaveLength(CRON_MAX_TASKS)
    const runs: CronRun[] = Array.from({ length: CRON_RUNS_MAX + 5 }, (_, i) => ({
      id: `r${i}`,
      taskId: 'a',
      status: 'ok',
      at: i,
    }))
    expect(parseCronDoc(JSON.stringify({ tasks: [], runs })).runs).toHaveLength(CRON_RUNS_MAX)
  })

  it('序列化 → 解析往返一致', () => {
    const doc = parseCronDoc(
      serializeCronDoc({
        tasks: [task()],
        runs: [{ id: 'r1', taskId: 'c1', status: 'missed', at: 5, error: '错过了' }],
      }),
    )
    expect(doc.tasks).toEqual([task()])
    expect(doc.runs).toEqual([{ id: 'r1', taskId: 'c1', status: 'missed', at: 5, error: '错过了' }])
  })
})

describe('定时任务：建任务的三条闸门', () => {
  it('空提示词 / 太长 / 坏时间 —— 逐条拒收；**超长拒收不截断**（截断会改任务语义）', () => {
    const empty = addTask([], { prompt: '   ', time: '09:00' }, 1)
    expect(empty.rejected[0]).toContain('不能为空')
    const long = addTask([], { prompt: '字'.repeat(CRON_PROMPT_MAX + 1), time: '09:00' }, 1)
    expect(long.rejected[0]).toContain('太长')
    const badTime = addTask([], { prompt: '好的', time: '9:5' }, 1)
    expect(badTime.rejected[0]).toContain('HH:MM')
    // 三条全被拒：清单一个都没动
    expect(empty.tasks).toHaveLength(0)
    expect(long.tasks).toHaveLength(0)
    expect(badTime.tasks).toHaveLength(0)
  })

  it('同一时间同一条提示词不重复；份数上限', () => {
    const first = addTask([], { prompt: '早安', time: '09:00' }, 1)
    expect(first.tasks).toHaveLength(1)
    const dup = addTask(first.tasks, { prompt: ' 早安 ', time: '09:00' }, 2)
    expect(dup.tasks).toHaveLength(1)
    expect(dup.rejected[0]).toContain('一样的任务')
    const base = Array.from({ length: CRON_MAX_TASKS }, (_, i) =>
      task({ id: `c${i}`, prompt: `p${i}`, time: `0${i}:00` }),
    )
    const over = addTask(base, { prompt: '再来', time: '23:00' }, 3)
    expect(over.tasks).toHaveLength(CRON_MAX_TASKS)
    expect(over.rejected[0]).toContain(String(CRON_MAX_TASKS))
  })

  it('成功的路径：id 唯一、createdAt 落盘', () => {
    const r = addTask([], { prompt: 'a', time: '09:00' }, 1_700_000_000_123)
    const r2 = addTask(r.tasks, { prompt: 'b', time: '10:00' }, 1_700_000_000_123)
    expect(new Set(r2.tasks.map((t) => t.id)).size).toBe(2)
    expect(r.tasks[0].createdAt).toBe(1_700_000_000)
    expect(newTaskId(1, [r.tasks[0].id])).not.toBe(r.tasks[0].id)
  })

  it('移除与启停只动目标那一行', () => {
    const list = [task({ id: 'a' }), task({ id: 'b', enabled: false })]
    expect(removeTask(list, 'a').map((t) => t.id)).toEqual(['b'])
    expect(setTaskEnabled(list, 'b', true).find((t) => t.id === 'b')?.enabled).toBe(true)
    expect(setTaskEnabled(list, 'nope', true)).toHaveLength(2)
  })
})

describe('定时任务：调度判定（纯函数，now 注入）', () => {
  const at = (hm: string): Date => {
    const [h, m] = hm.split(':').map(Number)
    const d = new Date(2026, 10, 8, h, m, 0, 0)
    return d
  }

  it('到点 → due；已过 → missed；没到 → 两边都不是', () => {
    const list = [task({ time: '09:00' }), task({ time: '08:00' }), task({ time: '23:00' })]
    const r = dueTasks(list, [], at('09:00'))
    expect(r.due.map((t) => t.time)).toEqual(['09:00'])
    expect(r.missed.map((t) => t.time)).toEqual(['08:00'])
    const later = dueTasks(list, [], at('12:30'))
    expect(later.due).toHaveLength(0)
    expect(later.missed.map((t) => t.time)).toEqual(['09:00', '08:00'])
  })

  it('跑过 / 记过错过的（done 并集）不再出现；停用的任务两头都不进', () => {
    const list = [task(), task({ id: 'c2', time: '09:00', enabled: false })]
    expect(dueTasks(list, ['c1'], at('09:00'))).toEqual({ due: [], missed: [] })
    expect(dueTasks(list, [], at('10:00')).missed.map((t) => t.id)).toEqual(['c1'])
  })

  it('localHM 补零；错过与到点共用同一把尺', () => {
    expect(localHM(at('09:05'))).toBe('09:05')
    expect(localHM(at('23:07'))).toBe('23:07')
  })
})

describe('定时任务：运行记录', () => {
  it('截断要说明全文在哪（会话历史），不装成全文', () => {
    const short = '桩回复：收到。'
    expect(clipRunText(short)).toBe(short)
    const long = '字'.repeat(3000)
    expect(clipRunText(long).endsWith('（结果很长，全文在那次对话里）')).toBe(true)
    expect(clipRunText(long).length).toBeLessThan(3000)
  })

  it('convId：合法字符串保留；空串 / 数字 / 缺字段都不认（旧档照样读）', () => {
    const doc = parseCronDoc(
      JSON.stringify({
        tasks: [],
        runs: [
          { id: 'r1', taskId: 'c1', at: 1, status: 'ok', text: '摘要', convId: 'conv-1' },
          { id: 'r2', taskId: 'c1', at: 2, status: 'missed', error: '错过了', convId: '' },
          { id: 'r3', taskId: 'c1', at: 3, status: 'ok', text: '旧档', convId: 42 },
          { id: 'r4', taskId: 'c.dir', at: 4, status: 'ok', text: '没有这个字段' },
        ],
      }),
    )
    expect(doc.runs[0].convId).toBe('conv-1')
    expect(doc.runs[1].convId).toBeUndefined()
    expect(doc.runs[2].convId).toBeUndefined()
    expect(doc.runs[3].convId).toBeUndefined()
  })

  it('序列化往返：convId 原样回来，undefined 不写成 null', () => {
    const runs: CronRun[] = [
      { id: 'r1', taskId: 'c1', status: 'ok', at: 1, text: 'a', convId: 'conv-1' },
      { id: 'r2', taskId: 'c1', status: 'ok', at: 2, text: 'b' },
    ]
    const raw = serializeCronDoc({ tasks: [], runs })
    const back = parseCronDoc(raw)
    expect(back.runs[0].convId).toBe('conv-1')
    expect(back.runs[1].convId).toBeUndefined()
    expect(raw).not.toContain('"convId":null')
  })
  it('头插 + 环形丢弃最旧的；lastRun 取该任务最近一条', () => {
    let runs: CronRun[] = []
    for (let i = 0; i < CRON_RUNS_MAX + 3; i++) {
      runs = appendRun(runs, { id: `r${i}`, taskId: 'c1', status: 'ok', at: i, text: String(i) })
    }
    expect(runs).toHaveLength(CRON_RUNS_MAX)
    expect(runs[0].id).toBe(`r${CRON_RUNS_MAX + 2}`)
    runs = appendRun(runs, { id: 'rx', taskId: 'c2', status: 'error', at: 99, error: '坏了' })
    expect(lastRun(runs, 'c2')?.status).toBe('error')
    expect(lastRun(runs, 'c1')?.taskId).toBe('c1')
    expect(lastRun(runs, 'nope')).toBeUndefined()
  })
})

describe('cron：每周几（周报场景，第四十笔）', () => {
  it('parse：weekday 合法数组去重升序；坏形态回落「每天」（字段不出现）', () => {
    const doc = parseCronDoc(
      JSON.stringify({
        tasks: [
          { id: 'c1', prompt: '周报', time: '17:30', weekday: [5, 1, 5], providerId: 'p1', enabled: true },
          { id: 'c2', prompt: '坏形态', time: '08:00', weekday: ['x', 9, null], providerId: 'p1', enabled: true },
          { id: 'c3', prompt: '不是数组', time: '08:00', weekday: 3, providerId: 'p1', enabled: true },
        ],
        runs: [],
      }),
    )
    expect(doc.tasks[0].weekday).toEqual([1, 5])
    expect('weekday' in doc.tasks[1]).toBe(false)
    expect('weekday' in doc.tasks[2]).toBe(false)
  })

  it('旧档没有 weekday：每天照跑（逐字兼容，一天不少）', () => {
    const legacy = parseCronDoc(JSON.stringify({
      tasks: [{ id: 'c1', prompt: '旧任务', time: '09:00', providerId: 'p1', enabled: true }],
      runs: [],
    }))
    expect('weekday' in legacy.tasks[0]).toBe(false)
    for (const day of [0, 3, 6]) {
      const r = dueTasks(legacy.tasks, [], new Date(2026, 10, 8 + day, 9, 0))
      expect(r.due).toHaveLength(1)
    }
  })

  it('周五的任务：周三不跑也不记错过；周五才 due；周六出现算错过', () => {
    const { tasks } = parseCronDoc(
      JSON.stringify({
        tasks: [{ id: 'c1', prompt: '周报', time: '17:30', weekday: [5], providerId: 'p1', enabled: true }],
        runs: [],
      }),
    )
    // 2026-11-18 是周三
    const wed = dueTasks(tasks, [], new Date(2026, 10, 18, 17, 30))
    expect(wed.due).toHaveLength(0)
    expect(wed.missed).toHaveLength(0)
    // 2026-11-20 是周五
    const fri = dueTasks(tasks, [], new Date(2026, 10, 20, 17, 30))
    expect(fri.due.map((t) => t.id)).toEqual(['c1'])
    // 2026-11-21 是周六：过了 17:30 但今天不该跑 ⇒ 不记错过
    const sat = dueTasks(tasks, [], new Date(2026, 10, 21, 18, 0))
    expect(sat.due).toHaveLength(0)
    expect(sat.missed).toHaveLength(0)
  })

  it('addTask：weekday 持久化；空 = 不写字段（与旧档同形）', () => {
    const { tasks } = addTask([], { prompt: '周报', time: '17:30', weekday: [5] }, 0)
    expect(tasks[0].weekday).toEqual([5])
    const plain = addTask([], { prompt: '每天', time: '09:00' }, 0)
    expect('weekday' in plain.tasks[0]).toBe(false)
  })

  it('weekdayLabel：升序拼接；空 / 未给 = 空串（调用方显示「每天」）', () => {
    expect(weekdayLabel([5, 1])).toBe('一五')
    expect(weekdayLabel([])).toBe('')
    expect(weekdayLabel(undefined)).toBe('')
  })
})

describe('cron：每月几日（月报场景，第四十二笔）', () => {
  it('parse：monthday 只认真整数 1–31；坏形态回落「每天」（字段不出现）', () => {
    const doc = parseCronDoc(
      JSON.stringify({
        tasks: [
          { id: 'c1', prompt: '月报', time: '09:00', monthday: 1, providerId: 'p1', enabled: true },
          { id: 'c2', prompt: '月末', time: '09:00', monthday: 31, providerId: 'p1', enabled: true },
          { id: 'c3', prompt: '零', time: '09:00', monthday: 0, providerId: 'p1', enabled: true },
          { id: 'c4', prompt: '三十二', time: '09:00', monthday: 32, providerId: 'p1', enabled: true },
          { id: 'c5', prompt: '小数', time: '09:00', monthday: 1.5, providerId: 'p1', enabled: true },
          { id: 'c6', prompt: '字符串', time: '09:00', monthday: '5', providerId: 'p1', enabled: true },
        ],
        runs: [],
      }),
    )
    expect(doc.tasks[0].monthday).toBe(1)
    expect(doc.tasks[1].monthday).toBe(31)
    expect('monthday' in doc.tasks[2]).toBe(false)
    expect('monthday' in doc.tasks[3]).toBe(false)
    expect('monthday' in doc.tasks[4]).toBe(false)
    expect('monthday' in doc.tasks[5]).toBe(false)
  })

  // 2026 年 11 月：1 号是周日、8 号是周日、18 号是周三；2 月只有 28 天
  it('旧档没有 monthday：每天照跑（逐字兼容）', () => {
    const legacy = parseCronDoc(
      JSON.stringify({
        tasks: [{ id: 'c1', prompt: '旧任务', time: '09:00', providerId: 'p1', enabled: true }],
        runs: [],
      }),
    )
    expect('monthday' in legacy.tasks[0]).toBe(false)
    for (const day of [1, 8, 18]) {
      const r = dueTasks(legacy.tasks, [], new Date(2026, 10, day, 9, 0))
      expect(r.due).toHaveLength(1)
    }
  })

  it('每月 1 号的任务：1 号才 due；8 号 / 18 号不跑也不记错过', () => {
    const { tasks } = parseCronDoc(
      JSON.stringify({
        tasks: [{ id: 'c1', prompt: '月报', time: '09:00', monthday: 1, providerId: 'p1', enabled: true }],
        runs: [],
      }),
    )
    const d1 = dueTasks(tasks, [], new Date(2026, 10, 1, 9, 0))
    expect(d1.due.map((t) => t.id)).toEqual(['c1'])
    for (const day of [8, 18]) {
      const r = dueTasks(tasks, [], new Date(2026, 10, day, 9, 0))
      expect(r.due).toHaveLength(0)
      expect(r.missed).toHaveLength(0)
    }
  })

  it('该月没有这一天（2 月 31 号）：安静跳过，不报错也不记错过', () => {
    const { tasks } = parseCronDoc(
      JSON.stringify({
        tasks: [{ id: 'c1', prompt: '月报', time: '09:00', monthday: 31, providerId: 'p1', enabled: true }],
        runs: [],
      }),
    )
    // 2026 年 2 月只有 28 天：扫到 28 号都不该跑
    for (const day of [20, 28]) {
      const r = dueTasks(tasks, [], new Date(2026, 1, day, 9, 0))
      expect(r.due).toHaveLength(0)
      expect(r.missed).toHaveLength(0)
    }
    // 12 月 31 号照跑
    const dec = dueTasks(tasks, [], new Date(2026, 11, 31, 9, 0))
    expect(dec.due.map((t) => t.id)).toEqual(['c1'])
  })

  it('weekday 与 monthday 同设 = AND：周几与月几都要满足', () => {
    const { tasks } = parseCronDoc(
      JSON.stringify({
        tasks: [{ id: 'c1', prompt: '周五的月报', time: '09:00', weekday: [5], monthday: 20, providerId: 'p1', enabled: true }],
        runs: [],
      }),
    )
    // 2026-11-20 是周五、又是 20 号 ⇒ 跑
    const both = dueTasks(tasks, [], new Date(2026, 10, 20, 9, 0))
    expect(both.due.map((t) => t.id)).toEqual(['c1'])
    // 2026-11-13 是周五但不是 20 号 ⇒ 不跑
    const friOnly = dueTasks(tasks, [], new Date(2026, 10, 13, 9, 0))
    expect(friOnly.due).toHaveLength(0)
    // 2026-12-20 是 20 号但不是周五 ⇒ 不跑
    const dayOnly = dueTasks(tasks, [], new Date(2026, 11, 20, 9, 0))
    expect(dayOnly.due).toHaveLength(0)
  })

  it('addTask：monthday 持久化；不给 = 不写字段', () => {
    const { tasks } = addTask([], { prompt: '月报', time: '09:00', monthday: 1 }, 0)
    expect(tasks[0].monthday).toBe(1)
    const plain = addTask([], { prompt: '每天', time: '09:00' }, 0)
    expect('monthday' in plain.tasks[0]).toBe(false)
  })

  it('monthdayLabel 与 MONTHLY_REPORT_PROMPT：人话 + 只读边界写死在文案里', () => {
    expect(monthdayLabel(1)).toBe('每月 1 号')
    expect(monthdayLabel(31)).toBe('每月 31 号')
    expect(monthdayLabel(undefined)).toBe('')
    expect(MONTHLY_REPORT_PROMPT).toContain('本月')
    expect(MONTHLY_REPORT_PROMPT).toContain('不要修改任何卡片')
  })
})
