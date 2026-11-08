import { describe, expect, it } from 'vitest'
import {
  addFlow,
  appendRun,
  clipCarry,
  clipStepText,
  lastRun,
  newFlowId,
  newStepId,
  parseWorkflowDoc,
  removeFlow,
  serializeWorkflowDoc,
  stepPrompt,
  STEP_CARRY_MAX,
  STEP_PROMPT_MAX,
  STEP_TEXT_MAX,
  WORKFLOW_MAX_FLOWS,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_MIN_STEPS,
  WORKFLOW_NAME_MAX,
  WORKFLOW_RUNS_MAX,
  type WorkflowFlow,
  type WorkflowRun,
  type WorkflowStep,
} from '../../src/vue/workflow'

const flow = (over: Partial<WorkflowFlow> = {}): WorkflowFlow => ({
  id: 'w1',
  name: '搜集再归纳',
  steps: [
    { id: 's1', prompt: '搜一搜这个主题' },
    { id: 's2', prompt: '把上面那些归纳成三条' },
  ],
  providerId: 'p1',
  createdAt: 0,
  ...over,
})

const step = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1',
  prompt: '做点什么',
  ...over,
})

describe('工作流：盘上的文档不可信（PR-F3）', () => {
  it('没有文档 / 坏 JSON / 形状不对 —— 一律空档，不抛', () => {
    expect(parseWorkflowDoc(null)).toEqual({ flows: [], runs: [] })
    expect(parseWorkflowDoc('{oops')).toEqual({ flows: [], runs: [] })
    expect(parseWorkflowDoc('{"flows":"nope"}')).toEqual({ flows: [], runs: [] })
    expect(parseWorkflowDoc('[]')).toEqual({ flows: [], runs: [] })
    expect(parseWorkflowDoc('null')).toEqual({ flows: [], runs: [] })
  })

  it('坏步骤丢弃：缺 id / 重 id / 空提示词 / 不是对象', () => {
    const raw = JSON.stringify({
      flows: [
        {
          id: 'w1',
          name: '好的',
          steps: [
            { id: 's1', prompt: '第一步' },
            { id: '', prompt: '没 id' },
            { id: 's2', prompt: '  ' },
            { id: 's1', prompt: '重复 id' },
            { id: 's3', prompt: '第二步' },
          ],
        },
      ],
    })
    const doc = parseWorkflowDoc(raw)
    // 重 id 的 s1 被丢；s2（空提示词）被丢 ⇒ 只剩 2 步，流程留得下来
    expect(doc.flows[0].steps.map((s) => s.id)).toEqual(['s1', 's3'])
  })

  it('步骤不足 2 步的流程读不出来（半条链跑不出东西）', () => {
    const raw = JSON.stringify({
      flows: [
        { id: 'w1', name: '只有一步', steps: [{ id: 's1', prompt: 'x' }] },
        { id: 'w2', name: '没有步骤', steps: [] },
        { id: 'w3', name: '两步', steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }] },
      ],
    })
    expect(parseWorkflowDoc(raw).flows.map((f) => f.id)).toEqual(['w3'])
  })

  it('缺名字 / 缺 id / 重 id 的流程丢掉；坏字段回默认', () => {
    const raw = JSON.stringify({
      flows: [
        { id: 'w1', name: '  ', steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }] },
        { id: '', name: '没 id', steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }] },
        { id: 'w2', name: '好的', steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }] },
        { id: 'w2', name: '重 id', steps: [{ id: 'c', prompt: 'x' }, { id: 'd', prompt: 'y' }] },
      ],
    })
    const doc = parseWorkflowDoc(raw)
    expect(doc.flows.map((f) => f.id)).toEqual(['w2'])
    expect(doc.flows[0].providerId).toBe('')
    expect(doc.flows[0].createdAt).toBe(0)
  })

  it('读盘时名字超长只截（写入口是拒收）—— 坏档不该把左栏挤走', () => {
    const raw = JSON.stringify({
      flows: [
        {
          id: 'w1',
          name: '字'.repeat(WORKFLOW_NAME_MAX + 10),
          steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }],
        },
      ],
    })
    expect(parseWorkflowDoc(raw).flows[0].name).toHaveLength(WORKFLOW_NAME_MAX)
  })

  it('运行记录：坏 status 丢、缺 id 兜底生成、坏字段回默认', () => {
    const raw = JSON.stringify({
      runs: [
        { flowId: 'w1', status: 'ok', steps: [], at: 5 },
        { flowId: 'w1', status: 'wat', steps: [] },
        { flowId: '', status: 'ok', steps: [] },
        { id: 'r2', flowId: 'w1', status: 'error', steps: [{ stepId: 's1', text: '半截' }, { nope: 1 }], error: '炸了' },
      ],
    })
    const doc = parseWorkflowDoc(raw)
    expect(doc.runs).toHaveLength(2)
    expect(doc.runs[0].id).not.toBe('')
    expect(doc.runs[1].steps).toHaveLength(1)
    expect(doc.runs[1].error).toBe('炸了')
  })

  it('份数与记录条数的上限：盘上多出来的尾部丢掉', () => {
    const many = Array.from({ length: WORKFLOW_MAX_FLOWS + 2 }, (_, i) => ({
      id: `w${i}`,
      name: `n${i}`,
      steps: [{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }],
    }))
    expect(parseWorkflowDoc(JSON.stringify({ flows: many })).flows).toHaveLength(WORKFLOW_MAX_FLOWS)
    const runs: WorkflowRun[] = Array.from({ length: WORKFLOW_RUNS_MAX + 5 }, (_, i) => ({
      id: `r${i}`,
      flowId: 'w1',
      status: 'ok',
      steps: [],
      at: i,
    }))
    expect(parseWorkflowDoc(JSON.stringify({ runs })).runs).toHaveLength(WORKFLOW_RUNS_MAX)
  })

  it('序列化 → 解析往返一致', () => {
    const doc = parseWorkflowDoc(
      serializeWorkflowDoc({
        flows: [flow()],
        runs: [{ id: 'r1', flowId: 'w1', at: 5, status: 'ok', steps: [{ stepId: 's1', text: '结果' }] }],
      }),
    )
    expect(doc.flows).toEqual([flow()])
    expect(doc.runs[0].steps[0].text).toBe('结果')
  })
})

