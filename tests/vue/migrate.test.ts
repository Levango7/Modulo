/**
 * 启动前数据迁移（P0-⑤）。
 *
 * 守四件事：
 *  ① **先快照、后写回** —— 没有退路的改写一次都不许发生；
 *  ② **幂等** —— 迁移过的数据再跑一遍不写盘、不新增快照；
 *  ③ **失败不毁原件** —— 迁移函数抛错 / 快照写不出 / 某个 key 写失败，原件都还在；
 *  ④ 当前生产计划对 v1 数据是**空操作** —— 每次启动重写用户文件是最坏的那种"框架"。
 */
import { describe, expect, it } from 'vitest'
import { createFileStorage, DATA_KEYS, hydrateData } from '../../src/vue/fileStorage'
import { memoryStorage, type StorageAdapter } from '../../src/vue/store'
import { MIGRATE_BACKUP_KEY, MIGRATION_PLAN, migrateStorage, type KeyPlan } from '../../src/vue/migrate'

const LAYOUT = 'modulo.layout.v1'
const SCHEMES = 'modulo.schemes.v1'
const v1 = { schemaVersion: 1, cols: 12, items: [] }
const toV2 = (raw: Record<string, unknown>) => ({ ...raw, addedInV2: true })

const plan = (to = 2, key = LAYOUT): KeyPlan[] => [{ key, table: { 1: toV2 }, to }]
const at = () => new Date('2026-10-21T00:00:00.000Z')

const backupRuns = (storage: StorageAdapter) => JSON.parse(storage.get(MIGRATE_BACKUP_KEY) ?? '{"runs":[]}').runs as { at: string; keys: { key: string; raw: string }[] }[]

/** 只对指定 key 的写入抛错；其余照常 */
function failOn(base: StorageAdapter, key: string): StorageAdapter {
  return {
    get: (k) => base.get(k),
    set: (k, v) => {
      if (k === key) throw new Error(`write ${k} failed`)
      base.set(k, v)
    },
  }
}

describe('migrateStorage：迁移 → 快照 → 写回', () => {
  it('v1 → v2：写回新版本，并把**原样**快照留下', () => {
    const storage = memoryStorage()
    storage.set(LAYOUT, JSON.stringify(v1))
    const before = storage.get(LAYOUT)!

    const r = migrateStorage(storage, plan(), at)
    expect(r.changed).toEqual([LAYOUT])
    expect(r.notes.join()).toContain('已迁移')
    expect(JSON.parse(storage.get(LAYOUT)!)).toMatchObject({ schemaVersion: 2, addedInV2: true })

    const runs = backupRuns(storage)
    expect(runs).toHaveLength(1)
    expect(runs[0].at).toBe('2026-10-21T00:00:00.000Z')
    expect(runs[0].keys).toEqual([{ key: LAYOUT, raw: before }])
  })

  it('幂等：已经迁过的数据再跑一遍，不写盘也不新增快照', () => {
    const storage = memoryStorage()
    storage.set(LAYOUT, JSON.stringify(v1))
    migrateStorage(storage, plan(), at)
    const migrated = storage.get(LAYOUT)!

    const second = migrateStorage(storage, plan(), at)
    expect(second).toEqual({ notes: [], changed: [], snapshotAt: null })
    expect(storage.get(LAYOUT)).toBe(migrated)
    expect(backupRuns(storage)).toHaveLength(1)
  })

  it('迁移函数抛错：一条都不写、不留快照，原件原样', () => {
    const storage = memoryStorage()
    storage.set(LAYOUT, JSON.stringify(v1))
    const boom: KeyPlan[] = [
      {
        key: LAYOUT,
        table: {
          1: () => {
            throw new Error('bad step')
          },
        },
        to: 2,
      },
    ]
    const r = migrateStorage(storage, boom, at)
    expect(r).toEqual({ notes: [], changed: [], snapshotAt: null })
    expect(JSON.parse(storage.get(LAYOUT)!)).toEqual(v1)
    expect(storage.get(MIGRATE_BACKUP_KEY)).toBeNull()
  })

  it('坏 JSON 不碰（那是各自解析层的活，写成"空"才是灾难）', () => {
    const storage = memoryStorage()
    storage.set(LAYOUT, '{坏')
    expect(migrateStorage(storage, plan(), at)).toEqual({ notes: [], changed: [], snapshotAt: null })
    expect(storage.get(LAYOUT)).toBe('{坏')
  })

  it('快照写不出去就不迁移 —— 没有退路的改写一次都不做', () => {
    const base = memoryStorage()
    base.set(LAYOUT, JSON.stringify(v1))
    const storage = failOn(base, MIGRATE_BACKUP_KEY)
    const r = migrateStorage(storage, plan(), at)
    expect(r.changed).toEqual([])
    expect(r.notes.join()).toContain('现场快照写入失败')
    expect(JSON.parse(base.get(LAYOUT)!)).toEqual(v1)
  })

  it('某个 key 写失败：其余照常迁移，失败那个保留原件并说明', () => {
    const base = memoryStorage()
    base.set(LAYOUT, JSON.stringify(v1))
    base.set(SCHEMES, JSON.stringify(v1))
    const storage = failOn(base, SCHEMES)
    const two: KeyPlan[] = [
      { key: LAYOUT, table: { 1: toV2 }, to: 2 },
      { key: SCHEMES, table: { 1: toV2 }, to: 2 },
    ]
    const r = migrateStorage(storage, two, at)
    expect(r.changed).toEqual([LAYOUT])
    expect(r.notes.join()).toContain(SCHEMES)
    expect(JSON.parse(base.get(LAYOUT)!)).toMatchObject({ schemaVersion: 2 })
    expect(JSON.parse(base.get(SCHEMES)!)).toEqual(v1)
    // 快照里两份原件都在（退路不受"某一份写失败"影响）
    expect(backupRuns(base)[0].keys.map((k) => k.key)).toEqual([LAYOUT, SCHEMES])
  })

  it('盘上的快照形状坏掉：坏条目丢掉、好条目照用，不因为历史坏了拒绝这次迁移', () => {
    const storage = memoryStorage()
    storage.set(
      MIGRATE_BACKUP_KEY,
      JSON.stringify({ runs: [{ at: '2026-10-20T00:00:00.000Z', keys: [{ key: LAYOUT, raw: 'old' }, { nope: 1 }, { key: 'x', raw: 1 }] }, { at: 42 }, 'x'] }),
    )
    storage.set(LAYOUT, JSON.stringify(v1))
    migrateStorage(storage, plan(), at)
    const runs = backupRuns(storage)
    expect(runs).toHaveLength(2)
    expect(runs[0].keys).toEqual([{ key: LAYOUT, raw: 'old' }])
    expect(runs[1].at).toBe('2026-10-21T00:00:00.000Z')
  })

  it('快照 JSON 坏掉：当作没有历史，仍然完成这次迁移', () => {
    const storage = memoryStorage()
    storage.set(MIGRATE_BACKUP_KEY, '{坏')
    storage.set(LAYOUT, JSON.stringify(v1))
    expect(migrateStorage(storage, plan(), at).changed).toEqual([LAYOUT])
    expect(backupRuns(storage)).toHaveLength(1)
  })

  it('读快照本身抛错：当作没有历史，仍然完成这次迁移', () => {
    const base = memoryStorage()
    base.set(LAYOUT, JSON.stringify(v1))
    const storage: StorageAdapter = {
      get: (k) => {
        if (k === MIGRATE_BACKUP_KEY) throw new Error('read fail')
        return base.get(k)
      },
      set: (k, v) => base.set(k, v),
    }
    const r = migrateStorage(storage, plan(), at)
    expect(r.changed).toEqual([LAYOUT])
    expect(backupRuns(base)).toHaveLength(1)
  })

  it('快照最多留最近 3 次', () => {
    const storage = memoryStorage()
    for (let i = 0; i < 5; i++) {
      storage.set(LAYOUT, JSON.stringify(v1))
      migrateStorage(storage, plan(), () => new Date(`2026-10-2${i}T00:00:00.000Z`))
    }
    const runs = backupRuns(storage)
    expect(runs).toHaveLength(3)
    expect(runs.map((r) => r.at)).toEqual(['2026-10-22T00:00:00.000Z', '2026-10-23T00:00:00.000Z', '2026-10-24T00:00:00.000Z'])
  })
})

