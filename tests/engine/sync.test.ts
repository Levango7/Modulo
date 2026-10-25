import { describe, expect, it } from 'vitest'
import {
  buildBundle,
  DEVICE_ID_MAX,
  HISTORY_KEEP,
  hashOf,
  historyName,
  isSyncSection,
  joinSyncPath,
  makeDeviceId,
  normalizeDeviceId,
  parseBundle,
  parseHistoryName,
  planHistoryRotation,
  planMerge,
  stampsOf,
  stableStringify,
  stampOk,
  summarizePlan,
  SYNC_SECTIONS,
  validateSyncEndpoint,
  type SectionStamp,
} from '@levango7/engine/sync'

/**
 * 多端同步的判据层。这里钉的全是**会洗掉用户数据**的那几条：
 * 谁覆盖谁、坏时间戳会不会被当成"很旧"、不认识的文件会不会被误删、
 * 内容一样会不会凭空多出一次搬运。
 */

const at = (n: number) => 1_700_000_000_000 + n * 1000
const stamp = (over: Partial<SectionStamp> = {}): SectionStamp => ({ at: at(1), dev: 'dev-a', hash: 'h1', ...over })

describe('内容指纹', () => {
  it('对键的顺序不敏感 —— 同一份数据的两种写法不许被判成冲突', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }))
    expect(hashOf({ items: [{ x: 1, y: 2 }] })).toBe(hashOf({ items: [{ y: 2, x: 1 }] }))
  })

  it('数组顺序敏感：版面行的先后是用户看见的东西，换了就是换了', () => {
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]))
  })

  it('值真的变了要变；嵌套变了也要变', () => {
    expect(hashOf({ todos: ['a'] })).not.toBe(hashOf({ todos: ['b'] }))
    expect(hashOf({ a: { b: { c: 1 } } })).not.toBe(hashOf({ a: { b: { c: 2 } } }))
  })

  it('stableStringify 把 undefined 键丢掉，与 JSON.stringify 同口径（否则两边算出的指纹会因一侧多一个空键而永远不等）', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('x')).toBe('"x"')
    // JSON.stringify(undefined) 返回 undefined（不是字符串"undefined"），兜底必须是 'null'，
    // 否则一侧整体是 undefined 时指纹会算出 "undefined" 这个假内容
    expect(stableStringify(undefined)).toBe('null')
    expect(hashOf(undefined)).toBe(hashOf(null))
  })
})

describe('时间戳可用性：不猜', () => {
  it('只认有限正数；0 / 负 / NaN / Infinity / 字符串都算坏', () => {
    expect(stampOk(1)).toBe(true)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1700000000000', null, undefined]) {
      expect(stampOk(bad), String(bad)).toBe(false)
    }
  })

  /**
   * 这条是本节最要紧的判据。把坏时间戳当 0 参与比较的后果是"远端一份被截断的文件
   * 把本机所有段判成更新"，于是本机数据被一份读不出来的东西覆盖掉。
   */
  it('坏时间戳不参与比较：判 invalid 且两侧都不动', () => {
    const plan = planMerge({ layout: stamp({ at: at(5), hash: 'L' }) }, { layout: stamp({ at: Number.NaN, hash: 'R', dev: 'dev-b' }) })
    expect(plan).toHaveLength(1)
    expect(plan[0].action).toBe('invalid')
    expect(plan[0].winner).toBeNull()
    expect(plan[0].reason).toContain('不可用')
  })

  it('本机那侧的坏时间戳同样判 invalid（不许因为"是自己家"就默认本机赢）', () => {
    const plan = planMerge({ layout: stamp({ at: -9 }) }, { layout: stamp({ hash: 'R', dev: 'dev-b' }) })
    expect(plan[0].action).toBe('invalid')
  })
})

