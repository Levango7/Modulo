/**
 * 天气卡的网络与缓存。收窄响应是 `@modulo/engine/weather` 的纯函数，这里只管三件事：
 * 发请求、存缓存、把状态摆出来。
 *
 * 与"版本检查"同一套克制，但有一处必须说清楚的不同：**天气卡本身就是网络部件** ——
 * 它显示的东西只可能来自网络。所以口径是：
 * - 卡片在版面上**第一次渲染**时才查（把卡加进来 = 用户明确要它）；
 * - **30 分钟内不重复查**，数据上永远带"多久之前更新"的时间戳；
 * - 想立刻刷就点卡片上那枚刷新；换城市立即查一次。
 * 不在启动时查，也不在版面上没有这张卡时发任何请求。
 *
 * 取不到不是"坏"：保留上一份数据（时间戳会如实变旧），界面据此提示 —— 一份不显示新鲜度的
 * 天气数据比没有更糟（用户会以为窗外就是那样）。
 */

import { ref } from 'vue'
import { DEFAULT_CITY_ID, WEATHER_CITIES, cityById, parseWeather, weatherUrl, type WeatherSnapshot } from '@modulo/engine/weather'
import type { StorageAdapter } from './store'

const KEY = 'modulo.weather.v1'
const TTL_MS = 30 * 60 * 1000
const TIMEOUT_MS = 8000

interface Cached {
  cityId: string
  snapshot: WeatherSnapshot | null
}

export function useWeather(storage: StorageAdapter = { get: () => null, set: () => {} }) {
  const cached = ((): Cached => {
    try {
      const raw = JSON.parse(storage.get(KEY) ?? '') as Partial<Cached>
      if (typeof raw?.cityId === 'string') {
        return { cityId: cityById(raw.cityId).id, snapshot: (raw.snapshot as WeatherSnapshot | null) ?? null }
      }
    } catch {
      /* 坏缓存当没有 */
    }
    return { cityId: DEFAULT_CITY_ID, snapshot: null }
  })()

  const cityId = ref(cached.cityId)
  const snapshot = ref<WeatherSnapshot | null>(cached.snapshot)
  const status = ref<'idle' | 'loading' | 'error'>('idle')
  const message = ref('')

  function persist(): void {
    storage.set(KEY, JSON.stringify({ cityId: cityId.value, snapshot: snapshot.value }))
  }

  async function load(): Promise<void> {
    const city = cityById(cityId.value)
    status.value = 'loading'
    message.value = ''
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(weatherUrl(city), { signal: ctrl.signal })
      if (!res.ok) throw new Error(`接口返回 ${res.status}`)
      const parsed = parseWeather(await res.json(), city.name, Date.now())
      if (!parsed) throw new Error('响应形状不认识')
      snapshot.value = parsed
      status.value = 'idle'
      persist()
    } catch (err) {
      status.value = 'error'
      // 网络失败/超时/形状不对都是常态（离线、接口抽风）。说清哪一种，别弹一个红叉就完事。
      message.value = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 卡片挂载时调：缓存还新鲜就什么都不做（30 分钟内不重复查） */
  function ensureFresh(now = Date.now()): void {
    if (snapshot.value && now - snapshot.value.fetchedAt < TTL_MS) return
    void load()
  }

  function refresh(): void {
    void load()
  }

  function setCity(id: string): void {
    if (id === cityId.value) return
    cityId.value = cityById(id).id
    persist()
    void load()
  }

  return { cityId, snapshot, status, message, ensureFresh, refresh, setCity, cities: WEATHER_CITIES }
}

export type WeatherApi = ReturnType<typeof useWeather>
