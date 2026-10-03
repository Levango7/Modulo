/**
 * 天气卡的网络与缓存层（`src/vue/useWeather.ts`）。
 *
 * ## 为什么单独给这一层写测试
 * 引擎那半（`packages/engine/src/weather.ts`）已经有 `tests/engine/weather.test.ts`，
 * 但"发请求 + 存缓存 + 摆状态"这一半此前一条断言都没有 —— 而它恰好是**会出错的那一半**：
 * 网络会失败、响应会迟到、缓存会坏、用户会连着换城市。
 *
 * ## 两条纪律
 * - **判据要能证伪**：每条测试都先造一个"没有这条防护就会挂"的场景，而不是复述实现。
 * - **夹具自带**：`fetch` 与 `storage` 都是现场造的假件，不蹭全局默认、不真发请求。
 *
 * 假 fetch 用**可控的 deferred**：想让两个请求乱序返回，就得能自己决定谁先落地 ——
 * 用 `setTimeout(0)` 赌顺序的测试不是测试，是抽奖。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CITY_ID, WEATHER_CITIES, type WeatherSnapshot } from '@modulo/engine/weather'
import { useWeather } from '../../src/vue/useWeather'
import type { StorageAdapter } from '../../src/vue/store'

/** 上游 open-meteo 的样子长什么样不重要，能被 `parseWeather` 认出来就行 */
function payload(code: number, temp: number): unknown {
  return {
    current: { weather_code: code, temperature_2m: temp },
    daily: {
      time: ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
      weather_code: [code, code, code, code],
      temperature_2m_max: [temp + 2, temp + 1, temp + 3, temp],
      temperature_2m_min: [temp - 4, temp - 5, temp - 3, temp - 2],
      sunrise: ['2026-10-04T06:12', '2026-10-05T06:13', '2026-10-06T06:14', '2026-10-07T06:15'],
      sunset: ['2026-10-04T17:48', '2026-10-05T17:47', '2026-10-06T17:45', '2026-10-07T17:44'],
    },
  }
}

interface Deferred {
  url: string
  settle: () => void
}

/**
 * 假 fetch：每次调用登记一个 deferred，由测试自己决定什么时候、按什么顺序落地。
 * `mode` 决定落地时是成功 / 网络失败 / 响应形状不对——三种都得能造，
 * 因为"取不到"不是一个分支，是三个。
 */
function fakeFetch(mode: 'ok' | 'fail' | 'bad' = 'ok'): { calls: string[]; pending: Deferred[]; mode: 'ok' | 'fail' | 'bad'; impl: typeof fetch } {
  const calls: string[] = []
  const pending: Deferred[] = []
  const box = { mode }
  const impl = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    return new Promise<Response>((resolve, reject) => {
      pending.push({
        url,
        settle: () => {
          if (box.mode === 'fail') reject(new Error('网络失败'))
          else if (box.mode === 'bad') resolve({ ok: true, status: 200, json: async () => ({ nonsense: true }) } as Response)
          else resolve({ ok: true, status: 200, json: async () => payload(0, 21) } as Response)
        },
      })
    })
  }
  return Object.assign({ calls, pending, impl: impl as unknown as typeof fetch }, {
    get mode() {
      return box.mode
    },
    set mode(v: 'ok' | 'fail' | 'bad') {
      box.mode = v
    },
  })
}

/** 假 storage：内存 Map，够用且能断言"到底存没存" */
function fakeStorage(seed?: string): { adapter: StorageAdapter; raw: () => string | null } {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set('modulo.weather.v1', seed)
  return {
    adapter: { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) },
    raw: () => map.get('modulo.weather.v1') ?? null,
  }
}

function snapshotOf(place: string, fetchedAt: number): WeatherSnapshot {
  return { place, temp: 21, code: 0, high: 23, low: 17, sunrise: '06:12', sunset: '17:48', days: [], fetchedAt }
}

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.useRealTimers()
})

/** 让挂起的请求按给定顺序落地，并等微任务队列排干 */
async function settle(order: Deferred[]): Promise<void> {
  for (const d of order) d.settle()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useWeather：缓存与 TTL', () => {
  it('缓存新鲜时不发请求 —— 挂载一张已有的卡不该打一次网络', () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const st = fakeStorage(JSON.stringify({ cityId: 'beijing', snapshot: snapshotOf('北京', Date.now()) }))
    const w = useWeather(st.adapter)

    w.ensureFresh(Date.now())

    expect(f.calls).toHaveLength(0)
    expect(w.snapshot.value?.place).toBe('北京')
  })

  it('缓存过期就查一次', async () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const old = Date.now() - 31 * 60 * 1000
    const w = useWeather(fakeStorage(JSON.stringify({ cityId: 'beijing', snapshot: snapshotOf('北京', old) })).adapter)

    w.ensureFresh(Date.now())
    expect(f.calls).toHaveLength(1)

    await settle(f.pending)
    expect(w.status.value).toBe('idle')
    expect(w.snapshot.value?.place).toBe('北京')
  })

  it('坏缓存当没有，且回落到默认城市', () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage('{ 这不是 JSON').adapter)

    expect(w.cityId.value).toBe(DEFAULT_CITY_ID)
    expect(w.snapshot.value).toBeNull()

    w.ensureFresh(Date.now())
    expect(f.calls).toHaveLength(1) // 没有数据 = 必须查
  })

  it('存档里的城市 id 认不出来时回落到默认，而不是留着一个空壳', () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage(JSON.stringify({ cityId: ' Atlantis ', snapshot: null })).adapter)
    expect(WEATHER_CITIES.some((c) => c.id === w.cityId.value)).toBe(true)
  })
})

