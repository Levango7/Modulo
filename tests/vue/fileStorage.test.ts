import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DATA_KEYS, createFileStorage, hydrateData, webStorage } from '../../src/vue/fileStorage'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('桌面壳的数据落盘适配器', () => {
  it('get 读到 hydrate 的内容，set 立刻对镜像生效并异步写穿', async () => {
    const written: Array<[string, string]> = []
    const s = createFileStorage({ a: '1' }, async (n, c) => void written.push([n, c]))

    expect(s.get('a')).toBe('1')
    expect(s.get('missing')).toBeNull()

    s.set('a', '2')
    expect(s.get('a')).toBe('2') // 同步可读，不等磁盘
    await settle()
    expect(written).toEqual([['a', '2']])
  })

  it('写失败会挂在 error 上，之后同一 key 写成功会清掉', async () => {
    let fail = true
    const s = createFileStorage({}, async () => {
      if (fail) throw new Error('disk full')
    })

    s.set('k', 'v')
    await settle()
    expect(s.error.value).toContain('disk full')

    fail = false
    s.set('k', 'v2')
    await settle()
    expect(s.error.value).toBeNull()
  })

  /** Rust 侧同一个 key 用同一个临时文件名，两次写重叠就会落半份 JSON */
  it('同一个 key 的并发写被强制排队', async () => {
    let active = 0
    let peak = 0
    const s = createFileStorage({}, () => {
      active += 1
      peak = Math.max(peak, active)
      return new Promise<void>((r) =>
        setTimeout(() => {
          active -= 1
          r()
        }, 5),
      )
    })

    s.set('k', 'a')
    s.set('k', 'b')
    s.set('k', 'c')
    await settle(120)
    expect(peak).toBe(1)
  })

  it('一次写失败不会把后续写永久卡住', async () => {
    const done: string[] = []
    const s = createFileStorage({}, async (_n, c) => {
      if (c === 'bad') throw new Error('boom')
      done.push(c)
    })

    s.set('k', 'bad')
    s.set('k', 'good')
    await settle()
    expect(done).toEqual(['good'])
  })

  it('磁盘没有文件时回退到旧的 localStorage 并立刻迁移', async () => {
    const legacy: Record<string, string> = { [DATA_KEYS[0]]: '{"from":"localstorage"}' }
    const migrated: Array<[string, string]> = []
    const out = await hydrateData(
      async () => null,
      async (n, c) => void migrated.push([n, c]),
      (k) => legacy[k] ?? null,
    )

    expect(out[DATA_KEYS[0]]).toBe('{"from":"localstorage"}')
    expect(migrated).toEqual([[DATA_KEYS[0], '{"from":"localstorage"}']])
  })

  it('磁盘已有内容时以磁盘为准，不被旧 localStorage 覆盖', async () => {
    const out = await hydrateData(
      async () => '{"from":"disk"}',
      async () => {},
    )
    expect(out[DATA_KEYS[0]]).toBe('{"from":"disk"}')
  })

  it('读盘抛异常按"没有这个文件"处理，不能让应用起不来', async () => {
    const out = await hydrateData(async () => {
      throw new Error('EACCES')
    })
    expect(Object.keys(out).sort()).toEqual([...DATA_KEYS].sort())
    expect(Object.values(out).every((v) => v === null)).toBe(true)
  })

  /**
   * 读盘失败的键**绝不能**走 legacy 迁移分支（规格书 §4「可靠性」点名过的覆盖风险）：
   * 抛异常只代表"这次没读出来"，不代表"磁盘上没有"。真去回写，就是拿 localStorage
   * 旧值覆盖可能存在的磁盘新数据。
   */
  it('读盘抛异常的键：不采 legacy、不回写磁盘', async () => {
    const legacy: Record<string, string> = Object.fromEntries(
      DATA_KEYS.map((k) => [k, '{"from":"localstorage"}']),
    )
    const migrated: Array<[string, string]> = []
    const out = await hydrateData(
      async () => {
        throw new Error('EACCES')
      },
      async (n, c) => void migrated.push([n, c]),
      (k) => legacy[k] ?? null,
    )

    expect(Object.values(out).every((v) => v === null)).toBe(true)
    expect(migrated).toEqual([])
  })

  it('读盘抛异常：失败的键经 onReadError 报出去（静默 = 假装数据没事）', async () => {
    const reported: string[][] = []
    const out = await hydrateData(
      async (k) => {
        if (k === DATA_KEYS[0] || k === DATA_KEYS[1]) throw new Error('EIO')
        return null
      },
      async () => {},
      () => null,
      (failed) => void reported.push([...failed]),
    )

    expect(reported).toEqual([[DATA_KEYS[0], DATA_KEYS[1]]])
    expect(out[DATA_KEYS[0]]).toBeNull()
    expect(out[DATA_KEYS[1]]).toBeNull()
    // 没抛的键仍走正常分支（这里是"磁盘无文件 + 无 legacy" ⇒ 同样为 null，但没进失败名单）
    expect(reported[0]).not.toContain(DATA_KEYS[2])
  })

  it('读盘抛异常与正常 legacy 迁移可以共存（同一次启动里两路分清）', async () => {
    const legacy: Record<string, string> = { [DATA_KEYS[2]]: '{"from":"localstorage"}' }
    const migrated: Array<[string, string]> = []
    const out = await hydrateData(
      async (k) => {
        if (k === DATA_KEYS[0]) throw new Error('EBUSY')
        if (k === DATA_KEYS[2]) return null
        return '{"from":"disk"}'
      },
      async (n, c) => void migrated.push([n, c]),
      (k) => legacy[k] ?? null,
    )

    expect(out[DATA_KEYS[0]]).toBeNull() // 抛异常 ⇒ 空值，不采 legacy
    expect(out[DATA_KEYS[2]]).toBe('{"from":"localstorage"}') // 真没有 ⇒ 正常迁移
    expect(migrated).toEqual([[DATA_KEYS[2], '{"from":"localstorage"}']]) // 回写只发生在"真没有"那一支
  })
})

