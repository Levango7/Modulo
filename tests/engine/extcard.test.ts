/**
 * 原生卡扩展的判定层（`packages/engine/src/extcard.ts`，2026-10-27）。
 *
 * 这份文件锁四件事：
 * ① **manifest 校验的每条失败原因都真实可达** —— 用户把卡包 JSON 粘进文本框，
 *    那句 reason 是他得到的全部反馈，每一条都得有人话且每个分支都有用例走到；
 * ② 清洗骨架（丢坏条 / 去重 / 上限）与其它名单同一套；
 * ③ **桥的方法面**：白名单外的请求拿不到任何回声（parseBridgeRequest 返回 null），
 *    这是"能力面收在方法清单上"这句话的 executable 版本；
 * ④ 状态与应答的上限真的拦得住（字节上限不是装饰）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXT_GROUP,
  EXT_METHODS,
  EXT_PREFIX,
  LOGICAL_COLS,
  MAX_EXT_CARDS,
  MAX_EXT_HTML_BYTES,
  MAX_EXT_MIN_H,
  MAX_EXT_STATE_BYTES,
  bridgeReply,
  extIdOf,
  extModuleDef,
  extModuleDefs,
  extModuleId,
  isExtModule,
  parseBridgeRequest,
  parseExtManifest,
  sanitizeExtCards,
  sanitizeExtState,
  type ExtCard,
} from '../../packages/engine/src/extcard'

/** 一份合法卡包：改哪条字段就让它死在哪条原因上 */
const good = {
  id: 'my-card',
  title: '我的卡',
  group: '演示',
  blurb: '一句话说明',
  html: '<b>你好</b><script>1+1</script>',
  variants: [
    { id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    { id: 'tall', name: '长条', minW: 1, minH: 3, idealW: 2, idealH: 4 },
  ],
}

const asExt = (r: ReturnType<typeof parseExtManifest>): ExtCard => {
  if (!r.ok) throw new Error(`期望合法卡包，实际：${r.reason}`)
  return r.card
}

describe('parseExtManifest：每条失败原因都有用例走到', () => {
  it('不是普通对象（null / 字符串 / 数组）各给同一条原因', () => {
    for (const bad of [null, '卡包', 42, [], true]) {
      const r = parseExtManifest(bad)
      expect(r.ok, String(bad)).toBe(false)
      if (!r.ok) expect(r.reason).toContain('JSON 对象')
    }
  })

  it('id：缺失 / 形状不对 / 大写开头都拒', () => {
    expect(parseExtManifest({ ...good, id: 7 }).ok).toBe(false)
    expect(parseExtManifest({ ...good, id: '1abc' }).ok).toBe(false)
    expect(parseExtManifest({ ...good, id: 'Bad_ID' }).ok).toBe(false)
    expect(parseExtManifest({ ...good, id: '' }).ok).toBe(false)
    // 合法：小写字母开头、带连字符与数字
    expect(parseExtManifest({ ...good, id: 'a' }).ok).toBe(true)
    expect(parseExtManifest({ ...good, id: 'a0-9z' }).ok).toBe(true)
  })

  it('title：空拒（trim 后）、超长拒、缺失拒', () => {
    expect(parseExtManifest({ ...good, title: '   ' }).ok).toBe(false)
    expect(parseExtManifest({ ...good, title: 'x'.repeat(25) }).ok).toBe(false)
    const noTitle = { ...good } as Record<string, unknown>
    delete noTitle.title
    expect(parseExtManifest(noTitle).ok).toBe(false)
  })

  it('html：空 / 纯空白 / 超长 / 非字符串都拒', () => {
    expect(parseExtManifest({ ...good, html: '' }).ok).toBe(false)
    expect(parseExtManifest({ ...good, html: '  \n ' }).ok).toBe(false)
    expect(parseExtManifest({ ...good, html: 'x'.repeat(MAX_EXT_HTML_BYTES + 1) }).ok).toBe(false)
    expect(parseExtManifest({ ...good, html: 7 }).ok).toBe(false)
  })

  it('variants：缺失为空、超过 4 个、条目不是对象、id 缺/长、重名、name 空', () => {
    const noVariants = { ...good } as Record<string, unknown>
    delete noVariants.variants
    expect(parseExtManifest(noVariants).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [1, 2, 3, 4, 5].map(() => good.variants[0]) }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [null] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: ['std'] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [[]] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...good.variants[0], id: '' }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...good.variants[0], id: 'x'.repeat(17) }] }).ok).toBe(false)
    expect(
      parseExtManifest({
        ...good,
        variants: [good.variants[0], { ...good.variants[1], id: 'std' }],
      }).ok,
    ).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...good.variants[0], name: ' ' }] }).ok).toBe(false)
  })

  it('尺寸契约：非整数 / 越界 / ideal 小于 min 都拒，边界值放行', () => {
    const v = { ...good.variants[0] }
    expect(parseExtManifest({ ...good, variants: [{ ...v, minW: 1.5 }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, minW: 0 }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, minW: LOGICAL_COLS + 1 }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, minH: '2' }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, minH: MAX_EXT_MIN_H + 1 }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, idealW: 1 }] }).ok).toBe(false)
    expect(parseExtManifest({ ...good, variants: [{ ...v, idealH: 1 }] }).ok).toBe(false)
    // 边界放行：满宽 12、满高 12、ideal 恰等于 min
    expect(
      parseExtManifest({ ...good, variants: [{ id: 'max', name: '满宽', minW: 12, minH: 12, idealW: 12, idealH: 12 }] })
        .ok,
    ).toBe(true)
  })

  it('成功路径：归一化（trim / 默认分组 / 形态表原样），group 缺省给「扩展」', () => {
    const r = asExt(parseExtManifest({ ...good, title: '  我的卡  ' }))
    expect(r.title).toBe('我的卡')
    expect(r.group).toBe('演示')
    expect(r.blurb).toBe('一句话说明')
    expect(r.variants).toHaveLength(2)
    expect(r.html).toBe(good.html)

    const bare = asExt(
      parseExtManifest({
        id: 'bare',
        title: '裸卡包',
        html: '<i>ok</i>',
        variants: [{ id: 'std', name: '标准', minW: 1, minH: 1, idealW: 2, idealH: 2 }],
      }),
    )
    expect(bare.group).toBe(DEFAULT_EXT_GROUP)
    expect(bare.blurb).toBe('')
  })
})

