<script setup lang="ts">
/**
 * 会议速记（模块 id `minutes`）：桌面壳里录麦克风 / 系统声音 → 本地语音模型断句 →
 * 实时字幕 + 落盘一份转写稿。网页版**如实降级**（网页拿不到本机麦克风，也起不了
 * Rust 侧的录音会话），不摆一排点了没反应的假控件。
 *
 * ## 三处按实现写、不按 yaml 契约的偏差
 * ① 事件名是 `minutes_segment` / `minutes_error`（**不是** `meeting_*`）；
 * ② `speaker` 恒 null、`speakerNames` 恒空 —— 说话人分离本批**没有数据来源**，
 *    所以整张卡按"没有说话人"处理，不做「标签回填中」这类子状态（没有可等的回填）；
 * ③ `minutes_segment` 的载荷里**没有 sessionId**：本组件只能用"本卡当前有没有在录"
 *    判定这句话归谁。这是事件契约的限制，前端根除不了 —— 停止后立刻开新会话时，
 *    上一场的尾巴句仍可能落进新会话的字幕里。别把它当成前端 bug 去"修"。
 *
 * 已录时长由前端按 `Date.now()` 自己累（后端只在 stop 时给一次总时长，中间没有心跳）。
 * 判据与格式化全在 `src/vue/minutesLive.ts`（可单测），控件外观在
 * `src/vue/components/MinutesRecorder.vue`，这里只负责 IPC 胶水与状态。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { CircleCheck, Mic, TriangleAlert, X } from 'lucide-vue-next'
import { isDesktop } from '../../vue/useShell'
import MinutesRecorder from '../../vue/components/MinutesRecorder.vue'
import {
  appendSegments,
  asModelState,
  deriveControls,
  describeResult,
  elapsedOf,
  formatBytes,
  listDevicesFor,
  pauseRun,
  pickDevice,
  progressFrac,
  startRun,
  type AudioDevice,
  type AudioSource,
  type Elapsed,
  type ModelState,
  type Segment,
  type SessionState,
  type StopResult,
} from '../../vue/minutesLive'

const props = defineProps<{ variant: string; moduleId?: string; chromeless?: boolean }>()

interface ModelStatus {
  state: string
  progress: number
  bytesTotal: number
  error: string | null
}
interface DlProgress {
  state: string
  receivedBytes: number
  totalBytes: number
  id: string
}
interface SegmentEvent {
  text: string
  startMs: number
  endMs: number
}
interface StartResult {
  sessionId: string
}

const compact = computed(() => props.variant === 'compact')

const status = ref<ModelStatus | null>(null)
/** 非 null = 本卡正在下载模型；进度一律取 Channel 的 received/total（见下） */
const dl = ref<DlProgress | null>(null)
const devices = ref<AudioDevice[]>([])
const source = ref<AudioSource>('mic')
const deviceId = ref<string | null>(null)
const sessionId = ref<string | null>(null)
const paused = ref(false)
const run = ref<Elapsed>({ accumulatedMs: 0, runSince: null })
const nowMs = ref(0)
const segments = ref<Segment[]>([])
const liveError = ref('')
const startError = ref('')
const result = ref<StopResult | null>(null)
/** 开始 / 停止是异步 IPC：连点两下会开出两场会话，或者拿同一个 id 停两次 */
const busy = ref(false)
let unSeg: UnlistenFn | null = null
let unErr: UnlistenFn | null = null
let tick: number | null = null

const sessionState = computed<SessionState>(() =>
  sessionId.value === null ? 'idle' : paused.value ? 'paused' : 'recording',
)
/**
 * 模型状态：下载中时以 Channel 每次推的 state 为准（比轮询到的 `status` 新），其余时候看
 * `asr_model_status`。`status.progress` 刻意不用 —— 它是**文件级**粗进度（Rust 侧写的是
 * `(i+1)/模型数`），而 Channel 推的 received/total 精确到当前文件、且是自描述的。
 */
