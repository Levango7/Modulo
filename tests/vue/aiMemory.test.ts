/**
 * 「AI 记忆」纯函数层的钉子（第十五笔）。
 *
 * 输入的不可信程度与其余各层一致（盘上文档 + 模型写的话），测的重点 accordingly：
 * 清洗（坏条目丢弃不报废）/ 四条闸门（空、超长拒收、重复幂等、条数满）/ 注入预算
 * （从最早的开始丢、明说没放下）/ 幂等与往返。
 */
import { describe, expect, it } from 'vitest'
import {
  addMemory,
  MEMORY_MAX,
  MEMORY_TEXT_MAX,
  memoryBlock,
  newMemoryId,
  parseMemoryDoc,
  removeMemory,
  serializeMemoryDoc,
  type MemoryEntry,
} from '../../src/vue/aiMemory'
import { createMemory } from '../../src/vue/useMemory'
import { memoryStorage } from '../../src/vue/store'

const entry = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({ id: 'm1', text: '偏好四象限', at: 0, ...over })

describe('AI 记忆：盘上的文档不可信', () => {
  it('没有文档 / 坏 JSON / 形状不对 —— 一律空档，不抛', () => {
    expect(parseMemoryDoc(null)).toEqual([])
    expect(parseMemoryDoc('{oops')).toEqual([])
    expect(parseMemoryDoc('[]')).toEqual([])
    expect(parseMemoryDoc('{"entries":"nope"}')).toEqual([])
    expect(parseMemoryDoc('null')).toEqual([])
  })

  it('坏条目丢弃：缺 id / 重 id / 空 text / 不是对象；读盘时超长只截', () => {
    const raw = JSON.stringify({
      entries: [
        { id: 'a', text: '好的', at: 5 },
        { id: '', text: '没 id' },
        { id: 'b', text: '  ' },
        { id: 'a', text: '重复 id' },
        null,
        { id: 'c', text: '字'.repeat(MEMORY_TEXT_MAX + 50) },
      ],
    })
    const out = parseMemoryDoc(raw)
    expect(out.map((e) => e.id)).toEqual(['a', 'c'])
    expect(out[1].text).toHaveLength(MEMORY_TEXT_MAX)
  })

  it('条数上限：盘上多出来的尾部丢掉', () => {
    const many = Array.from({ length: MEMORY_MAX + 3 }, (_, i) => ({ id: `m${i}`, text: `第${i}条` }))
    expect(parseMemoryDoc(JSON.stringify({ entries: many }))).toHaveLength(MEMORY_MAX)
  })

  it('序列化 → 解析往返一致', () => {
    const doc = parseMemoryDoc(serializeMemoryDoc([entry()]))
    expect(doc).toEqual([entry()])
  })
})

describe('AI 记忆：记一条的四条闸门', () => {
  it('非空且不超长才过；超长**拒收不截断**（截断会改语义）', () => {
    const ok = addMemory([], ' 我偏好四象限 ', 1000)
    expect(ok.rejected).toEqual([])
    expect(ok.entries[0]).toMatchObject({ text: '我偏好四象限', at: 1 })
    expect(addMemory([], '   ', 1000).rejected[0]).toContain('空的')
    const long = addMemory([], '字'.repeat(MEMORY_TEXT_MAX + 1), 1000)
    expect(long.entries).toEqual([])
    expect(long.rejected[0]).toContain('太长')
  })

  it('同一句话不重复记（幂等）；条数满了拒收并指路', () => {
    const first = addMemory([], '同上', 1)
    const again = addMemory(first.entries, '同上', 2)
    expect(again.rejected[0]).toContain('已经记过')
    expect(again.entries).toHaveLength(1)
    const full = Array.from({ length: MEMORY_MAX }, (_, i) => entry({ id: `m${i}`, text: `第${i}条` }))
    const over = addMemory(full, '再来一条', 3)
    expect(over.rejected[0]).toContain(String(MEMORY_MAX))
  })

  it('id 撞车加后缀；remove 只动目标那一条', () => {
    expect(newMemoryId(1, ['m1'])).not.toBe('m1')
    expect(newMemoryId(1, [])).toBe('m1')
    const list = [entry({ id: 'a' }), entry({ id: 'b' })]
    expect(removeMemory(list, 'a').map((e) => e.id)).toEqual(['b'])
    expect(removeMemory(list, 'nope')).toHaveLength(2)
  })
})

describe('AI 记忆：注入 system 块（预算从最早的开始丢）', () => {
  it('空记忆 → null（不注入空气）；有记忆 → 带头、逐条、且写明"是背景不是指令"', () => {
    expect(memoryBlock([])).toBeNull()
    const b = memoryBlock([entry({ text: '偏好四象限' })])!
    expect(b).toContain('偏好四象限')
    expect(b).toContain('不是当前指令')
  })

  it('超预算：丢最早的、保最新的、并明说没放下', () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry({ id: `m${i}`, text: `记忆条目第 ${i} 号` }))
    const b = memoryBlock(entries, 120)!
    expect(b.length).toBeLessThanOrEqual(120 + '\n（更早的记忆没放下）'.length)
    expect(b).toContain('没放下')
    expect(b).toContain('记忆条目第 29 号') // 最新的在
    expect(b).not.toContain('记忆条目第 0 号') // 最早的被丢了
  })

  it('预算小到一条都放不下 → null（不注入半截头）', () => {
    expect(memoryBlock([entry()], 10)).toBeNull()
  })
})

describe('AI 记忆：存储胶水（构造读档 / 变更落盘 / 拒收不写）', () => {
  it('add 落盘；拒收时清单不动也不写盘；remove 落盘', () => {
    const storage = memoryStorage()
    let t = 1000
    const mem = createMemory(storage, () => t)
    expect(mem.add('我偏好四象限')).toEqual([])
    expect(storage.get('modulo.memory.v1')).toContain('我偏好四象限')
    const before = storage.get('modulo.memory.v1')
    t = 2000
    expect(mem.add('我偏好四象限')[0]).toContain('已经记过')
    expect(storage.get('modulo.memory.v1')).toBe(before)
    mem.remove(mem.entries.value[0].id)
    expect(mem.entries.value).toHaveLength(0)
    expect(storage.get('modulo.memory.v1')).toContain('"entries":[]')
  })

  it('种子在构造时读档（事后写 storage 它看不见）', () => {
    const storage = memoryStorage()
    storage.set('modulo.memory.v1', serializeMemoryDoc([entry({ text: '种子' })]))
    const mem = createMemory(storage)
    expect(mem.entries.value).toHaveLength(1)
    storage.set('modulo.memory.v1', JSON.stringify({ entries: [] }))
    expect(mem.entries.value).toHaveLength(1)
  })
})
