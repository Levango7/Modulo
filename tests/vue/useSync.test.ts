import { describe, expect, it, vi } from 'vitest'
import {
  buildBundle,
  hashOf,
  historyName,
  LIVE_NAME,
  SYNC_KIND,
  SYNC_VERSION,
  type SyncBundle,
  type SyncSection,
} from '@levango7/engine/sync'
import { createSyncStore, parseSyncState, sectionOfKey, serializeSyncState, stampForWrite, watchSectionWrites } from '../../src/vue/syncStore'
import { AUTO_INTERVAL_MS, describePending, desktopTransport, shouldAutoSync, useSync, type SyncTransport } from '../../src/vue/useSync'

/**
 * 同步胶水层：钉的是"会不会洗掉数据"，不是"请求发得对不对"。
 * 传输是假的（真传输在 Rust `webdav.rs`，由 CI 编译 + 真机探针验证），
 * 但**裁决、确认门、先留现场再覆盖、口令不落盘**这些决定数据安全的顺序，全在这里断言。
 */

const mem = () => {
  const map = new Map<string, string>()
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => void map.set(k, v),
    map,
  }
}

const SECTIONS = {
  layout: { items: [{ id: 'm1' }] },
  schemes: { schemes: [{ id: 's1' }] },
  cardData: { todos: [{ id: 't1', text: '写测试' }] },
  settings: { appearance: { skin: 'a' }, template: 't1' },
} as unknown as Partial<Record<SyncSection, unknown>>

class FakeTransport implements SyncTransport {
  remote: Record<string, string> = {}
  etags: Record<string, string> = {}
  listing: string[] = []
  calls: string[] = []
  /** 下一次 put 返回"冲突"（模拟另一台设备抢先写了） */
  conflictOnce = false
  /** 收到的 If-Match（按调用顺序） */
  ifMatches: (string | null)[] = []
  failPut = false

  async probe(endpoint: string): Promise<number> {
    this.calls.push(`probe ${endpoint}`)
    return 207
  }
  async get(_e: string, name: string): Promise<{ body: string; etag: string | null } | null> {
    this.calls.push(`get ${name}`)
    const body = this.remote[name]
    return body === undefined ? null : { body, etag: this.etags[name] ?? null }
  }
  async put(_e: string, name: string, body: string, _u: string, _p: string | null, ifMatch: string | null): Promise<{ conflict: boolean }> {
    if (this.failPut) throw new Error('网盘写失败')
    this.ifMatches.push(ifMatch)
    // 412 只可能发生在**条件写**上（带 If-Match）；无条件写不该被它拦，否则历史副本那步会被误伤
    if (this.conflictOnce && ifMatch !== null) {
      this.conflictOnce = false
      this.calls.push(`put-conflict ${name}`)
      return { conflict: true }
    }
    this.calls.push(`put ${name}`)
    this.remote[name] = body
    // 真实的 WebDAV 在 PUT 之后就能列出来 —— 假传输也要这样，否则轮转永远少算一份
    if (!this.listing.includes(name)) this.listing.push(name)
    return { conflict: false }
  }
  async list(): Promise<string[]> {
    this.calls.push('list')
    return this.listing
  }
  async remove(_e: string, name: string): Promise<void> {
    this.calls.push(`remove ${name}`)
    this.listing = this.listing.filter((n) => n !== name)
  }
  async credStatus(): Promise<boolean> {
    return false
  }
  async credSet(_e: string, _u: string, _p: string): Promise<void> {
    this.calls.push('credSet')
  }
  async credClear(): Promise<void> {
    this.calls.push('credClear')
  }
}

function setup(over: { remote?: SyncBundle | null; transport?: FakeTransport; localStamps?: boolean } = {}) {
  const storage = mem()
  const store = createSyncStore(storage, { now: () => 1000 })
  // 设置好端点/用户名/设备标识
  store.patch({ endpoint: 'https://dav.example.com/dav/modulo/', user: 'me', remember: false })
  const transport = over.transport ?? new FakeTransport()
  if (over.remote) {
    transport.remote[LIVE_NAME] = JSON.stringify(over.remote)
    transport.etags[LIVE_NAME] = '"v1"'
  }
  if (over.localStamps !== false) {
    // 本机三段的戳：都以"比远端旧"的时刻记下
    store.setStamps({
      layout: { at: 900, dev: store.state().settings.deviceId, hash: hashOf(SECTIONS.layout) },
      schemes: { at: 900, dev: store.state().settings.deviceId, hash: hashOf(SECTIONS.schemes) },
      cardData: { at: 900, dev: store.state().settings.deviceId, hash: hashOf(SECTIONS.cardData) },
      settings: { at: 900, dev: store.state().settings.deviceId, hash: hashOf(SECTIONS.settings) },
    })
  }
  const applied: Record<string, unknown>[] = []
  const sync = useSync({
    store,
    transport,
    desktop: true,
    sections: () => SECTIONS,
    applyRemote: (remote) => {
      applied.push(remote as Record<string, unknown>)
      return { done: ['版面 1 个模块'], warnings: [] }
    },
    now: () => 2000,
  })
  sync.password.value = 'pw'
  return { sync, transport, store, storage, applied }
}

