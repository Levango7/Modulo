/**
 * `useSkills` 的胶水层单测（backlog ① 第三十三笔）。
 *
 * 判定全在 `skills.ts` 的纯函数里（那里已有独立测试），这里只钉必须活在 composable 的
 * 那一层：构造时读档、入库才落盘、全拒收不空写、remove/clearAll 无条件落盘、ref 共享。
 *
 * 三条夹具纪律（与 `useCron.test.ts` / `mcp.test.ts` 同源）：
 * - 种子必须在 `createSkills` **之前**写进 storage —— 构造时就读档，事后写它看不见；
 * - "写没写盘"一律读 `storage.get(KEY)` 反序列化（辅以 spy 计数），不只看 ref 变了；
 * - `Date.now()` 用假时钟钉死，重复 add 的 id 分配才能逐字断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { createSkills } from '../../src/vue/useSkills'
import { SKILL_DOC_KEY, parseSkills, serializeSkills, type Skill } from '../../src/vue/skills'
import { memoryStorage } from '../../src/vue/store'

const NOW = 1_760_000_000_000
const BASE = NOW.toString(36)

const seedSkill = (over: Partial<Skill> = {}): Skill => ({
  id: 's-seed',
  name: '种下的',
  text: '种下的正文',
  chars: 5,
  addedAt: 1,
  ...over,
})

function makeSkills(seedRaw?: string) {
  const storage = memoryStorage()
  if (seedRaw !== undefined) storage.set(SKILL_DOC_KEY, seedRaw)
  const set = vi.spyOn(storage, 'set')
  const api = createSkills(storage)
  set.mockClear() // 构造期本就不写盘；计数只从"动作"开始
  const disk = (): Skill[] => parseSkills(storage.get(SKILL_DOC_KEY))
  return { storage, set, api, disk }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSkills：构造时读档', () => {
  it('种子在 createSkills 之前写进盘上，构造出来就是那一条', () => {
    const { api } = makeSkills(serializeSkills([seedSkill()]))
    expect(api.skills.value.map((s) => s.name)).toEqual(['种下的'])
  })

  it('缺档 / 坏档 / 结构不对都不抛，构造期也不写盘', () => {
    for (const raw of [undefined, 'not json', '{}', '{"skills":"nope"}']) {
      const { api, storage, set } = makeSkills(raw)
      expect(api.skills.value).toEqual([])
      expect(storage.get(SKILL_DOC_KEY)).toBe(raw === undefined ? null : raw)
      expect(set).not.toHaveBeenCalled()
    }
  })
})

describe('useSkills：add 才有条件落盘', () => {
  it('入库即落盘，读回来是同一个列表', () => {
    const { api, disk, set } = makeSkills()
    const rejected = api.add([
      { name: '甲', text: '正文甲' },
      { name: '乙', text: '正文乙' },
    ])
    expect(rejected).toEqual([])
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(SKILL_DOC_KEY, expect.any(String))
    expect(disk().map((s) => s.name)).toEqual(['甲', '乙'])
    expect(disk()[0]!.addedAt).toBe(Math.floor(NOW / 1000))
  })

  it('一条入库一条被拒：只落入库那条，理由逐条传出来', () => {
    const { api, disk, set } = makeSkills()
    const rejected = api.add([
      { name: '甲', text: '正文甲' },
      { name: '甲', text: '同名再来' },
    ])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('已经有这条技能')
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk().map((s) => s.name)).toEqual(['甲'])
  })

  it('一次全拒收不空写盘', () => {
    const { storage, api, set } = makeSkills()
    const rejected = api.add([{ name: '', text: '没有名字' }])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('没有名字')
    expect(api.skills.value).toEqual([])
    expect(storage.get(SKILL_DOC_KEY)).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })

  it('盘上已有老档时全拒收也不重写一遍', () => {
    const seed = serializeSkills([seedSkill()])
    const { storage, api, set } = makeSkills(seed)
    expect(api.add([{ name: '种下的', text: '同名会被拒' }])).toHaveLength(1)
    expect(set).not.toHaveBeenCalled()
    expect(storage.get(SKILL_DOC_KEY)).toBe(seed)
  })

  it('重复 add 的 id 分配：同毫秒撞车时按 -1/-2 让位', () => {
    const { api, disk } = makeSkills()
    api.add([
      { name: '甲', text: '甲' },
      { name: '乙', text: '乙' },
    ])
    api.add([
      { name: '丙', text: '丙' },
      { name: '丁', text: '丁' },
    ])
    expect(disk().map((s) => s.id)).toEqual([
      `s${BASE}0`,
      `s${BASE}1`,
      `s${BASE}0-1`,
      `s${BASE}1-1`,
    ])
    const ids = disk().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('useSkills：remove / clearAll 无条件落盘', () => {
  it('remove 命中即落盘，盘上少了那条', () => {
    const { api, disk, set } = makeSkills(
      serializeSkills([seedSkill(), seedSkill({ id: 's-2', name: '第二条' })]),
    )
    api.remove('s-seed')
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk().map((s) => s.name)).toEqual(['第二条'])
  })

  it('remove 未知 id 也照写一遍盘（源码无条件 save），内容不变', () => {
    const seed = serializeSkills([seedSkill()])
    const { storage, api, disk, set } = makeSkills(seed)
    api.remove('不存在')
    expect(set).toHaveBeenCalledTimes(1)
    expect(storage.get(SKILL_DOC_KEY)).toBe(seed)
    expect(disk().map((s) => s.name)).toEqual(['种下的'])
  })

  it('clearAll 后盘上是空数组', () => {
    const { storage, api, disk, set } = makeSkills(serializeSkills([seedSkill()]))
    api.clearAll()
    expect(api.skills.value).toEqual([])
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk()).toEqual([])
    expect(JSON.parse(storage.get(SKILL_DOC_KEY)!)).toEqual({ schemaVersion: 1, skills: [] })
  })
})

describe('useSkills：ref 响应式共享', () => {
  it('两处持有同一个 ref：经 API 加 / 删 / 清，两侧同步且同步触发监听', () => {
    const { api } = makeSkills()
    const left = api.skills
    const right = api.skills
    expect(left).toBe(right)
    const lengths: number[] = []
    const stop = watch(left, (v) => lengths.push(v.length), { flush: 'sync' })

    api.add([{ name: '甲', text: '正文' }])
    expect(right.value.map((s) => s.name)).toEqual(['甲'])
    api.remove(right.value[0]!.id)
    expect(left.value).toEqual([])
    api.clearAll()
    expect(lengths).toEqual([1, 0, 0])
    stop()
  })
})
