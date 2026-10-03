import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, docToJson, migrate, parseLayout, type Migration } from '@modulo/engine/serialize'
import { LOGICAL_COLS } from '@modulo/engine/types'
import { REGISTRY } from '../../src/vue/cardRegistry'

const v1 = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'clock', variant: 'big', x: 0, y: 0, w: 5, h: 3 }],
}

/**
 * 临时往迁移表里塞一条，用完立刻撤回。
 * 必须真装表再跑 —— 早先那版测试自己在测试里复制了一遍迁移循环，等于"测的是我写的模拟"，
 * 而生产代码里那几行循环一次都没跑到，覆盖率从 91.72 掉到 91.55 才暴露出来。
 * `to` 也要显式传：默认目标是当前版本（此刻是 1），v1 数据不需要迁移，循环自然不进。
 */
function withMigrations(table: Record<number, Migration>, to: number, fn: () => void) {
  const before = { ...MIGRATIONS }
  Object.assign(MIGRATIONS, table)
  try {
    fn()
  } finally {
    for (const k of Object.keys(MIGRATIONS)) delete MIGRATIONS[Number(k)]
    Object.assign(MIGRATIONS, before)
  }
  expect(CURRENT_SCHEMA_VERSION).toBe(1)
}

describe('migrate：管道存在且真的被调用', () => {
  it('当前没有跨版本需求，所以表是空的 —— 有假想需求就会有人手滑填错键', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([])
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })

  it('v1 数据在当前版本下原样通过，一步都不跑', () => {
    const r = migrate(v1)
    expect(r.applied).toEqual([])
    expect(r.note).toBeNull()
    expect(r.raw).toBe(v1)
  })

  it('非对象输入不抛，回空对象', () => {
    for (const bad of [null, undefined, 42, 'str', [1, 2]]) {
      expect(() => migrate(bad)).not.toThrow()
      expect(migrate(bad).raw).toEqual({})
    }
  })

  it('版本号不是正整数时按 v1 处理，而不是当成 v0 白跑一步', () => {
    // 装了 v1→v2 这一步，才能看出"当成 v1"与"当成 v0"的差别：前者跑一步，后者会去找 0→1 而扑空
    withMigrations({ 1: (raw) => ({ ...raw, seen: true }) }, 2, () => {
      for (const v of [0, -1, 1.5, '1', null, undefined, NaN]) {
        const r = migrate({ ...v1, schemaVersion: v }, 2)
        expect(r.applied, String(v)).toEqual([1])
        expect(r.raw.seen, String(v)).toBe(true)
      }
    })
  })

  it('缺步骤时停在原处而不是报错：半个版本好过崩掉', () => {
    const r = migrate({ ...v1, schemaVersion: 99 }, 200)
    expect(r.applied).toEqual([])
    expect(r.note).toBeNull()
    expect(r.raw.schemaVersion).toBe(99)
  })

  it('装了迁移函数就真的会跑：版本号推进一格，并留下说明', () => {
    withMigrations({ 1: (raw) => ({ ...raw, b: true }) }, 2, () => {
      const r = migrate(v1, 2)
      expect(r.applied).toEqual([1])
      expect(r.raw.b).toBe(true)
      expect(r.raw.schemaVersion).toBe(2)
      expect(r.note).toContain('1 迁移到 2')
    })
  })

  it('多步链按版本号顺序跑完', () => {
    const table: Record<number, Migration> = { 1: (raw) => ({ ...raw, b: true }), 2: (raw) => ({ ...raw, c: true }) }
    withMigrations(table, 3, () => {
      const r = migrate(v1, 3)
      expect(r.applied).toEqual([1, 2])
      expect(r.raw.b).toBe(true)
      expect(r.raw.c).toBe(true)
      expect(r.raw.schemaVersion).toBe(3)
    })
  })

  it('迁移函数返回的不是对象就停：坏步骤不能把整份数据变成空', () => {
    withMigrations({ 1: () => null as unknown as Record<string, unknown> }, 2, () => {
      const r = migrate(v1, 2)
      expect(r.applied).toEqual([])
      expect(r.raw.schemaVersion).toBe(1)
    })
  })

  it('步数有上限：目标版本荒唐到 1e9 也不会死循环', () => {
    // 每一步都原地返回 → 版本号永远不涨，只有上限能救它
    withMigrations({ 1: (raw) => raw }, 1e9, () => {
      const started = Date.now()
      const r = migrate(v1, 1e9)
      expect(r.applied.length).toBeLessThanOrEqual(32)
      expect(Date.now() - started).toBeLessThan(1000)
    })
  })
})