const modelState = computed<ModelState>(() =>
  dl.value ? asModelState(dl.value.state) : asModelState(status.value?.state ?? 'missing'),
)
const ctl = computed(() =>
  deriveControls({
    isDesktop,
    model: modelState.value,
    session: sessionState.value,
    modelError: status.value?.error ?? null,
    startError: startError.value,
  }),
)
/** 设备被拔 / 被占用这类运行时错误也走同一条提示条：它们比模型状态更急 */
const notice = computed(() => (liveError.value ? { tone: 'error' as const, text: liveError.value } : ctl.value.notice))

const elapsed = computed(() => elapsedOf(run.value, nowMs.value))
const dlFrac = computed(() => (dl.value ? progressFrac(dl.value.receivedBytes, dl.value.totalBytes) : null))
const dlText = computed(() => {
  const p = dl.value
  if (!p) return ''
  const frac = dlFrac.value
  // 总大小未知时只报已下载量：不做不确定态的往复动画 —— 全项目的常驻动画只有录制点那一个
  return frac === null
    ? `已下载 ${formatBytes(p.receivedBytes)}`
    : `${formatBytes(p.receivedBytes)} / ${formatBytes(p.totalBytes)} · ${Math.round(frac * 100)}%`
})
const devices4source = computed(() => listDevicesFor(devices.value, source.value))
const resultLine = computed(() => (result.value ? describeResult(result.value) : null))

async function refreshModel(): Promise<void> {
  try {
    status.value = await invoke<ModelStatus>('asr_model_status')
  } catch {
    /* 读不到就沿用上一次的读数；一次读失败不该把界面重置成"未下载" */
  }
}

async function download(): Promise<void> {
  if (dl.value) return
  startError.value = ''
  const ch = new Channel<DlProgress>()
  ch.onmessage = (p) => {
    dl.value = p
  }
  dl.value = { state: 'downloading', receivedBytes: 0, totalBytes: 0, id: '' }
  try {
    // Rust 侧形参是 on_progress，Tauri 按 camelCase 转（同 float_card 的 defaultW 惯例）
    await invoke('asr_model_download', { onProgress: ch })
  } catch (err) {
    status.value = { state: 'failed', progress: 0, bytesTotal: 0, error: String(err) }
  } finally {
    dl.value = null
    await refreshModel()
  }
}

async function loadDevices(): Promise<void> {
  try {
    devices.value = await invoke<AudioDevice[]>('audio_devices')
  } catch {
    devices.value = []
  }
}

/** 切音源后原设备多半不在新列表里（输入/输出是两批），重新挑一次默认设备 */
function syncDevice(): void {
  const stillThere = devices4source.value.some((d) => d.id === deviceId.value)
  if (!stillThere) deviceId.value = pickDevice(devices.value, source.value)?.id ?? null
}
watch(source, () => syncDevice())

async function start(): Promise<void> {
  if (busy.value || sessionId.value) return
  busy.value = true
  startError.value = ''
  liveError.value = ''
  result.value = null
  segments.value = []
  try {
    const r = await invoke<StartResult>('meeting_start', {
      deviceId: deviceId.value ?? undefined,
      source: source.value,
    })
    sessionId.value = r.sessionId
    paused.value = false
    const at = Date.now()
    nowMs.value = at
    run.value = startRun({ accumulatedMs: 0, runSince: null }, at)
  } catch (err) {
    // 模型没就绪时后端直接 reject，那句话是给人看的 —— 原样接住，不自己编一条
    startError.value = String(err)
    await refreshModel()
  } finally {
    busy.value = false
  }
}

async function pause(): Promise<void> {
  const id = sessionId.value
  if (!id || paused.value) return
  try {
    await invoke('meeting_pause', { sessionId: id })
  } catch (err) {
    liveError.value = String(err)
    return
  }
  paused.value = true
  run.value = pauseRun(run.value, Date.now())
}

async function resume(): Promise<void> {
  const id = sessionId.value
  if (!id || !paused.value) return
  try {
    await invoke('meeting_resume', { sessionId: id })
  } catch (err) {
    liveError.value = String(err)
    return
  }
  const at = Date.now()
  nowMs.value = at
  paused.value = false
  run.value = startRun(run.value, at)
}

