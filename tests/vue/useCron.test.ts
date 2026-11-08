/**
 * `useCron` 的胶水层单测（PR-F2）：调度判定在 `cron.test.ts`，这里钉的是"必须活在
 * 组件层"的那几条 —— invoke 只代表受理、跑完以 done 帧为准、超时发停止、错过不补跑、
 * 翻天清空调度状态。invoke 与 Channel 都是 mock（shell.test.ts 同款：vi.hoisted + vi.mock）。
 *
 * 两个夹具纪律：
 * - 种子必须在 `createCron` **之前**写进 storage（构造时就读档，事后写它看不见）；
 * - `start()` 自带第一次对表 —— 想观察"这一次对表发生了什么"，直接调 `tick()`。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { invoke, FakeChannel } = vi.hoisted(() => {
  const invoke = vi.fn()
  class FakeChannel {
    static last: FakeChannel | null = null
    onmessage: ((c: { delta?: string; done?: boolean; error?: string | null }) => void) | null = null
    constructor() {
      FakeChannel.last = this
    }
  }
  return { invoke, FakeChannel }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: FakeChannel }))

import { createCron, RUN_TIMEOUT_MS } from '../../src/vue/useCron'
import { CRON_DOC_KEY } from '../../src/vue/cron'
import { memoryStorage } from '../../src/vue/store'

const NINE = new Date(2026, 10, 8, 9, 0, 0, 0)
let fake = new Date(NINE.getTime())

interface MakeOpts {
  /** 建组件前写进 CRON_DOC_KEY 的种子（tasks/runs/调度状态） */
  seed?: unknown
  providers?: () => { id: string }[]
  canRun?: () => boolean
}

function makeCron(opts: MakeOpts = {}) {
  const storage = memoryStorage()
  if (opts.seed !== undefined) {
    storage.set(CRON_DOC_KEY, JSON.stringify({ schemaVersion: 1, ...opts.seed }))
  }
  const cron = createCron({
    storage,
    now: () => new Date(fake.getTime()),
    providers: opts.providers ?? (() => [{ id: 'p1' }]),
    ...(opts.canRun ? { canRun: opts.canRun } : {}),
  })
  return { cron, storage }
}

const seedTask = (over: Partial<{ time: string; enabled: boolean; prompt: string }> = {}) => ({
  tasks: [
    { id: 'c1', prompt: '早安整理', time: '09:00', providerId: 'p1', enabled: true, createdAt: 0, ...over },
  ],
  runs: [],
})

