/**
 * 更新检查这一层（`src/vue/useUpdateCheck.ts`）。
 *
 * ## 为什么单独给这一层写测试
 * 引擎那半（`packages/engine/src/update.ts`）已经有 `tests/engine/update.test.ts`（比版本 /
 * 解析 Release / 进度累加），但**"发请求 + 存缓存 + 摆状态 + 归还后端句柄"这一半此前一条断言
 * 都没有** —— 而它恰好是会出错的那一半：网络会失败、会被网关掐断、缓存会写坏、用户会连着点、
 * 设置页关掉之后后端还握着一个资源。与 `tests/vue/weather.test.ts` 是同一个理由（那一层
 * 当初就是这么补的）。
 *
 * ## 两条纪律
 * - **判据要能证伪**：每条测试先造一个「没有这条防护就会挂 / 就会静默错」的场景，不复述实现。
 * - **夹具自带**：`fetch`、`storage`、`@tauri-apps/plugin-updater` 全是现场假件 ——
 *   不蹭全局默认、不真发请求、不起真进程、不真读 `Date.now()`。
 *
 * ## 桌面端那条路怎么测
 * `desktop` 取自 `useShell` 的 `isDesktop`，插件是 `check()` 里动态 `import()` 进来的 ——
 * 两者都用**可变开关**的假件（下面的 `flags`），用例里翻一下就行。
 *
 * 为什么不是「每个用例 `vi.resetModules()` + 动态 import 重新装一遍」：那版单机跑 18/18 绿，
 * 但**全量套件里 `beforeAll` 预热撞了 10 秒 hook 预算，整文件被判 skipped**（本机还有 Qoder
 * 在抢 CPU）。一次加载 + 翻开关，既快也不吃负载。
 *
 * 同一案发现场的第二个坑：**假定时器底下做第一次动态 import 会卡死** —— `queueMicrotask`
 * 也被假掉，模块加载后面的排队没有人推进。桌面端那条路本来就要翻假定时器（8 秒超时那条），
 * 所以「静态 import + 开关」这两个决定是同一个原因。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { RELEASES_API } from '@levango7/engine/update'
import { useUpdateCheck } from '../../src/vue/useUpdateCheck'
import type { StorageAdapter } from '../../src/vue/store'

const flags = vi.hoisted(() => ({
  desktop: false,
  check: (async () => null) as () => Promise<unknown>,
}))

vi.mock('../../src/vue/useShell', async (imp) => {
  const real = (await imp()) as Record<string, unknown>
  // 只换 `isDesktop` 这一项 —— 其余真身照旧（useBackup 那条依赖链也用这个模块）
  return { ...real, get isDesktop() { return flags.desktop } }
})

vi.mock('@tauri-apps/plugin-updater', () => ({
  get check() { return flags.check },
}))

/** 桌面端：把插件的 `check()` 换成返回这个句柄（返回 null = 没有更新） */
function withDesktop(check: () => Promise<unknown>) {
  flags.desktop = true
  flags.check = check
}

/** 比当前版本（0.8.4）新的一个 tag —— `pickUpdate` 只在真的更新时才给结果 */
const NEWER = 'v0.9.0'
const OLDER = 'v0.8.3'

function release(tag: string): unknown {
  return {
    tag_name: tag,
    html_url: `https://github.com/Levango7/Modulo/releases/tag/${tag}`,
    body: '## 修了什么\n\n- 拆了 cardData\n- 修了 id 撞号',
    published_at: '2026-10-21T00:00:00Z',
  }
}

interface MemStorage extends StorageAdapter {
  data: Record<string, string>
}

function memStorage(initial: Record<string, string> = {}): MemStorage {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    get: (k: string) => data[k] ?? null,
    set: (k: string, v: string) => {
      data[k] = v
    },
  }
}

/** 假 `fetch`：返回一个 200 的 GitHub Release 响应 */
function okFetch(body: unknown) {
  return vi.fn(async (_url?: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => body }))
}

/** 假 `fetch`：永远挂着，等 signal 被 abort 才 reject（用来测 8 秒超时真的会断） */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted')
          e.name = 'AbortError'
          reject(e)
        })
      }) as unknown as Promise<Response>,
  )
}

interface FakeHandle {
  version: string
  body?: string
  date?: string
  downloadImpl?: (onEvent: (e: unknown) => void) => Promise<void>
  installImpl?: () => Promise<void>
  closed?: boolean
}

