/**
 * 「定时任务」的**纯函数层**（改天换地 PR-F2，生态位第二格）。
 *
 * 与 `reminders.ts` 同一条纪律：全是纯函数 —— `now` 注入、不读时钟、不碰存储、不发请求；
 * 调度才可能被穷举断言（"到点跑 / 当天错过"这两种事实都必须能离线证明）。
 *
 * 四条产品边界（都是刻意的，§12.67 如实记）：
 * 1. **到点自动跑 AI = 未经确认花钱** —— 所以任务只能由用户显式创建，且**错过不补跑**：
 *    应用当时没开着，就记一条「错过」，不静默追赶（追赶等于替用户做"这笔钱该花"的决定）。
 * 2. **结果不自动写进版面**：跑完的结果存进运行记录（每条截 2000 字），全文落在那次
 *    ai_chat 自己的会话历史里 —— 会话列表看得见、点得进去。替用户改卡片是另一层决定，不在这笔里。
 * 3. **不做 cron 表达式**：v1 只有"每天 HH:MM"。表达式那套语法对普通人是一座山，
 *    先把"每天一次"做对（含错过语义），语法面等真有需求再加。
 * 4. **粒度是分钟**：判定按 `HH:MM` 精确匹配（胶水层每分钟对一次表），错过与否在同一天内判定。
 */

/** 存储文档名；**必须登记进 `fileStorage.ts` 的 `DATA_KEYS`**（漏登记 = 写得下去、重启读不到） */
export const CRON_DOC_KEY = 'modulo.cron.v1'
/** 最多几个任务：再多就不是"替你盯几件事"，是拿后台当队列灌 */
export const CRON_MAX_TASKS = 8
/** 运行记录留最近几条（环形丢弃最旧的） */
export const CRON_RUNS_MAX = 20
/** 单条提示词的上限。**超长拒收不截断** —— 截断会悄悄改变任务语义 */
export const CRON_PROMPT_MAX = 4000
/** 运行结果进存档的上限；全文在 ai_chat 自己的会话历史里（会话列表可见） */
export const RUN_TEXT_MAX = 2000

export const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface CronTask {
  id: string
  prompt: string
  /** `HH:MM`，本地时间，每天一次 */
  time: string
  /** 用哪个模型服务跑；胶水层在执行时解析，解析不到回落第一个可用的 */
  providerId: string
  enabled: boolean
  createdAt: number
}

export interface CronRun {
  id: string
  taskId: string
  /** 完成时刻（秒） */
  at: number
  status: 'ok' | 'error' | 'missed'
  /** `ok` 时的结果正文（截到 `RUN_TEXT_MAX`；全文在会话历史） */
  text?: string
  /** `error` / `missed` 时的人话原因 */
  error?: string
}

export interface CronDoc {
  tasks: CronTask[]
  runs: CronRun[]
}

const isStr = (v: unknown): v is string => typeof v === 'string'

function cleanTask(it: Partial<CronTask> | null | undefined, taken: Set<string>): CronTask | null {
  if (!it || typeof it !== 'object') return null
  if (!isStr(it.id) || !it.id || taken.has(it.id)) return null
  if (!isStr(it.prompt) || !it.prompt.trim()) return null
  if (!isStr(it.time) || !HM_RE.test(it.time.trim())) return null
  taken.add(it.id)
  return {
    id: it.id,
    prompt: it.prompt.trim(),
    time: it.time.trim(),
    providerId: isStr(it.providerId) ? it.providerId : '',
    enabled: it.enabled !== false,
    createdAt: typeof it.createdAt === 'number' && Number.isFinite(it.createdAt) ? it.createdAt : 0,
  }
}

function cleanRun(it: Partial<CronRun> | null | undefined, i: number): CronRun | null {
  if (!it || typeof it !== 'object') return null
  if (!isStr(it.taskId)) return null
  const status = it.status === 'ok' || it.status === 'error' || it.status === 'missed' ? it.status : null
  if (!status) return null
  return {
    // 运行记录的 id 允许兜底生成（旧档可能没写）
    id: isStr(it.id) && it.id ? it.id : `r-fallback-${i}`,
    taskId: it.taskId,
    at: typeof it.at === 'number' && Number.isFinite(it.at) ? it.at : 0,
    status,
    text: isStr(it.text) ? it.text : undefined,
    error: isStr(it.error) ? it.error : undefined,
  }
}