async function stop(): Promise<void> {
  const id = sessionId.value
  if (!id || busy.value) return
  busy.value = true
  try {
    result.value = await invoke<StopResult>('meeting_stop', { sessionId: id })
  } catch (err) {
    liveError.value = String(err)
  } finally {
    // 不论后端怎么说，本地这一场到此为止：会话 id 不能留着重用
    sessionId.value = null
    paused.value = false
    run.value = { accumulatedMs: 0, runSince: null }
    busy.value = false
  }
}

onMounted(async () => {
  if (!isDesktop) return
  await refreshModel()
  await loadDevices()
  syncDevice()
  unSeg = await listen<SegmentEvent>('minutes_segment', (e) => {
    // 载荷不带 sessionId：只能按"本卡当前有没有在录"判定归属。
    // 暂停中的尾巴句也算这一场 —— 丢掉一句真实的转写比收进下一场更糟。
    if (!sessionId.value) return
    segments.value = appendSegments(segments.value, [e.payload])
  })
  unErr = await listen<string>('minutes_error', (e) => {
    liveError.value = String(e.payload)
  })
})
onBeforeUnmount(() => {
  unSeg?.()
  unErr?.()
  unSeg = null
  unErr = null
  if (tick !== null) window.clearInterval(tick)
})

// 计时器只在录制/暂停期间跑：不录的时候让它空转只是白烧电
watch(sessionState, (s) => {
  if (s === 'idle') {
    if (tick !== null) window.clearInterval(tick)
    tick = null
    return
  }
  if (tick === null) tick = window.setInterval(() => (nowMs.value = Date.now()), 500)
})
</script>

<template>
  <div class="card minutes" :data-v="variant">
    <div v-if="!chromeless" class="card-head">
      <Mic :size="14" />
      <span>会议速记</span>
    </div>
    <div class="card-body">
      <p v-if="notice" class="notice" :data-tone="notice.tone" :role="notice.tone === 'error' ? 'alert' : 'status'">
        <TriangleAlert v-if="notice.tone !== 'info'" :size="14" />
        <CircleCheck v-else :size="14" />
        <span class="ntx">{{ notice.text }}</span>
        <button v-if="liveError" class="x" aria-label="关闭提示" @click="liveError = ''"><X :size="12" /></button>
      </p>

      <MinutesRecorder
        v-if="isDesktop"
        :compact="compact"
        :session="sessionState"
        :step="ctl"
        :model-state="modelState"
        :elapsed-ms="elapsed"
        :dl-frac="dlFrac"
        :dl-text="dlText"
        :busy="busy"
        :source="source"
        :device-id="deviceId"
        :source-devices="devices4source"
        :segments="segments"
        :result-line="resultLine"
        @pick-source="source = $event"
        @pick-device="deviceId = $event"
        @download="download"
        @start="start"
        @pause="pause"
        @resume="resume"
        @stop="stop"
      />
    </div>
  </div>
</template>

<style scoped>
.minutes .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(4px, 1.4cqw, 10px);
  padding: clamp(8px, 2.2cqw, 16px);
  overflow: hidden;
}
/* 语气用背景淡染 + 图标两个通道一起表达，不做彩色左边框（设计 §0.4 明文禁的那条） */
.notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
}
.notice[data-tone='info'] {
  background: var(--bg-card-soft);
}
.notice[data-tone='warn'] {
  background: color-mix(in srgb, var(--c-amber) 14%, transparent);
}
.notice[data-tone='error'] {
  background: color-mix(in srgb, var(--c-red) 14%, transparent);
}
.notice[data-tone='info'] svg {
  color: var(--brand-500);
}
.notice[data-tone='warn'] svg {
  color: var(--c-amber);
}
.notice[data-tone='error'] svg {
  color: var(--c-red);
}
.notice svg {
  flex: none;
  margin-block-start: 1px;
}
.ntx {
  flex: 1 1 auto;
  min-width: 0;
}
.x {
  flex: none;
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-2);
}
</style>
