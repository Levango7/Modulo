/**
 * `useWorkflow` 的胶水层单测（PR-F3）：串接判定在 `workflow.test.ts`，这里钉的是"必须活在
 * 组件层"的那几条 —— invoke 只代表受理、跑完以 done 帧为准、首败即停、一次只跑一个、
 * 超时发停止、跑完才落盘。invoke 与 Channel 都是 mock（useCron.test.ts 同款：vi.hoisted + vi.mock）。
 *
 * 夹具纪律：种子必须在 `createWorkflow` **之前**写进 storage（构造时就读档，事后写它看不见）。
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

import { createWorkflow, STEP_TIMEOUT_MS } from '../../src/vue/useWorkflow'
import { WORKFLOW_DOC_KEY } from '../../src/vue/workflow'
import { memoryStorage } from '../../src/vue/store'

const NINE = new Date(2026, 10, 8, 9, 0, 0, 0)
let fake = new Date(NINE.getTime())

interface MakeOpts {
  /** 建组件前写进 WORKFLOW_DOC_KEY 的种子（flows/runs） */
  seed?: { flows?: unknown[]; runs?: unknown[] }
  providers?: () => { id: string }[]
}

function makeWorkflow(opts: MakeOpts = {}) {
  const storage = memoryStorage()
  if (opts.seed !== undefined) {
    storage.set(
      WORKFLOW_DOC_KEY,
      JSON.stringify({ schemaVersion: 1, flows: opts.seed.flows ?? [], runs: opts.seed.runs ?? [] }),
    )
  }
  const workflow = createWorkflow({
    storage,
    now: () => new Date(fake.getTime()),
    providers: opts.providers ?? (() => [{ id: 'p1' }]),
  })
  return { workflow, storage }
}

const seedFlow = (over: Record<string, unknown> = {}) => ({
  flows: [
    {
      id: 'w1',
      name: '搜集再归纳',
      steps: [
        { id: 's1', prompt: '搜一搜' },
        { id: 's2', prompt: '归纳成三条' },
      ],
      providerId: 'p1',
      createdAt: 0,
      ...over,
    },
  ],
  runs: [],
})

/** 把微任务队列冲干净（串行跑下一步是在 await 之后才建 Channel 的） */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const contentOf = (call: unknown): string =>
  (call as { messages: { content: string }[] }).messages[0].content

