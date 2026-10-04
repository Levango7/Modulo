/**
 * 计时：一张引擎，四种形状（秒表 / 倒计时 / 间歇计时 / 呼吸计时）。
 *
 * **为什么只有一套机制**：这四张卡看起来是四种功能，其实是同一件事的四个读法 ——
 * "从某个时刻起过了多久"。分四套实现意味着四份计时偏差、四份跨重启恢复逻辑、
 * 四个"为什么这个卡跳了一秒"的 bug 源。所以这个文件里只有一个状态形状：
 *
 * ```ts
 * interface RunState { running: boolean; startedAt: number | null; accumulatedMs: number }
 * ```
 *
 * 剩下的一切都是**投影**：正计时直接显示 `elapsed`；倒计时显示 `duration - elapsed`；
 * 间歇与呼吸是"倒计时 + 到点换一段设定"。
 *
 * ## 一条硬纪律：不用累加计数器，用时间戳
 *
 * `setInterval(1000)` 每秒 `acc += 1000` 在后台标签页会被节流到 1 分钟一次，
 * 于是它记的时间会比真实时间少一大截 —— 用户回来发现"我明明过了十分钟"。
 * 所以这里**永远存"从哪个时刻开始的"**，显示时才用 `now - startedAt` 算差。
 * 累加值只在"暂停"时写回（`accumulatedMs`）。
 *
 * `setInterval` 只用来**重绘**，不用来累加时间 —— 那是它唯一被允许的职责。
 */

/** 一个"跑起来的钟"的状态。这是本文件的核心，别的地方都只是它的投影。 */
export interface RunState {
  running: boolean
  /** 当前这一段的起始 epoch 毫秒；没跑就是 null */
  startedAt: number | null
  /** 这一段之前的累计毫秒（暂停时冻结的值） */
  accumulatedMs: number
}

export const IDLE: RunState = { running: false, startedAt: null, accumulatedMs: 0 }

export function startRun(s: RunState, now: number): RunState {
  if (s.running) return s
  return { running: true, startedAt: now, accumulatedMs: s.accumulatedMs }
}

/** 暂停：把"到此刻为止"的差值冻结进 `accumulatedMs`。没在跑时是幂等的空操作 */
export function pauseRun(s: RunState, now: number): RunState {
  if (!s.running || s.startedAt === null) return s
  return { running: false, startedAt: null, accumulatedMs: Math.max(0, s.accumulatedMs + (now - s.startedAt)) }
}

/** 复位：清零，但保留"跑着没有"这个事实之外的一切归零 —— 调用方要保留 running 就自己 start */
export function resetRun(s: RunState): RunState {
  return { running: false, startedAt: null, accumulatedMs: 0 }
}

/** 已经跑了多少毫秒。负数夹到 0（时钟被往回调过时不该显示负的秒表） */
export function elapsedMs(s: RunState, now: number): number {
  const base = Number.isFinite(s.accumulatedMs) ? Math.max(0, s.accumulatedMs) : 0
  if (!s.running || s.startedAt === null) return base
  return base + Math.max(0, now - s.startedAt)
}

export const MAX_MINUTES = 599

/** 分 → 毫秒，夹到 0–599 分。上限是有意的：一张卡不该显示"还有 600 分钟" */
export function minutesToMs(minutes: number): number {
  const m = Number.isFinite(minutes) ? Math.round(minutes) : 0
  return Math.min(MAX_MINUTES, Math.max(0, m)) * 60_000
}

/** 倒计时还剩多少毫秒。**到点是 0，不是负数** —— 界面上"剩余 0"才是对的，负数要用户自己想 */
export function remainingMs(s: RunState, durationMs: number, now: number): number {
  return Math.max(0, durationMs - elapsedMs(s, now))
}

/** 倒计时是否到点。到点是 `elapsed >= duration`（不是 `> `，否则 duration=0 时永远不到点） */
export function isFinished(s: RunState, durationMs: number, now: number): boolean {
  return durationMs >= 0 && elapsedMs(s, now) >= durationMs
}

/** 进度 0–1；duration 为 0 时给 1（"没有时长"不是一个 0% 的进度条） */
export function progress(s: RunState, durationMs: number, now: number): number {
  if (durationMs <= 0) return 1
  return Math.min(1, Math.max(0, elapsedMs(s, now) / durationMs))
}

// ---------------------------------------------------------------------------
// 显示格式
// ---------------------------------------------------------------------------

