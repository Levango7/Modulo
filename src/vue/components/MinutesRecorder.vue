<script setup lang="ts">
/**
 * 速记的**控制面板**：模型状态 + 下载进度 + 音源/设备 + 录制控制 + 停止结果 + 字幕。
 * 全部是"给什么就画什么"，自己不 invoke、不 listen —— 行数上限把这块从卡本体拆出来了
 * （卡本体只管 IPC 胶水与状态，见 `src/app/cards/MinutesCard.vue`）。
 * 只读的判据（哪个按钮能点、要不要显示呼吸点）一律来自 `minutesLive.ts` 的纯函数结果，
 * 这里**不做第二次判断** —— 两处判断迟早会打起来。
 */
import { computed } from 'vue'
import {
  AudioLines,
  CircleCheck,
  Download,
  LoaderCircle,
  Mic,
  MonitorSpeaker,
  Pause,
  Play,
  RefreshCw,
  Square,
  TriangleAlert,
} from 'lucide-vue-next'
import MinutesTranscript from './MinutesTranscript.vue'
import {
  deviceLabel,
  formatDuration,
  formatSegmentTime,
  type AudioDevice,
  type AudioSource,
  type ControlState,
  type ModelState,
  type ResultLine,
  type Segment,
  type SessionState,
} from '../minutesLive'

const props = defineProps<{
  compact: boolean
  session: SessionState
  step: ControlState
  modelState: ModelState
  elapsedMs: number
  dlFrac: number | null
  dlText: string
  busy: boolean
  source: AudioSource
  deviceId: string | null
  /** 已经按当前音源筛过的设备（筛选口径在 minutesLive 的 listDevicesFor） */
  sourceDevices: AudioDevice[]
  segments: Segment[]
  resultLine: ResultLine | null
}>()

const emit = defineEmits<{
  (e: 'pickSource', source: AudioSource): void
  (e: 'pickDevice', id: string): void
  (e: 'download'): void
  (e: 'start'): void
  (e: 'pause'): void
  (e: 'resume'): void
  (e: 'stop'): void
}>()

const lastLine = computed(() => {
  const s = props.segments[props.segments.length - 1]
  if (s) return `${formatSegmentTime(s.startMs)} ${s.text}`
  return props.session === 'idle' ? '开始后，断出的句子会逐条出现在这里' : '在听，还没断出完整的句子'
})
</script>

<template>
  <div class="model" :data-state="modelState">
    <LoaderCircle v-if="modelState === 'downloading' || modelState === 'verifying'" :size="14" class="ico" />
    <CircleCheck v-else-if="modelState === 'ready'" :size="14" class="ico" />
    <TriangleAlert v-else :size="14" class="ico" />
    <span class="lab">{{ step.modelLabel }}</span>
    <button v-if="step.canDownload" class="mini" :disabled="busy" @click="emit('download')">
      <Download v-if="modelState === 'missing'" :size="12" />
      <RefreshCw v-else :size="12" />
      <span>{{ modelState === 'missing' ? '下载模型' : '重试下载' }}</span>
    </button>
  </div>

  <div v-if="dlFrac !== null || dlText" class="dl">
    <span
      class="track"
      :data-known="dlFrac !== null"
      role="progressbar"
      :aria-valuenow="dlFrac === null ? undefined : Math.round(dlFrac * 100)"
    >
      <i v-if="dlFrac !== null" :style="{ transform: `scaleX(${dlFrac})` }" />
    </span>
    <span class="dlt">{{ dlText }}</span>
  </div>

  <template v-if="!compact">
    <div class="pick" role="group" aria-label="音源">
      <button :aria-pressed="source === 'mic'" @click="emit('pickSource', 'mic')">
        <Mic :size="12" /><span>麦克风</span>
        <span class="mk" aria-hidden="true"><CircleCheck v-if="source === 'mic'" :size="12" /></span>
      </button>
      <button :aria-pressed="source === 'system'" @click="emit('pickSource', 'system')">
        <MonitorSpeaker :size="12" /><span>系统声音</span>
        <span class="mk" aria-hidden="true"><CircleCheck v-if="source === 'system'" :size="12" /></span>
      </button>
    </div>
    <div v-if="sourceDevices.length" class="pick dev" role="group" aria-label="录音设备">
      <button
        v-for="d in sourceDevices"
        :key="d.id"
        :aria-pressed="deviceId === d.id"
        :title="d.name"
        @click="emit('pickDevice', d.id)"
      >
        <span class="mk" aria-hidden="true"><CircleCheck v-if="deviceId === d.id" :size="12" /></span>
        <span class="dname">{{ deviceLabel(d) }}</span>
      </button>
    </div>
    <p v-else class="hint">没读到这个音源下的设备，换个音源或插上设备再试</p>
  </template>

  <div class="ctl">
    <span v-if="session !== 'idle'" class="time">
      <span v-if="step.pulse" class="pulse" aria-hidden="true" />
      已录 {{ formatDuration(elapsedMs) }}
    </span>
    <button v-if="session === 'idle'" class="primary" :disabled="!step.canStart || busy" @click="emit('start')">
      <Mic :size="12" /><span>开始</span>
    </button>
    <button v-if="session === 'recording'" :disabled="!step.canPause" @click="emit('pause')">
      <Pause :size="12" /><span>暂停</span>
    </button>
    <button v-if="session === 'paused'" :disabled="!step.canResume" @click="emit('resume')">
      <Play :size="12" /><span>继续</span>
    </button>
    <button v-if="session !== 'idle'" :disabled="!step.canStop || busy" @click="emit('stop')">
      <Square :size="12" /><span>停止</span>
    </button>
    <span v-if="session === 'idle' && !step.canStart" class="hint">模型就绪后才能开始</span>
  </div>

  <div v-if="resultLine" class="result">
    <span>{{ resultLine.text }}</span>
    <code :title="resultLine.path">{{ resultLine.path }}</code>
  </div>

  <MinutesTranscript v-if="!compact" :segments="segments" :active="session !== 'idle'" />
  <p v-else class="last">
    <AudioLines :size="12" />
    <span>{{ lastLine }}</span>
  </p>