beforeEach(() => {
  fake = new Date(NINE.getTime())
  invoke.mockReset()
  invoke.mockResolvedValue({ conversationId: 'conv-1' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkflow：顺次执行（跑完的判据是 done 帧，不是 await）', () => {
  it('两步顺次跑：第二步的提示词里带着第一步的产出', async () => {
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    expect(workflow.run('w1')).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(contentOf(invoke.mock.calls[0][1])).toBe('搜一搜')
    // invoke 已 resolve，但第一步的流还没完 —— 此刻不能有记录
    await Promise.resolve()
    expect(workflow.runs.value).toHaveLength(0)
    expect(workflow.running.value).toBe('w1')
    FakeChannel.last!.onmessage!({ delta: '搜到的原文', done: true })
    await flush()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(contentOf(invoke.mock.calls[1][1])).toContain('归纳成三条')
    expect(contentOf(invoke.mock.calls[1][1])).toContain('搜到的原文')
    FakeChannel.last!.onmessage!({ delta: '三条结论', done: true })
    await flush()
    expect(workflow.runs.value).toHaveLength(1)
    expect(workflow.runs.value[0]).toMatchObject({ flowId: 'w1', status: 'ok' })
    expect(workflow.runs.value[0].steps).toHaveLength(2)
    expect(workflow.runs.value[0].steps[0].text).toBe('搜到的原文')
    expect(workflow.runs.value[0].steps[1].text).toBe('三条结论')
    expect(workflow.running.value).toBeNull()
  })

  it('首败即停：第一步没跑通，后面几步不再发请求', async () => {
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    workflow.run('w1')
    FakeChannel.last!.onmessage!({ delta: '', done: true, error: 'API key 无效，去设置里重新填入' })
    await flush()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(workflow.runs.value).toHaveLength(1)
    expect(workflow.runs.value[0].status).toBe('error')
    expect(workflow.runs.value[0].error).toContain('第 1 步没跑通')
    expect(workflow.runs.value[0].error).toContain('API key 无效')
    expect(workflow.runs.value[0].steps).toHaveLength(1)
  })

  it('第二步没跑通：错误里说的是第 2 步', async () => {
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    workflow.run('w1')
    FakeChannel.last!.onmessage!({ delta: '搜到的原文', done: true })
    await flush()
    FakeChannel.last!.onmessage!({ delta: '', done: true, error: '模型服务不可用' })
    await flush()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(workflow.runs.value[0].status).toBe('error')
    expect(workflow.runs.value[0].error).toContain('第 2 步没跑通')
  })

  it('invoke 直接拒绝（凭据类失败）也记 error，并同样首败即停', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    workflow.run('w1')
    await flush()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(workflow.runs.value[0]).toMatchObject({ status: 'error', error: expect.stringContaining('boom') })
  })

  it('超时：等满 3 分钟记失败，并对那次对话发 ai_chat_cancel', async () => {
    vi.useFakeTimers()
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    workflow.run('w1')
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS + 1_000)
    expect(workflow.runs.value[0].status).toBe('error')
    expect(workflow.runs.value[0].error).toContain('放弃等待')
    const cancel = invoke.mock.calls.find((c) => c[0] === 'ai_chat_cancel')
    expect(cancel, '超时后对那次对话发了停止').toBeTruthy()
    expect((cancel![1] as { conversationId: string }).conversationId).toBe('conv-1')
  })

  it('没有模型服务：记 error，不发请求', async () => {
    const { workflow } = makeWorkflow({ seed: seedFlow(), providers: () => [] })
    workflow.run('w1')
    await flush()
    expect(invoke).not.toHaveBeenCalled()
    expect(workflow.runs.value[0]).toMatchObject({ status: 'error', error: expect.stringContaining('模型服务') })
  })

  it('流程里存的模型服务没了：回落第一个可用的', () => {
    const { workflow } = makeWorkflow({ seed: seedFlow({ providerId: 'gone' }), providers: () => [{ id: 'p9' }] })
    workflow.run('w1')
    expect((invoke.mock.calls[0][1] as { providerId: string }).providerId).toBe('p9')
  })

  it('一次只跑一个：已经有在跑的时候，第二次直接被拒（并发跑 = 双倍花钱）', () => {
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    expect(workflow.run('w1')).toBe(true)
    expect(workflow.run('w1')).toBe(false)
    expect(workflow.run('nope')).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe('useWorkflow：增删改与落盘', () => {
  it('种子在构造时读档（事后写 storage 它看不见）', () => {
    const { workflow, storage } = makeWorkflow({ seed: seedFlow() })
    expect(workflow.flows.value).toHaveLength(1)
    storage.set(WORKFLOW_DOC_KEY, JSON.stringify({ flows: [], runs: [] }))
    expect(workflow.flows.value).toHaveLength(1)
  })

  it('add 落盘；拒收时清单不动也不写盘', () => {
    const { workflow, storage } = makeWorkflow()
    expect(workflow.add({ name: '搜集再归纳', prompts: ['搜一搜', '归纳成三条'], providerId: 'p1' })).toHaveLength(0)
    expect(workflow.flows.value).toHaveLength(1)
    expect(JSON.parse(storage.get(WORKFLOW_DOC_KEY) ?? '{}').flows).toHaveLength(1)
    const before = storage.get(WORKFLOW_DOC_KEY)
    expect(workflow.add({ name: '  ', prompts: ['a', 'b'] })).toHaveLength(1)
    expect(storage.get(WORKFLOW_DOC_KEY)).toBe(before)
  })

  it('remove 连它的运行记录一起清（挂着死流程的记录只会让人误会还能点）', async () => {
    const { workflow } = makeWorkflow({ seed: seedFlow() })
    workflow.run('w1')
    FakeChannel.last!.onmessage!({ delta: '搜到的原文', done: true })
    await flush()
    FakeChannel.last!.onmessage!({ delta: '三条结论', done: true })
    await flush()
    expect(workflow.runs.value.length).toBeGreaterThan(0)
    workflow.remove('w1')
    expect(workflow.flows.value).toHaveLength(0)
    expect(workflow.runs.value).toHaveLength(0)
  })

  it('跑的过程中不落盘：跑完（或中途失败）才写一次整份文档', async () => {
    const { workflow, storage } = makeWorkflow({ seed: seedFlow() })
    const before = storage.get(WORKFLOW_DOC_KEY)
    workflow.run('w1')
    expect(storage.get(WORKFLOW_DOC_KEY)).toBe(before)
    FakeChannel.last!.onmessage!({ delta: '搜到的原文', done: true })
    await flush()
    expect(storage.get(WORKFLOW_DOC_KEY)).toBe(before)
    FakeChannel.last!.onmessage!({ delta: '三条结论', done: true })
    await flush()
    const onDisk = JSON.parse(storage.get(WORKFLOW_DOC_KEY) ?? '{}')
    expect(onDisk.runs).toHaveLength(1)
    expect(onDisk.runs[0].status).toBe('ok')
  })
})