describe('工作流：建流程的四条闸门', () => {
  it('名字空 / 太长 —— 拒收，**超长拒收不截断**（截断会改语义）', () => {
    const empty = addFlow([], { name: '   ', prompts: ['a', 'b'] }, 1)
    expect(empty.rejected[0]).toContain('不能为空')
    const long = addFlow([], { name: '字'.repeat(WORKFLOW_NAME_MAX + 1), prompts: ['a', 'b'] }, 1)
    expect(long.rejected[0]).toContain('太长')
    expect(empty.flows).toHaveLength(0)
    expect(long.flows).toHaveLength(0)
  })

  it('步骤数不在 2–6 之间 —— 拒收，并说清为什么', () => {
    const one = addFlow([], { name: 'n', prompts: ['a'] }, 1)
    expect(one.rejected[0]).toContain('至少')
    const many = addFlow([], { name: 'n', prompts: Array.from({ length: WORKFLOW_MAX_STEPS + 1 }, (_, i) => `p${i}`) }, 1)
    expect(many.rejected[0]).toContain('最多')
    expect(one.flows).toHaveLength(0)
    expect(many.flows).toHaveLength(0)
  })

  it('某一步空 / 太长 —— 指名道姓说第几步，不静默改写', () => {
    const blank = addFlow([], { name: 'n', prompts: ['好的', '   '] }, 1)
    expect(blank.rejected[0]).toContain('第 2 步')
    const long = addFlow([], { name: 'n', prompts: ['好的', '字'.repeat(STEP_PROMPT_MAX + 1)] }, 1)
    expect(long.rejected[0]).toContain('第 2 步')
    expect(long.rejected[0]).toContain('太长')
  })

  it('份数上限：最多 6 个工作流', () => {
    const base = Array.from({ length: WORKFLOW_MAX_FLOWS }, (_, i) => flow({ id: `w${i}` }))
    const over = addFlow(base, { name: '再来', prompts: ['a', 'b'] }, 3)
    expect(over.flows).toHaveLength(WORKFLOW_MAX_FLOWS)
    expect(over.rejected[0]).toContain(String(WORKFLOW_MAX_FLOWS))
  })

  it('成功的路径：id 唯一、步骤 id 唯一、createdAt 落盘', () => {
    const r = addFlow([], { name: '搜集再归纳', prompts: ['搜一搜', '归纳成三条'], providerId: 'p1' }, 1_700_000_000_123)
    expect(r.flows).toHaveLength(1)
    expect(r.flows[0].providerId).toBe('p1')
    expect(r.flows[0].createdAt).toBe(1_700_000_000)
    expect(new Set(r.flows[0].steps.map((s) => s.id)).size).toBe(2)
    const r2 = addFlow(r.flows, { name: '第二个', prompts: ['a', 'b'] }, 1_700_000_000_123)
    expect(new Set(r2.flows.map((f) => f.id)).size).toBe(2)
  })

  it('id 撞车时加后缀，不覆盖已有的', () => {
    expect(newFlowId(1, ['w1'])).not.toBe('w1')
    expect(newStepId(1, ['s1'])).not.toBe('s1')
    expect(newFlowId(1, [])).toBe('w1')
  })

  it('移除只动目标那一条', () => {
    const list = [flow({ id: 'a' }), flow({ id: 'b' })]
    expect(removeFlow(list, 'a').map((f) => f.id)).toEqual(['b'])
    expect(removeFlow(list, 'nope')).toHaveLength(2)
  })
})

