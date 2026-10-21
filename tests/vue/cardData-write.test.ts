/**
 * `cardData` 的写入防抖（2026-10-21，P0-② 起挂着的遗留）。
 *
 * 判据三件事：
 *  ① **合并**：300ms 窗口内的连续改动只落盘一次，落的是最后一次的状态；
 *  ② **能立刻冲刷**：`flush()` 把它写掉，且之后不再重复写；
 *  ③ **跨实例读得回**：冲刷之后新建一份 `createCardData` 能读到刚写的内容。
 *
 * 卸载钩子（`pagehide` / `beforeunload`）在 node 环境里没有 `window`，由 `typeof window`
 * 守卫跳过 —— 那条路径靠 E2E「输入后立刻刷新」守，单测不假装能测到它。
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createCardData } from '../../src/vue/cardData'
import type { StorageAdapter } from '../../src/vue/store'

const KEY = 'modulo.carddata.v1'

function countingStorage(): StorageAdapter & { writes: string[] } {
  const m = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      writes.push(v)
      m.set(k, v)
    },
  }
}

describe('写入防抖：300ms 合并成一次', () => {
  it('窗口内的连续改动只写一次，落最后的状态', async () => {
    vi.useFakeTimers()
    try {
      const storage = countingStorage()
      const api = createCardData(storage)
      api.state.sticky = 'a'
      await nextTick()
      vi.advanceTimersByTime(100)
      api.state.sticky = 'ab'
      await nextTick()
      vi.advanceTimersByTime(100)
      api.state.sticky = 'abc'
      await nextTick()
      expect(storage.writes).toHaveLength(0)
      vi.advanceTimersByTime(300)
      expect(storage.writes).toHaveLength(1)
      expect(JSON.parse(storage.writes[0]).sticky).toBe('abc')
    } finally {
      vi.useRealTimers()
    }
  })

  it('数组路径（待办）同样合并', async () => {
    vi.useFakeTimers()
    try {
      const storage = countingStorage()
      // 先用空数组种一份，避免把示例内容当成"新增的待办"（sanitize 会拿 fallback 补缺字段）
      storage.set(KEY, JSON.stringify({ todos: [], notes: [] }))
      storage.writes.length = 0 // 种子那笔不算
      const api = createCardData(storage)
      api.addTodo('一')
      await nextTick()
      api.addTodo('二')
      await nextTick()
      vi.advanceTimersByTime(300)
      expect(storage.writes).toHaveLength(1)
      expect(JSON.parse(storage.writes[0]).todos.map((t: { text: string }) => t.text)).toEqual(['一', '二'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flush() 立刻写；之后定时器不再补写一次', async () => {
    vi.useFakeTimers()
    try {
      const storage = countingStorage()
      const api = createCardData(storage)
      api.state.sticky = '立刻'
      await nextTick()
      api.flush()
      expect(storage.writes).toHaveLength(1)
      vi.advanceTimersByTime(1_000)
      expect(storage.writes).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有待写内容时 flush 什么都不做（键盘走完窗口后再卸载不该多写一份）', () => {
    const storage = countingStorage()
    const api = createCardData(storage)
    api.flush()
    expect(storage.writes).toHaveLength(0)
  })

  it('注册卸载钩子：pagehide / beforeunload 都会把待写的一笔写掉', async () => {
    const handlers = new Map<string, () => void>()
    vi.stubGlobal('window', { addEventListener: (ev: string, fn: () => void) => handlers.set(ev, fn) })
    try {
      const storage = countingStorage()
      const api = createCardData(storage)
      api.state.sticky = '待冲刷'
      await nextTick()
      expect(storage.writes).toHaveLength(0)
      handlers.get('pagehide')!()
      expect(storage.writes).toHaveLength(1)
      expect(JSON.parse(storage.writes[0]).sticky).toBe('待冲刷')
      expect(handlers.has('beforeunload'), '两个钩子都要注册').toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('flush 之后新建一份实例读得回（顺序：先冲刷，再换实例）', async () => {
    vi.useFakeTimers()
    try {
      const storage = countingStorage()
      storage.set(KEY, JSON.stringify({ todos: [], notes: [] }))
      storage.writes.length = 0 // 种子那笔不算
      const api = createCardData(storage)
      api.addNote('标题', '正文')
      await nextTick()
      api.flush()
      const again = createCardData(storage)
      expect(again.state.notes.map((n) => n.title)).toEqual(['标题'])
    } finally {
      vi.useRealTimers()
    }
  })
})