describe('逐段裁决', () => {
  it('只有一边有：推 / 拉，各一条', () => {
    expect(planMerge({ layout: stamp() }, {})).toEqual([
      expect.objectContaining({ section: 'layout', action: 'upload', winner: 'local' }),
    ])
    expect(planMerge({}, { schemes: stamp() })).toEqual([
      expect.objectContaining({ section: 'schemes', action: 'download', winner: 'remote' }),
    ])
  })

  it('两边都没有：不产出行（免得界面上出现四条"无需搬运"的噪声）', () => {
    expect(planMerge({}, {})).toEqual([])
  })

  it('内容一致就不动 —— 哪怕时间戳差了一天', () => {
    const plan = planMerge({ cardData: stamp({ at: at(9), hash: 'same' }) }, { cardData: stamp({ at: at(1), hash: 'same', dev: 'dev-b' }) })
    expect(plan[0].action).toBe('skip')
    expect(plan[0].winner).toBeNull()
  })

  it('时间戳谁新听谁的，两侧都算出同一个赢家（对称性）', () => {
    const a = planMerge({ layout: stamp({ at: at(3), hash: 'L' }) }, { layout: stamp({ at: at(9), hash: 'R', dev: 'dev-b' }) })
    const b = planMerge({ layout: stamp({ at: at(9), hash: 'L', dev: 'dev-b' }) }, { layout: stamp({ at: at(3), hash: 'R' }) })
    expect(a[0].action).toBe('remote-wins')
    expect(b[0].action).toBe('local-wins')
  })

  /**
   * 平局必须**收敛**：两边都判"对方赢"会把同一次同步跑成乒乓（A 拉到 B 的、B 又拉到 A 的）。
   * 判本机赢 + 远端那份留在历史副本里，是"可见的覆盖"而不是"看不见的丢失"。
   */
  it('同一时刻内容不同 → 判本机赢，并把远端那份的去向写进理由', () => {
    const plan = planMerge({ settings: stamp({ at: at(5), hash: 'L', dev: 'dev-a' }) }, { settings: stamp({ at: at(5), hash: 'R', dev: 'dev-b' }) })
    expect(plan[0].action).toBe('local-wins')
    expect(plan[0].reason).toContain('历史副本')
  })

  it('同一台设备的同一时刻不算冲突（重复上传、或把远端包原样读回来）', () => {
    const plan = planMerge({ layout: stamp({ at: at(5), hash: 'L', dev: 'dev-a' }) }, { layout: stamp({ at: at(5), hash: 'R', dev: 'dev-a' }) })
    expect(plan[0].action).toBe('skip')
    expect(plan[0].reason).toContain('同一台设备')
  })

  it('清单固定按 SYNC_SECTIONS 走：调用方多塞的段（比如凭据）不产出行', () => {
    const sneaky = { aiSettings: stamp(), layout: stamp() } as unknown as Partial<Record<(typeof SYNC_SECTIONS)[number], SectionStamp>>
    const plan = planMerge(sneaky, sneaky)
    expect(plan.map((d) => d.section)).toEqual(['layout'])
    expect(plan[0].action).toBe('skip')
  })

  it('四段同时给出四行，顺序就是清单顺序（界面按它排版）', () => {
    const local = Object.fromEntries(SYNC_SECTIONS.map((s) => [s, stamp({ at: at(2) })])) as Partial<Record<(typeof SYNC_SECTIONS)[number], SectionStamp>>
    const remote = Object.fromEntries(SYNC_SECTIONS.map((s) => [s, stamp({ at: at(1), dev: 'dev-b' })])) as Partial<Record<(typeof SYNC_SECTIONS)[number], SectionStamp>>
    expect(planMerge(local, remote).map((d) => d.section)).toEqual([...SYNC_SECTIONS])
  })

  it('isSyncSection 只认清单里的名字', () => {
    expect(isSyncSection('layout')).toBe(true)
    for (const bad of ['ai-settings', 'shell', 'carddata', '', 'LAYOUT']) expect(isSyncSection(bad), bad).toBe(false)
  })

  /**
   * `stampsOf` 是传输层喂给 `planMerge` 的唯一入口，所以"清单里这一位是空的"必须产不出戳：
   * 少这一条的话，一个 `sections: { layout: undefined }` 的包会带着 undefined 进裁决，
   * 而 `planMerge` 里 undefined 与 null 走的是同一个"没有"分支 —— 真正会出事的是
   * 有人后续把 `?? null` 改掉，那时没有这条断言就只剩远端包能触发。
   */
  it('stampsOf 只摘存在的段，缺失/为空的段不产出条目', () => {
    expect(stampsOf({ sections: { layout: undefined, schemes: { at: at(2), dev: 'd', hash: 'h' } as never } })).toEqual({
      schemes: { at: at(2), dev: 'd', hash: 'h' },
    })
    expect(stampsOf({ sections: {} })).toEqual({})
  })
})