const bundleWith = (sections: Partial<Record<SyncSection, { at: number; dev: string; body: unknown }>>, dev = 'dev-other') => {
  const out: SyncBundle['sections'] = {}
  for (const [s, v] of Object.entries(sections)) {
    out[s as SyncSection] = { at: v.at, dev: v.dev, hash: hashOf(v.body), body: v.body }
  }
  return { kind: SYNC_KIND, version: SYNC_VERSION, deviceId: dev, createdAt: 1500, sections: out } satisfies SyncBundle
}

describe('首次同步：远端还没有文件', () => {
  it('把本机这几段整份推上去，并把同步时刻记下来', async () => {
    const { sync, transport, store } = setup()
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    expect(transport.remote[LIVE_NAME]).toBeTruthy()
    const pushed = JSON.parse(transport.remote[LIVE_NAME]) as SyncBundle
    expect(Object.keys(pushed.sections).sort()).toEqual(['cardData', 'layout', 'schemes', 'settings'])
    expect(pushed.deviceId).toBe(store.state().settings.deviceId)
    expect(store.state().settings.lastSyncAt).toBe(2000)
    // 没有旧内容可留，所以不该产生历史副本
    expect(transport.calls.filter((c) => c.startsWith('put ')).length).toBe(1)
  })

  it('上传时用的是各段**本机写入时刻**，不是"现在"（否则每次同步都宣称本机最新）', async () => {
    const { sync, transport } = setup()
    await sync.syncNow()
    const pushed = JSON.parse(transport.remote[LIVE_NAME]) as SyncBundle
    expect(pushed.sections.layout?.at).toBe(900)
    expect(pushed.sections.cardData?.at).toBe(900)
  })
})

describe('远端文件读不懂 → 什么都不动', () => {
  it('坏 JSON：报错、不写网盘、不落地', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = '{"sections": {'
    const { sync, applied } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('没有改动任何东西')
    expect(applied).toEqual([])
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([])
  })

  it('坏时间戳的段：整次同步拒绝执行（判据层说"两边都不动"，这里必须照办）', async () => {
    const t = new FakeTransport()
    const b = bundleWith({ layout: { at: 1500, dev: 'dev-x', body: { items: [] } } })
    b.sections.layout!.at = 0 // 坏戳
    t.remote[LIVE_NAME] = JSON.stringify(b)
    const { sync, applied } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('时间戳')
    expect(applied).toEqual([])
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([])
  })
})

describe('远端更新：先问，再覆盖', () => {
  it('进入 pending 时不写本机、不写网盘；确认后才落地并推回去', async () => {
    const t = new FakeTransport()
    const b = bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [{ id: 'remote' }] } } })
    t.remote[LIVE_NAME] = JSON.stringify(b)
    const { sync, applied } = setup({ transport: t })

    await sync.syncNow()
    expect(sync.pending.value).not.toBeNull()
    expect(applied).toEqual([])
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([])
    expect(sync.pending.value!.sections).toEqual({ layout: { items: [{ id: 'remote' }] } })

    const before = t.remote[LIVE_NAME]
    await sync.confirmApply()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual({ layout: { items: [{ id: 'remote' }] } })
    // 先留现场（远端旧内容）再覆盖 live
    const puts = t.calls.filter((c) => c.startsWith('put '))
    expect(puts).toHaveLength(2)
    expect(puts[0]).not.toBe(`put ${LIVE_NAME}`)
    expect(JSON.parse(t.remote[puts[0].slice(4)])).toEqual(JSON.parse(before!))
    expect(puts[1]).toBe(`put ${LIVE_NAME}`)
  })

  it('取消：本机与网盘都不动', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [] } } }))
    const { sync, applied } = setup({ transport: t })
    const before = t.remote[LIVE_NAME]
    await sync.syncNow()
    sync.cancelApply()
    expect(sync.pending.value).toBeNull()
    expect(applied).toEqual([])
    expect(t.remote[LIVE_NAME]).toBe(before)
    expect(sync.message.value).toContain('都没有改动')
  })

  /**
   * 连点几次「立即同步」是真实用法（用户不确定上一次成没成就会再点）。
   * 如果每次不变成都写一份历史副本，7 个额度几分钟内会被同一份内容填满，
   * 真正需要的"覆盖前那一份"反而被挤掉 —— 所以只有**真的改到远端内容**时才留现场。
   */
  it('没有任何段变化时不留历史副本（连点同步不会把额度塞满同一份）', async () => {
    const t = new FakeTransport()
    // 远端四段内容与本机完全一致（只是来源是另一台设备）
    const same = Object.fromEntries(Object.entries(SECTIONS).map(([k, body]) => [k, { at: 900, dev: 'dev-b', body }]))
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith(same as never))
    const { sync } = setup({ transport: t })
    t.listing = [LIVE_NAME]
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([`put ${LIVE_NAME}`])
    // 再点一次也一样：内容还是一致
    t.calls.length = 0
    await sync.syncNow()
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([`put ${LIVE_NAME}`])
  })

  it('两边内容一致：不落地、不判冲突，但仍然把合并结果推一遍（戳对齐）', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: SECTIONS.layout } }))
    const { sync, applied } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.pending.value).toBeNull()
    expect(applied).toEqual([])
    expect(sync.status.value).toBe('ok')
    expect(t.calls).toContain(`put ${LIVE_NAME}`)
  })
})

