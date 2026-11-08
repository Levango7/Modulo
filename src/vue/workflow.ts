/**
 * 「工作流」的**纯函数层**（改天换地 PR-F3，生态位第三格）。
 *
 * 与 `cron.ts` 同一条纪律：全是纯函数 —— 不读时钟、不碰存储、不发请求；
 * 「步骤怎么串」「产出怎么带」「记录怎么留」都必须能离线证明。
 *
 * 四条产品边界（都是刻意的，§12.68 如实记）：
 * 1. **工作流是"替我把几步串起来"**：每一步跑一次模型，上一步的产出折叠进下一步的
 *    提示词里。跟定时任务分工明确 —— 定时任务管"什么时候跑"，工作流管"按什么顺序跑"。
 * 2. **首败即停**：某一步没跑通，后面几步不再跑。后面几步的前提是上一步的产出，
 *    没有产出还往下走，等于让模型猜 —— 那花的不是用户的钱，是用户的信任。
 * 3. **步骤数 2–6**：一步是"聊天"，两步以上才是"流程"；上限 6 是因为一步就是一次
 *    模型调用，链条越长越贵越慢。名字也限长，免得左栏被一行标题挤走。
 * 4. **上一步只带开头 2000 字**：带全文会让后面的请求越滚越大；每一步自己的全文
 *    在 ai_chat 的会话历史里看得见、点得进去。
 */

/** 存储文档名；**必须登记进 `fileStorage.ts` 的 `DATA_KEYS`**（漏登记 = 写得下去、重启读不到） */
export const WORKFLOW_DOC_KEY = 'modulo.workflow.v1'
/** 最多几个工作流：再多就不是"替我串几件事"，是拿后台当流水线灌 */
export const WORKFLOW_MAX_FLOWS = 6
/** 最少几步：一步是"聊天"，两步以上才是"流程" */
export const WORKFLOW_MIN_STEPS = 2
/** 最多几步：一步 = 一次模型调用，链条越长越贵越慢 */
export const WORKFLOW_MAX_STEPS = 6
/** 名字上限（一个字 = 一个字，不截断不静默改写） */
export const WORKFLOW_NAME_MAX = 40
/** 单步提示词上限。**超长拒收不截断** —— 截断会悄悄改变这一步的语义 */
export const STEP_PROMPT_MAX = 2000
/** 单步产出进存档的上限；全文在 ai_chat 自己的会话历史里 */
export const STEP_TEXT_MAX = 2000
/** 带上一步产出的上限（只带开头） */
export const STEP_CARRY_MAX = 2000
/** 运行记录留最近几条（环形丢弃最旧的） */
export const WORKFLOW_RUNS_MAX = 20

export interface WorkflowStep {
  id: string
  /** 这一步要做的事（给模型看的话） */
  prompt: string
}

export interface WorkflowFlow {
  id: string
  name: string
  /** 按顺序；每步跑一次模型 */
  steps: WorkflowStep[]
  /** 用哪个模型服务跑；胶水层在执行时解析，解析不到回落第一个可用的 */
  providerId: string
  createdAt: number
}

/** 一步的产出（文本截到 `STEP_TEXT_MAX`；出错时带原因） */
export interface WorkflowStepRun {
  stepId: string
  text: string
  error?: string
}

export interface WorkflowRun {
  id: string
  flowId: string
  /** 完成时刻（秒） */
  at: number
  status: 'ok' | 'error'
  /** 逐步的产出（跑到哪步停在哪步） */
  steps: WorkflowStepRun[]
  /** `error` 时的人话原因（含"第几步没跑通"） */
  error?: string
}

export interface WorkflowDoc {
  flows: WorkflowFlow[]
  runs: WorkflowRun[]
}

const isStr = (v: unknown): v is string => typeof v === 'string'

function cleanStep(it: Partial<WorkflowStep> | null | undefined, taken: Set<string>): WorkflowStep | null {
  if (!it || typeof it !== 'object') return null
  if (!isStr(it.id) || !it.id || taken.has(it.id)) return null
  if (!isStr(it.prompt) || !it.prompt.trim()) return null
  taken.add(it.id)
  return { id: it.id, prompt: it.prompt.trim() }
}