describe('打包与解包', () => {
  const body = { layout: { items: [] }, schemes: { schemes: [] }, cardData: { todos: [] }, settings: { appearance: {} } }

  it('buildBundle 给每段打上同一时刻 + 自己的设备 + 内容指纹', () => {
    const b = buildBundle(body, 'dev-me', at(7))
    expect(b.kind).toBe('modulo.sync')
    expect(b.version).toBe(1)
    expect(b.deviceId).toBe('dev-me')
    for (const s of SYNC_SECTIONS) {
      expect(b.sections[s]?.at).toBe(at(7))
      expect(b.sections[s]?.dev).toBe('dev-me')
      expect(b.sections[s]?.hash).toBe(hashOf(body[s as keyof typeof body]))
    }
  })

  it('没给的段不进包（undefined 不等于"空的也要推一份"）', () => {
    const b = buildBundle({ layout: body.layout }, 'dev-me', at(7))
    expect(Object.keys(b.sections)).toEqual(['layout'])
  })

  it('设备标识或时刻不合法直接抛 —— 造一个"没有身份"的包比不造更糟', () => {
    expect(() => buildBundle(body, '', at(1))).toThrow()
    expect(() => buildBundle(body, 'dev/../evil', at(1))).toThrow()
    expect(() => buildBundle(body, 'dev-me', 0)).toThrow()
  })

  it('往返一致：解出来的戳与指纹能被 planMerge 直接用（本机侧判 skip）', () => {
    const b = buildBundle(body, 'dev-me', at(7))
    const parsed = parseBundle(JSON.stringify(b))
    expect(parsed.problems).toEqual([])
    expect(parsed.bundle).toEqual(b)
    const local = Object.fromEntries(SYNC_SECTIONS.map((s) => [s, { at: at(7), dev: 'dev-me', hash: b.sections[s]!.hash }]))
    const plan = planMerge(local, stampsOf(parsed.bundle!))
    expect(plan.every((d) => d.action === 'skip')).toBe(true)
  })

  it('坏 JSON 不等于空包：明确报"没解析出任何段"，不许被当成"远端什么都没有"于是本机覆盖上去', () => {
    const r = parseBundle('{"sections": {"layout"')
    expect(r.bundle).toBeNull()
    expect(r.problems.join()).toContain('不是合法 JSON')
  })

  it('version 高于本程序支持的版本 → 拒绝按本格式读', () => {
    const b = buildBundle(body, 'dev-me', at(7))
    const future = JSON.stringify({ ...b, version: 99 })
    const r = parseBundle(future)
    expect(r.bundle).toBeNull()
    expect(r.problems.join()).toContain('高于本程序支持')
  })

  it('version 不是数字或不是有限数（字面量 1e999 → Infinity）都点名，不当成有效版本', () => {
    const b = buildBundle(body, 'dev-me', at(7))
    expect(parseBundle(JSON.stringify({ ...b, version: '1' })).problems.join()).toContain('不是数字')
    // 只能手写 JSON 字面量来构造 Infinity：`JSON.stringify(Infinity)` 产出的是 `null`
    // （走的是"不是数字"那一支），而远端文件是被**写**出来的、不是被 stringify 出来的，
    // 所以 `1e999` 这种形状真的会出现，必须单独判掉。
    const huge = JSON.stringify({ ...b }).replace('"version":1', '"version":1e999')
    expect(huge).toContain('"version":1e999')
    const parsed = JSON.parse(huge) as { version: unknown }
    expect(parsed.version).toBe(Number.POSITIVE_INFINITY) // 前提成立：解析出来确实是 Infinity
    expect(parseBundle(huge).problems.join()).toContain('不是数字')
  })

  it('kind 不对 / 顶层是数组 / deviceId 缺失 / createdAt 坏 / sections 不是对象 —— 逐个点名', () => {
    expect(parseBundle(JSON.stringify({ kind: 'other', version: 1, deviceId: 'd', createdAt: at(1), sections: {} })).problems.join()).toContain('kind')
    expect(parseBundle('[]').problems.join()).toContain('顶层不是对象')
    const b = buildBundle(body, 'dev-me', at(7))
    expect(parseBundle(JSON.stringify({ ...b, deviceId: 'x'.repeat(DEVICE_ID_MAX + 1) })).problems.join()).toContain('deviceId')
    expect(parseBundle(JSON.stringify({ ...b, createdAt: '昨天' })).problems.join()).toContain('createdAt')
    expect(parseBundle(JSON.stringify({ ...b, sections: [] })).problems.join()).toContain('sections')
  })

  it('不认识的一段被忽略而不是让整包不可读；但疑似凭据的段要单独喊一声', () => {
    const b = buildBundle({ layout: body.layout }, 'dev-me', at(7))
    const withExtras = JSON.stringify({
      ...b,
      sections: { ...b.sections, somethingElse: { at: at(1), dev: 'dev-me', hash: 'z', body: 1 }, 'ai-settings': { at: at(1), dev: 'dev-me', hash: 'z', body: { key: 'sk-x' } } },
    })
    const r = parseBundle(withExtras)
    expect(r.problems).toEqual([])
    expect(Object.keys(r.bundle!.sections)).toEqual(['layout'])
    expect(r.sections.map((s) => s.problem).join()).toContain('疑似凭据')
    expect(r.sections.map((s) => s.problem).join()).toContain('已忽略')
  })

  it('某一段戳记不完整 → 只丢那一段，并点名是哪段（界面要能说"layout 没同步"）', () => {
    const b = buildBundle(body, 'dev-me', at(7))
    const broken = JSON.parse(JSON.stringify(b))
    broken.sections.cardData.at = 0
    broken.sections.settings.hash = ''
    const r = parseBundle(JSON.stringify(broken))
    expect(r.bundle && Object.keys(r.bundle.sections).sort()).toEqual(['layout', 'schemes'])
    expect(r.sections.map((s) => s.section).sort()).toEqual(['cardData', 'settings'])
  })
})