describe('历史副本与轮转', () => {
  it('覆盖前把远端那份存成历史副本；轮转只删认识的旧副本', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [{ id: 'r' }] } } }))
    // 远端已有 8 份历史（超过 7 份额度）+ 一个不相干文件
    const olds = Array.from({ length: 8 }, (_, i) => historyName(1000 + i))
    t.listing = [...olds, LIVE_NAME, 'notes.pdf']
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    const puts = t.calls.filter((c) => c.startsWith('put '))
    expect(puts[0]).toBe(`put ${historyName(2000)}`)
    // 8 旧 + 1 新 = 9 份，额度 7 ⇒ 删最旧的 2 份
    expect(t.calls.filter((c) => c.startsWith('remove ')).sort()).toEqual([`remove ${olds[0]}`, `remove ${olds[1]}`].sort())
    expect(t.calls).not.toContain('remove notes.pdf')
  })

  it('轮转失败只是警告：数据已经同步成功', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    t.list = async () => {
      throw new Error('目录列不出来')
    }
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    expect(sync.notices.value.join()).toContain('轮转失败')
  })
})

describe('口令不落盘、只在显式勾选时进凭据库', () => {
  it('同步设置里永远没有口令字段（连字段名都不出现）', async () => {
    const { sync, storage } = setup()
    await sync.syncNow()
    const raw = storage.map.get('modulo.sync.v1') ?? ''
    expect(raw).not.toContain('pw')
    expect(raw.toLowerCase()).not.toContain('password')
  })

  it('勾「记住口令」才写凭据库；取消勾选会清掉', async () => {
    const { sync, transport } = setup()
    await sync.rememberPassword(true)
    expect(transport.calls).toContain('credSet')
    expect(sync.settings.value.remember).toBe(true)
    await sync.rememberPassword(false)
    expect(transport.calls).toContain('credClear')
    expect(sync.settings.value.remember).toBe(false)
  })

  it('没输口令就勾「记住」：报错且不写凭据库', async () => {
    const { sync, transport } = setup()
    sync.password.value = ''
    await sync.rememberPassword(true)
    expect(transport.calls).not.toContain('credSet')
    expect(sync.status.value).toBe('error')
  })
})

describe('客户端设置与拒绝路径', () => {
  it('端点不合法 / 没用户名 / 没口令：各自给出人话，且不发请求', async () => {
    const t = new FakeTransport()
    const { sync } = setup({ transport: t })
    sync.save({ endpoint: 'http://192.168.1.9/dav/' })
    await sync.syncNow()
    expect(sync.message.value).toContain('https')
    sync.save({ endpoint: 'https://dav.example.com/dav/' })
    sync.save({ user: '' })
    await sync.syncNow()
    expect(sync.message.value).toContain('用户名')
    sync.save({ user: 'me' })
    sync.password.value = ''
    await sync.syncNow()
    expect(sync.message.value).toContain('口令')
    expect(t.calls).toEqual([])
  })

  it('网页版（没有传输）：明说不可用，不假装成功', async () => {
    const storage = mem()
    const store = createSyncStore(storage)
    const sync = useSync({
      store,
      transport: null,
      desktop: false,
      sections: () => ({}),
      applyRemote: () => ({ done: [], warnings: [] }),
    })
    expect(sync.usable).toBe(false)
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('桌面版')
  })
})

describe('syncStore：戳与设置的容错', () => {
  it('坏 JSON / 坏字段一律回默认，不整份报废', () => {
    expect(parseSyncState('{').settings).toEqual({ endpoint: '', user: '', deviceId: '', remember: false, auto: false, lastSyncAt: null })
    const s = parseSyncState(
      JSON.stringify({ endpoint: 1, user: 'u', deviceId: 'd', remember: 'yes', lastSyncAt: -5, stamps: { layout: { at: 0, dev: 'x', hash: 'h' }, unknown: { at: 1, dev: 'x', hash: 'h' } } }),
    )
    expect(s.settings).toEqual({ endpoint: '', user: 'u', deviceId: 'd', remember: false, auto: false, lastSyncAt: null })
    expect(s.stamps).toEqual({}) // at=0 的坏戳与不认识的段都丢掉
  })

  it('序列化再解析是等价的（写的和读的同一套字段）', () => {
    const raw = serializeSyncState({ settings: { endpoint: 'e', user: 'u', deviceId: 'd', remember: true, auto: false, lastSyncAt: 5 }, stamps: { layout: { at: 9, dev: 'd', hash: 'h' } } })
    expect(parseSyncState(raw)).toEqual({ settings: { endpoint: 'e', user: 'u', deviceId: 'd', remember: true, auto: false, lastSyncAt: 5 }, stamps: { layout: { at: 9, dev: 'd', hash: 'h' } } })
  })

  it('写非 JSON / 非对象的内容不记戳（记原文指纹会让同一份数据永远判不等）', () => {
    expect(stampForWrite('不是 json', 'd', 1)).toBeNull()
    expect(stampForWrite('42', 'd', 1)).toBeNull()
    expect(stampForWrite('{"a":1}', 'd', 7)).toEqual({ at: 7, dev: 'd', hash: hashOf({ a: 1 }) })
  })

  it('只有参与同步的 key 会被记为对应段', () => {
    expect(sectionOfKey('modulo.layout.v1')).toBe('layout')
    expect(sectionOfKey('modulo.appearance.v1')).toBe('settings')
    expect(sectionOfKey('modulo.template.v1')).toBe('settings')
    expect(sectionOfKey('modulo.weather.v1')).toBeNull()
    expect(sectionOfKey('modulo.sync.v1')).toBeNull()
  })

  it('watchSectionWrites 透传 error 且只对参与同步的 key 记戳', () => {
    const storage = mem()
    const store = createSyncStore(storage, { now: () => 555 })
    const err = { value: null }
    const wrapped = watchSectionWrites(Object.assign(storage, { error: err }), store)
    expect(wrapped.error).toBe(err)
    wrapped.set('modulo.weather.v1', '{"a":1}')
    expect(store.state().stamps.layout).toBeUndefined()
    wrapped.set('modulo.layout.v1', '{"items":[]}')
    expect(store.state().stamps.layout).toEqual({ at: 555, dev: store.state().settings.deviceId, hash: hashOf({ items: [] }) })
  })

  it('没设过设备标识时开箱就有一个合法的（否则第一次同步会带一个空 id）', () => {
    const store = createSyncStore(mem())
    expect(store.state().settings.deviceId).toMatch(/^dev-[a-z0-9]{8}$/)
  })
})

