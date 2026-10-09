<script setup lang="ts">
/**
 * 空气质量（open-meteo air-quality）：AQI + PM2.5 / PM10。
 * **城市跟着天气卡走**（读 `modulo.weather.v1` 的 cityId）—— 用户已经选过城市，再问一遍是骚扰；
 * `freshKey` 让"天气卡换了城市"这事件立刻触发重查，而不是等缓存过期。
 */
import { computed, inject, onMounted } from 'vue'
import { airUrl, aqiLevel, parseAir } from '@levango7/engine/air'
import { cityById } from '@levango7/engine/weather'
import { RefreshCw } from 'lucide-vue-next'
import { useRemote } from '../../vue/useRemote'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()
const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }

function weatherCityId(): string {
  try {
    const raw = JSON.parse(storage.get('modulo.weather.v1') ?? '') as { cityId?: unknown }
    return typeof raw?.cityId === 'string' ? raw.cityId : 'shanghai'
  } catch {
    return 'shanghai'
  }
}

const air = useRemote(storage, {
  key: 'modulo.air.v1',
  url: () => airUrl(cityById(weatherCityId())),
  parse: parseAir,
  ttlMs: 30 * 60 * 1000,
  freshKey: weatherCityId,
})
onMounted(() => air.ensureFresh())

const cityName = computed(() => cityById(weatherCityId()).name)
const level = computed(() => (air.snapshot.value ? aqiLevel(air.snapshot.value.aqi) : null))
</script>

<template>
  <div class="card air" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <span class="place">{{ cityName }} · 空气</span>
        <button class="refresh" :class="{ spinning: air.status.value === 'loading' }" title="立刻刷新" aria-label="刷新空气质量" @click="air.refresh()">
          <RefreshCw :size="13" />
        </button>
      </div>
      <template v-if="air.snapshot.value && level">
        <div class="now">
          <span class="aqi">{{ air.snapshot.value.aqi }}</span>
          <span class="lv" :data-kind="level.kind">{{ level.label }}</span>
        </div>
        <div class="meta">
          <span>PM2.5 {{ air.snapshot.value.pm25 }}</span>
          <span>PM10 {{ air.snapshot.value.pm10 }}</span>
        </div>
        <p class="cap">
          美标 AQI · 城市跟着天气卡
          <template v-if="air.status.value === 'error'"> · 上次没取到（{{ air.message.value }}）</template>
        </p>
      </template>
      <p v-else-if="air.status.value === 'loading'" class="hint">正在取空气质量…</p>
      <p v-else class="hint">取不到（{{ air.message.value || '点右上角刷新' }}）· 城市跟着天气卡</p>
    </div>
  </div>
</template>

<style scoped>
.air .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.place {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.refresh {
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-2);
  cursor: pointer;
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
  gap: clamp(4px, 1.6cqw, 10px);
}
.aqi {
  font-size: clamp(24px, 10cqw, 48px);
  line-height: 1.05;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.lv {
  font-size: clamp(12px, 3cqw, 15px);
  color: var(--text-2);
}
.lv[data-kind='good'] {
  color: var(--c-green, #16a34a);
}
.lv[data-kind='light'] {
  color: var(--c-amber, #d97706);
}
.lv[data-kind='moderate'],
.lv[data-kind='heavy'],
.lv[data-kind='severe'] {
  color: var(--brand-600);
}
.meta {
  display: flex;
  gap: clamp(4px, 2cqw, 14px);
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.6;
}
</style>