describe('存储键登记：写下去的键必须重启还读得回来（2026-10-24 修）', () => {
  const CACHE_KEYS = [
    'modulo.weather.v1',
    'modulo.air.v1',
    'modulo.fx.v1',
    'modulo.hn.v1',
    'modulo.repo.v1',
    'modulo.repo-snapshot.v1',
    'modulo.update.v1',
    'modulo.worldclock.v1',
  ]

  /**
   * 走**裸 `localStorage`**、明确不进文件存储的键（各自卡片自己读浏览器存储，桌面重启后仍在，
   * 但不在文件镜像里、也不在备份清单里）。白名单是「已知分叉」的登记处，不是省事：
   * 下面一条用例要求每个白名单键**确实还在源码里出现**，卡片改走适配器后这一条会逼着来删。
   */
  /**
   * 走**裸 `localStorage`**、明确不进文件存储的键。**2026-10-27 起是空的**：
   * rss / probe 两张卡的历史已经搬回存储适配器（见 `store.ts` 的 `adoptLegacyKey`），
   * 于是"源码里出现的每个存储键都必须在 DATA_KEYS 里"这条判据现在**没有例外**。
   * 机制留着而不是删掉：下次真要分叉时，往这里加一条比放宽整体判据干净。
   */
  const RAW_LOCAL_STORAGE_KEYS: string[] = []

  it('8 个缓存/偏好键都在 DATA_KEYS 里（漏登记 = 写得下去、重启读不到）', () => {
    for (const k of CACHE_KEYS) expect(DATA_KEYS, `${k} 没登记`).toContain(k)
  })

  it('重启链：按 DATA_KEYS hydrate 后，缓存原样读得回来', async () => {
    const disk: Record<string, string> = Object.fromEntries(CACHE_KEYS.map((k, i) => [k, `{"cachedAt":${i}}`]))
    const out = await hydrateData(async (k) => disk[k] ?? null, async () => {})
    for (const k of CACHE_KEYS) expect(out[k]).toBe(disk[k])
  })

  /**
   * 源码扫描门禁：`src/` 里任何 `'modulo.<名字>.v<N>'` 字面量，要么进了 `DATA_KEYS`，
   * 要么在裸 localStorage 白名单里 —— 两者都不沾就红。
   *
   * 为什么正则不写死卡片名：本笔之前的写法只认 `weather|air|fx|hn|repo|repo-snapshot|update`
   * 七个名字，而 `modulo.worldclock.v1`（世界时钟选的城市）**正好在射程外、照样漏着** ——
   * 换成通用形状后它当场被抓出来。写死名单的门禁只能守住"已经想到的那几个键"。
   *
   * 反假绿：扫描本身坏掉（目录改名、正则失配）时会得到空集合，而"没有未登记的键"看起来像通过，
   * 所以先断言扫出的键数下限；白名单也逐条断言仍在源码里，防止它变成永远绿的黑洞。
   */
  it('src 里出现的存储键全数已登记（扫描不能空跑）', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(p)
      }
    }
    walk(resolve(__dirname, '../../src'))
    const sources = files.map((f) => readFileSync(f, 'utf8'))

    const re = /'(modulo\.[a-z][a-z0-9-]*\.v\d+)'/g
    const found = new Set<string>()
    for (const text of sources) for (const m of text.matchAll(re)) found.add(m[1])

    // 2026-10-24 实测 19 个；下限留余量，但不低到能放过一整类新键
    expect(found.size, '扫出的存储键过少 —— 扫描本身坏了，不能当成"没有漏登记"').toBeGreaterThanOrEqual(16)

    const known = new Set([...DATA_KEYS, ...RAW_LOCAL_STORAGE_KEYS])
    for (const key of found) expect(known, `${key} 出现在源码里但既没登记 DATA_KEYS、也不在裸 localStorage 白名单`).toContain(key)

    for (const key of RAW_LOCAL_STORAGE_KEYS) {
      expect(found, `白名单里的 ${key} 已不在源码里 —— 请把这一条从白名单删掉`).toContain(key)
    }
    // 白名单现在是空的：如果有人重新引入"裸 localStorage 存储"，把键加回白名单的同时
    // 这条断言会提醒他这不是免费的（判据从"全部登记"退化成"登记或白名单"）。
    expect(RAW_LOCAL_STORAGE_KEYS, '白名单应保持为空；要开例外先想清楚为什么').toEqual([])
  })
})

