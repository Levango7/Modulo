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

  /**
   * 请求序号。**没有它就会张冠李戴**：连换两次城市时两个请求同时在飞，
   * 谁后回来谁写进 `snapshot` —— 而 `cityId` 早就是第二次那个了。
   * 于是界面会出现「标题写着上海、内容却是北京」，而且状态码也可能是先发那个留下的。
   * 过期响应直接丢掉：它已经不代表用户当前的意图了。
   */
  let seq = 0

  function persist(): void {
    storage.set(KEY, JSON.stringify({ cityId: cityId.value, snapshot: snapshot.value }))
  }

  async function load(): Promise<void> {
    const city = cityById(cityId.value)
    const mine = ++seq
    status.value = 'loading'
    message.value = ''
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(weatherUrl(city), { signal: ctrl.signal })
      if (!res.ok) throw new Error(`接口返回 ${res.status}`)
      const parsed = parseWeather(await res.json(), city.name, Date.now())
      if (!parsed) throw new Error('响应形状不认识')
      if (mine !== seq) return // 期间又换了城市：这次的结果已经过期
      snapshot.value = parsed
      status.value = 'idle'
      persist()
    } catch (err) {
      if (mine !== seq) return
      status.value = 'error'
      // 网络失败/超时/形状不对都是常态（离线、接口抽风）。说清哪一种，别弹一个红叉就完事。
      message.value = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 卡片挂载时调。两个条件都满足才什么都不做：缓存新鲜，**且这份数据就是当前选中的城市**。
   * 少后面那半个条件会留一个坑：换城市那次请求失败后，留着的是上一个城市的数据且它是新鲜的，
   * 于是接下来 30 分钟里每次挂载都直接 return —— 新城市要等 TTL 过期才会再试一次。
   */
  function ensureFresh(now = Date.now()): void {
    const s = snapshot.value
    if (s && s.place === cityById(cityId.value).name && now - s.fetchedAt < TTL_MS) return
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