beforeEach(() => {
  fake = new Date(NINE.getTime())
  invoke.mockReset()
  invoke.mockResolvedValue({ conversationId: 'conv-1' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useCron：执行（跑完的判据是 done 帧，不是 await）', () => {
  it('到点 tick 按任务的提示词发了 ai_chat；done 帧后记 ok 并落盘', async () => {
    const { cron, storage } = makeCron({ seed: seedTask() })
    const started = cron.tick()
    expect(started.map((t) => t.id)).toEqual(['c1'])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][0]).toBe('ai_chat')
    expect((invoke.mock.calls[0][1] as { messages: { content: string }[] }).messages[0].content).toBe('早安整理')
    // invoke 已 resolve，但流还没完 —— 此刻不能有记录（await 只代表"受理了"）
    await Promise.resolve()
    expect(cron.runs.value).toHaveLength(0)
    FakeChannel.last!.onmessage!({ delta: '你好', done: false })
    FakeChannel.last!.onmessage!({ delta: '，整理好了', done: true })
    expect(cron.runs.value).toHaveLength(1)
    expect(cron.runs.value[0]).toMatchObject({ taskId: 'c1', status: 'ok', text: '你好，整理好了' })
    // 落盘的是整份文档（任务 + 记录 + 当天调度状态）
    const round = JSON.parse(storage.get(CRON_DOC_KEY) ?? '{}')
    expect(round.tasks).toHaveLength(1)
    expect(round.fired).toEqual(['c1'])
  })

  it('错误帧记 error（人话由 Rust 给，这里不加工）', () => {
    const { cron } = makeCron({ seed: seedTask() })
    cron.tick()
    FakeChannel.last!.onmessage!({ delta: '', done: true, error: 'API key 无效，去设置里重新填入' })
    expect(cron.runs.value[0]).toMatchObject({ status: 'error', error: 'API key 无效，去设置里重新填入' })
  })

  it('invoke 直接拒绝（网页/凭据类失败）也记 error', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const { cron } = makeCron({ seed: seedTask() })
    cron.tick()
    await Promise.resolve()
    await Promise.resolve()
    expect(cron.runs.value[0]).toMatchObject({ status: 'error', error: expect.stringContaining('boom') })
  })

  it('超时：等满 3 分钟记失败，并对那次对话发 ai_chat_cancel', async () => {
    vi.useFakeTimers()
    const { cron } = makeCron({ seed: seedTask() })
    cron.tick()
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1_000)
    expect(cron.runs.value[0].status).toBe('error')
    expect(cron.runs.value[0].error).toContain('放弃等待')
    const cancel = invoke.mock.calls.find((c) => c[0] === 'ai_chat_cancel')
    expect(cancel, '超时后对那次对话发了停止').toBeTruthy()
    expect((cancel![1] as { conversationId: string }).conversationId).toBe('conv-1')
  })

  it('没有模型服务：记 error，不发请求', () => {
    const { cron } = makeCron({ seed: seedTask(), providers: () => [] })
    cron.tick()
    expect(invoke).not.toHaveBeenCalled()
    expect(cron.runs.value[0]).toMatchObject({ status: 'error', error: expect.stringContaining('模型服务') })
  })

  it('已 fired 的任务不再跑（先记账后执行的那一半）：第二次 tick 不重发', () => {
    const { cron } = makeCron({ seed: seedTask() })
    expect(cron.tick()).toHaveLength(1)
    expect(cron.tick()).toEqual([])
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('useCron：错过与翻新（错过不补跑，是新的一天才重新算）', () => {
  it('过点的任务第一次对表记 missed；第二次不再记（不重复刷屏）', () => {
    fake = new Date(2026, 10, 8, 12, 0, 0, 0)
    const { cron } = makeCron({ seed: seedTask() })
    expect(cron.tick()).toEqual([])
    const first = cron.runs.value.filter((r) => r.status === 'missed')
    expect(first).toHaveLength(1)
    expect(first[0].error).toContain('不补跑')
    cron.tick()
    expect(cron.runs.value.filter((r) => r.status === 'missed')).toHaveLength(1)
  })

  it('翻到第二天：状态清空，同一任务再过点就再记一条（每天各自的错过）', () => {
    fake = new Date(2026, 10, 8, 12, 0, 0, 0)
    const { cron } = makeCron({ seed: seedTask() })
    cron.tick()
    fake = new Date(2026, 10, 9, 12, 0, 0, 0)
    cron.tick()
    expect(cron.runs.value.filter((r) => r.status === 'missed')).toHaveLength(2)
  })

  it('canRun=false（网页版）start() 不开表：怎么等都不会发请求', () => {
    vi.useFakeTimers()
    const { cron } = makeCron({ seed: seedTask(), canRun: () => false })
    cron.start()
    vi.advanceTimersByTime(10 * 60_000)
    expect(invoke).not.toHaveBeenCalled()
    expect(cron.runs.value).toHaveLength(0)
  })
})

describe('useCron：增删改与落盘', () => {
  it('toggle 落盘（重启还读得回来靠 DATA_KEYS，这里钉写入面）', () => {
    const { cron, storage } = makeCron()
    cron.add({ prompt: '早安', time: '09:00', providerId: 'p1' })
    const id = cron.tasks.value[0].id
    cron.toggle(id)
    expect(JSON.parse(storage.get(CRON_DOC_KEY) ?? '{}').tasks[0].enabled).toBe(false)
    cron.toggle(id)
    expect(JSON.parse(storage.get(CRON_DOC_KEY) ?? '{}').tasks[0].enabled).toBe(true)
  })

  it('remove 连它的运行记录一起清（挂着死任务的记录只会让人误会还能点）', () => {
    fake = new Date(2026, 10, 8, 12, 0, 0, 0)
    const { cron } = makeCron({ seed: seedTask() })
    cron.tick()
    expect(cron.runs.value.length).toBeGreaterThan(0)
    cron.remove('c1')
    expect(cron.tasks.value).toHaveLength(0)
    expect(cron.runs.value).toHaveLength(0)
  })

  it('add 的拒收逐条透传，不入库就不写盘', () => {
    const { cron, storage } = makeCron()
    const before = storage.get(CRON_DOC_KEY)
    expect(cron.add({ prompt: '   ', time: '09:00' })).toHaveLength(1)
    expect(storage.get(CRON_DOC_KEY)).toBe(before)
  })
})