describe('desktopTransport：命令名与参数形状（与 Rust 侧注册的一一对应）', () => {
  it('每条命令都走 invoke，且参数名与 Rust 一致（dir_url → dirUrl）', async () => {
    const seen: [string, Record<string, unknown> | undefined][] = []
    const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => {
      seen.push([cmd, args])
      if (cmd === 'webdav_probe') return { status: 207 } as T
      if (cmd === 'webdav_get') return null as T
      if (cmd === 'webdav_list') return [] as T
      if (cmd === 'webdav_put') return { conflict: false } as T
      return true as T
    }
    const t = desktopTransport(invoke)
    await t.probe('https://x.example.com/d/', 'u', 'p')
    await t.get('https://x.example.com/d/', LIVE_NAME, 'u', null)
    await t.put('https://x.example.com/d/', historyName(1), '{}', 'u', 'p', '"v1"')
    await t.list('https://x.example.com/d/', 'u', null)
    await t.remove('https://x.example.com/d/', historyName(1), 'u', null)
    await t.credStatus('https://x.example.com/d/', 'u')
    await t.credSet('https://x.example.com/d/', 'u', 'p')
    await t.credClear('https://x.example.com/d/', 'u')
    expect(seen.map(([c]) => c)).toEqual([
      'webdav_probe',
      'webdav_get',
      'webdav_put',
      'webdav_list',
      'webdav_delete',
      'sync_cred_status',
      'sync_cred_set',
      'sync_cred_clear',
    ])
    expect(seen[3][1]).toMatchObject({ dirUrl: 'https://x.example.com/d/' })
    expect(seen[1][1]).toMatchObject({ name: LIVE_NAME, password: null })
    // 条件写的头在 Rust 侧拼，渲染层只负责把 ETag 送到 if_match
    expect(seen[2][1]).toMatchObject({ ifMatch: '"v1"' })
  })
})

describe('buildBundle 的对照（防止胶水层自己造戳）', () => {
  it('上传的包必须能被引擎的 parseBundle 认下来', async () => {
    const { sync, transport } = setup()
    await sync.syncNow()
    const raw = transport.remote[LIVE_NAME]!
    const b = JSON.parse(raw) as SyncBundle
    expect(b.kind).toBe(SYNC_KIND)
    expect(b.version).toBe(SYNC_VERSION)
    // 与 buildBundle 造的包同形：各段都有 at/dev/hash/body
    const ref = buildBundle(SECTIONS, b.deviceId, 2000)
    expect(Object.keys(b.sections).sort()).toEqual(Object.keys(ref.sections).sort())
  })
})

describe('init 与连接测试', () => {
  it('勾了「记住口令」且凭据库里有：启动时标记 hasStored（不用再输）', async () => {
    const { sync, transport } = setup()
    sync.save({ remember: true })
    transport.credStatus = async () => true
    await sync.init()
    expect(sync.hasStored.value).toBe(true)
    sync.password.value = ''
    transport.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    await sync.syncNow()
    expect(sync.status.value).toBe('ok') // 空口令也放行（走凭据库）
  })

  it('读凭据库失败：回退成"没存过"并留一条提示，不挡启动', async () => {
    const { sync, transport } = setup()
    sync.save({ remember: true })
    transport.credStatus = async () => {
      throw new Error('凭据库被锁')
    }
    await sync.init()
    expect(sync.hasStored.value).toBe(false)
    expect(sync.notices.value.join()).toContain('凭据库被锁')
  })

  it('测试连接：成功报 207；失败把人话原样摆出来', async () => {
    const { sync, transport } = setup()
    await sync.test()
    expect(sync.status.value).toBe('ok')
    expect(sync.message.value).toContain('207')
    transport.probe = async () => {
      throw new Error('网盘说口令不对或没有权限（401）')
    }
    await sync.test()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('401')
  })
})