describe('设备标识', () => {
  it('收字母数字点横杠下划线，限长；其余（空格、斜杠、中文、超长）全拒', () => {
    expect(normalizeDeviceId(' dev-a.1_b ')).toBe('dev-a.1_b')
    for (const bad of ['', ' ', 'dev/a', 'dev a', '设备', 'x'.repeat(DEVICE_ID_MAX + 1), 42, null]) {
      expect(normalizeDeviceId(bad), String(bad)).toBeNull()
    }
  })

  /**
   * 随机源注入而不是碰运气：rand 恒给 0 / 恒给接近 1 / 给出 NaN 时都要造出合法形状，
   * 否则第一次同步就带一个进不了文件名的 id。
   */
  it('makeDeviceId 对任何随机源都产出合法形状（含抛 NaN 的坏源）', () => {
    for (const rand of [() => 0, () => 0.999999, () => 0.5, () => Number.NaN, () => -1, () => 99]) {
      const id = makeDeviceId(rand)
      expect(id).toMatch(/^dev-[a-z0-9]{8}$/)
      expect(normalizeDeviceId(id)).toBe(id)
    }
    expect(makeDeviceId(() => 0.123456789)).toBe(makeDeviceId(() => 0.123456789)) // 同源必同值
  })
})

describe('端点判据：复用 watch.ts 那一套边界', () => {
  it('收公网 https，补齐结尾斜杠', () => {
    expect(validateSyncEndpoint('https://dav.example.com/dav/modulo')).toEqual({ ok: true, url: 'https://dav.example.com/dav/modulo/' })
    expect(validateSyncEndpoint('https://dav.example.com/').ok).toBe(true)
  })

  it('拒空、拒 http、拒查询串、拒目录穿越（**编码后也要拒**——`..%2F` 解出来就是 `../`，服务器会解它）', () => {
    expect(validateSyncEndpoint('').reason).toContain('空的')
    expect(validateSyncEndpoint('http://dav.example.com/').reason).toContain('https')
    expect(validateSyncEndpoint('https://dav.example.com/d?p=1').reason).toContain('查询串')
    for (const bad of ['https://dav.example.com/../etc', 'https://dav.example.com/a/../../b', 'https://dav.example.com/..%2Fx', 'https://dav.example.com/%2e%2e/etc']) {
      expect(validateSyncEndpoint(bad).ok, bad).toBe(false)
    }
    expect(validateSyncEndpoint('https://dav.example.com/%E4%B8%AD%E6%96%87/').ok).toBe(true) // 正常编码的目录名照收（"中文"两字）
    expect(validateSyncEndpoint('https://dav.example.com/%E4%B8').reason).toContain('百分号') // 截断的编码序列不猜
  })

  /**
   * 这条是把 `watch.ts` 的边界真正接上了的证据：把 sync 端点改成私网地址后，
   * 如果哪天有人把 `normalizeUrl` 换成一个不做边界检查的解析，这里就会绿变红之前先在这里断掉。
   */
  it('拒内网/本机/云元数据地址（与连通性监控同一条取舍，代价一并写在文档里）', () => {
    for (const bad of ['https://192.168.1.10/dav', 'https://127.0.0.1/dav', 'https://localhost/dav', 'https://169.254.169.254/latest', 'https://nas.local/dav', 'https://[::1]/dav']) {
      expect(validateSyncEndpoint(bad).ok, bad).toBe(false)
      expect(validateSyncEndpoint(bad).reason, bad).toContain('https')
    }
  })

  it('userinfo 不收（凭据不该在地址里）', () => {
    expect(validateSyncEndpoint('https://user:pw@dav.example.com/').ok).toBe(false)
  })

  /**
   * 端点是**从存储里读出来的**，可能是 undefined（首次配置、或那一整段没写成功）。
   * `(input ?? '').trim()` 的兜底分支必须有真调用方，否则设置面板一进来就会
   * 在 `.trim()` 上抛异常，把整个界面打挂。
   */
  it('非字符串输入（undefined / null）当空处理，不抛', () => {
    for (const bad of [undefined, null]) {
      const v = validateSyncEndpoint(bad as unknown as string)
      expect(v.ok).toBe(false)
      expect(v.reason).toContain('空的')
    }
  })
})