describe('sanitizeExtCards：丢坏条 / 去重 / 上限', () => {
  it('坏条与重复 id 都记 rejected，好条原样保留', () => {
    const r = sanitizeExtCards([good, { ...good, html: '' }, { ...good, id: 'second' }, { ...good }])
    expect(r.cards.map((c) => c.id)).toEqual(['my-card', 'second'])
    expect(r.rejected).toBe(2)
  })

  it(`超过 ${MAX_EXT_CARDS} 张截断（与其它名单同骨架：多的不计 rejected）`, () => {
    const many = Array.from({ length: MAX_EXT_CARDS + 2 }, (_, i) => ({ ...good, id: `c${i}` }))
    const r = sanitizeExtCards(many)
    expect(r.cards).toHaveLength(MAX_EXT_CARDS)
    expect(r.rejected).toBe(0)
  })
})

describe('模块映射：ext: 前缀与注册表合成', () => {
  it('extModuleId / isExtModule / extIdOf 往返一致', () => {
    expect(extModuleId('my-card')).toBe('ext:my-card')
    expect(isExtModule('ext:my-card')).toBe(true)
    expect(isExtModule('extcard')).toBe(false)
    expect(isExtModule('clock')).toBe(false)
    expect(extIdOf('ext:my-card')).toBe('my-card')
  })

  it('extModuleDef：blurb 空则字段缺省；第一个形态即默认形态', () => {
    const def = extModuleDef(asExt(parseExtManifest(good)))
    expect(def.id).toBe('ext:my-card')
    expect(def.group).toBe('演示')
    expect(def.blurb).toBe('一句话说明')
    expect(def.defaultVariant).toBe('std')
    const noBlurb = extModuleDef(asExt(parseExtManifest({ ...good, blurb: '' })))
    expect(noBlurb.blurb).toBeUndefined()
  })

  it('extModuleDef：空形态表兜底 std（防御分支 —— parse 过的卡不会走到）', () => {
    const def = extModuleDef({ id: 'x', title: 't', group: DEFAULT_EXT_GROUP, blurb: '', variants: [], html: '' })
    expect(def.defaultVariant).toBe('std')
  })

  it('extModuleDefs：ext 段在尾部；与内置 id 撞车 / 相互重复的条目被丢弃', () => {
    const base = [{ id: 'clock' }, { id: 'ext:ghost' }] as never as Parameters<typeof extModuleDefs>[0]
    const cards = [
      asExt(parseExtManifest({ ...good, id: 'clock' })), // ext:clock 不撞内置 'clock'，保留
      asExt(parseExtManifest({ ...good, id: 'ghost' })), // ext:ghost 撞内置，丢
      asExt(parseExtManifest({ ...good, id: 'a' })),
      asExt(parseExtManifest({ ...good, id: 'a' })), // 相互重复，丢
    ]
    const defs = extModuleDefs(base, cards)
    expect(defs.map((d) => d.id)).toEqual(['ext:clock', 'ext:a'])
  })
})

