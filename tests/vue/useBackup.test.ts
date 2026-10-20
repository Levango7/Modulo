/**
 * `useBackup` 的胶水层判据（2026-10-20，P0-③）。
 *
 * 这一组守的是**恢复的完整性**：备份包一直是全的（`buildBackup` 导出整份 CardData），
 * 但 2026-10-20 之前 `confirmRestore` 只回填便签/待办/速记/倒数日四个字段 ——
 * 记账、四象限、习惯、生日、链接、订阅、自选、自定卡全都静默丢失。
 * 下面的「整份恢复」用例在旧实现上必红。
 *
 * 另外守自动备份：环形 7 份、24h 判定、版本变化判定、恢复前留现场。
 * `desktop: true` 是给这几条用的测试缝（生产走 `isDesktop`，node 环境里是 false）。
 */
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { REGISTRY } from '../../src/vue/cardRegistry'
import { createFallbackCardData } from '../../src/vue/cardDataFallback'
import { emptyCardData, buildBackup, backupToJson, BACKUP_VERSION, type BackupSettings } from '../../src/vue/backup'
import { createLayoutStore, memoryStorage, type StorageAdapter } from '../../src/vue/store'
import { useBackup, APP_VERSION, AUTO_INDEX_KEY, autoSlotKey, type AutoBackupMeta } from '../../src/vue/useBackup'
import { createFileStorage, hydrateData } from '../../src/vue/fileStorage'
import { useSchemes } from '../../src/vue/useSchemes'

const AUTO_INDEX = AUTO_INDEX_KEY
const slotKey = autoSlotKey

function setup(settings: BackupSettings = { appearance: { skin: 'ink' }, template: 'general' }, storage: StorageAdapter = memoryStorage()) {
  const store = createLayoutStore({ registry: REGISTRY, storage })
  const schemes = useSchemes(store, storage)
  const state = reactive(createFallbackCardData())
  const applied: BackupSettings[] = []
  const backup = useBackup(store, schemes, () => state, {
    storage,
    desktop: true,
    settings: { get: () => settings, apply: (s) => void applied.push(s) },
  })
  return { storage, store, schemes, state, backup, applied }
}

/** 造一份"内容很全"的来源数据：每个易丢字段都放一条，旧实现只回填四个字段时它们会消失 */
function richCardData() {
  const d = emptyCardData()
  d.sticky = '便签正文'
  d.todos = [{ id: 't1', text: '待办', done: false }]
  d.notes = [{ id: 'n1', title: '速记', body: '正文', at: 1 }]
  d.countdown = { label: '发布', date: '2026-11-01' }
  d.ledger = { symbol: '¥', entries: [{ id: 'e1', date: '2026-10-01', cents: 1234, category: '餐饮', note: '午饭' }] }
  d.matrix = [{ id: 'm1', text: '重要且紧急', q: 'do', done: false }]
  d.habit = { name: '跑步', days: ['2026-10-19'] }
  d.birthdays = [{ id: 'b1', name: '朋友', month: 3, day: 4 }]
  d.links = [{ id: 'l1', label: '官网', href: 'https://example.com' }]
  d.feeds = [{ id: 'f1', label: 'RSS', url: 'https://example.com/feed.xml' }]
  d.stocks = [{ id: 's1', label: '贵州茅台', code: '600519' }]
  d.htmlCards = [{ id: 'h1', title: '自定卡', html: '<b>x</b>' }]
  return d
}

const seedSlot = (storage: ReturnType<typeof memoryStorage>, store: ReturnType<typeof createLayoutStore>, cardData: ReturnType<typeof richCardData>, meta: AutoBackupMeta) => {
  const payload = buildBackup({
    layout: store.doc.value,
    schemes: { schemaVersion: 1, activeId: null, schemes: [] } as never,
    cardData,
    app: APP_VERSION,
    settings: { appearance: { skin: 'ink' }, template: 'general' },
  })
  storage.set(slotKey(meta.slot), backupToJson(payload))
  storage.set(AUTO_INDEX, JSON.stringify([meta]))
}

const meta = (slot = 0, at = new Date().toISOString(), reason: AutoBackupMeta['reason'] = 'manual'): AutoBackupMeta => ({
  slot,
  at,
  reason,
  app: APP_VERSION,
  version: BACKUP_VERSION,
  bytes: 1,
})

