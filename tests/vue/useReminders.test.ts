/**
 * 提醒胶水层（P0-④ 阶段 1）：去重、静默、跨天、设置落盘、桌面重启。
 *
 * 这一层最容易出的不是"算错"，而是"**每分钟重复弹同一条**"与"**重启后又弹一遍**"——
 * 前者靠 fired + 稳定 key，后者靠 `modulo.reminders.v1` 在 `DATA_KEYS` 里（桌面 `get` 只读
 * hydrate 出来的镜像；P0-③ 在自动备份上踩过一次同形状的坑）。最后一条用例把整条链跑真。
 */
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createFallbackCardData } from '../../src/vue/cardDataFallback'
import { createFileStorage, hydrateData } from '../../src/vue/fileStorage'
import { memoryStorage, type StorageAdapter } from '../../src/vue/store'
import { DEFAULT_REMINDER_SETTINGS } from '../../src/vue/reminders'
import type { Reminder } from '../../src/vue/reminders'
import { REMINDERS_KEY, useReminders } from '../../src/vue/useReminders'

const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min, 0, 0)

function setup(opts: { clock: { now: Date }; storage?: StorageAdapter; deliver?: (items: Reminder[]) => void } = { clock: { now: at(2026, 10, 21) } }) {
  const state = reactive(createFallbackCardData())
  const delivered: Reminder[][] = []
  const reminders = useReminders(() => state, {
    storage: opts.storage ?? memoryStorage(),
    now: () => opts.clock.now,
    deliver: (items) => {
      delivered.push(items)
      opts.deliver?.(items)
    },
  })
  return { state, reminders, delivered, clock: opts.clock }
}

describe('去重与静默', () => {
  it('同一天同一件事只投递一次（tick 每分钟都在跑）', () => {
    const { state, reminders, delivered, clock } = setup()
    state.countdown = { label: '发布', date: '2026-10-21' }
    expect(reminders.tick().map((r) => r.kind)).toEqual(['countdown'])
    clock.now = at(2026, 10, 21, 9, 1)
    expect(reminders.tick()).toEqual([])
    clock.now = at(2026, 10, 21, 23, 59)
    expect(reminders.tick()).toEqual([])
    expect(delivered).toHaveLength(1)
  })

  it('静默时段压住投递、但**不记**已提醒 —— 静默结束后同一天内补弹', () => {
    const clock = { now: at(2026, 10, 21, 13, 0) }
    const { state, reminders, delivered } = setup({ clock })
    state.countdown = { label: '发布', date: '2026-10-21' }
    reminders.setSettings({ quietStart: '12:00', quietEnd: '14:00' })
    expect(reminders.quietNow.value).toBe(true)
    expect(reminders.tick()).toEqual([])
    expect(delivered).toHaveLength(0)

    clock.now = at(2026, 10, 21, 14, 0)
    expect(reminders.tick().map((r) => r.kind)).toEqual(['countdown'])
  })

  it('关掉开关：事实还在（pending 不为空），但一条都不投', () => {
    const { state, reminders, delivered } = setup()
    state.countdown = { label: '发布', date: '2026-10-21' }
    reminders.setSettings({ enabled: false })
    expect(reminders.pending.value).toEqual([])
    expect(reminders.tick()).toEqual([])
    expect(delivered).toHaveLength(0)
  })

  it('跨天：昨天提醒过的，今天换了日子要重新提醒', () => {
    const clock = { now: at(2026, 10, 21, 9, 0) }
    const { state, reminders, delivered } = setup({ clock })
    state.countdown = { label: '发布', date: '2026-10-21' }
    reminders.tick()
    clock.now = at(2026, 10, 22, 9, 0)
    state.countdown = { label: '发布', date: '2026-10-22' }
    expect(reminders.tick().map((r) => r.key)).toEqual(['countdown:2026-10-22'])
    expect(delivered).toHaveLength(2)
  })
})

describe('设置：落盘、读回、坏数据不炸', () => {
  it('改完立刻落盘；换一个实例读得回来', () => {
    const storage = memoryStorage()
    const first = setup({ clock: { now: at(2026, 10, 21) }, storage })
    first.reminders.setSettings({ quietStart: '21:30', habitAfter: '19:00', enabled: false })
    expect(JSON.parse(storage.get(REMINDERS_KEY)!).settings).toMatchObject({ quietStart: '21:30', habitAfter: '19:00', enabled: false })

    const second = setup({ clock: { now: at(2026, 10, 21) }, storage })
    expect(second.reminders.state.settings).toMatchObject({ quietStart: '21:30', habitAfter: '19:00', enabled: false })
  })

  it('时间串认不出时保留原值，不写进一个用户没选过的时段', () => {
    const { reminders } = setup()
    const before = { ...reminders.state.settings }
    reminders.setSettings({ quietStart: '9:5' })
    expect(reminders.state.settings.quietStart).toBe(before.quietStart)
    reminders.setSettings({ habitAfter: '' })
    expect(reminders.state.settings.habitAfter).toBe(before.habitAfter)
  })

  it('系统通知开关：默认开、可关、非布尔值不覆盖原值', () => {
    const storage = memoryStorage()
    const first = setup({ clock: { now: at(2026, 10, 21) }, storage })
    expect(first.reminders.state.settings.systemNotifications).toBe(true)
    first.reminders.setSettings({ systemNotifications: false })
    expect(JSON.parse(storage.get(REMINDERS_KEY)!).settings.systemNotifications).toBe(false)

    const second = setup({ clock: { now: at(2026, 10, 21) }, storage })
    expect(second.reminders.state.settings.systemNotifications).toBe(false)
    second.reminders.setSettings({ systemNotifications: 'yes' as unknown as boolean })
    expect(second.reminders.state.settings.systemNotifications).toBe(false)
  })

  it('盘上是坏 JSON / 坏字段：回默认值，不抛', () => {
    const storage = memoryStorage()
    storage.set(REMINDERS_KEY, '{坏')
    expect(setup({ clock: { now: at(2026, 10, 21) }, storage }).reminders.state.settings).toEqual(DEFAULT_REMINDER_SETTINGS)

    storage.set(REMINDERS_KEY, JSON.stringify({ settings: { enabled: 'yes', quietStart: '99:99', quietEnd: '08:00' }, day: 'x', fired: [1, 'a'] }))
    const r = setup({ clock: { now: at(2026, 10, 21) }, storage }).reminders
    expect(r.state.settings.enabled).toBe(DEFAULT_REMINDER_SETTINGS.enabled)
    expect(r.state.settings.quietStart).toBe(DEFAULT_REMINDER_SETTINGS.quietStart)
    expect(r.state.settings.quietEnd).toBe('08:00')
    expect(r.state.day).toBe('')
    expect(r.state.fired).toEqual(['a'])
  })
})