describe('parseBridgeRequest：方法白名单外的请求拿不到回声', () => {
  it('信封形状不对一律 null（非对象 / 无 bridge / bridge 是数组）', () => {
    expect(parseBridgeRequest(null)).toBeNull()
    expect(parseBridgeRequest('桥')).toBeNull()
    expect(parseBridgeRequest({})).toBeNull()
    expect(parseBridgeRequest({ bridge: 'getState' })).toBeNull()
    expect(parseBridgeRequest({ bridge: ['getState'] })).toBeNull()
  })

  it('rid：缺失 / 空串 / 超过 64 位都 null', () => {
    expect(parseBridgeRequest({ bridge: { method: 'getState' } })).toBeNull()
    expect(parseBridgeRequest({ bridge: { rid: '', method: 'getState' } })).toBeNull()
    expect(parseBridgeRequest({ bridge: { rid: 'r'.repeat(65), method: 'getState' } })).toBeNull()
  })

  it('method：缺失 / 不在白名单都 null —— 白名单是唯一能力面', () => {
    expect(parseBridgeRequest({ bridge: { rid: 'r1' } })).toBeNull()
    expect(parseBridgeRequest({ bridge: { rid: 'r1', method: 'eval' } })).toBeNull()
    expect(parseBridgeRequest({ bridge: { rid: 'r1', method: 'readStorage' } })).toBeNull()
    expect(EXT_METHODS).toEqual(['getState', 'setState', 'notify'])
  })

  it('setState：不合规状态 null（不朴素 / 超字节），合规原样带出；null 归一为 null', () => {
    const call = (args: unknown) => parseBridgeRequest({ bridge: { rid: 'r1', method: 'setState', args } })
    expect(call({ bad: () => 1 })).toBeNull()
    expect(call('x'.repeat(MAX_EXT_STATE_BYTES + 1))).toBeNull()
    const ok = call({ n: 1 })
    expect(ok).toEqual({ rid: 'r1', method: 'setState', args: { n: 1 } })
    expect(call(null)).toEqual({ rid: 'r1', method: 'setState', args: null })
  })

  it('notify：args 不是对象 / text 缺失非串 / 纯空白都 null；合规 trim 并截断', () => {
    const call = (args: unknown) => parseBridgeRequest({ bridge: { rid: 'r1', method: 'notify', args } })
    expect(call('提醒')).toBeNull()
    expect(call(null)).toBeNull()
    expect(call({})).toBeNull()
    expect(call({ text: 7 })).toBeNull()
    expect(call({ text: '  \n' })).toBeNull()
    const long = call({ text: `x${'。'.repeat(300)}` })
    expect(long).not.toBeNull()
    if (long) expect((long.args as { text: string }).text.length).toBeLessThanOrEqual(200)
    expect(call({ text: ' 到点了 ' })).toEqual({ rid: 'r1', method: 'notify', args: { text: '到点了' } })
  })

  it('getState：无参放行，多余的 args 丢弃', () => {
    expect(parseBridgeRequest({ bridge: { rid: 'r9', method: 'getState' } })).toEqual({
      rid: 'r9',
      method: 'getState',
      args: undefined,
    })
    expect(parseBridgeRequest({ bridge: { rid: 'r9', method: 'getState', args: { sneaky: 1 } } })).toEqual({
      rid: 'r9',
      method: 'getState',
      args: undefined,
    })
  })
})

describe('sanitizeExtState 与 bridgeReply', () => {
  it('状态：不朴素 / 超字节拒并给原因；undefined 归一 null；合法原样', () => {
    expect(sanitizeExtState(() => 1).ok).toBe(false)
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } // 深度 7
    expect(sanitizeExtState(deep).ok).toBe(false)
    expect(sanitizeExtState('x'.repeat(MAX_EXT_STATE_BYTES + 1)).ok).toBe(false)
    expect(sanitizeExtState(undefined)).toEqual({ ok: false, reason: expect.any(String) })
    expect(sanitizeExtState(null)).toEqual({ ok: true, value: null })
    expect(sanitizeExtState({ n: 1 })).toEqual({ ok: true, value: { n: 1 } })
  })

  it('应答信封：成功带 value；失败带 error（缺省给兜底话）', () => {
    expect(bridgeReply('r1', true, 42)).toEqual({ __modulo: 'bridge', rid: 'r1', ok: true, value: 42 })
    expect(bridgeReply('r1', true)).toEqual({ __modulo: 'bridge', rid: 'r1', ok: true, value: undefined })
    expect(bridgeReply('r1', false, undefined, '状态太大')).toEqual({
      __modulo: 'bridge',
      rid: 'r1',
      ok: false,
      error: '状态太大',
    })
    expect(bridgeReply('r1', false).error).toBe('桥请求没有完成')
    expect(bridgeReply('r1', false, undefined, '').error).toBe('桥请求没有完成')
  })
})