describe('confirmRestore：整份恢复（旧实现只回填四个字段）', () => {
  it('记账 / 四象限 / 习惯 / 生日 / 链接 / 订阅 / 自选 / 自定卡 全部回来', () => {
    const { storage, store, state, backup, applied } = setup()
    seedSlot(storage, store, richCardData(), meta(0))
    backup.restoreAuto(meta(0))
    expect(backup.pending.value, '待确认块要出现').not.toBeNull()
    backup.confirmRestore()

    expect(state.sticky).toBe('便签正文')
    expect(state.todos.map((t) => t.id)).toEqual(['t1'])
    expect(state.notes.map((n) => n.id)).toEqual(['n1'])
    expect(state.countdown.date).toBe('2026-11-01')
    expect(state.ledger.entries.map((e) => e.id), '记账以前会静默丢失').toEqual(['e1'])
    expect(state.matrix.map((m) => m.id)).toEqual(['m1'])
    expect(state.habit.name).toBe('跑步')
    expect(state.birthdays.map((b) => b.id)).toEqual(['b1'])
    expect(state.links.map((l) => l.id)).toEqual(['l1'])
    expect(state.feeds.map((f) => f.id)).toEqual(['f1'])
    expect(state.stocks.map((s) => s.id)).toEqual(['s1'])
    expect(state.htmlCards.map((h) => h.id)).toEqual(['h1'])
    expect(applied, '外观设置也要套上').toHaveLength(1)
    expect(applied[0].appearance).toEqual({ skin: 'ink' })
    expect(backup.pending.value).toBeNull()
  })

  it('恢复前自动留一份现场（桌面）', () => {
    const { storage, store, backup } = setup()
    seedSlot(storage, store, richCardData(), meta(0))
    backup.restoreAuto(meta(0))
    backup.refreshAuto()
    const before = backup.autoBackups.value.length
    backup.confirmRestore()
    expect(backup.autoBackups.value.length, '恢复前多出一份').toBe(before + 1)
    expect(backup.autoBackups.value.some((m) => m.reason === 'pre-restore')).toBe(true)
  })

  it('整份回填是深拷贝：改回填后的数组不会污染来源对象', () => {
    const { storage, store, state, backup } = setup()
    const source = richCardData()
    seedSlot(storage, store, source, meta(0))
    backup.restoreAuto(meta(0))
    backup.confirmRestore()
    state.ledger.entries.push({ id: 'e2', date: '2026-10-02', cents: 1, category: '其他', note: '' })
    expect(source.ledger.entries).toHaveLength(1)
  })
})

describe('自动备份：环形 7 份与触发条件', () => {
  it('没有索引时首次启动建一份基线', () => {
    const { backup } = setup()
    backup.initAutoBackup()
    expect(backup.autoBackups.value).toHaveLength(1)
  })

  it('连写 8 次仍是 7 份，槽位不重复', () => {
    const { storage, backup } = setup()
    for (let i = 0; i < 8; i++) backup.runAutoBackup('manual')
    const list = JSON.parse(storage.get(AUTO_INDEX) ?? '[]') as AutoBackupMeta[]
    expect(list).toHaveLength(7)
    expect(new Set(list.map((m) => m.slot)).size).toBe(7)
    expect(backup.autoBackups.value).toHaveLength(7)
    // 被覆盖的槽里存的必须是合法备份（不是半截 JSON）
    for (const m of list) expect(storage.get(slotKey(m.slot))?.includes('"kind":"modulo.backup"')).toBe(true)
  })

  it('距上一份满 24h → 每日备份', () => {
    const { storage, backup } = setup()
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    storage.set(AUTO_INDEX, JSON.stringify([meta(0, old, 'daily')]))
    backup.initAutoBackup()
    expect(backup.autoBackups.value.length).toBe(2)
  })

  it('版本变化后的首次启动 → 留一份 pre-upgrade', () => {
    const { storage, backup } = setup()
    storage.set(AUTO_INDEX, JSON.stringify([{ ...meta(0), app: '0.0.1' }]))
    backup.initAutoBackup()
    expect(backup.autoBackups.value.some((m) => m.reason === 'pre-upgrade')).toBe(true)
  })

  it('24h 内且版本没变 → 不重复备份', () => {
    const { storage, backup } = setup()
    storage.set(AUTO_INDEX, JSON.stringify([meta(0, new Date().toISOString(), 'daily')]))
    backup.initAutoBackup()
    expect(backup.autoBackups.value).toHaveLength(1)
  })

  it('槽位读不出来时如实说，不产生待确认块', () => {
    const { storage, backup } = setup()
    storage.set(AUTO_INDEX, JSON.stringify([meta(3)]))
    backup.restoreAuto(meta(3))
    expect(backup.pending.value).toBeNull()
    expect(backup.notices.value.join()).toContain('读不出来')
  })

  it('索引是坏数据时当作空表，不抛', () => {
    const { storage, backup } = setup()
    storage.set(AUTO_INDEX, '{坏')
    backup.refreshAuto()
    expect(backup.autoBackups.value).toEqual([])
  })
})

/**
 * 桌面壳的存储适配器是"启动 hydrate 成内存镜像、之后 `get` 只读镜像"，而镜像内容 =
 * `fileStorage.ts` 里的 `DATA_KEYS`。自动备份的键漏登记时**不会报错**，症状是
 * "重启后读不到自己刚写的备份" —— 每次启动都以为没有备份，重建基线并把环形 7 份洗掉。
 * 这条用例把整条链跑真：写 → 落盘记录 → 按 DATA_KEYS 重新 hydrate → 列表里还得有那份备份。
 */
describe('自动备份扛得住桌面重启（hydrate 只认 DATA_KEYS）', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('写下去的索引与槽位，重启后按同一张表读得回来', async () => {
    const disk = new Map<string, string>()
    const write = async (name: string, content: string) => void disk.set(name, content)
    const first = setup(undefined, createFileStorage({}, write))
    first.backup.runAutoBackup('daily')
    await settle()
    expect(disk.has(AUTO_INDEX_KEY), '索引确实落了盘').toBe(true)
    expect(disk.has(autoSlotKey(0)), '槽 0 确实落了盘').toBe(true)

    const read = async (name: string) => disk.get(name) ?? null
    const second = setup(undefined, createFileStorage(await hydrateData(read, async () => undefined, () => null), write))
    second.backup.refreshAuto()
    expect(second.backup.autoBackups.value.map((m) => m.reason), '重启后列表还在').toEqual(['daily'])
    // 槽内容也一起回来了，否则"恢复这份"会报"读不出来"
    expect(second.storage.get(autoSlotKey(0)) ?? '').toContain('"kind":"modulo.backup"')
  })
})
