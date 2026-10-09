<script setup lang="ts">
/**
 * 呼吸计时：按节奏引导吸气 / 屏住 / 呼气。
 *
 * 和间歇计时一样，**状态不自己推进**：`breathView` 只把"已经跑了多久"映射成"第几拍、第几秒"，
 * 而已跑量来自 `startedAt` 时间戳。所以后台标签页被节流、或用户切走十分钟再回来，
 * 拍子仍然对得上 —— 一个靠 `setInterval` 自增的呼吸节奏器最容易在这里出错。
 *
 * 三个预设：方箱 4-4-4-4（提神）、助眠 4-7-8（睡前）、平缓 4-6（日常）。
 * 动效受 `prefers-reduced-motion` 约束由全局样式处理，这里只用 inline-size 驱动，不用动画库。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { breathComplete, breathCycleSeconds, breathPatternById, breathTotalMs, breathView, BREATH_PATTERNS } from '@levango7/engine/timer'
import { Pause, Play, RotateCcw } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(Date.now())
// 200ms 一跳：这个圆是连续动效，250ms 以上能看出"顿"一下；再密只是白耗电
const tick = window.setInterval(() => (now.value = Date.now()), 200)
onBeforeUnmount(() => window.clearInterval(tick))

const store = computed(() => cards.state.timers.breath)
const pattern = computed(() => breathPatternById(store.value.patternId))
const run = computed(() => ({ running: store.value.startedAt !== null, startedAt: store.value.startedAt, accumulatedMs: store.value.accumulatedMs }))
const view = computed(() => breathView(run.value, pattern.value, now.value))
const running = computed(() => run.value.running)
const finished = computed(() => breathComplete(run.value, pattern.value, now.value))

/** 吸气放大、呼气缩小：方块取"这一拍已过 / 这拍多长"的三角波，不用 CSS 动画 */
const scale = computed(() => {
  if (!running.value) return 1
  const half = 0.5
  const r = view.value.ratio
  const tri = view.value.kind === 'exhale' || view.value.kind === 'rest' ? 1 - r : r
  return (1 - half) + half * (tri < 0 ? 0 : tri > 1 ? 1 : tri)
})
</script>

<template>
  <div class="card breath" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">呼吸计时</span>
        <span class="round">{{ view.round }} / {{ view.roundCount }} 轮</span>
      </div>

      <div class="orb-wrap">
        <div class="orb" :data-kind="view.kind" :style="{ transform: `scale(${scale.toFixed(3)})` }" aria-hidden="true" />
        <div class="readout">
          <span class="pname">{{ finished ? '做完了' : view.label }}</span>
          <span class="psec">{{ view.seconds - view.second }}<template v-if="!finished">s</template></span>
        </div>
      </div>

      <p class="cap">
        {{ pattern.label }} · 一轮 {{ breathCycleSeconds(pattern) }} 秒 × {{ pattern.rounds }}
        <template v-if="finished"> · 共 {{ Math.round(breathTotalMs(pattern) / 60_000) || 1 }} 分钟内完成</template>
      </p>

      <div class="acts">
        <button class="primary" :aria-label="running ? '暂停' : '开始'" @click="running ? cards.timerPause('breath') : cards.timerStart('breath')">
          <Pause v-if="running" :size="12" />
          <Play v-else :size="12" />
          {{ running ? '暂停' : finished ? '再来一轮' : '开始' }}
        </button>
        <button class="rst" aria-label="复位" @click="cards.timerReset('breath')"><RotateCcw :size="11" /></button>
      </div>

      <div v-if="variant === 'panel'" class="pats">
        <button
          v-for="p in BREATH_PATTERNS"
          :key="p.id"
          class="pb"
          :data-on="p.id === pattern.id"
          :aria-pressed="p.id === pattern.id"
          @click="cards.setBreathPattern(p.id)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.breath .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
  text-align: center;
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  inline-size: 100%;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.round {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.orb-wrap {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: min(100%, 22cqw);
  aspect-ratio: 1;
  margin-block: 2px;
}
.orb {
  position: absolute;
  inline-size: 100%;
  block-size: 100%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 28%, transparent);
  border: 1px solid color-mix(in srgb, var(--mod, var(--brand-500)) 45%, transparent);
  /* 只让 transform 走合成层，不重排不重绘 */
  will-change: transform;
}
.breath[data-v='panel'] .orb {
  transition: transform 120ms linear;
}
.readout {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.pname {
  font-size: clamp(12px, 3.6cqw, 16px);
  color: var(--text-1);
}
.psec {
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
.acts {
  display: flex;
  align-items: center;
  gap: 4px;
}
.acts .primary,
.acts .rst {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 2px 9px;
}
.acts .primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
.pats {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
}
.pb {
  font-size: clamp(11px, 2cqw, 11px);
  padding: 1px 5px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
  white-space: nowrap;
}
.pb[data-on='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
</style>