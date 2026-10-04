<script setup lang="ts">
/**
 * 秒表：从按下开始往上数。
 *
 * 时间不靠 `setInterval` 累加，而是存"从哪个时刻开始的"（`timers.stopwatch.startedAt`），
 * 显示时才用 `now - startedAt` 算差。**后台标签页被节流到一分钟一次也不会少记时间** ——
 * 这是这张卡唯一真正重要的实现细节。
 *
 * `setInterval` 在这里只负责"重绘"，不负责计时。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { elapsedMs, formatClock, formatDurationShort } from '@modulo/engine/timer'
import { Pause, Play, RotateCcw, Timer } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => window.clearInterval(tick))

/** 持久化的存形状与引擎的 RunState 同构，只差 `running` 是从 `startedAt` 推出来的 */
const run = computed(() => {
  const t = cards.state.timers.stopwatch
  return { running: t.startedAt !== null, startedAt: t.startedAt, accumulatedMs: t.accumulatedMs }
})
const ms = computed(() => elapsedMs(run.value, now.value))
const running = computed(() => run.value.running)
</script>

<template>
  <div class="card stopwatch" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">秒表</span>
        <span v-if="running" class="live">走时中</span>
      </div>

      <div class="num" :data-live="running">{{ formatClock(ms, true) }}</div>
      <p v-if="variant === 'panel'" class="cap">
        {{ formatDurationShort(ms) }}<template v-if="running"> · 从 {{ new Date(run.startedAt ?? 0).toLocaleTimeString('zh-CN', { hour12: false }) }} 起</template>
      </p>

      <div class="acts">
        <button class="primary" :aria-label="running ? '暂停' : '开始'" @click="running ? cards.timerPause('stopwatch') : cards.timerStart('stopwatch')">
          <Pause v-if="running" :size="12" />
          <Play v-else :size="12" />
          {{ running ? '暂停' : '开始' }}
        </button>
        <button v-if="ms > 0 || running" class="rst" aria-label="复位" @click="cards.timerReset('stopwatch')">
          <RotateCcw :size="11" /> 复位
        </button>
        <span v-else class="hint"><Timer :size="11" /> 按「开始」就往上数</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stopwatch .card-body {
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
.live {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--mod, var(--brand-500));
}
.live::before {
  content: '';
  display: inline-block;
  inline-size: 5px;
  block-size: 5px;
  margin-inline-end: 3px;
  border-radius: 50%;
  background: currentColor;
  vertical-align: middle;
}
.num {
  font-size: clamp(20px, 8cqw, 36px);
  line-height: 1.05;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
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
  flex-wrap: wrap;
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
.hint {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
</style>