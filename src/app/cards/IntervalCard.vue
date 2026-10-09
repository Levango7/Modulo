<script setup lang="ts">
/**
 * 间歇计时：专注一段、休息一段，自动切段并计数。
 *
 * **这就是番茄工作法的一般形式** —— 所以"番茄 25/5"是这张卡里的一个**预设**，
 * 不是一张单独的卡。给一套预设值单独发一张卡，卡片的功能承诺就超过了它保证的范围：
 * 用户会以为它默认 25/5、能数番茄、四个一循环，而这些都不该由一张工作台卡片来担保。
 * 要 50/10、90/15 也是改预设，不是再加一张卡。
 *
 * 到点即切段（`intervalView` 里做的），钟归零不累计 —— 否则"专注 25 分钟"会显示 50 分钟。
 */
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { INTERVAL_PRESETS, intervalPresetById, intervalView, PHASE_LABELS, progress } from '@levango7/engine/timer'
import { Coffee, Pause, Play, RotateCcw, Target } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => window.clearInterval(tick))

const store = computed(() => cards.state.timers.interval)
const preset = computed(() => intervalPresetById(store.value.presetId))
const run = computed(() => ({ running: store.value.startedAt !== null, startedAt: store.value.startedAt, accumulatedMs: store.value.accumulatedMs }))
const view = computed(() => intervalView(run.value, { completedFocus: store.value.completedFocus, phaseIndex: store.value.phaseIndex }, preset.value, now.value))
const running = computed(() => run.value.running)
const pct = computed(() => Math.round(progress(run.value, view.value.durationMs, now.value) * 100))

/**
 * `intervalView` 是**纯计算**：到点了它返回下一段，但不会替你写状态。
 * 这里把算出来的相位与轮次写回去 —— 否则用户暂停再继续时会弹回上一段。
 * 只在"确实变了"时写，避免每秒都往存储里塞一次同样的值。
 */
watch(
  () => view.value.state,
  (s) => {
    if (s.phaseIndex !== store.value.phaseIndex || s.completedFocus !== store.value.completedFocus) {
      cards.setIntervalPhase(s.phaseIndex, s.completedFocus)
    }
  },
)

const round = computed(() => view.value.round)
</script>

<template>
  <div class="card interval" :data-v="variant" :data-phase="view.phase">
    <div class="card-body">
      <div class="top">
        <span class="label">间歇计时</span>
        <span class="round">{{ round.done }} / {{ round.target }} 轮</span>
      </div>

      <div class="phase">
        <Target v-if="view.phase === 'focus'" class="ico" :size="13" />
        <Coffee v-else class="ico" :size="13" />
        <span class="pname">{{ PHASE_LABELS[view.phase] }}</span>
        <span class="prem">剩 {{ Math.ceil((view.durationMs - view.elapsed) / 60_000) }} 分</span>
      </div>

      <div class="bar" role="img" :aria-label="`本段进度 ${pct}%`">
        <span class="fill" :style="{ inlineSize: `${pct}%` }" />
      </div>

      <div class="acts">
        <button class="primary" :aria-label="running ? '暂停' : '开始'" @click="running ? cards.timerPause('interval') : cards.timerStart('interval')">
          <Pause v-if="running" :size="12" />
          <Play v-else :size="12" />
          {{ running ? '暂停' : view.phase === 'focus' ? '开始专注' : '开始休息' }}
        </button>
        <button class="rst" aria-label="清零" @click="cards.timerReset('interval')"><RotateCcw :size="11" /></button>
      </div>

      <div v-if="variant === 'panel'" class="presets">
        <button
          v-for="p in INTERVAL_PRESETS"
          :key="p.id"
          class="pb"
          :data-on="p.id === preset.id"
          :aria-pressed="p.id === preset.id"
          :title="`专注 ${p.focusMin} 分 / 短休 ${p.breakMin} 分 / 每 ${p.longEvery} 段长休 ${p.longBreakMin} 分`"
          @click="cards.setIntervalPreset(p.id)"
        >
          {{ p.label }}
        </button>
      </div>
      <p v-else class="cap">{{ preset.label }} · {{ preset.focusMin }}/{{ preset.breakMin }}</p>
    </div>
  </div>
</template>

<style scoped>
.interval .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.round {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.phase {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.ico {
  color: var(--mod, var(--brand-500));
  align-self: center;
}
.pname {
  font-size: clamp(15px, 5.4cqw, 24px);
  color: var(--text-1);
  line-height: 1.2;
}
.prem {
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bar {
  block-size: 5px;
  border-radius: 3px;
  background: var(--border-soft);
  overflow: hidden;
}
.fill {
  display: block;
  block-size: 100%;
  background: var(--mod, var(--brand-500));
}
.interval[data-phase='break'] .ico,
.interval[data-phase='longBreak'] .ico {
  color: var(--c-green, var(--brand-500));
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
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
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
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
</style>