</template>

<style scoped>
.model {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
}
.model[data-state='ready'] .ico {
  color: var(--c-green);
}
.model[data-state='missing'] .ico,
.model[data-state='failed'] .ico {
  color: var(--c-red);
}
.lab {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mini {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.1cqw, 12px);
  padding: 1px 6px;
}
.dl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-2);
}
.track {
  flex: 1 1 auto;
  min-width: 0;
  block-size: clamp(5px, 1.6cqh, 8px);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--border-strong) 45%, transparent);
  overflow: hidden;
}
.track i {
  display: block;
  block-size: 100%;
  inline-size: 100%;
  transform-origin: left center;
  border-radius: inherit;
  background: var(--brand-500);
}
.dlt {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.pick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.pick button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-inline-size: 100%;
  font-size: clamp(11px, 2.2cqw, 12px);
  padding: 1px 8px;
}
/* 选中态：边线 + 文字色 + 字重 + 勾号四个通道。
   不用全局的 `button[data-active]`（那支是 brand-500 底 + #fff 字，暗色皮肤的
   --accent 是浅绿，白字只有 ≈2.6:1）—— 这里取"只染边线与文字"，两个主题都安全。 */
.pick button[aria-pressed='true'] {
  background: var(--bg-card-solid);
  border-color: var(--brand-500);
  color: var(--brand-500);
  font-weight: 500;
}
.mk {
  /* 选中标记的位置常驻（只是内容有没有）：否则一选中整行文字就往右跳一格 */
  flex: none;
  display: inline-flex;
  inline-size: 12px;
  block-size: 12px;
}
.dname {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ctl button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.2cqw, 12px);
  padding: 1px 8px;
}
.primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
.ctl button:disabled {
  opacity: 0.5;
  cursor: default;
}
.time {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: clamp(12px, 2.4cqw, 14px);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}
/* 全项目唯一允许的常驻装饰动画（设计 §0.7 的明文例外）。只动 transform / opacity。 */
.pulse {
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--c-red);
  animation: minutes-pulse 1.4s ease-in-out infinite;
}
@keyframes minutes-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}
.result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
}
.result code {
  /* 11px 是铁律下限（E2E 最小字号）—— 这里原写 clamp(10px, …, 11px) 会掉到 10px，锁死 11 */
  font-size: 11px;
  color: var(--text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  user-select: all;
}
.last {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
}
.last svg {
  flex: none;
  color: var(--brand-500);
}
.last span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
}
</style>