describe('网页版的 localStorage 适配器：错误必须可见（2026-10-13）', () => {
  /** 假 localStorage：可控地在 set/get 上抛错（等价于配额满 / 隐私模式限制） */
  const fakeLS = (opts: { failSet?: boolean; failGet?: boolean } = {}) => {
    const map = new Map<string, string>()
    return {
      get: (k: string) => {
        if (opts.failGet) throw new DOMException('SecurityError: denied', 'SecurityError')
        return map.get(k) ?? null
      },
      set: (k: string, v: string) => {
        if (opts.failSet) throw new DOMException('QuotaExceededError: full', 'QuotaExceededError')
        map.set(k, v)
      },
      map,
    }
  }

  it('写失败：error 被填上（此前永远是 null，界面毫无提示），改动不再往外抛', () => {
    const s = webStorage(fakeLS({ failSet: true }))
    expect(() => s.set('modulo.layout.v1', '{}')).not.toThrow()
    expect(s.error.value).toContain('modulo.layout.v1')
    expect(s.error.value).toContain('只在内存里')
  })

  it('写恢复：同一 key 再写成功把红条清掉（与桌面壳同样的"恢复即消警"）', () => {
    let fail = true
    const ls = fakeLS()
    const s = webStorage({
      get: ls.get,
      set: (k, v) => {
        if (fail) throw new DOMException('QuotaExceededError: full', 'QuotaExceededError')
        ls.set(k, v)
      },
    })
    s.set('modulo.layout.v1', 'a')
    expect(s.error.value).not.toBeNull()
    fail = false
    s.set('modulo.layout.v1', 'b')
    expect(s.error.value).toBeNull()
    expect(ls.get('modulo.layout.v1')).toBe('b')
  })

  it('读失败：按"没有存档"处理并留下提示，不让应用起不来', () => {
    const s = webStorage(fakeLS({ failGet: true }))
    expect(s.get('modulo.layout.v1')).toBeNull()
    expect(s.error.value).toContain('没能读进浏览器存储')
  })
})