function cleanFlow(it: Partial<WorkflowFlow> | null | undefined, taken: Set<string>): WorkflowFlow | null {
  if (!it || typeof it !== 'object') return null
  if (!isStr(it.id) || !it.id || taken.has(it.id)) return null
  const name = isStr(it.name) ? it.name.trim() : ''
  if (!name) return null
  const stepIds = new Set<string>()
  const steps: WorkflowStep[] = []
  if (Array.isArray(it.steps)) {
    for (const s of it.steps) {
      const st = cleanStep(s as Partial<WorkflowStep>, stepIds)
      if (st) steps.push(st)
      if (steps.length >= WORKFLOW_MAX_STEPS) break
    }
  }
  // 步骤不足的流程读不出来 —— 半条链跑不出东西，留着只会让人以为"跑过"
  if (steps.length < WORKFLOW_MIN_STEPS) return null
  taken.add(it.id)
  return {
    id: it.id,
    // 读盘时名字超长才截（写入口是拒收）：坏档不该让左栏被一行标题挤走
    name: name.slice(0, WORKFLOW_NAME_MAX),
    steps,
    providerId: isStr(it.providerId) ? it.providerId : '',
    createdAt: typeof it.createdAt === 'number' && Number.isFinite(it.createdAt) ? it.createdAt : 0,
  }
}

function cleanRun(it: Partial<WorkflowRun> | null | undefined, i: number): WorkflowRun | null {
  if (!it || typeof it !== 'object') return null
  // flowId 必须非空：空 id 的记录永远配不上任何流程（流程 id 非空），留着只会白占记录位
  if (!isStr(it.flowId) || !it.flowId) return null
  const status = it.status === 'ok' || it.status === 'error' ? it.status : null
  if (!status) return null
  const steps: WorkflowStepRun[] = []
  if (Array.isArray(it.steps)) {
    for (const s of it.steps) {
      if (!s || typeof s !== 'object') continue
      const sr = s as Partial<WorkflowStepRun>
      if (!isStr(sr.stepId)) continue
      steps.push({
        stepId: sr.stepId,
        text: isStr(sr.text) ? sr.text : '',
        ...(isStr(sr.error) ? { error: sr.error } : {}),
      })
    }
  }
  return {
    // 运行记录的 id 允许兜底生成（旧档可能没写）
    id: isStr(it.id) && it.id ? it.id : `wf-run-fallback-${i}`,
    flowId: it.flowId,
    at: typeof it.at === 'number' && Number.isFinite(it.at) ? it.at : 0,
    status,
    steps,
    ...(isStr(it.error) ? { error: it.error } : {}),
  }
}

/** 盘上的文档不可信：逐条清洗，坏条目丢弃（同 parseCronDoc / parseKnowledge） */
export function parseWorkflowDoc(raw: string | null): WorkflowDoc {
  const empty: WorkflowDoc = { flows: [], runs: [] }
  if (!raw) return empty
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return empty
  }
  const doc = o as Partial<WorkflowDoc> | null
  if (!doc || typeof doc !== 'object') return empty
  const taken = new Set<string>()
  const flows: WorkflowFlow[] = []
  if (Array.isArray(doc.flows)) {
    for (const it of doc.flows) {
      const f = cleanFlow(it as Partial<WorkflowFlow>, taken)
      if (f) flows.push(f)
      if (flows.length >= WORKFLOW_MAX_FLOWS) break
    }
  }
  const runs: WorkflowRun[] = []
  if (Array.isArray(doc.runs)) {
    for (const [i, it] of doc.runs.entries()) {
      const r = cleanRun(it as Partial<WorkflowRun>, i)
      if (r) runs.push(r)
      if (runs.length >= WORKFLOW_RUNS_MAX) break
    }
  }
  return { flows, runs }
}

export function serializeWorkflowDoc(doc: WorkflowDoc): string {
  return JSON.stringify({
    schemaVersion: 1,
    flows: doc.flows.slice(0, WORKFLOW_MAX_FLOWS),
    runs: doc.runs.slice(0, WORKFLOW_RUNS_MAX),
  })
}