describe('生产计划：当前是空操作，且键都登记在 DATA_KEYS', () => {
  it('什么都不传（默认计划 + 默认时钟）在空存储上是安全的空操作', () => {
    expect(migrateStorage(memoryStorage())).toEqual({ notes: [], changed: [], snapshotAt: null })
  })

  it('v1 的版面 / 方案册 / 卡片内容原样不动（不重写、不留快照）', () => {
    const storage = memoryStorage()
    for (const k of ['modulo.layout.v1', 'modulo.schemes.v1', 'modulo.carddata.v1']) storage.set(k, JSON.stringify(v1))
    expect(migrateStorage(storage, MIGRATION_PLAN, at)).toEqual({ notes: [], changed: [], snapshotAt: null })
    expect(storage.get(LAYOUT)).toBe(JSON.stringify(v1))
    expect(storage.get(MIGRATE_BACKUP_KEY)).toBeNull()
  })

  it('计划里的每个 key 与快照键都在 DATA_KEYS 里（桌面 get 只读 hydrate 的镜像）', () => {
    for (const item of MIGRATION_PLAN) expect(DATA_KEYS, item.key).toContain(item.key)
    expect(DATA_KEYS).toContain(MIGRATE_BACKUP_KEY)
  })
})

/** 桌面适配器"启动 hydrate 成内存镜像、之后 get 只读镜像" —— 快照键没登记就重启读不到 */
describe('快照扛得住桌面重启（hydrate 只认 DATA_KEYS）', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('重启后再迁移一次，追加到既有快照而不是从零开始', async () => {
    const disk = new Map<string, string>()
    const write = async (name: string, content: string) => void disk.set(name, content)

    const first = createFileStorage({}, write)
    first.set(LAYOUT, JSON.stringify(v1))
    await settle()
    migrateStorage(first, plan(), at)
    await settle()
    expect(disk.has(MIGRATE_BACKUP_KEY), '快照确实落了盘').toBe(true)

    const read = async (name: string) => disk.get(name) ?? null
    const second = createFileStorage(await hydrateData(read, async () => undefined, () => null), write)
    // 把它改回 v1 再造一次迁移：若快照读得到，就会变成第 2 次
    second.set(LAYOUT, JSON.stringify(v1))
    await settle()
    migrateStorage(second, plan(), () => new Date('2026-10-22T00:00:00.000Z'))
    await settle()
    expect(backupRuns(second)).toHaveLength(2)
  })
})
