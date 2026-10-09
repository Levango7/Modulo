<script setup lang="ts">
/**
 * 天气卡：当前温度 / 天气 / 今天高低温 / 日出日落，`card` 形态再带明天起三天的预报。
 *
 * 它与其他卡最大的不同是**内容来自网络**，所以界面上必须永远能回答"这份数据是什么时候的"：
 * 右上角有刷新、底部有相对时间戳；取不到时保留上一份并注明"上次没取到"。
 * 网络与缓存的口径在 `useWeather.ts` 里写着（首次渲染才查、30 分钟 TTL、换城市立即查）。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { cityById, dayLabel, formatTemp, freshness, weatherKind, weatherText } from '@levango7/engine/weather'
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, HelpCircle, RefreshCw, Sun } from 'lucide-vue-next'
import { useWeather } from '../../vue/useWeather'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()
const weather = useWeather(inject<StorageAdapter>('storage') ?? undefined)
onMounted(() => weather.ensureFresh())

/** 相对时间要自己走字，否则"刚刚更新"会一直停在屏幕上 */
const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

/** WMO 大类 → 图标。引擎只给语义（`WeatherKind`），图标是界面的事 */
const ICONS = { clear: Sun, partly: CloudSun, cloudy: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning, unknown: HelpCircle } as const

const s = computed(() => weather.snapshot.value)
const kind = computed(() => (s.value ? weatherKind(s.value.code) : 'unknown'))
const icon = computed(() => ICONS[kind.value])
/**
 * 显示的必须是**数据自己的城市**（`snapshot.place`），不是"当前选中的城市"。
 * 两者在换城市请求失败时会不一致 —— 那时留着的是上一个城市的数据，
 * 若按 `cityId` 显示就成了「标题写着上海、内容却是北京」，而它连一句提示都没有。
 * 数据知道自己属于谁，就用它自己说的；不一致时下面那行脚注会如实写出来。
 */
const place = computed(() => s.value?.place ?? cityById(weather.cityId.value).name)
const stale = computed(() => weather.status.value === 'error' && !!s.value)
/** 选了 A、显示的还是 B —— 这时候"新鲜度"是不能单独看的，必须连城市一起说 */
const mismatch = computed(() => !!s.value && s.value.place !== cityById(weather.cityId.value).name)

function onCity(e: Event): void {
  weather.setCity((e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="card weather" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <select v-if="variant === 'card'" class="place" :value="weather.cityId.value" aria-label="城市" @change="onCity">
          <option v-for="c in weather.cities" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <span v-else class="place static">{{ place }}</span>
        <button class="refresh" :class="{ spinning: weather.status.value === 'loading' }" title="立刻刷新天气" aria-label="刷新天气" @click="weather.refresh()">
          <RefreshCw :size="13" />
        </button>
      </div>

      <template v-if="s">
        <div class="now">
          <component :is="icon" class="ico" />
          <span class="temp">{{ formatTemp(s.temp) }}</span>
          <span class="desc">{{ weatherText(s.code) }}</span>
        </div>
        <div class="meta">
          <span>{{ formatTemp(s.high) }} / {{ formatTemp(s.low) }}</span>
          <span class="sun">日出 {{ s.sunrise }} · 日落 {{ s.sunset }}</span>
        </div>
        <ul v-if="variant === 'card'" class="days">
          <li v-for="d in s.days" :key="d.date">
            <span class="day">{{ dayLabel(d.date) }}</span>
            <span class="range">{{ formatTemp(d.high) }}/{{ formatTemp(d.low) }}</span>
            <span class="what">{{ weatherText(d.code) }}</span>
          </li>
        </ul>
        <p class="foot" :class="{ warn: stale || mismatch }">
          {{ freshness(s.fetchedAt, now) }}<template v-if="stale"> · 上次没取到（{{ weather.message.value }}）</template>
          <template v-if="mismatch"> · 显示的还是{{ s.place }}的数据</template>
        </p>
      </template>
      <p v-else-if="weather.status.value === 'loading'" class="empty">正在取天气…</p>
      <p v-else-if="weather.status.value === 'error'" class="empty">
        取不到天气（{{ weather.message.value }}）<br />
        <span class="hint">点右上角刷新重试</span>
      </p>
      <p v-else class="empty hint">点右上角取一次天气</p>
    </div>
  </div>
</template>

<style scoped>
/* 与其他卡同一套规矩：内容随格子连续缩放（clamp(绝对下限, 容器查询单位, 绝对上限)），
   12 列到 2 列都不裁字；两处挤不下时靠 --x 降级（.days 在 mini 形态本来就不渲染） */
.weather .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 1.2cqw, 8px);
  padding: clamp(8px, 2.2cqw, 20px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.place {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  background: transparent;
  border: none;
  padding: 0;
  max-width: 70%;
}
.place.static {
  font-size: clamp(11px, 2.6cqw, 13px);
}
select.place {
  cursor: pointer;
}
.refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--text-2);
}
.refresh.spinning {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.now {
  display: flex;
  align-items: baseline;
  gap: clamp(4px, 1.4cqw, 10px);
  min-width: 0;
}
.ico {
  align-self: center;
  width: clamp(18px, 6cqw, 34px);
  height: clamp(18px, 6cqw, 34px);
  flex: none;
  color: var(--brand-600);
}
.temp {
  font-size: clamp(22px, 9cqw, 44px);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.desc {
  font-size: clamp(11px, 3cqw, 15px);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: clamp(4px, 2cqw, 14px);
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.days {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(1px, 0.8cqw, 6px);
  font-size: clamp(11px, 2.6cqw, 13px);
}
.days li {
  display: flex;
  align-items: baseline;
  gap: clamp(4px, 2cqw, 12px);
  min-width: 0;
}
.days .day {
  color: var(--text-2);
  flex: none;
}
.days .range {
  font-variant-numeric: tabular-nums;
  flex: none;
}
.days .what {
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.foot {
  margin: auto 0 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-2);
}
.foot.warn {
  color: var(--brand-600);
}
.empty {
  margin: auto 0;
  font-size: clamp(11px, 2.8cqw, 13px);
  color: var(--text-2);
  line-height: 1.6;
}
.hint {
  font-size: clamp(11px, 2.4cqw, 12px);
  opacity: 0.75;
}
</style>