export function newFlowId(nowMs: number, taken: readonly string[] = []): string {
  const base = `w${nowMs.toString(36)}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

export function newStepId(nowMs: number, taken: readonly string[] = []): string {
  const base = `s${nowMs.toString(36)}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

export interface PickedFlow {
  name: string
  /** 每一步要做的事（按顺序）；有空步或超长的整条拒收 */
  prompts: string[]
  providerId?: string
}

/**
 * 建工作流。闸门：名字非空且 ≤ 上限（**超长拒收**，截断会改语义）、
 * 步骤数在 2–6 之间、每一步的提示词非空且 ≤ 上限。
 */
export function addFlow(
  flows: readonly WorkflowFlow[],
  picked: PickedFlow,
  nowMs: number,
): { flows: WorkflowFlow[]; rejected: string[] } {
  const out = flows.slice()
  const rejected: string[] = []
  const name = picked.name.trim()
  if (!name) rejected.push('名字不能为空')
  else if (name.length > WORKFLOW_NAME_MAX) rejected.push(`名字太长（上限 ${WORKFLOW_NAME_MAX} 字）`)
  const prompts = (picked.prompts ?? []).map((p) => (typeof p === 'string' ? p.trim() : ''))
  if (prompts.length < WORKFLOW_MIN_STEPS) {
    rejected.push(`工作流至少 ${WORKFLOW_MIN_STEPS} 步（一步是聊天，两步以上才是流程）`)
  } else if (prompts.length > WORKFLOW_MAX_STEPS) {
    rejected.push(`最多 ${WORKFLOW_MAX_STEPS} 步（一步就是一次模型调用）`)
  }
  for (const [i, p] of prompts.entries()) {
    if (!p) {
      rejected.push(`第 ${i + 1} 步还没写要做的事`)
      break
    }
    if (p.length > STEP_PROMPT_MAX) {
      rejected.push(`第 ${i + 1} 步的提示词太长（上限 ${STEP_PROMPT_MAX} 字）——太长会悄悄改掉这一步的语义`)
      break
    }
  }
  if (rejected.length) return { flows: out, rejected }
  if (out.length >= WORKFLOW_MAX_FLOWS) {
    rejected.push(`最多 ${WORKFLOW_MAX_FLOWS} 个工作流`)
    return { flows: out, rejected }
  }
  const stepIds: string[] = []
  const steps: WorkflowStep[] = []
  for (const p of prompts) {
    const id = newStepId(nowMs, stepIds)
    stepIds.push(id)
    steps.push({ id, prompt: p })
  }
  out.push({
    id: newFlowId(nowMs, out.map((f) => f.id)),
    name,
    steps,
    providerId: picked.providerId ?? '',
    createdAt: Math.floor(nowMs / 1000),
  })
  return { flows: out, rejected }
}

export function removeFlow(flows: readonly WorkflowFlow[], id: string): WorkflowFlow[] {
  return flows.filter((f) => f.id !== id)
}

/** 产出进存档的截断：末尾说明全文在哪（会话历史），不装成全文 */
export function clipStepText(text: string, max: number = STEP_TEXT_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…（这一步的结果很长，全文在那次对话里）`
}

/** 带上一步产出时的截断：只带开头，说明后面被省了 */
export function clipCarry(text: string, max: number = STEP_CARRY_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…（前一步太长，只带了开头）`
}

/**
 * 这一步发给模型的话。第一步只有自己的提示词；从第二步起，把上一步的产出
 * 折叠在后面（只带开头）—— 链条靠这个串起来。
 */
export function stepPrompt(step: WorkflowStep, prevOut?: string): string {
  const base = step.prompt.trim()
  const prev = (prevOut ?? '').trim()
  if (!prev) return base
  return `${base}\n\n—— 上一段的产出（最多带 ${STEP_CARRY_MAX} 字）——\n${clipCarry(prev)}`
}

/** 运行记录头插 + 环形丢弃最旧的 */
export function appendRun(runs: readonly WorkflowRun[], run: WorkflowRun): WorkflowRun[] {
  return [run, ...runs].slice(0, WORKFLOW_RUNS_MAX)
}

/** 某个工作流最近的一条运行记录（没有就是 undefined —— 界面据此显示"还没跑过"） */
export function lastRun(runs: readonly WorkflowRun[], flowId: string): WorkflowRun | undefined {
  return runs.find((r) => r.flowId === flowId)
}