describe('落地失败与设置写失败', () => {
  it('应用远端时抛错：报"写入本机失败"、网盘不动', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [] } } }))
    const storage = mem()
    const store = createSyncStore(storage, { now: () => 1000 })
    store.patch({ endpoint: 'https://dav.example.com/dav/modulo/', user: 'me' })
    const sync = useSync({
      store,
      transport: t,
      desktop: true,
      sections: () => SECTIONS,
      applyRemote: () => {
        throw new Error('版面清洗失败')
      },
      now: () => 2000,
    })
    sync.password.value = 'pw'
    await sync.syncNow()
    await sync.confirmApply()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('写入本机失败')
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([])
  })

  it('设置写不进本机存储：patch 抛错（设置存不下来要让人知道，不能静默）', () => {
    const storage = mem()
    const store = createSyncStore(storage)
    storage.set = () => {
      throw new Error('disk full')
    }
    expect(() => store.patch({ endpoint: 'https://x.example.com/' })).toThrow('同步设置没能写进本机存储')
    // 记戳失败不抛（它是后台观察者，不该把一次正常保存变成异常）
    expect(() => store.recordWrite('modulo.layout.v1', '{"items":[]}')).not.toThrow()
    expect(() => store.setStamps({ layout: { at: 1, dev: 'd', hash: 'h' } })).not.toThrow()
  })

  it('远端有、本机没有的段：确认后不会被推成空的（上传时保留远端那份）', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ cardData: { at: 1900, dev: 'dev-b', body: { todos: [{ id: 'r' }] } } }))
    const storage = mem()
    const store = createSyncStore(storage, { now: () => 1000 })
    store.patch({ endpoint: 'https://dav.example.com/dav/modulo/', user: 'me' })
    const sync = useSync({
      store,
      transport: t,
      desktop: true,
      // 本机完全没有卡片内容（新机器刚装上）
      sections: () => ({ layout: SECTIONS.layout, schemes: SECTIONS.schemes, settings: SECTIONS.settings }),
      applyRemote: () => ({ done: ['内容 1 条待办'], warnings: [] }),
      now: () => 2000,
    })
    sync.password.value = 'pw'
    await sync.syncNow()
    expect(sync.pending.value!.sections).toEqual({ cardData: { todos: [{ id: 'r' }] } })
    await sync.confirmApply()
    const pushed = JSON.parse(t.remote[LIVE_NAME]) as SyncBundle
    expect(pushed.sections.cardData?.body).toEqual({ todos: [{ id: 'r' }] })
  })
})

describe('补充：错误路径与展示函数', () => {
  it('读远端时传输抛错：报错且不落地', async () => {
    const t = new FakeTransport()
    t.get = async () => {
      throw new Error('连不上网盘：timeout')
    }
    const { sync, applied } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('timeout')
    expect(applied).toEqual([])
  })

  it('describePending 只列"以网盘为准"的段，并带上判据理由', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [] } } }))
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    const text = describePending(sync.pending.value!)
    expect(text).toContain('layout')
    expect(text).toContain('远端更新')
    expect(text).not.toContain('cardData')
  })

  it('parseSyncState 对数组/坏戳记逐项丢弃', () => {
    expect(parseSyncState('[]').settings.endpoint).toBe('')
    const s = parseSyncState(
      JSON.stringify({
        stamps: {
          layout: 'not-an-object',
          schemes: { at: 5, dev: '', hash: 'h' },
          cardData: { at: 5, dev: 'd', hash: '' },
          settings: { at: 5, dev: 'd', hash: 'h' },
        },
      }),
    )
    expect(Object.keys(s.stamps)).toEqual(['settings'])
  })

  it('第二次开盘时沿用已有设备标识（不重新生成）', () => {
    const storage = mem()
    const first = createSyncStore(storage).state().settings.deviceId
    const second = createSyncStore(storage).state().settings.deviceId
    expect(second).toBe(first)
  })

  it('写进存储的内容解析不了时不记戳，也不污染已有戳', () => {
    const store = createSyncStore(mem(), { now: () => 9 })
    store.setStamps({ layout: { at: 3, dev: 'd', hash: 'h' } })
    store.recordWrite('modulo.layout.v1', 'not json')
    expect(store.state().stamps.layout).toEqual({ at: 3, dev: 'd', hash: 'h' })
  })
})

describe('补充 2：无端点的设置与空存储', () => {
  it('parseSyncState 对字面量 null 也回默认', () => {
    expect(parseSyncState('null').settings.deviceId).toBe('')
  })

  it('还没填端点就勾「记住口令」：只记下开关，不碰凭据库', async () => {
    const storage = mem()
    const store = createSyncStore(storage)
    const t = new FakeTransport()
    const sync = useSync({ store, transport: t, desktop: true, sections: () => ({}), applyRemote: () => ({ done: [], warnings: [] }) })
    sync.password.value = 'pw'
    await sync.rememberPassword(true)
    expect(t.calls).toEqual([])
    expect(sync.settings.value.remember).toBe(true)
  })

  it('网页版 init 直接返回（不去读凭据库）', async () => {
    const store = createSyncStore(mem())
    const t = new FakeTransport()
    let called = false
    t.credStatus = async () => {
      called = true
      return true
    }
    const sync = useSync({ store, transport: null, desktop: false, sections: () => ({}), applyRemote: () => ({ done: [], warnings: [] }) })
    await sync.init()
    expect(called).toBe(false)
    expect(sync.hasStored.value).toBe(false)
  })
})

