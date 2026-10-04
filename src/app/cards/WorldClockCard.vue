<script setup lang="ts">
/**
 * 世界时钟：几个城市的当前时间与对本地时差。
 *
 * 城市选择是**偏好**，放自己的 key（`modulo.worldclock.v1`）、不进完整备份 —— 与天气的"选哪个城市"
 * 同一口径；用户写的字才进 `cardData`。时区算术全在引擎（`Intl` 是唯一权威，不手写偏移表），
 * 这里只把绝对事实翻成"比本地早/晚几小时"。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import {
  MAX_WORLD_CITIES,
  WORLD_CITIES,
  cityClock,
  relativeLabel,
  sanitizeCityIds,
  worldCityById,
} from '@modulo/engine/worldclock'
import { X } from 'lucide-vue-next'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()
const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }
const KEY = 'modulo.worldclock.v1'

function read(): string[] {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? '') as { ids?: unknown }
    return Array.isArray(raw?.ids) ? (raw.ids as string[]) : []
  } catch {
    /* 坏缓存当没有 */
  }
  return []
}

const ids = ref<string[]>(sanitizeCityIds(read()))
const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 20_000)
onBeforeUnmount(() => window.clearInterval(tick))

/** 本地偏移（分钟）：东八区 = 480。用 `-getTimezoneOffset()`，不去碰可能为空的 resolvedOptions */
const localOffset = computed(() => -now.value.getTimezoneOffset())

const rows = computed(() =>
  ids.value.map((id) => {
    const city = worldCityById(id)!
    const at = cityClock(city, now.value)
    return { id, name: city.name, hhmm: at.hhmm, dateStr: at.dateStr, rel: relativeLabel(at.offsetMin, localOffset.value) }
  }),
)
/** mini 只报第一个城市：尺寸契约里它是 2×2，塞不下清单 */
const shown = computed(() => (props.variant === 'mini' ? rows.value.slice(0, 1) : rows.value))
const candidates = computed(() => WORLD_CITIES.filter((c) => !ids.value.includes(c.id)))
const full = computed(() => ids.value.length >= MAX_WORLD_CITIES)

function persist(): void {
  storage.set(KEY, JSON.stringify({ ids: ids.value }))
}

function addCity(e: Event): void {
  const el = e.target as HTMLSelectElement
  if (!el.value) return
  ids.value = sanitizeCityIds([...ids.value, el.value])
  el.value = ''
  persist()
}

function removeCity(id: string): void {
  ids.value = sanitizeCityIds(ids.value.filter((x) => x !== id))
  persist()
}
</script>

<template>
  <div class="card worldclock" :data-v="variant">
    <div class="card-body">
      <div v-for="r in shown" :key="r.id" class="row">
        <span class="name">{{ r.name }}</span>
        <span class="time">{{ r.hhmm }}</span>
        <span class="rel">{{ r.rel }}</span>
        <button v-if="variant !== 'mini'" class="drop" :title="`不再显示${r.name}`" :aria-label="`不再显示${r.name}`" @click="removeCity(r.id)">
          <X :size="11" />
        </button>
      </div>
      <p v-if="variant === 'mini' && rows.length > 1" class="more">另外 {{ rows.length - 1 }} 个城市在「多城列表」形态里</p>
      <select v-if="variant !== 'mini' && !full && candidates.length" class="adder" aria-label="添加城市" @change="addCity">
        <option value="">＋ 添加城市…</option>
        <option v-for="c in candidates" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <p v-else-if="variant !== 'mini' && full" class="more">最多 {{ MAX_WORLD_CITIES }} 个城市</p>
    </div>
  </div>
</template>

<style scoped>
.worldclock .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 0.9cqw, 7px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: baseline;
  gap: clamp(4px, 1.6cqw, 10px);
  min-width: 0;
}
.name {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  font-size: clamp(14px, 4.4cqw, 22px);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}
.rel {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
}
.drop {
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  opacity: 0.6;
}
.drop:hover,
.drop:focus-visible {
  opacity: 1;
  color: var(--text-1);
}
.adder {
  margin-top: auto;
  align-self: flex-start;
  max-width: 100%;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-2);
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
}
.more {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
}
</style>
