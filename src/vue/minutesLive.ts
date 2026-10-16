/**
 * 会议速记卡（`src/app/cards/MinutesCard.vue`）里**能被断言**的那半。
 *
 * 这里只放纯函数：没有 DOM、没有 IPC、没有定时器。卡本体负责胶水（invoke / listen /
 * 定时器 / 滚动），这个模块负责"给定输入必然得到哪个输出"。
 *
 * 为什么值得单测：这张卡最容易错的地方全在这里 ——
 *   1. 时长口径（暂停期间算不算、大于一小时怎么显示）；
 *   2. 字幕累积（同一时间点重复投递、乱序到达、长会撑爆 DOM）；
 *   3. 控件可用性（模型没就绪就绝不能让人点开始，否则只能收一个后端 reject）；
 *   4. 设备挑选（挑错 = 录了一路不存在的声音，而且当场看不出来）。
 *
 * ## 与后端契约的三处偏差（按**实现**写，不按 yaml）
 * - 事件名是 `minutes_segment` / `minutes_error`；
 * - `speaker` 恒为 null、`speakerNames` 恒空 —— 说话人分离本批没落地、**没有数据来源**，
 *   所以本模块里**没有**任何"说话人"字段：不给不存在的状态留位置；
 * - `meeting_stop` 承诺的 diarization 回填已顺延，别等它。
 */

/** 模型状态。`asr_model_status` 的 state 就是这五个。 */
export type ModelState = 'missing' | 'downloading' | 'verifying' | 'ready' | 'failed'

/** 会话状态。`paused` 时后端不再吐句子，但会话还在（停止仍然可用）。 */
export type SessionState = 'idle' | 'recording' | 'paused'

/** 音源：麦克风 / 系统声音（后者录的是"电脑正在放什么"）。 */
export type AudioSource = 'mic' | 'system'

export type Tone = 'info' | 'warn' | 'error'

/** 字幕里的一句。`speaker` 不在其中 —— 见文件头第 2 条偏差。 */
export interface Segment {
  startMs: number
  endMs: number
  text: string
}

export interface AudioDevice {
  id: string
  name: string
  isDefault: boolean
  kind: 'input' | 'output'
}

/**
 * 后端 state 是自由字符串（Channel 推的是 `string`），而界面只认五个已知值。
 * 未知值一律落到 `'missing'`：宁可多显示一个"下载模型"按钮，也不能把它当成 `ready`
 * 放行 —— 后者会让人点开始、然后收到一个后端 reject。
 */
export function asModelState(raw: string): ModelState {
  return raw === 'downloading' || raw === 'verifying' || raw === 'ready' || raw === 'failed' || raw === 'missing'
    ? raw
    : 'missing'
}

const KB = 1024

/** 非有限值 / 负数的兜底：绝不能让 `NaN:NaN` 这种串出现在界面上。 */
function safeMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0
}

/**
 * 时长格式化。口径（三处都要按它断言）：
 * - **向下取整到秒**：计时器不能提前跳下一秒（59.9s 显示 00:59 而不是 01:00）；
 * - 不满 1 小时给 `mm:ss`（`04:07`），满 1 小时给 `h:mm:ss`（`1:02:03`，小时不补零）；
 * - 非有限值 / 负数 / 0 都当 0 → `00:00`。
 */