describe('useWeather：取不到时保留上一份', () => {
  it('失败不动 snapshot —— 一份旧的真数据比一个红叉有用', async () => {
    const f = fakeFetch('fail')
    globalThis.fetch = f.impl
    const before = snapshotOf('北京', Date.now() - 40 * 60 * 1000)
    const st = fakeStorage(JSON.stringify({ cityId: 'beijing', snapshot: before }))
    const w = useWeather(st.adapter)

    w.refresh()
    await settle(f.pending)

    expect(w.status.value).toBe('error')
    expect(w.message.value).toBe('网络失败')
    expect(w.snapshot.value).toEqual(before) // 没被清空
  })

  it('失败不写缓存 —— 别把失败固化进存档', async () => {
    const f = fakeFetch('fail')
    globalThis.fetch = f.impl
    const st = fakeStorage()
    const w = useWeather(st.adapter)

    w.refresh()
    await settle(f.pending)

    expect(w.status.value).toBe('error')
    expect(st.raw()).toBeNull()
  })

  it('响应形状认不出来时同样走 error，且说清是哪一种', async () => {
    const f = fakeFetch('bad')
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage().adapter)

    w.refresh()
    await settle(f.pending)

    expect(w.status.value).toBe('error')
    expect(w.message.value).toContain('形状')
    expect(w.snapshot.value).toBeNull()
  })
})

describe('useWeather：换城市后的两个坑', () => {
  it('换城市失败后，重新挂载还会再试 —— 不能因为上一份数据新鲜就 30 分钟不吭声', () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const fresh = Date.now() - 1000
    // 存档：选中的是上海，手上却还是北京的新鲜数据（正是"换城市那次失败了"留下的状态）
    const w = useWeather(fakeStorage(JSON.stringify({ cityId: 'shanghai', snapshot: snapshotOf('北京', fresh) })).adapter)

    w.ensureFresh(Date.now())

    // 没有这条判据就会 return，新城市要等 TTL 过期才被想起来
    expect(f.calls).toHaveLength(1)
  })

  it('连换两次城市，先发后到的那次不能覆盖后发的 —— 否则标题上海、内容北京', async () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage().adapter)

    w.setCity('beijing') // 第一次：让它慢
    w.setCity('shanghai') // 第二次：让它先回来

    expect(f.pending).toHaveLength(2)
    const [first, second] = f.pending
    expect(first.url).toContain('39.9') // 北京
    expect(second.url).toContain('31.23') // 上海

    // 故意让后发的先落地、先发的后落地
    await settle([second, first])
    await settle([])

    expect(w.cityId.value).toBe('shanghai')
    expect(w.snapshot.value?.place).toBe('上海') // 过期响应被丢掉了
    expect(w.status.value).toBe('idle')
  })

  it('换城市会立刻查一次，不等 TTL', async () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage(JSON.stringify({ cityId: 'beijing', snapshot: snapshotOf('北京', Date.now()) })).adapter)

    expect(f.calls).toHaveLength(0)
    w.setCity('hangzhou')

    expect(f.calls).toHaveLength(1)
    await settle(f.pending)
    expect(w.snapshot.value?.place).toBe('杭州')
  })

  it('换到同一个城市不重复发请求', () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage().adapter)

    w.setCity('beijing')
    const n = f.calls.length
    w.setCity('beijing')

    expect(f.calls).toHaveLength(n)
  })

  it('先发的那次失败也一样被丢掉 —— 过期的失败不该把状态改回 error', async () => {
    const f = fakeFetch()
    globalThis.fetch = f.impl
    const w = useWeather(fakeStorage().adapter)

    w.setCity('beijing')
    w.setCity('shanghai')

    const [first, second] = f.pending
    f.mode = 'fail'
    first.settle() // 先发的（北京）失败，但它已经过期了
    await Promise.resolve()
    await Promise.resolve()

    expect(w.status.value).toBe('loading') // 还在等上海那次，不该被北京的失败改写成 error

    f.mode = 'ok'
    second.settle()
    await Promise.resolve()
    await Promise.resolve()

    expect(w.status.value).toBe('idle')
    expect(w.snapshot.value?.place).toBe('上海')
  })

  it('抛出来的不是 Error 也能说清（有些环境下的失败是字符串）', async () => {
    globalThis.fetch = (async () => {
      throw 'boom'
    }) as unknown as typeof fetch
    const w = useWeather(fakeStorage().adapter)

    w.refresh()
    await Promise.resolve()
    await Promise.resolve()

    expect(w.status.value).toBe('error')
    expect(w.message.value).toBe('boom')
  })
})
