<script setup lang="ts">
/**
 * 会议规划器：一个本地时间，换算成每个参会城市当地几点、该不该这个点开。
 *
 * 算术全在 `@modulo/engine/meeting`（偏移与星期几都交给 Intl，不手写时区表）。
 * 卡只做两件事：画出对照表，以及在顶部给一句总评 —— 让人不必自己扫六行才知道"纽约那边是凌晨"。
 *
 * **只存"我说几点开"**，不存各城几点：后者是算出来的，存下来就会与夏令时变更对不上。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import {
  formatDuration,
  localOffsetMinutes,
  meetingAdvice,
  meetingCityById,
  meetingSlots,
  minutesUntil,
  worstSlot,
  WORLD_CITIES,
} from '@modulo/engine/meeting'
import { Users } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const localOff = computed(() => localOffsetMinutes(now.value))
const localDate = computed(() => {
  const d = now.value
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

/** 会议时刻：把"本地墙上时间"落成一个绝对瞬间，交给引擎去各时区换算 */
const at = computed(() => {
  const [h, m] = cards.state.meeting.at.split(':').map(Number)
  const d = new Date(now.value)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), (h || 0) % 24, m || 0, 0, 0)
})

const slots = computed(() =>
  meetingSlots(
    cards.state.meeting.cityIds.map(meetingCityById).filter((c): c is NonNullable<typeof c> => c !== null),
    at.value,
    localOff.value,
    localDate.value,
  ),
)
const worst = computed(() => worstSlot(slots.value))
const advice = computed(() => meetingAdvice(worst.value))
/** 我自己那一行：本地不用换算，但也要给"还有多久开会" */
const countdown = computed(() => minutesUntil(cards.state.meeting.at, now.value))

function shiftTime(deltaMin: number): void {
  const [h, m] = cards.state.meeting.at.split(':').map(Number)
  const total = (((h || 0) * 60 + (m || 0) + deltaMin) % 1440 + 1440) % 1440
  cards.setMeetingTime(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`, cards.state.meeting.minutes)
}
</script>

<template>
  <div class="card meeting" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">{{ cards.state.meeting.title || '会议规划' }}</span>
        <span v-if="countdown !== null" class="cd">{{ countdown >= 0 ? `${formatDuration(countdown)}后` : `${formatDuration(-countdown)}前` }}</span>
      </div>

      <div class="when">
        <button class="step" aria-label="提前一小时" @click="shiftTime(-60)">−</button>
        <input
          class="hhmm"
          type="time"
          step="300"
          aria-label="会议时间（本地）"
          :value="cards.state.meeting.at"
          @input="cards.setMeetingTime(($event.target as HTMLInputElement).value, cards.state.meeting.minutes)"
        />
        <button class="step" aria-label="推后一小时" @click="shiftTime(60)">+</button>
        <span class="dur">{{ formatDuration(cards.state.meeting.minutes) }}</span>
      </div>

      <p v-if="slots.length" class="advice" :data-bad="worst?.info.verdict === 'sleep' || worst?.info.verdict === 'weekend'">
        {{ advice }}
      </p>

      <ul v-if="slots.length" class="rows">
        <li v-for="s in slots" :key="s.city.id" :data-v="s.info.verdict">
          <span class="cn">{{ s.city.name }}</span>
          <span class="ch">
            {{ s.hhmm }}
            <template v-if="s.otherDay"><em class="day">周{{ s.weekdayLabel }}</em></template>
          </span>
          <span class="cv">{{ s.info.label }}</span>
          <span class="cr">{{ s.relative }}</span>
        </li>
      </ul>
      <p v-else class="hint"><Users :size="12" /> 下面挑参会城市</p>

      <div v-if="variant === 'panel'" class="cities">
        <button
          v-for="c in WORLD_CITIES"
          :key="c.id"
          class="cb"
          :data-on="cards.state.meeting.cityIds.includes(c.id)"
          :aria-pressed="cards.state.meeting.cityIds.includes(c.id)"
          @click="cards.toggleMeetingCity(c.id)"
        >
          {{ c.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.meeting .card-body {
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
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cd {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.when {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.step {
  flex: 0 0 auto;
  inline-size: 1.6em;
  padding: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-3);
}
.step:hover,
.step:focus-visible {
  color: var(--text-1);
}
.hhmm {
  flex: 0 0 auto;
  font-size: clamp(15px, 5cqw, 24px);
  padding: 0 2px;
  background: transparent;
  border: none;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.dur {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
}
.advice {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
}
.advice[data-bad='true'] {
  color: var(--c-amber, var(--text-1));
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: clamp(1px, 0.6cqw, 4px);
}
.rows li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.cn {
  flex: 0 0 auto;
  min-inline-size: 4.5em;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ch {
  flex: 0 0 auto;
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rows li[data-v='sleep'] .ch,
.rows li[data-v='weekend'] .ch {
  color: var(--c-amber, var(--text-3));
}
.day {
  font-style: normal;
  font-size: 0.85em;
  color: var(--text-3);
}
.cv {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cr {
  flex: 0 0 auto;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hint {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
}
.cities {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-block-start: 2px;
}
.cb {
  font-size: clamp(11px, 2cqw, 11px);
  padding: 1px 6px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
}
.cb[data-on='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
</style>