/** 盘上的文档不可信：逐条清洗，坏条目丢弃（同 parseKnowledge / parseAiDoc） */
export function parseCronDoc(raw: string | null): CronDoc {
  const empty: CronDoc = { tasks: [], runs: [] }
  if (!raw) return empty
  let o: unknown = null
  try {
    o = JSON.parse(raw)
  } catch {
    return empty
  }
  const doc = o as Partial<CronDoc> | null
  if (!doc || typeof doc !== 'object') return empty
  const taken = new Set<string>()
  const tasks: CronTask[] = []
  if (Array.isArray(doc.tasks)) {
    for (const it of doc.tasks) {
      const t = cleanTask(it as Partial<CronTask>, taken)
      if (t) tasks.push(t)
      if (tasks.length >= CRON_MAX_TASKS) break
    }
  }
  const runs: CronRun[] = []
  if (Array.isArray(doc.runs)) {
    for (const [i, it] of doc.runs.entries()) {
      const r = cleanRun(it as Partial<CronRun>, i)
      if (r) runs.push(r)
      if (runs.length >= CRON_RUNS_MAX) break
    }
  }
  return { tasks, runs }
}

export function serializeCronDoc(doc: CronDoc): string {
  return JSON.stringify({
    schemaVersion: 1,
    tasks: doc.tasks.slice(0, CRON_MAX_TASKS),
    runs: doc.runs.slice(0, CRON_RUNS_MAX),
  })
}

export function newTaskId(nowMs: number, taken: readonly string[] = []): string {
  const base = `c${nowMs.toString(36)}`
  let id = base
  let n = 0
  while (taken.includes(id)) id = `${base}-${++n}`
  return id
}

export interface PickedTask {
  prompt: string
  time: string
  providerId?: string
}

/**
 * 建任务。三条闸门：提示词非空且 ≤ 上限（**超长拒收**，截断会改语义）、时间格式、
 * 同一时间同一条提示词不重复。
 */
export function addTask(
  tasks: readonly CronTask[],
  picked: PickedTask,
  nowMs: number,
): { tasks: CronTask[]; rejected: string[] } {
  const out = tasks.slice()
  const rejected: string[] = []
  const prompt = picked.prompt.trim()
  const time = picked.time.trim()
  if (!prompt) {
    rejected.push('提示词不能为空')
  } else if (prompt.length > CRON_PROMPT_MAX) {
    rejected.push(`提示词太长（上限 ${CRON_PROMPT_MAX} 字）——太长的活不适合一句话交给后台`)
  }
  if (!HM_RE.test(time)) rejected.push('时间要是 HH:MM（比如 09:00）')
  if (rejected.length) return { tasks: out, rejected }
  if (out.some((t) => t.time === time && t.prompt === prompt)) {
    rejected.push('这个时间已经有一条一样的任务了')
    return { tasks: out, rejected }
  }
  if (out.length >= CRON_MAX_TASKS) {
    rejected.push(`最多 ${CRON_MAX_TASKS} 个任务`)
    return { tasks: out, rejected }
  }
  out.push({
    id: newTaskId(nowMs, out.map((t) => t.id)),
    prompt,
    time,
    providerId: picked.providerId ?? '',
    enabled: true,
    createdAt: Math.floor(nowMs / 1000),
  })
  return { tasks: out, rejected }
}

export function removeTask(tasks: readonly CronTask[], id: string): CronTask[] {
  return tasks.filter((t) => t.id !== id)
}

export function setTaskEnabled(tasks: readonly CronTask[], id: string, enabled: boolean): CronTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, enabled } : t))
}

/** 今天的 `HH:MM`（本地时间；胶水层每分钟对一次表，靠这个相等判定"到点"） */
export function localHM(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(now.getHours())}:${p(now.getMinutes())}`
}

/**
 * 纯调度判定：**该跑的**（到点且今天没跑过）与**该记错过的**（时间已过、没跑过也没记过）。
 *
 * `done` 由胶水层传"今天已跑 ∪ 今天已记错过"的并集 —— 这一层不做状态机，只做判定，
 * 状态（day 翻天清空）归胶水层（与 useReminders 同一条分工）。
 */
export function dueTasks(
  tasks: readonly CronTask[],
  done: readonly string[],
  now: Date,
): { due: CronTask[]; missed: CronTask[] } {
  const hm = localHM(now)
  const did = new Set(done)
  const due: CronTask[] = []
  const missed: CronTask[] = []
  for (const t of tasks) {
    if (!t.enabled || did.has(t.id)) continue
    if (t.time === hm) due.push(t)
    else if (t.time < hm) missed.push(t)
  }
  return { due, missed }
}

/** 结果进存档的截断：末尾说明全文在哪（会话历史），不装成全文 */
export function clipRunText(text: string, max: number = RUN_TEXT_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…（结果很长，全文在那次对话里）`
}

/** 运行记录头插 + 环形丢弃最旧的 */
export function appendRun(runs: readonly CronRun[], run: CronRun): CronRun[] {
  return [run, ...runs].slice(0, CRON_RUNS_MAX)
}

/** 某个任务最近的一条运行记录（没有就是 undefined —— 界面据此显示"还没跑过"） */
export function lastRun(runs: readonly CronRun[], taskId: string): CronRun | undefined {
  return runs.find((r) => r.taskId === taskId)
}