describe('工作流：产出怎么带（链条靠这个串起来）', () => {
  it('第一步只有自己的提示词', () => {
    expect(stepPrompt(step({ prompt: ' 搜一搜  ' }))).toBe('搜一搜')
  })

  it('第二步带上一步的产出', () => {
    const p = stepPrompt(step({ prompt: '归纳成三条' }), '搜到的原文')
    expect(p).toContain('归纳成三条')
    expect(p).toContain('搜到的原文')
  })

  it('上一步太长只带开头，并说明后面被省了', () => {
    const long = '字'.repeat(STEP_CARRY_MAX + 500)
    const p = stepPrompt(step({ prompt: '下一步' }), long)
    expect(p).toContain('前一步太长')
    expect(p).not.toContain(long)
  })

  it('存档里的产出要截断，并说明全文在哪', () => {
    expect(clipStepText('短')).toBe('短')
    const long = '字'.repeat(STEP_TEXT_MAX + 100)
    expect(clipStepText(long).endsWith('（这一步的结果很长，全文在那次对话里）')).toBe(true)
    expect(clipCarry(long).endsWith('（前一步太长，只带了开头）')).toBe(true)
    expect(clipCarry('短')).toBe('短')
  })
})

describe('工作流：运行记录', () => {
  it('头插 + 环形丢弃最旧的；lastRun 取该流程最近一条', () => {
    let runs: WorkflowRun[] = []
    for (let i = 0; i < WORKFLOW_RUNS_MAX + 3; i++) {
      runs = appendRun(runs, { id: `r${i}`, flowId: 'w1', status: 'ok', steps: [], at: i })
    }
    expect(runs).toHaveLength(WORKFLOW_RUNS_MAX)
    expect(runs[0].id).toBe(`r${WORKFLOW_RUNS_MAX + 2}`)
    runs = appendRun(runs, { id: 'rx', flowId: 'w2', status: 'error', steps: [], at: 99, error: '坏了' })
    expect(lastRun(runs, 'w2')?.status).toBe('error')
    expect(lastRun(runs, 'w1')?.flowId).toBe('w1')
    expect(lastRun(runs, 'nope')).toBeUndefined()
  })

  it('最少步数常量与产品口径一致（一步是聊天，两步以上才是流程）', () => {
    expect(WORKFLOW_MIN_STEPS).toBe(2)
  })
})
