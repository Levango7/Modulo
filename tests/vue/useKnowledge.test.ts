/**
 * `useKnowledge` 的胶水层单测（backlog ① 第三十三笔）。
 *
 * 与 `useSkills.test.ts` 逐字同构：判定全在 `knowledge.ts` 的纯函数里（那里已有独立测试），
 * 这里只钉必须活在 composable 的那一层：构造时读档、入库才落盘、全拒收不空写、
 * remove/clearAll 无条件落盘、ref 共享。
 *
 * 三条夹具纪律（与 `useCron.test.ts` / `mcp.test.ts` 同源）：
 * - 种子必须在 `createKnowledge` **之前**写进 storage —— 构造时就读档，事后写它看不见；
 * - "写没写盘"一律读 `storage.get(KEY)` 反序列化（辅以 spy 计数），不只看 ref 变了；
 * - `Date.now()` 用假时钟钉死，重复 add 的 id 分配才能逐字断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { createKnowledge } from '../../src/vue/useKnowledge'
import {
  KNOWLEDGE_DOC_KEY,
  parseKnowledge,
  serializeKnowledge,
  type KnowledgeDoc,
} from '../../src/vue/knowledge'
import { memoryStorage } from '../../src/vue/store'

const NOW = 1_760_000_000_000
const BASE = NOW.toString(36)

const seedDoc = (over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'k-seed',
  name: '种下的',
  text: '种下的正文',
  chars: 5,
  addedAt: 1,
  truncated: false,
  ...over,
})

function makeKnowledge(seedRaw?: string) {
  const storage = memoryStorage()
  if (seedRaw !== undefined) storage.set(KNOWLEDGE_DOC_KEY, seedRaw)
  const set = vi.spyOn(storage, 'set')
  const api = createKnowledge(storage)
  set.mockClear() // 构造期本就不写盘；计数只从"动作"开始
  const disk = (): KnowledgeDoc[] => parseKnowledge(storage.get(KNOWLEDGE_DOC_KEY))
  return { storage, set, api, disk }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useKnowledge：构造时读档', () => {
  it('种子在 createKnowledge 之前写进盘上，构造出来就是那一份', () => {
    const { api } = makeKnowledge(serializeKnowledge([seedDoc()]))
    expect(api.docs.value.map((d) => d.name)).toEqual(['种下的'])
  })

  it('缺档 / 坏档 / 结构不对都不抛，构造期也不写盘', () => {
    for (const raw of [undefined, 'not json', '{}', '{"docs":"nope"}']) {
      const { api, storage, set } = makeKnowledge(raw)
      expect(api.docs.value).toEqual([])
      expect(storage.get(KNOWLEDGE_DOC_KEY)).toBe(raw === undefined ? null : raw)
      expect(set).not.toHaveBeenCalled()
    }
  })
})

describe('useKnowledge：add 才有条件落盘', () => {
  it('入库即落盘，读回来是同一个列表', () => {
    const { api, disk, set } = makeKnowledge()
    const rejected = api.add([
      { name: '甲', text: '正文甲' },
      { name: '乙', text: '正文乙' },
    ])
    expect(rejected).toEqual([])
    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(KNOWLEDGE_DOC_KEY, expect.any(String))
    expect(disk().map((d) => d.name)).toEqual(['甲', '乙'])
    expect(disk()[0]!.addedAt).toBe(Math.floor(NOW / 1000))
    expect(disk()[0]!.truncated).toBe(false)
  })

  it('一份入库一份被拒：只落入库那份，理由逐条传出来', () => {
    const { api, disk, set } = makeKnowledge()
    const rejected = api.add([
      { name: '甲', text: '正文甲' },
      { name: '甲', text: '同名再来' },
    ])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('已经在资料里了')
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk().map((d) => d.name)).toEqual(['甲'])
  })

  it('一次全拒收不空写盘', () => {
    const { storage, api, set } = makeKnowledge()
    const rejected = api.add([{ name: '', text: '没有文件名' }])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('没有文件名')
    expect(api.docs.value).toEqual([])
    expect(storage.get(KNOWLEDGE_DOC_KEY)).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })

  it('盘上已有老档时全拒收也不重写一遍', () => {
    const seed = serializeKnowledge([seedDoc()])
    const { storage, api, set } = makeKnowledge(seed)
    expect(api.add([{ name: '种下的', text: '同名会被拒' }])).toHaveLength(1)
    expect(set).not.toHaveBeenCalled()
    expect(storage.get(KNOWLEDGE_DOC_KEY)).toBe(seed)
  })

  it('重复 add 的 id 分配：同毫秒撞车时按 -1/-2 让位', () => {
    const { api, disk } = makeKnowledge()
    api.add([
      { name: '甲', text: '甲' },
      { name: '乙', text: '乙' },
    ])
    api.add([
      { name: '丙', text: '丙' },
      { name: '丁', text: '丁' },
    ])
    expect(disk().map((d) => d.id)).toEqual([
      `k${BASE}0`,
      `k${BASE}1`,
      `k${BASE}0-1`,
      `k${BASE}1-1`,
    ])
    const ids = disk().map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('useKnowledge：remove / clearAll 无条件落盘', () => {
  it('remove 命中即落盘，盘上少了那份', () => {
    const { api, disk, set } = makeKnowledge(
      serializeKnowledge([seedDoc(), seedDoc({ id: 'k-2', name: '第二份' })]),
    )
    api.remove('k-seed')
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk().map((d) => d.name)).toEqual(['第二份'])
  })

  it('remove 未知 id 也照写一遍盘（源码无条件 save），内容不变', () => {
    const seed = serializeKnowledge([seedDoc()])
    const { storage, api, disk, set } = makeKnowledge(seed)
    api.remove('不存在')
    expect(set).toHaveBeenCalledTimes(1)
    expect(storage.get(KNOWLEDGE_DOC_KEY)).toBe(seed)
    expect(disk().map((d) => d.name)).toEqual(['种下的'])
  })

  it('clearAll 后盘上是空数组', () => {
    const { storage, api, disk, set } = makeKnowledge(serializeKnowledge([seedDoc()]))
    api.clearAll()
    expect(api.docs.value).toEqual([])
    expect(set).toHaveBeenCalledTimes(1)
    expect(disk()).toEqual([])
    expect(JSON.parse(storage.get(KNOWLEDGE_DOC_KEY)!)).toEqual({ schemaVersion: 1, docs: [] })
  })
})

describe('useKnowledge：ref 响应式共享', () => {
  it('两处持有同一个 ref：经 API 加 / 删 / 清，两侧同步且同步触发监听', () => {
    const { api } = makeKnowledge()
    const left = api.docs
    const right = api.docs
    expect(left).toBe(right)
    const lengths: number[] = []
    const stop = watch(left, (v) => lengths.push(v.length), { flush: 'sync' })

    api.add([{ name: '甲', text: '正文' }])
    expect(right.value.map((d) => d.name)).toEqual(['甲'])
    api.remove(right.value[0]!.id)
    expect(left.value).toEqual([])
    api.clearAll()
    expect(lengths).toEqual([1, 0, 0])
    stop()
  })
})