describe('条件写：两台机器同刻同步不许互相洗掉', () => {
  it('GET 拿到的 ETag 会一路带到 PUT 的 If-Match', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    t.etags[LIVE_NAME] = '"abc123"'
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(t.ifMatches.at(-1)).toBe('"abc123"')
    expect(sync.status.value).toBe('ok')
  })

  it('服务端没给 ETag：退回无条件写（不编一个假校验器）', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(t.ifMatches.at(-1)).toBeNull()
    expect(sync.status.value).toBe('ok')
  })

  it('412：报"另一台设备刚改过、本次没有写入"，不落地也不假装成功', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    t.etags[LIVE_NAME] = '"v1"' // 条件写才有 412
    t.conflictOnce = true
    const { sync, applied } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('412')
    expect(sync.message.value).toContain('没有写入')
    expect(applied).toEqual([])
    const pushed = JSON.parse(t.remote[LIVE_NAME]) as SyncBundle
    expect(pushed.createdAt).toBe(1500)
    expect(sync.settings.value.lastSyncAt).toBeNull()
  })

  it('冲突是一次性的：再点一次同步就正常写入（不需要重启或重填）', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    t.etags[LIVE_NAME] = '"v1"'
    t.conflictOnce = true
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    expect((JSON.parse(t.remote[LIVE_NAME]) as SyncBundle).createdAt).toBe(2000)
  })
})

describe('历史副本恢复', () => {
  const seedHistory = (t: FakeTransport) => {
    const old = bundleWith(
      {
        layout: { at: 1000, dev: 'dev-old', body: { items: [{ id: 'old' }] } },
        cardData: { at: 1000, dev: 'dev-old', body: { todos: [{ id: 'old-todo' }] } },
      },
      'dev-old',
    )
    t.remote[historyName(1000)] = JSON.stringify(old)
    t.listing = [LIVE_NAME, historyName(1000), historyName(500), 'notes.pdf', 'sync-abc.json']
    return old
  }

  it('刷新列表：只认 sync-<毫秒>.json，新的在前，杂文件不进列表', async () => {
    const t = new FakeTransport()
    seedHistory(t)
    const { sync } = setup({ transport: t })
    await sync.refreshHistory()
    expect(sync.history.value.map((h) => h.name)).toEqual([historyName(1000), historyName(500)])
  })

  it('恢复一份：先进确认块（写明来源与将要覆盖的段），确认后才落地并推回网盘', async () => {
    const t = new FakeTransport()
    seedHistory(t)
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-new', body: { items: [{ id: 'new' }] } } }))
    t.etags[LIVE_NAME] = '"cur"'
    const { sync, applied } = setup({ transport: t })

    await sync.restoreHistory(historyName(1000))
    expect(sync.pending.value?.source).toBe('history')
    expect(sync.pending.value?.historyName).toBe(historyName(1000))
    expect(Object.keys(sync.pending.value!.sections).sort()).toEqual(['cardData', 'layout'])
    expect(sync.message.value).toContain('确认后')
    expect(applied).toEqual([])
    expect(t.calls.filter((c) => c.startsWith('put '))).toEqual([])

    await sync.confirmApply()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual({ layout: { items: [{ id: 'old' }] }, cardData: { todos: [{ id: 'old-todo' }] } })
    expect(t.ifMatches.at(-1)).toBe('"cur"')
    expect(sync.status.value).toBe('ok')
  })

  it('名字不是历史副本 / 副本已被轮转清掉：都拒绝，且什么都不动', async () => {
    const t = new FakeTransport()
    const { sync, applied } = setup({ transport: t })
    await sync.restoreHistory('notes.pdf')
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('不是历史副本')

    await sync.restoreHistory(historyName(999))
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('已经不在了')
    expect(applied).toEqual([])
  })

  it('历史副本本身读不懂：拒绝并说明"没有改动任何东西"', async () => {
    const t = new FakeTransport()
    t.remote[historyName(700)] = '{"sections":{'
    const { sync, applied } = setup({ transport: t })
    await sync.restoreHistory(historyName(700))
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('没有改动任何东西')
    expect(applied).toEqual([])
  })
})