/** `HH:MM:SS`。不足 1 小时不带小时位 —— 秒表卡上 `09:58` 比 `00:09:58` 好读 */
export function formatClock(ms: number, forceHours = false): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 || forceHours ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/** 紧凑形态：`1h 05m` / `5m` / `40s`。给只放得下一行小字的窄卡用 */
export function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${String(rest).padStart(2, '0')}m`
}

/** "还有 12 分" / "还有 40 秒" —— 倒计时在切换到"分"以下时要跟秒数走，不然一整分钟不更新 */
export function formatRemainingText(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000))
  if (total < 60) return `还有 ${total} 秒`
  const m = Math.ceil(total / 60)
  return `还有 ${m} 分`
}

// ---------------------------------------------------------------------------
// 间歇计时（含"番茄 25/5"作为**预设**，不是一张卡）
// ---------------------------------------------------------------------------

export type IntervalPhase = 'focus' | 'break' | 'longBreak'

export interface IntervalPreset {
  id: string
  label: string
  /** 一段专注多少分钟 */
  focusMin: number
  /** 一段短休多少分钟 */
  breakMin: number
  /** 每几段专注之后来一次长休 */
  longEvery: number
  /** 长休多少分钟 */
  longBreakMin: number
}

/**
 * 预设表。
 *
 * **"番茄 25/5"在这里，不是一张卡。** 番茄工作法是一套预设值而不是一种计时机制 ——
 * 给它单独发一张卡，等于让卡片的功能承诺超出它实际做的事（用户会以为默认 25/5、能数番茄、
 * 四个一循环），而这些都不该由一张工作台卡片来保证。要 50/10 或 90/15 也是改这里一行。
 */
export const INTERVAL_PRESETS: readonly IntervalPreset[] = [
  { id: 'pomodoro', label: '番茄 25/5', focusMin: 25, breakMin: 5, longEvery: 4, longBreakMin: 15 },
  { id: 'fifty-ten', label: '50/10 深度', focusMin: 50, breakMin: 10, longEvery: 3, longBreakMin: 20 },
  { id: 'ninety-fifteen', label: '90/15 大块', focusMin: 90, breakMin: 15, longEvery: 2, longBreakMin: 30 },
]

export const DEFAULT_INTERVAL_PRESET_ID = 'pomodoro'

export function intervalPresetById(id: string): IntervalPreset {
  return INTERVAL_PRESETS.find((p) => p.id === id) ?? INTERVAL_PRESETS[0]
}

export interface IntervalState {
  /** 已完成几段专注（跨休息累加，不清零） */
  completedFocus: number
  /** 当前是第几段（0 起） */
  phaseIndex: number
}

export const INTERVAL_INIT: IntervalState = { completedFocus: 0, phaseIndex: 0 }

/** 当前该跑哪一段（纯函数，不看时间） */
export function currentPhase(s: IntervalState, preset: IntervalPreset): IntervalPhase {
  // 偶数段是专注，奇数段是休息；每 longEvery 段的休息是长休
  if (s.phaseIndex % 2 === 0) return 'focus'
  const focusDone = Math.floor(s.phaseIndex / 2) + 1
  return focusDone % preset.longEvery === 0 ? 'longBreak' : 'break'
}

export function phaseMinutes(phase: IntervalPhase, preset: IntervalPreset): number {
  if (phase === 'focus') return preset.focusMin
  if (phase === 'longBreak') return preset.longBreakMin
  return preset.breakMin
}

export const PHASE_LABELS: Record<IntervalPhase, string> = {
  focus: '专注',
  break: '休息',
  longBreak: '长休息',
}

/** 到点了 → 推进到下一段。这是唯一的迁移函数，"完成一段"在这里被计数 */
export function advanceInterval(s: IntervalState, preset: IntervalPreset): IntervalState {
  const wasFocus = currentPhase(s, preset) === 'focus'
  return {
    completedFocus: wasFocus ? s.completedFocus + 1 : s.completedFocus,
    phaseIndex: s.phaseIndex + 1,
  }
}

/** 第几轮 / 共几轮（长休那一轮才说得清；短休时给"已完成 / 目标"） */
export function intervalRound(s: IntervalState, preset: IntervalPreset): { done: number; target: number } {
  return { done: s.completedFocus, target: preset.longEvery }
}

/**
 * 一步到位：算出某个时刻该显示什么、以及是否到点需要切段。
 * **只算一步**，不追赶多段 —— 后台标签页回来一次跨过好几段（或者时钟被往回拨）时，
 * 界面直接跳到"现在应该在哪一段"比一口气播完 7 段提示更合理。
 */
export interface IntervalView {
  phase: IntervalPhase
  state: IntervalState
  /** 本段已跑毫秒 */
  elapsed: number
  /** 本段总时长毫秒 */
  durationMs: number
  /** 本段是否到点 */
  finished: boolean
  round: { done: number; target: number }
}

export function intervalView(run: RunState, interval: IntervalState, preset: IntervalPreset, now: number): IntervalView {
  let state = interval
  let r = run
  let phase = currentPhase(state, preset)
  let durationMs = minutesToMs(phaseMinutes(phase, preset))
  if (isFinished(r, durationMs, now)) {
    state = advanceInterval(state, preset)
    // 到点即自动切段：钟归零、不再累计 —— 否则"专注 25 分钟"会一直显示 50 分钟
    r = IDLE
    phase = currentPhase(state, preset)
    durationMs = minutesToMs(phaseMinutes(phase, preset))
  }
  const elapsed = Math.min(elapsedMs(r, now), durationMs)
  return { phase, state, elapsed, durationMs, finished: isFinished(r, durationMs, now), round: intervalRound(state, preset) }
}

// ---------------------------------------------------------------------------
// 呼吸计时
// ---------------------------------------------------------------------------

export interface BreathPattern {
  id: string
  label: string
  /** 一步一句提示：显示"吸气"/"屏住"/"呼气" */
  phases: { kind: 'inhale' | 'hold' | 'exhale' | 'rest'; seconds: number }[]
  /** 一轮几拍 */
  rounds: number
}

export const BREATH_PATTERNS: readonly BreathPattern[] = [
  { id: 'box', label: '方箱 4-4-4-4', phases: [{ kind: 'inhale', seconds: 4 }, { kind: 'hold', seconds: 4 }, { kind: 'exhale', seconds: 4 }, { kind: 'rest', seconds: 4 }], rounds: 4 },
  { id: 'relax-478', label: '助眠 4-7-8', phases: [{ kind: 'inhale', seconds: 4 }, { kind: 'hold', seconds: 7 }, { kind: 'exhale', seconds: 8 }], rounds: 4 },
  { id: 'calm', label: '平缓 4-6', phases: [{ kind: 'inhale', seconds: 4 }, { kind: 'exhale', seconds: 6 }], rounds: 3 },
]

export const DEFAULT_BREATH_PATTERN_ID = 'box'

export function breathPatternById(id: string): BreathPattern {
  return BREATH_PATTERNS.find((p) => p.id === id) ?? BREATH_PATTERNS[0]
}

export const BREATH_LABELS: Record<BreathPattern['phases'][number]['kind'], string> = {
  inhale: '吸气',
  hold: '屏住',
  exhale: '呼气',
  rest: '停一下',
}

export interface BreathView {
  kind: BreathPattern['phases'][number]['kind']
  label: string
  /** 本拍已过秒（整数，向下取） */
  second: number
  /** 本拍总秒 */
  seconds: number
  /** 本拍进度 0–1，驱动那个收缩/放大的圆 */
  ratio: number
  /** 第几拍（0 起） */
  step: number
  stepCount: number
  round: number
  roundCount: number
}

/**
 * 呼吸节奏：把"已经跑了多久"映射成"现在是第几拍、这一拍第几秒"。
 * 不自己推进状态 —— 状态由 `RunState` 的时间戳给出，所以**后台被节流也不会走错拍**。
 */
export function breathView(run: RunState, pattern: BreathPattern, now: number): BreathView {
  const cycleSecs = pattern.phases.reduce((s, p) => s + p.seconds, 0)
  const cycleMs = cycleSecs * 1000
  const elapsed = elapsedMs(run, now)
  const round = Math.min(pattern.rounds, Math.floor(elapsed / cycleMs) + 1)
  const inCycle = cycleMs > 0 ? elapsed % cycleMs : 0
  let acc = 0
  let step = 0
  for (let i = 0; i < pattern.phases.length; i += 1) {
    const span = pattern.phases[i].seconds * 1000
    if (inCycle < acc + span || i === pattern.phases.length - 1) {
      step = i
      break
    }
    acc += span
  }
  const phase = pattern.phases[step]
  const into = Math.max(0, inCycle - acc)
  return {
    kind: phase.kind,
    label: BREATH_LABELS[phase.kind],
    second: Math.min(phase.seconds, Math.floor(into / 1000)),
    seconds: phase.seconds,
    ratio: phase.seconds > 0 ? Math.min(1, into / (phase.seconds * 1000)) : 0,
    step,
    stepCount: pattern.phases.length,
    round,
    roundCount: pattern.rounds,
  }
}

/** 一轮总共多少秒（给卡上写"一轮 48 秒 × 4"） */
export function breathCycleSeconds(p: BreathPattern): number {
  return p.phases.reduce((s, x) => s + x.seconds, 0)
}

/** 总时长（毫秒），用来在计时结束时说"做完了" */
export function breathTotalMs(p: BreathPattern): number {
  return breathCycleSeconds(p) * 1000 * p.rounds
}

/** 呼吸/间歇计时是否已跑完全部轮次 */
export function breathComplete(run: RunState, p: BreathPattern, now: number): boolean {
  return elapsedMs(run, now) >= breathTotalMs(p)
}