export function formatDuration(ms: number): string {
  const total = Math.floor(safeMs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 字幕行首的时间：**恒定 `mm:ss`，分钟一直累加**（75 分钟显示 `75:00`，不切 `1:15:00`）。
 * 一行里时间戳的宽度会变，整列文本就会跟着左右跳一下 —— 长会里每次跨过一小时跳一次很扎眼。
 * 同样向下取整。
 */
export function formatSegmentTime(ms: number): string {
  const total = Math.floor(safeMs(ms) / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 字节格式化：1024 进制、`B` 取整、其余保留一位小数（`244.3 MB`）。非正值给 `0 B`。 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= KB && i < units.length - 1) {
    v /= KB
    i++
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${units[i]}`
}

/**
 * 下载进度分数，夹到 `[0,1]`。
 * **总大小未知（非有限或 <= 0）时返回 `null`**，界面据此走"只报已下载字节"的不确定形态 ——
 * 拿 0% 冒充一个未知进度是在骗用户（他会以为卡住了）。
 */
export function progressFrac(received: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(received) || received <= 0) return 0
  return Math.min(1, received / total)
}

/** live 区保留的句子上限。落盘由 Rust 负责，视图不该被一场长会撑死。 */
export const LIVE_SEGMENT_CAP = 200

/**
 * 累积字幕。规则按优先级：
 * 1. `trim` 后为空 → 丢（ASR 偶发空串，摆一行空文本只会让人以为卡了）；
 * 2. `startMs` 非有限或负数 → 夹到 0；`endMs < startMs` → 抬到 `startMs`（区间不能倒挂）；
 * 3. 已有同 `startMs` 的条目 → **丢新的**。事件是"整句发射"、没有 partial / 修正的概念，
 *    同一时间点再来一条更可能是重复投递；保留先到的才可复现；
 * 4. 按 `startMs` 升序（`Array#sort` 在 ES2019+ 稳定，同起点保持先来后到）；
 * 5. 只保留末尾 `cap` 条。
 *
 * 没有任何一条被收下时**返回原数组本身**（引用不变）：卡里 `segments` 是深比较的响应式值，
 * 每次都新建数组会让"没新句子"也触发一轮渲染。
 */
export function appendSegments(prev: Segment[], incoming: readonly Segment[], cap = LIVE_SEGMENT_CAP): Segment[] {
  const seen = new Set(prev.map((s) => s.startMs))
  const added: Segment[] = []
  for (const raw of incoming) {
    const text = String(raw.text ?? '').trim()
    if (!text) continue
    const startMs = safeMs(raw.startMs)
    if (seen.has(startMs)) continue
    seen.add(startMs)
    added.push({ startMs, endMs: Math.max(startMs, safeMs(raw.endMs)), text })
  }
  if (!added.length) return prev
  const next = [...prev, ...added]
  next.sort((a, b) => a.startMs - b.startMs)
  return next.length > cap ? next.slice(next.length - cap) : next
}

/**
 * 计时状态：`accumulatedMs` 是已经数过的总和，`runSince` 是"当前这一段"的起点
 * （`null` = 正停着）。**已录时长由前端按 `Date.now()` 自己算，不依赖后端** ——
 * 后端只在 stop 时给一次总时长，中间没有任何心跳可跟。
 */
export interface Elapsed {
  accumulatedMs: number
  runSince: number | null
}

/** 已录时长。停着时就是累计值；跑着时是累计值 + 这一段（负数按 0 算，时钟回拨不该倒扣）。 */
export function elapsedOf(state: Elapsed, now: number): number {
  const acc = Number.isFinite(state.accumulatedMs) ? Math.max(0, state.accumulatedMs) : 0
  if (state.runSince === null) return acc
  return acc + Math.max(0, now - state.runSince)
}

/** 开始计时。**重复调用不重开一段**（重复点"继续"不能把已数的时间抹掉）。 */
export function startRun(state: Elapsed, now: number): Elapsed {
  return state.runSince === null ? { accumulatedMs: state.accumulatedMs, runSince: now } : state
}

/** 暂停计时：把当前这一段折进累计值。重复调用幂等（`runSince` 已为 null 时原样返回）。 */
export function pauseRun(state: Elapsed, now: number): Elapsed {
  if (state.runSince === null) return state
  return { accumulatedMs: elapsedOf(state, now), runSince: null }
}

export interface Notice {
  tone: Tone
  text: string
}

/** 网页版的降级文案。卡本体与本函数共用这一句，避免两处文案各改各的。 */
export const DESKTOP_ONLY_HINT = '会议速记仅桌面壳可用（网页版拿不到本机麦克风与系统声音）。'

export interface ControlInput {
  isDesktop: boolean
  model: ModelState
  session: SessionState
  /** `asr_model_status` 里带回来的人话错误（模型加载失败时才有）。 */
  modelError?: string | null
  /** `meeting_start` 被 reject 时后端给的人话（例如"模型还没下载完…"）。 */
  startError?: string | null
}

export interface ControlState {
  canStart: boolean
  canPause: boolean
  canResume: boolean
  canStop: boolean
  canDownload: boolean
  /** 模型状态区那一行短标签。 */
  modelLabel: string
  /** 顶部提示条要显示什么；`null` = 不显示。 */
  notice: Notice | null
  /** 录制呼吸点是否显示。这是全项目**唯一**允许的常驻装饰动画，所以只有一个开关。 */
  pulse: boolean
}

/**
 * 录制状态机：由 (是否桌面, 模型状态, 会话状态) 算出「各按钮是否可用」+「该显示什么提示」。
 *
 * 三条不可让步的规则：
 * - **`ready` 之外一律不能开始**（`missing` / `downloading` / `verifying` / `failed` 都不行），
 *   唯一的例外是后端自己 reject 的人话错误 —— 那由 `startError` 接管提示；
 * - 会话一旦在跑，按钮只看会话（此刻模型状态已经"过了"这道门，再拿它禁用停止是错的）；
 * - 网页版**所有**按钮都不可用，提示只有一句降级文案 —— 不摆假控件。
 */
export function deriveControls(input: ControlInput): ControlState {
  const { isDesktop, model, session } = input
  const recording = session === 'recording'
  const paused = session === 'paused'

  let canDownload = false
  let modelLabel: string
  let notice: Notice | null = null

  switch (model) {
    case 'missing':
      canDownload = true
      modelLabel = '语音模型未下载'
      notice = { tone: 'warn', text: '语音模型还没下载，下载完才能开始速记。' }
      break
    case 'downloading':
      modelLabel = '模型下载中'
      notice = { tone: 'info', text: '语音模型正在下载，完成后会自动校验。' }
      break
    case 'verifying':
      modelLabel = '模型校验中'
      notice = { tone: 'info', text: '语音模型下载完成，正在校验文件。' }
      break
    case 'ready':
      modelLabel = '语音模型就绪'
      break
    case 'failed':
      canDownload = true
      modelLabel = '语音模型不可用'
      notice = { tone: 'error', text: input.modelError || '语音模型加载失败，可以重试下载。' }
      break
  }

  if (!isDesktop) {
    return {
      canStart: false,
      canPause: false,
      canResume: false,
      canStop: false,
      canDownload: false,
      modelLabel,
      notice: { tone: 'info', text: DESKTOP_ONLY_HINT },
      pulse: false,
    }
  }

  return {
    canStart: session === 'idle' && model === 'ready',
    canPause: recording,
    canResume: paused,
    canStop: recording || paused,
    canDownload,
    modelLabel,
    // 刚被 reject 的那次操作优先：用户正看着错误，此时显示"模型下载中"是答非所问
    notice: input.startError ? { tone: 'error', text: input.startError } : notice,
    pulse: recording,
  }
}

export interface StopResult {
  id: string
  transcriptPath: string
  segmentCount: number
  durationMs: number
}

export interface ResultLine {
  text: string
  path: string
  /** 一句都没断出来。界面上要明说，别让人以为"转写稿是空的"是正常的。 */
  empty: boolean
}

/** 停止后那行结果。零句不是错误，但也不是"成功"——直说可能的原因（音源选错最常见）。 */
export function describeResult(r: StopResult): ResultLine {
  const empty = !(r.segmentCount > 0)
  const dur = formatDuration(r.durationMs)
  return {
    text: empty ? `没识别到语音（录了 ${dur}），确认音源和设备选对了` : `${r.segmentCount} 句 · ${dur}`,
    path: r.transcriptPath,
    empty,
  }
}

/** 当前音源该列哪些设备：mic 列输入、system 列输出（枚举错方向就会挑到"扬声器当麦克风"）。 */
export function listDevicesFor(devices: readonly AudioDevice[], source: AudioSource): AudioDevice[] {
  const kind = source === 'mic' ? 'input' : 'output'
  return devices.filter((d) => d.kind === kind)
}

/** 挑默认设备：优先系统标了 `isDefault` 的，其次第一个；一个都没有返回 null。 */
export function pickDevice(devices: readonly AudioDevice[], source: AudioSource): AudioDevice | null {
  const list = listDevicesFor(devices, source)
  return list.find((d) => d.isDefault) ?? list[0] ?? null
}

/** 设备显示名。默认设备用**文字后缀**标出来，不靠颜色（状态双编码）。 */
export function deviceLabel(d: AudioDevice): string {
  return d.isDefault ? `${d.name}（默认）` : d.name
}