describe('历史副本与确认块的边界', () => {
  it('列历史副本失败：留一条提示，不挡其它操作', async () => {
    const t = new FakeTransport()
    t.list = async () => {
      throw new Error('目录列不出来')
    }
    const { sync } = setup({ transport: t })
    await sync.refreshHistory()
    expect(sync.notices.value.join()).toContain('读历史副本列表失败')
    expect(sync.history.value).toEqual([])
  })

  it('历史副本里一段都没有：拒绝恢复，什么都不动', async () => {
    const t = new FakeTransport()
    t.remote[historyName(600)] = JSON.stringify({
      kind: SYNC_KIND,
      version: SYNC_VERSION,
      deviceId: 'dev-x',
      createdAt: 600,
      sections: {},
    })
    const { sync, applied } = setup({ transport: t })
    await sync.restoreHistory(historyName(600))
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('没有可恢复的段')
    expect(applied).toEqual([])
  })

  it('确认时网盘被抢先写：如实说"本机已更新、网盘没推上去"，不谎报本机失败', async () => {
    const t = new FakeTransport()
    t.remote[historyName(1000)] = JSON.stringify(
      bundleWith({ layout: { at: 1000, dev: 'dev-old', body: { items: [{ id: 'old' }] } } }, 'dev-old'),
    )
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-new', body: { items: [{ id: 'new' }] } } }))
    t.etags[LIVE_NAME] = '"cur"'
    const { sync } = setup({ transport: t })
    await sync.restoreHistory(historyName(1000))
    t.conflictOnce = true // 落地之后、推回那一刻被抢先
    await sync.confirmApply()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('本机已更新')
    expect(sync.message.value).toContain('412')
  })
})

describe('历史副本：不可用与参数不合法时不发请求', () => {
  it('网页版（无传输）：refreshHistory / restoreHistory 都直接返回', async () => {
    const store = createSyncStore(mem())
    const sync = useSync({ store, transport: null, desktop: false, sections: () => ({}), applyRemote: () => ({ done: [], warnings: [] }) })
    await sync.refreshHistory()
    await sync.restoreHistory(historyName(1))
    expect(sync.history.value).toEqual([])
    expect(sync.status.value).toBe('idle')
  })

  it('端点不合法时不列目录（避免把坏地址发给网盘）', async () => {
    const t = new FakeTransport()
    const { sync } = setup({ transport: t })
    sync.save({ endpoint: 'http://192.168.1.2/dav/' })
    await sync.refreshHistory()
    expect(t.calls).toEqual([])
    expect(sync.status.value).toBe('error')
  })
})

describe('自动同步：判据是纯函数，节拍只是执行它', () => {
  const base = {
    enabled: true,
    usable: true,
    busy: false,
    pending: false,
    lastSyncAt: null as number | null,
    now: 1_000_000,
    hidden: false,
  }

  it('六个条件缺一不可', () => {
    expect(shouldAutoSync(base)).toBe(true)
    for (const patch of [{ enabled: false }, { usable: false }, { busy: true }, { pending: true }, { hidden: true }]) {
      expect(shouldAutoSync({ ...base, ...patch }), JSON.stringify(patch)).toBe(false)
    }
  })

  it('间隔：满 15 分钟才跑，差一毫秒都不跑', () => {
    const last = base.now - AUTO_INTERVAL_MS + 1
    expect(shouldAutoSync({ ...base, lastSyncAt: last })).toBe(false)
    expect(shouldAutoSync({ ...base, lastSyncAt: base.now - AUTO_INTERVAL_MS })).toBe(true)
  })

  it('从没成功过就立刻可以跑（首次同步都是上传，不需要抉择）', () => {
    expect(shouldAutoSync({ ...base, lastSyncAt: null })).toBe(true)
  })

  it('开启后立刻跑一次，之后按 15 分钟节拍走，关掉就不再跑', async () => {
    vi.useFakeTimers()
    try {
      const t = new FakeTransport()
      const { sync, store } = setup({ transport: t })
      sync.save({ auto: true })
      sync.startAuto()
      await vi.advanceTimersByTimeAsync(0)
      expect(t.calls.filter((c) => c.startsWith('get ')).length).toBe(1) // 首次立刻跑
      expect(store.state().settings.lastSyncAt).not.toBeNull()

      sync.stopAuto()
      const before = t.calls.length
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(t.calls.length).toBe(before) // 停了就不动
    } finally {
      vi.useRealTimers()
    }
  })

  it('有下载待确认时自动同步不跑（绝不替用户按确认）', async () => {
    vi.useFakeTimers()
    try {
      const t = new FakeTransport()
      t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [] } } }))
      const { sync, applied } = setup({ transport: t })
      sync.save({ auto: true })
      sync.startAuto()
      await vi.advanceTimersByTimeAsync(0)
      expect(sync.pending.value).not.toBeNull() // 进了确认块
      expect(applied).toEqual([])
      const after = t.calls.length
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(t.calls.length).toBe(after) // pending 未清，不再跑
      sync.cancelApply()
      sync.stopAuto()
    } finally {
      vi.useRealTimers()
    }
  })

  it('后台失败不把状态打红，只留一条"自动同步没成"', async () => {
    const t = new FakeTransport()
    t.get = async () => {
      throw new Error('连不上网盘：timeout')
    }
    const { sync } = setup({ transport: t })
    sync.save({ auto: true })
    await sync.syncNow({ auto: true })
    expect(sync.status.value).toBe('idle')
    expect(sync.notices.value.join()).toContain('自动同步没成')
  })
})