describe('parseLayout：接上迁移之后行为不变', () => {
  it('v1 正常文档读出来没有多余告警', () => {
    const r = parseLayout(JSON.stringify(v1), REGISTRY)
    expect(r.doc.items).toHaveLength(1)
    expect(r.warnings).toEqual([])
  })

  it('高于当前支持版本：仍按 v1 读，并告警', () => {
    const r = parseLayout(JSON.stringify({ ...v1, schemaVersion: 99 }), REGISTRY)
    expect(r.doc.items).toHaveLength(1)
    expect(r.warnings.join()).toContain('99')
    expect(r.warnings.join()).toContain('高于当前支持版本')
  })

  it('schemaVersion 缺失按 v1 处理，不算"高于当前版本"', () => {
    const { schemaVersion: _drop, ...noVersion } = v1
    const r = parseLayout(JSON.stringify(noVersion), REGISTRY)
    expect(r.doc.items).toHaveLength(1)
    expect(r.warnings).toEqual([])
  })

  it('JSON 坏了：回退空布局 + 一条告警，绝不抛', () => {
    const r = parseLayout('{ 坏', REGISTRY)
    expect(r.doc.items).toEqual([])
    expect(r.doc.cols).toBe(LOGICAL_COLS)
    expect(r.warnings).toHaveLength(1)
  })

  it('顶层不是对象（数组/字符串/null）：回退空布局而不是把 sanitize 喂崩', () => {
    for (const raw of ['[]', '"x"', 'null', '42']) {
      const r = parseLayout(raw, REGISTRY)
      expect(r.doc.items, raw).toEqual([])
    }
  })

  it('清洗仍然生效：未知模块被剔除并留告警（迁移不削弱校验）', () => {
    const r = parseLayout(JSON.stringify({ ...v1, items: [...v1.items, { id: '外来的', x: 0, y: 9, w: 2, h: 2 }] }), REGISTRY)
    expect(r.doc.items.map((i) => i.id)).toEqual(['clock'])
    expect(r.warnings.join()).toContain('外来的')
  })

  it('cols 超界被钳到 12', () => {
    expect(parseLayout(JSON.stringify({ ...v1, cols: 999 }), REGISTRY).doc.cols).toBe(LOGICAL_COLS)
    expect(parseLayout(JSON.stringify({ ...v1, cols: 0 }), REGISTRY).doc.cols).toBe(LOGICAL_COLS)
  })

  it('导出再导入逐字往返', () => {
    const r = parseLayout(docToJson(v1), REGISTRY)
    expect(r.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(r.doc.items[0]).toEqual(v1.items[0])
  })

  it('读盘确实过了 migrate：装上假想迁移后，parseLayout 会说出它升了几版', () => {
    withMigrations({ 1: (raw) => ({ ...raw, cols: 6 }) }, 2, () => {
      const r = parseLayout(JSON.stringify(v1), REGISTRY, 2)
      expect(r.warnings.join()).toContain('已从 schemaVersion 1 迁移到 2')
      expect(r.doc.cols).toBe(6)
    })
  })

  it('生产路径（不传 to，目标=当前版本）下 v1 不会平白触发迁移', () => {
    withMigrations({ 1: (raw) => ({ ...raw, cols: 6 }) }, 2, () => {
      const r = parseLayout(JSON.stringify(v1), REGISTRY)
      expect(r.warnings).toEqual([])
      expect(r.doc.cols).toBe(12)
    })
  })
})
