/**
 * `useAiSessions` 的状态机单测（backlog ①「composable 层补测」第三十三笔）。
 *
 * 这一层不判定什么，它的全部价值就是「什么时候改状态 / 失败折成哪句话 / 参数名对不对」，
 * 所以下面钉的都是具体事实，不是「调用过」这种弱断言：
 * ① refresh 在途（loading=true）重复调用直接 return —— 防双击，第二次不触发新 invoke；
 * ② load 成功才写 activeId / lastLoaded，失败写 error **并重新抛出**（调用方要能接住）；
 * ③ remove 删的是当前会话 ⇒ activeId 归 null，之后 refresh；clearAll 同理归零；
 * ④ startNew 只把 activeId 归 null，不调后端；
 * ⑤ 所有 catch 把错误落人话 `String(err)`，不静默吞；
 * ⑥ invoke 参数是**对象**不是字符串（`{ id }`，Tauri 2 camelCase）。
 *
 * 夹具照 `useCron.test.ts` 第 12–23 行：`vi.hoisted` + `vi.mock` 顶替 Tauri core，
 * node 环境无 jsdom 也能跑；beforeEach 里 `mockReset` 清调用与实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryItem, HistoryMsg } from '../../src/vue/aiChat'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { createAiSessions } from '../../src/vue/useAiSessions'

const item = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'conv-1',
  title: '第一次会话',
  updatedAt: 1_700_000_000_000,
  messageCount: 2,
  ...over,
})

const msg = (over: Partial<HistoryMsg> = {}): HistoryMsg => ({
  role: 'user',
  content: '你好',
  ts: 1_700_000_000_000,
  ...over,
})

const detail = (id: string, messages: HistoryMsg[] = [msg()]) => ({ id, messages })

beforeEach(() => {
  invoke.mockReset()
})

describe('useAiSessions：refresh 与防双击', () => {
  it('refresh 调 ai_history_list（无参），写 items、清 error、loading 归位', async () => {
    const list = [item({ id: 'conv-1' }), item({ id: 'conv-2', title: '第二次会话' })]
    invoke.mockResolvedValueOnce(list)
    const s = createAiSessions()
    s.error.value = '旧错误'
    await s.refresh()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]).toEqual(['ai_history_list'])
    expect(s.items.value).toEqual(list)
    expect(s.error.value).toBeNull()
    expect(s.loading.value).toBe(false)
  })

  it('refresh 在途时重复调用直接 return：第二次不触发新 invoke，一次动画做完才放行', async () => {
    let resolveList!: (rows: HistoryItem[]) => void
    const pending = new Promise<HistoryItem[]>((r) => {
      resolveList = r
    })
    invoke.mockReturnValueOnce(pending)
    const s = createAiSessions()
    const first = s.refresh()
    expect(s.loading.value).toBe(true)
    const second = s.refresh()
    expect(invoke).toHaveBeenCalledTimes(1)
    resolveList([item()])
    await Promise.all([first, second])
    expect(s.loading.value).toBe(false)
    expect(s.items.value).toHaveLength(1)
  })

  it('refresh 失败：error 落人话、loading 归位、items 不动（不静默吞）', async () => {
    invoke.mockRejectedValueOnce('列表服务没连上')
    const s = createAiSessions()
    const original = [item()]
    s.items.value = original
    await s.refresh()
    expect(s.error.value).toContain('列表服务没连上')
    expect(s.loading.value).toBe(false)
    expect(s.items.value).toEqual(original)
  })
})

describe('useAiSessions：load 的成功与失败两条路', () => {
  it('load 成功：调 ai_history_get {id}，写 activeId / lastLoaded，清 error，原样返回详情', async () => {
    const d = detail('conv-7', [msg({ role: 'assistant', content: '在的' })])
    invoke.mockResolvedValueOnce(d)
    const s = createAiSessions()
    s.error.value = '旧错误'
    const got = await s.load('conv-7')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]).toEqual(['ai_history_get', { id: 'conv-7' }])
    expect(s.activeId.value).toBe('conv-7')
    expect(s.lastLoaded.value).toEqual(d)
    expect(s.error.value).toBeNull()
    expect(got).toBe(d)
  })

  it('load 失败：写 error 且重新抛出，activeId / lastLoaded 不被写脏', async () => {
    invoke.mockRejectedValueOnce(new Error('读不到这条会话'))
    const s = createAiSessions()
    s.activeId.value = 'conv-old'
    await expect(s.load('conv-x')).rejects.toThrow('读不到这条会话')
    expect(s.error.value).toContain('读不到这条会话')
    expect(s.activeId.value).toBe('conv-old')
    expect(s.lastLoaded.value).toBeNull()
  })
})

describe('useAiSessions：remove / clearAll 的归零与回刷', () => {
  it('remove 当前会话：调 delete {id} 后 activeId 归零，并 refresh 拉回新列表', async () => {
    invoke
      .mockResolvedValueOnce(detail('conv-1')) // load
      .mockResolvedValueOnce(undefined) // ai_history_delete
      .mockResolvedValueOnce([item({ id: 'conv-2', title: '下一条' })]) // refresh 的 list
    const s = createAiSessions()
    await s.load('conv-1')
    expect(s.activeId.value).toBe('conv-1')
    await s.remove('conv-1')
    expect(invoke.mock.calls[1]).toEqual(['ai_history_delete', { id: 'conv-1' }])
    expect(s.activeId.value).toBeNull()
    expect(invoke.mock.calls[2][0]).toBe('ai_history_list')
    expect(s.items.value[0]!.id).toBe('conv-2')
  })

  it('remove 非当前会话：activeId 保持不动（仍回刷）', async () => {
    invoke
      .mockResolvedValueOnce(detail('conv-1'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
    const s = createAiSessions()
    await s.load('conv-1')
    await s.remove('conv-2')
    expect(s.activeId.value).toBe('conv-1')
    expect(invoke.mock.calls[1]).toEqual(['ai_history_delete', { id: 'conv-2' }])
    expect(invoke.mock.calls[2][0]).toBe('ai_history_list')
  })

  it('clearAll：调 ai_history_clear（无参）后 activeId 归零并 refresh', async () => {
    invoke
      .mockResolvedValueOnce(detail('conv-1'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
    const s = createAiSessions()
    await s.load('conv-1')
    await s.clearAll()
    expect(invoke.mock.calls[1]).toEqual(['ai_history_clear'])
    expect(s.activeId.value).toBeNull()
    expect(invoke.mock.calls[2][0]).toBe('ai_history_list')
  })

  it('remove / clearAll 失败都把错误落人话，且不回刷（不静默吞）', async () => {
    const s1 = createAiSessions()
    s1.activeId.value = 'conv-1'
    invoke.mockRejectedValueOnce(new Error('删不掉'))
    await s1.remove('conv-1')
    expect(s1.error.value).toContain('删不掉')
    expect(s1.activeId.value).toBe('conv-1')
    expect(invoke).toHaveBeenCalledTimes(1)

    const s2 = createAiSessions()
    invoke.mockRejectedValueOnce(new Error('清不掉'))
    await s2.clearAll()
    expect(s2.error.value).toContain('清不掉')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('useAiSessions：startNew 与命令形状', () => {
  it('startNew 只把 activeId 归零，不调后端、不碰 items / lastLoaded', async () => {
    invoke.mockResolvedValueOnce(detail('conv-1'))
    const s = createAiSessions()
    await s.load('conv-1')
    const loaded = s.lastLoaded.value
    invoke.mockClear()
    s.startNew()
    expect(s.activeId.value).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    expect(s.items.value).toEqual([])
    expect(s.lastLoaded.value).toBe(loaded)
  })

  it('四个后端命令名与参数形状都对：参数是对象不是字符串（camelCase id）', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'ai_history_list') return Promise.resolve([])
      if (cmd === 'ai_history_get') return Promise.resolve(detail('conv-9'))
      return Promise.resolve(undefined)
    })
    const s = createAiSessions()
    await s.refresh()
    await s.load('conv-9')
    await s.remove('conv-9')
    await s.clearAll()
    const names = invoke.mock.calls.map((c) => c[0])
    expect(names).toContain('ai_history_list')
    expect(names).toContain('ai_history_get')
    expect(names).toContain('ai_history_delete')
    expect(names).toContain('ai_history_clear')
    const getCall = invoke.mock.calls.find((c) => c[0] === 'ai_history_get')!
    expect(typeof getCall[1]).toBe('object')
    expect(getCall[1]).toEqual({ id: 'conv-9' })
    const delCall = invoke.mock.calls.find((c) => c[0] === 'ai_history_delete')!
    expect(delCall[1]).toEqual({ id: 'conv-9' })
    const clearCall = invoke.mock.calls.find((c) => c[0] === 'ai_history_clear')!
    expect(clearCall).toHaveLength(1)
  })
})