describe('自动同步的启停边界', () => {
  it('重复 startAuto 不会挂第二个定时器（只跑一轮）', async () => {
    vi.useFakeTimers()
    try {
      const t = new FakeTransport()
      const { sync } = setup({ transport: t })
      sync.save({ auto: true })
      sync.startAuto()
      sync.startAuto()
      await vi.advanceTimersByTimeAsync(0)
      const gets = t.calls.filter((c) => c.startsWith('get ')).length
      expect(gets).toBe(1)
      sync.stopAuto()
    } finally {
      vi.useRealTimers()
    }
  })

  it('没启动就 stopAuto / 再 stopAuto 都是无操作（不抛）', () => {
    const { sync } = setup()
    expect(() => sync.stopAuto()).not.toThrow()
    expect(() => sync.stopAuto()).not.toThrow()
  })

  it('没开开关时 startAuto 的那次立刻判据直接放弃（不发请求）', async () => {
    const t = new FakeTransport()
    const { sync } = setup({ transport: t })
    sync.save({ auto: false })
    sync.startAuto()
    await Promise.resolve()
    expect(t.calls).toEqual([])
    sync.stopAuto()
  })
})

describe('补充 3：默认时钟、空 done、无 ETag 的恢复、空轮转、展示函数', () => {
  it('不注入时钟时用 Date.now（默认参数的兜底不能是坏的）', async () => {
    const storage = mem()
    const store = createSyncStore(storage)
    store.patch({ endpoint: 'https://dav.example.com/dav/modulo/', user: 'me' })
    const t = new FakeTransport()
    const sync = useSync({ store, transport: t, desktop: true, sections: () => SECTIONS, applyRemote: () => ({ done: [], warnings: [] }) })
    sync.password.value = 'pw'
    await sync.syncNow()
    expect(sync.status.value).toBe('ok')
    expect(store.state().settings.lastSyncAt).toBeGreaterThan(0)
  })

  it('非 Error 的抛出（字符串）也进提示，不会变成 [object Object]', async () => {
    const t = new FakeTransport()
    t.get = async () => {
      throw '网盘挂了' // eslint-disable-line no-throw-literal
    }
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(sync.status.value).toBe('error')
    expect(sync.message.value).toContain('网盘挂了')
  })

  it('网页版点「测试连接」：静默返回（没有通道，不该假报成功）', async () => {
    const store = createSyncStore(mem())
    const sync = useSync({ store, transport: null, desktop: false, sections: () => ({}), applyRemote: () => ({ done: [], warnings: [] }) })
    await sync.test()
    expect(sync.status.value).toBe('idle')
  })

  it('测试连接：端点不合法时直接给理由，不 probe', async () => {
    const t = new FakeTransport()
    const { sync } = setup({ transport: t })
    sync.save({ endpoint: 'http://nas.local/dav/' })
    await sync.test()
    expect(sync.status.value).toBe('error')
    expect(t.calls).toEqual([])
  })

  it('没有待确认时 confirmApply 是无操作；落地后本机无变化也能说清', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 1900, dev: 'dev-b', body: { items: [] } } }))
    const storage = mem()
    const store = createSyncStore(storage)
    store.patch({ endpoint: 'https://dav.example.com/dav/modulo/', user: 'me' })
    const applied: unknown[] = []
    const sync = useSync({
      store,
      transport: t,
      desktop: true,
      sections: () => SECTIONS,
      applyRemote: (r) => {
        applied.push(r)
        return { done: [], warnings: [] } // 宿主认为没有需要落地的东西
      },
      now: () => 2000,
    })
    sync.password.value = 'pw'
    await sync.confirmApply() // 没有 pending：直接返回，不发请求
    expect(applied).toEqual([])
    expect(t.calls).toEqual([])

    await sync.syncNow()
    await sync.confirmApply()
    expect(sync.notices.value.join()).toContain('无变化')
  })

  it('恢复历史副本时 live 读不到：etag 为 null（退回无条件写）', async () => {
    const t = new FakeTransport()
    t.remote[historyName(1000)] = JSON.stringify(
      bundleWith({ layout: { at: 1000, dev: 'dev-old', body: { items: [{ id: 'old' }] } } }, 'dev-old'),
    )
    // live 不存在 → t.get(LIVE_NAME) 返回 null
    const { sync } = setup({ transport: t })
    await sync.restoreHistory(historyName(1000))
    expect(sync.pending.value?.etag).toBeNull()
    await sync.confirmApply()
    expect(t.ifMatches.at(-1)).toBeNull()
  })

  it('历史副本全部在额度内：轮转不发 DELETE', async () => {
    const t = new FakeTransport()
    t.remote[LIVE_NAME] = JSON.stringify(bundleWith({ layout: { at: 800, dev: 'dev-b', body: { items: [] } } }))
    t.listing = [LIVE_NAME, historyName(500)]
    const { sync } = setup({ transport: t })
    await sync.syncNow()
    expect(t.calls.filter((c) => c.startsWith('remove '))).toEqual([])
  })

  it('describePending 对历史副本只列那几段（source 分支）', async () => {
    const t = new FakeTransport()
    t.remote[historyName(1000)] = JSON.stringify(
      bundleWith({ layout: { at: 1000, dev: 'dev-old', body: { items: [] } } }, 'dev-old'),
    )
    const { sync } = setup({ transport: t })
    await sync.restoreHistory(historyName(1000))
    expect(describePending(sync.pending.value!)).toContain('历史副本那一版')
  })
})
