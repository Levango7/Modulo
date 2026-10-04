<script setup lang="ts">
/**
 * 倒计时：从一个设定时长往下数，到 0 为止。
 *
 * **默认 25 分钟但它不是番茄钟**：这张卡只做"定 N 分钟、到点告诉我"，不做自动切段、
 * 不数轮次、不管长休 —— 那是「间歇计时」那张卡的事。把两件事混在一张卡里，
 * 承诺就超过了它保证的范围（用户会以为默认 25/5、能数番茄）。
 *
 * 时长夹在 1–599 分钟。**到点是 0 而不是负数**。
 */
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { formatClock, formatRemainingText, minutesToMs, remainingMs } from '@modulo/engine/timer'
import { BellRing, Pause, Play, RotateCcw } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => window.clearInterval(tick))

const store = computed(() => cards.state.timers.countdown)
const duration = computed(() => minutesToMs(store.value.minutes))
const run = computed(() => ({ running: store.value.startedAt !== null, startedAt: store.value.startedAt, accumulatedMs: store.value.accumulatedMs }))
const left = computed(() => remainingMs(run.value, duration.value, now.value))
const running = computed(() => run.value.running)
const done = computed(() => running.value && left.value === 0)
/** 到点瞬间把 ringing 置起来，给音效留一个明确的触发点；复位时收掉 */
const ringing = ref(false)
watch(left, (v) => {
  if (v > 0) ringing.value = false
})

const QUICK = [5, 10, 15, 25, 45, 60]

function adjust(delta: number): void {
  cards.setCountdownMinutes(store.value.minutes + delta)
  ringing.value = false
}
</script>

<template>
  <div class="card timer" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">倒计时</span>
        <span v-if="done" class="ring"><BellRing :size="11" /> 时间到</span>
        <span v-else class="mins">{{ store.minutes }} 分</span>
      </div>

      <div class="num" :data-done="done">{{ formatClock(left, duration >= 3_600_000) }}</div>
      <p class="cap">{{ formatRemainingText(left) }}</p>

      <div class="acts">
        <button class="primary" :aria-label="running ? '暂停' : '开始'" @click="running ? cards.timerPause('countdown') : cards.timerStart('countdown')">
          <Pause v-if="running" :size="12" />
          <Play v-else :size="12" />
          {{ running ? '暂停' : '开始' }}
        </button>
        <button class="rst" aria-label="复位" @click="cards.timerReset('countdown')"><RotateCcw :size="11" /></button>
      </div>

      <div class="quick">
        <button v-for="m in QUICK" :key="m" class="qb" :data-on="store.minutes === m" :aria-pressed="store.minutes === m" @click="cards.setCountdownMinutes(m)">
          {{ m }}
        </button>
        <button class="qb adj" aria-label="减 5 分钟" @click="adjust(-5)">−5</button>
        <button class="qb adj" aria-label="加 5 分钟" @click="adjust(5)">+5</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timer .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.mins,
.ring {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ring {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--mod, var(--brand-500));
}
.num {
  font-size: clamp(20px, 8cqw, 36px);
  line-height: 1.05;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.num[data-done='true'] {
  color: var(--mod, var(--brand-500));
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
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
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.qb {
  font-size: clamp(11px, 2cqw, 11px);
  padding: 1px 5px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
  font-variant-numeric: tabular-nums;
}
.qb[data-on='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
.qb.adj {
  color: var(--text-2);
}
</style>