describe('路径拼接与历史副本', () => {
  it('joinSyncPath 只认安全文件名，且再查一遍穿越', () => {
    expect(joinSyncPath('https://dav.example.com/dav/modulo/', 'live.json')).toBe('https://dav.example.com/dav/modulo/live.json')
    for (const bad of ['../etc/passwd', 'a/b.json', '中文.json', '', '..']) expect(() => joinSyncPath('https://x.example.com/', bad), bad).toThrow()
  })

  it('historyName 用毫秒定名；时刻不可用就抛（不产出一个认不出来的名字）', () => {
    expect(historyName(at(3))).toBe(`sync-${at(3)}.json`)
    expect(() => historyName(Number.NaN)).toThrow()
    expect(parseHistoryName(`sync-${at(3)}.json`)).toBe(at(3))
    for (const junk of ['live.json', 'sync-abc.json', 'sync-.json', 'sync-0.json', 'sync--1.json']) expect(parseHistoryName(junk), junk).toBeNull()
  })

  /**
   * 两条安全性质，都要真的钉住：
   * ① 不认识的文件名**不进删除名单**（远端是用户的网盘，里面有他别的文件）；
   * ② 也不占保留额度（否则用户多放一个文件就能把该留的历史副本挤掉）。
   */
  it('旋转只删认识的历史副本，未知文件既不动也不占额度', () => {
    const names = ['keepme.txt', ...Array.from({ length: HISTORY_KEEP + 3 }, (_, i) => `sync-${at(i)}.json`), 'notes.pdf']
    const r = planHistoryRotation(names)
    expect(r.remove).toHaveLength(3)
    expect(r.remove.every((n) => parseHistoryName(n) !== null)).toBe(true)
    expect(r.keep).toContain('keepme.txt')
    expect(r.keep).toContain('notes.pdf')
    expect(r.keep.filter((n) => parseHistoryName(n) !== null)).toHaveLength(HISTORY_KEEP)
  })

  it('不超限就一个都不删；正好等于额度也不删', () => {
    const ok = Array.from({ length: HISTORY_KEEP }, (_, i) => `sync-${at(i)}.json`)
    expect(planHistoryRotation(ok).remove).toEqual([])
    expect(planHistoryRotation([...ok, 'sync-9999999999999.json']).remove).toEqual([`sync-${at(0)}.json`])
  })

  it('清单里重复出现的同一个文件不占两个额度；去掉重复项后新在前后，两侧必然算出同一个删除名单', () => {
    const dup = ['sync-2.json', 'sync-1.json', 'sync-2.json']
    const r = planHistoryRotation(dup, 1)
    expect(r.keep).toEqual(['sync-2.json']) // 去重后 2 是最新的，占那一个额度
    expect(r.remove).toEqual(['sync-1.json']) // 重复项不会被列进删除名单两次
    expect(planHistoryRotation(['sync-300.json', 'sync-200.json', 'sync-100.json'], 2).remove).toEqual(['sync-100.json'])
  })

  it('keep 传坏值（NaN / 负数）按默认额度处理，不许算出"把全部历史都删掉"；显式要 0 份才照 0 份算', () => {
    const names = Array.from({ length: 3 }, (_, i) => `sync-${at(i)}.json`)
    for (const bad of [Number.NaN, -1, -0.5]) {
      expect(planHistoryRotation(names, bad).remove, String(bad)).toEqual([])
    }
    const zero = planHistoryRotation(names, 0)
    expect([...zero.remove].sort()).toEqual([...names].sort())
    expect(zero.keep).toEqual([])
  })
})

describe('给界面的一句话', () => {
  const mk = (actions: string[]) =>
    actions.map((a, i) => ({ section: SYNC_SECTIONS[i % SYNC_SECTIONS.length], action: a as never, reason: '', winner: null }))

  it('推/拉各自计数；invalid 单独点名（它意味着"这次这几段不动"）', () => {
    expect(summarizePlan(mk(['upload', 'local-wins', 'download']))).toBe('推 2 段，拉 1 段')
    expect(summarizePlan(mk(['skip']))).toBe('两边一致，无需搬运')
    expect(summarizePlan(mk(['invalid', 'upload']))).toBe('推 1 段，1 段时间戳不可用，这些段这次不动')
  })

  it('空计划说"无需搬运"，不说"推 0 段"', () => {
    expect(summarizePlan([])).toBe('两边一致，无需搬运')
  })
})