function makeHandle(h: FakeHandle) {
  return {
    version: h.version,
    body: h.body,
    date: h.date,
    download: async (onEvent: (e: unknown) => void) => {
      await (h.downloadImpl ?? (async () => {}))(onEvent)
    },
    install: async () => {
      await (h.installImpl ?? (async () => {}))()
    },
    close: async () => {
      h.closed = true
    },
  }
}

const T0 = new Date('2026-10-21T02:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  // 开关回到网页版：默认那条路是 GitHub Releases，桌面端由用例自己 `withDesktop()`
  flags.desktop = false
  flags.check = async () => null
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('更新检查：网页版那条路（GitHub Releases API）', () => {
  it('建出来什么都不做 —— 启动不该顺手给 GitHub 发请求', async () => {
    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck(memStorage())
    expect(api.state.value.status, '刚建出来是 idle').toBe('idle')
    expect(spy, '一条请求都不该发').not.toHaveBeenCalled()
  })

  it('查到新版：状态 found、信息落到界面、结果写进缓存', async () => {
    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const mem = memStorage()
    const api = useUpdateCheck(mem)
    await api.check()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0], '问的是仓库的 latest 接口').toBe(RELEASES_API)
    expect(api.state.value.status).toBe('found')
    const info = api.state.value.status === 'found' ? api.state.value.info : null
    expect(info?.latest, 'tag 上的 v 要剥掉').toBe('0.9.0')
    expect(info?.url).toBe(`https://github.com/Levango7/Modulo/releases/tag/${NEWER}`)
    expect(info?.notes, 'markdown 只留纯文本').not.toContain('##')
    // 缓存里必须有 latest / url / checkedAt —— 缺一个，下次命中缓存就拿不出下载页
    const cached = JSON.parse(Object.values(mem.data)[0] ?? '{}') as Record<string, unknown>
    expect(cached.latest).toBe('0.9.0')
    expect(typeof cached.checkedAt).toBe('number')
  })

  it('已是最新 / 远端更旧：状态 current，不写缓存', async () => {
    vi.stubGlobal('fetch', okFetch(release(OLDER)))
    const mem = memStorage()
    const api = useUpdateCheck(mem)
    await api.check()
    expect(api.state.value.status).toBe('current')
    expect(Object.keys(mem.data), '没新版本就不必记').toHaveLength(0)
  })

  it('一小时内命中缓存 —— 不再联网（这一条就是「启动不发请求」的兑现处）', async () => {
    const first = okFetch(release(NEWER))
    vi.stubGlobal('fetch', first)
    const mem = memStorage()
    const api = useUpdateCheck(mem)
    await api.check()
    expect(first).toHaveBeenCalledTimes(1)

    const second = okFetch(release(NEWER))
    vi.stubGlobal('fetch', second)
    vi.setSystemTime(T0 + 30 * 60 * 1000) // 过了 30 分钟，仍在 TTL 内
    await api.check()
    expect(second, '缓存新鲜就不该再问').not.toHaveBeenCalled()
    expect(api.state.value.status, '缓存说的是有新版').toBe('found')
  })

  it('缓存过了一小时 → 重新联网；显式 force 也重新联网', async () => {
    const first = okFetch(release(NEWER))
    vi.stubGlobal('fetch', first)
    const mem = memStorage()
    const api = useUpdateCheck(mem)
    await api.check()

    const second = okFetch(release(NEWER))
    vi.stubGlobal('fetch', second)
    vi.setSystemTime(T0 + 61 * 60 * 1000)
    await api.check()
    expect(second, 'TTL 过了就该重问').toHaveBeenCalledTimes(1)

    const third = okFetch(release(NEWER))
    vi.stubGlobal('fetch', third)
    await api.check(true)
    expect(third, '用户点了「重新检查」就必须真去问').toHaveBeenCalledTimes(1)
  })

  it('缓存里的版本已经不比当前新 → current（缓存不能反过来骗出「有新版」）', async () => {
    vi.stubGlobal('fetch', okFetch(release(NEWER)))
    const mem = memStorage()
    const api = useUpdateCheck(mem)
    await api.check()
    // 把缓存里的版本号改小：命中缓存时它必须自己比一次，不能照抄
    const key = Object.keys(mem.data)[0]
    mem.data[key] = JSON.stringify({ latest: '0.8.3', url: 'https://github.com/Levango7/Modulo/releases', checkedAt: T0 })

    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    await api.check()
    expect(spy).not.toHaveBeenCalled()
    expect(api.state.value.status).toBe('current')
  })

  it('缓存写坏了（JSON 坏了）→ 当没有，走网络；不该把启动卡死', async () => {
    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    // 键名从一次真实写入里取，避免这里手抄一份与实现各说各话
    const mem = memStorage()
    const probe = useUpdateCheck(mem)
    await probe.check()
    const key = Object.keys(mem.data)[0]
    const broken = memStorage({ [key]: '{ 不是 JSON' })

    const api = useUpdateCheck(broken)
    await api.check()
    expect(api.state.value.status).toBe('found')
  })

  it('HTTP 非 2xx：状态 failed 且**不抛**（离线/限流是常态，不是 bug）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    const api = useUpdateCheck(memStorage())
    await expect(api.check()).resolves.toBeUndefined()
    expect(api.state.value.status).toBe('failed')
    expect(api.state.value.status === 'failed' && api.state.value.message).toContain('GitHub 返回 403')
  })

  it('网络直接抛错：状态 failed，错误信息原样带出来', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('公司网关不让出网') }))
    const api = useUpdateCheck(memStorage())
    await api.check()
    expect(api.state.value.status).toBe('failed')
    expect(api.state.value.status === 'failed' && api.state.value.message).toBe('公司网关不让出网')
  })

  it('8 秒没收完 → 自己断掉（挂死的请求不该让界面一直转圈）', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const api = useUpdateCheck(memStorage())
    const pending = api.check()
    await vi.advanceTimersByTimeAsync(8000)
    await pending
    expect(api.state.value.status).toBe('failed')
    expect(api.state.value.status === 'failed' && api.state.value.message).toBeTruthy()
  })

  it('正在查的时候重复点：只发一次请求（连点不该把 GitHub 打三遍）', async () => {
    const spy = hangingFetch()
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck(memStorage())
    void api.check()
    await Promise.resolve()
    await api.check()
    await api.check()
    expect(spy, '第二次第三次都被状态机挡下').toHaveBeenCalledTimes(1)
    expect(api.state.value.status).toBe('checking')
  })

  it('缓存形状不完整（缺 url）→ 当没有，走网络（半截缓存不该被当成结论）', async () => {
    const mem = memStorage()
    const probe = useUpdateCheck(mem)
    vi.stubGlobal('fetch', okFetch(release(NEWER)))
    await probe.check()
    const key = Object.keys(mem.data)[0]
    // 只留 latest，把 url 抹掉：命中缓存时也拿不出下载页，这种半截缓存必须作废
    const half = memStorage({ [key]: JSON.stringify({ latest: '0.9.0', checkedAt: T0 }) })

    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck(half)
    await api.check()
    expect(spy, '形状不全的缓存不该被采信').toHaveBeenCalledTimes(1)
    expect(api.state.value.status).toBe('found')
  })

  it('缓存缺时间戳 → 不算新鲜（否则写一次就永远命中，再也查不到新版）', async () => {
    const mem = memStorage()
    const probe = useUpdateCheck(mem)
    vi.stubGlobal('fetch', okFetch(release(NEWER)))
    await probe.check()
    const key = Object.keys(mem.data)[0]
    const noTs = memStorage({ [key]: JSON.stringify({ latest: '0.9.0', url: 'https://github.com/Levango7/Modulo/releases' }) })

    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck(noTs)
    await api.check()
    expect(spy, '没有时间戳的缓存不能当新鲜，必须重问').toHaveBeenCalledTimes(1)
  })

  it('抛的不是 Error（有的库抛字符串）→ 也如实显示，不显示成 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'updater: bad gateway' }))
    const api = useUpdateCheck(memStorage())
    await api.check()
    expect(api.state.value.status).toBe('failed')
    expect(api.state.value.status === 'failed' && api.state.value.message).toBe('updater: bad gateway')
  })

  it('不传 storage 也能跑：默认件是不落盘的那个（网页版不该因为没存储而崩）', async () => {
    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck()
    await api.check()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(api.state.value.status).toBe('found')
    // 再查一次：默认件存不住，所以还得联网 —— 没有缓存就是没有缓存，不许假装命中
    await api.check()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('更新检查：桌面壳那条路（tauri-plugin-updater）', () => {
  it('桌面端走插件，不去问 GitHub；没更新 → current', async () => {
    withDesktop(async () => null)
    const spy = okFetch(release(NEWER))
    vi.stubGlobal('fetch', spy)
    const api = useUpdateCheck(memStorage())
    expect(api.desktop).toBe(true)
    await api.check()
    expect(spy, '桌面端不该碰 GitHub API').not.toHaveBeenCalled()
    expect(api.state.value.status).toBe('current')
  })

  it('有更新 → found；说明文字取纯文本并截到 200；没有网页下载页（动作是「下载更新」）', async () => {
    const body = '甲'.repeat(400) // 超过 200，必须被截断
    const handle = makeHandle({ version: '0.9.0', body, date: '2026-10-21T00:00:00Z' })
    withDesktop(async () => handle)
    const api = useUpdateCheck(memStorage())
    await api.check()
    expect(api.state.value.status).toBe('found')
    const info = api.state.value.status === 'found' ? api.state.value.info : null
    expect(info?.latest).toBe('0.9.0')
    expect(info?.url).toBe('')
    expect(info?.notes.length).toBeLessThanOrEqual(200)
    expect(info?.publishedAt).toBe('2026-10-21T00:00:00Z')
  })

  it('插件抛错 → failed（端点/公钥配置错了要能看见，不能静默）', async () => {
    withDesktop(async () => {
      throw new Error('latest.json 解析失败')
    })
    const api = useUpdateCheck(memStorage())
    await api.check()
    expect(api.state.value.status).toBe('failed')
    expect(api.state.value.status === 'failed' && api.state.value.message).toBe('latest.json 解析失败')
  })

  it('下载：进度按块累加，收尾变 downloaded；下载抛错 → failed（验签失败落在这里）', async () => {
    const opts: FakeHandle = { version: '0.9.0' }
    const handle = makeHandle({
      ...opts,
      downloadImpl: async (onEvent) => {
        onEvent({ event: 'Started', data: { contentLength: 1000 } })
        onEvent({ event: 'Progress', data: { chunkLength: 400 } })
        onEvent({ event: 'Progress', data: { chunkLength: 600 } })
      },
    })
    withDesktop(async () => handle)
    const api = useUpdateCheck(memStorage())
    await api.check()
    await api.download()
    expect(api.state.value.status).toBe('downloaded')

    const bad = makeHandle({
      version: '0.9.0',
      downloadImpl: async () => {
        throw new Error('签名校验失败')
      },
    })
    withDesktop(async () => bad)
    const api2 = useUpdateCheck(memStorage())
    await api2.check()
    await api2.download()
    expect(api2.state.value.status).toBe('failed')
    expect(api2.state.value.status === 'failed' && api2.state.value.message).toBe('签名校验失败')
  })

  it('安装：正常路径停在 installing（NSIS 拉起后本进程即退出）；抛错 → failed', async () => {
    const handle = makeHandle({ version: '0.9.0' })
    withDesktop(async () => handle)
    const api = useUpdateCheck(memStorage())
    await api.check()
    await api.install()
    expect(api.state.value.status).toBe('installing')

    const bad = makeHandle({
      version: '0.9.0',
      installImpl: async () => {
        throw new Error('安装器退出码 2')
      },
    })
    withDesktop(async () => bad)
    const api2 = useUpdateCheck(memStorage())
    await api2.check()
    await api2.install()
    expect(api2.state.value.status).toBe('failed')
  })

  it('没查到更新就点下载/安装：no-op（不该拿一个空句柄去调后端）', async () => {
    withDesktop(async () => null)
    const api = useUpdateCheck(memStorage())
    await api.check()
    await api.download()
    await api.install()
    expect(api.state.value.status, '句柄为空时两个动作都不该动状态').toBe('current')
  })

  it('设置页关掉 → 后端句柄被归还；换一份新句柄时旧的也先关掉', async () => {
    const first: FakeHandle = { version: '0.9.0' }
    const h1 = makeHandle(first)
    withDesktop(async () => h1)
    const scope = effectScope()
    const api = scope.run(() => useUpdateCheck(memStorage()))!
    await api.check()
    scope.stop() // 设置页卸载
    expect(first.closed, '卸载时得把后端资源还回去').toBe(true)
  })
})