describe('定时器与存储的边角', () => {
  it('start 幂等、stop 之后不再对表（每分钟那条真的在跑）', async () => {
    vi.useFakeTimers()
    try {
      const clock = { now: at(2026, 10, 21, 9, 0) }
      const { state, reminders, delivered } = setup({ clock })
      state.countdown = { label: '发布', date: '2026-10-21' }
      reminders.start()
      expect(delivered).toHaveLength(1)
      reminders.start() // 幂等：不会多一个定时器
      clock.now = at(2026, 10, 21, 9, 30)
      state.birthdays = [{ id: 'b1', name: '妈妈', month: 10, day: 21 }]
      vi.advanceTimersByTime(60_000)
      expect(delivered).toHaveLength(2)

      reminders.stop()
      state.birthdays = [
        { id: 'b1', name: '妈妈', month: 10, day: 21 },
        { id: 'b2', name: '老陈', month: 10, day: 21 },
      ]
      vi.advanceTimersByTime(120_000)
      expect(delivered, 'stop 之后不该再投').toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('不给 storage 也能跑（内存态），setSettings 不抛', () => {
    const state = reactive(createFallbackCardData())
    const r = useReminders(() => state, { now: () => at(2026, 10, 21) })
    r.setSettings({ enabled: false })
    expect(r.state.settings.enabled).toBe(false)
    expect(r.tick()).toEqual([])
  })

  it('不注入时钟也能构造（生产路径：默认取真实时间）', () => {
    const state = reactive(createFallbackCardData())
    const r = useReminders(() => state)
    expect(r.state.settings).toEqual(DEFAULT_REMINDER_SETTINGS)
    expect(r.pending.value).toEqual([]) // 空内容下没有事实，与真实时钟无关
  })

  it('stop 在没启动时调用是安全的', () => {
    const { reminders } = setup()
    expect(() => reminders.stop()).not.toThrow()
  })

  it('盘上是对象但没有 settings 段：设置回默认值，其余字段照读', () => {
    const storage = memoryStorage()
    storage.set(REMINDERS_KEY, JSON.stringify({ day: '2026-10-21', fired: ['countdown:2026-10-21'] }))
    const r = setup({ clock: { now: at(2026, 10, 21) }, storage }).reminders
    expect(r.state.settings).toEqual(DEFAULT_REMINDER_SETTINGS)
    expect(r.state.fired).toEqual(['countdown:2026-10-21'])
  })

  it('盘上是 null / fired 不是数组：回默认值', () => {
    const storage = memoryStorage()
    storage.set(REMINDERS_KEY, 'null')
    expect(setup({ clock: { now: at(2026, 10, 21) }, storage }).reminders.state.fired).toEqual([])
    storage.set(REMINDERS_KEY, JSON.stringify({ settings: {}, day: '2026-10-21', fired: 'nope' }))
    expect(setup({ clock: { now: at(2026, 10, 21) }, storage }).reminders.state.fired).toEqual([])
  })

  it('存储写失败不拦投递（提醒不能因为写盘挂了就不响）', () => {
    const disk = memoryStorage()
    const throwing: StorageAdapter = {
      get: (k) => disk.get(k),
      set: () => {
        throw new Error('quota')
      },
    }
    const clock = { now: at(2026, 10, 21, 9, 0) }
    const { state, reminders, delivered } = setup({ clock, storage: throwing })
    state.countdown = { label: '发布', date: '2026-10-21' }
    expect(reminders.tick()).toHaveLength(1)
    expect(delivered).toHaveLength(1)
  })
})

/** 桌面适配器"启动 hydrate 成内存镜像、之后 get 只读镜像" —— 键没进 DATA_KEYS 就重启读不到 */describe('扛得住桌面重启（hydrate 只认 DATA_KEYS）', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('提醒过的事重启后不会再弹一遍', async () => {
    const disk = new Map<string, string>()
    const write = async (name: string, content: string) => void disk.set(name, content)
    const clock = { now: at(2026, 10, 21, 9, 0) }

    const first = setup({ clock, storage: createFileStorage({}, write) })
    first.state.countdown = { label: '发布', date: '2026-10-21' }
    expect(first.reminders.tick()).toHaveLength(1)
    await settle()
    expect(disk.has(REMINDERS_KEY), '提醒记录确实落了盘').toBe(true)

    const read = async (name: string) => disk.get(name) ?? null
    const second = setup({ clock, storage: createFileStorage(await hydrateData(read, async () => undefined, () => null), write) })
    second.state.countdown = { label: '发布', date: '2026-10-21' }
    expect(second.reminders.tick(), '重启后同一条不该再弹').toEqual([])
  })
})
