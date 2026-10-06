import { describe, expect, it, vi } from 'vitest'
import * as E from '@modulo/engine'
import { REGISTRY } from '../../src/vue/cardRegistry'
import { browserStorage, createLayoutStore, memoryStorage, type StorageAdapter } from '../../src/vue/store'

/**
 * store.ts 是「引擎纯函数 + localStorage」之间那层胶水，而它恰好是受测层里分支覆盖最低的一个。
 * 下面钉的都是**真的会走到**的路径：不带 storage 的构造、模板 id 不存在、
 * cycleVariant 的三种退出、批量锁定里那些"不在版面上的 id"。
 * 单测跑在 node 环境（vitest 默认），所以 `typeof localStorage === 'undefined'` 这条为真 ——
 * 有分支要 stub 出 localStorage 才走得到，那部分用 vi.stubGlobal 显式造。
 */
describe('browserStorage：两种环境都要有确定行为', () => {
  it('没有 localStorage（node / SSR / 隐私模式早期）退到内存，不抛错', () => {
    // 前提自己造而不是靠 runner 的环境：Node 24 起 `localStorage` 是个带告警的全局占位，
    // 将来它真提供了，这条不该变成"环境变了所以测试红了"
    vi.stubGlobal('localStorage', undefined)
    try {
      const s = browserStorage()
      expect(s.get('缺的键')).toBeNull()
      s.set('k', 'v')
      expect(s.get('k')).toBe('v')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('有 localStorage 时逐键委托给 getItem / setItem', () => {
    const backing = new Map<string, string>()
    const getItem = vi.fn((k: string) => backing.get(k) ?? null)
    const setItem = vi.fn((k: string, v: string) => void backing.set(k, v))
    vi.stubGlobal('localStorage', { getItem, setItem })
    try {
      const s = browserStorage()
      expect(s.get('a')).toBeNull()
      s.set('a', '1')
      expect(s.get('a')).toBe('1')
      expect(getItem).toHaveBeenCalledTimes(2)
      expect(setItem).toHaveBeenCalledWith('a', '1')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('createLayoutStore 不传 storage 也能建起来（走 browserStorage 那条 ??）', () => {
    const store = createLayoutStore({ registry: REGISTRY })
    expect(store.doc.value.items.length).toBeGreaterThan(0)
    // 没有存档时 parseLayout('') 按"坏 JSON"回退空布局并留一句警告，随后 store 摆出厂版面 ——
    // 这条警告在 store 里是给导入路径用的，首启并不展示，所以这里只钉"版面照样建起来"
    expect(store.available.value.length).toBe(REGISTRY.length - store.doc.value.items.length)
  })
})

describe('applyTemplate：没换成必须说 false', () => {
  /** 界面靠这个返回值决定「提示换成功了」还是「什么都不说」，返回 undefined 就等于说谎 */
  it('模板 id 不存在 → false，版面与选择记录都不动', () => {
    const storage = memoryStorage()
    const store = createLayoutStore({ registry: REGISTRY, storage })
    const before = store.exportJson()
    const chosenBefore = store.templateId.value

    expect(store.applyTemplate('这张模板不存在')).toBe(false)

    expect(store.exportJson()).toBe(before)
    expect(store.templateId.value).toBe(chosenBefore)
    expect(store.canUndo.value).toBe(false)
  })

  it('模板 id 存在 → true，版面整体替换且选择记进 storage', () => {
    const storage = memoryStorage()
    const store = createLayoutStore({ registry: REGISTRY, storage })
    const expected = E.buildTemplate(REGISTRY, E.templateById('clock-note')!)

    expect(store.applyTemplate('clock-note')).toBe(true)

    expect(store.doc.value.items.map((p) => p.id).sort()).toEqual(expected.items.map((p) => p.id).sort())
    expect(store.templateId.value).toBe('clock-note')
    // 选择记录与版面是两个键：手动拖过之后版面不再代表模板，但"上次选了哪张"还要留着高亮
    const fresh = createLayoutStore({ registry: REGISTRY, storage })
    expect(fresh.templateId.value).toBe('clock-note')
  })

  it('换模板是一步可撤销的，undo 回到换之前的版面', () => {
    const store = createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })
    const before = store.exportJson()
    store.applyTemplate('focus')
    expect(store.canUndo.value).toBe(true)
    store.undo()
    expect(store.exportJson()).toBe(before)
  })

  it('setTemplateChoice 只记选择，绝不动版面', () => {
    const store = createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })
    const before = store.exportJson()
    store.setTemplateChoice('focus')
    expect(store.templateId.value).toBe('focus')
    expect(store.exportJson()).toBe(before)
    expect(store.canUndo.value).toBe(false)
  })

  it('restoreStarter 就是回到出厂模板', () => {
    const store = createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })
    store.remove('clock')
    store.restoreStarter()
    expect(store.doc.value.items.map((p) => p.id).sort()).toEqual(
      E.buildTemplate(REGISTRY, E.templateById(E.DEFAULT_TEMPLATE_ID)!).items.map((p) => p.id).sort(),
    )
    expect(store.templateId.value).toBe(E.DEFAULT_TEMPLATE_ID)
  })
})

describe('cycleVariant：三种"不该动"和一种"该动"', () => {
  const store = () => createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })

  it('id 不在版面上 → 原样返回，不进历史', () => {
    const s = store()
    const before = s.exportJson()
    s.cycleVariant('版面上没有这张')
    expect(s.exportJson()).toBe(before)
    expect(s.canUndo.value).toBe(false)
  })

  it('模块只有一个形态 → 没得循环，也不许把 variant 写坏', () => {
    const s = store()
    // 必须挑**版面上真的有**的那张：cycleVariant 先按 id 找版面项，找不到走的是另一条退出
    const single = REGISTRY.find((m) => m.variants.length < 2 && s.doc.value.items.some((p) => p.id === m.id))!
    expect(single.id).toBe('recent')
    const before = s.exportJson()

    s.cycleVariant(single.id)

    expect(s.exportJson()).toBe(before)
    expect(s.doc.value.items.find((p) => p.id === single.id)!.variant).toBe(single.variants[0].id)
    expect(s.canUndo.value).toBe(false)
  })

  it('多形态模块按注册表顺序推进，到尾回到头', () => {
    const s = store()
    const clock = REGISTRY.find((m) => m.id === 'clock')!
    expect(clock.variants.length).toBeGreaterThan(1)

    const seen: string[] = []
    for (let i = 0; i < clock.variants.length; i++) {
      s.cycleVariant('clock')
      seen.push(s.doc.value.items.find((p) => p.id === 'clock')!.variant)
    }
    expect(seen).toEqual(clock.variants.map((v) => v.id).slice(1).concat(clock.variants[0].id))
  })

  it('cycleVariant 换形态时会顺手满足该形态的最小尺寸', () => {
    const s = store()
    const nextVariant = REGISTRY.find((m) => m.id === 'clock')!.variants[1]
    s.cycleVariant('clock')
    const after = s.doc.value.items.find((p) => p.id === 'clock')!
    expect(after.variant).toBe(nextVariant.id)
    expect(after.w).toBeGreaterThanOrEqual(nextVariant.minW)
    expect(after.h).toBeGreaterThanOrEqual(nextVariant.minH)
  })
})

describe('toggleLockMany：只改版面上的那些', () => {
  const store = () => createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })

  it('ids 里混了不在版面上的 id → 只锁住真实存在的那张', () => {
    const s = store()
    s.toggleLockMany(['clock', '不存在的卡'])
    expect(s.doc.value.items.find((p) => p.id === 'clock')!.locked).toBe(true)
    expect(s.doc.value.items.filter((p) => p.locked).length).toBe(1)
  })

  it('整组已锁 → 再点一次整组解锁（next 取的是当前态的否）', () => {
    const s = store()
    s.toggleLockMany(['clock', 'sticky'])
    expect(s.doc.value.items.filter((p) => p.locked).map((p) => p.id).sort()).toEqual(['clock', 'sticky'])
    s.toggleLockMany(['clock', 'sticky'])
    expect(s.doc.value.items.filter((p) => p.locked)).toEqual([])
  })

  it('一个 id 都不在版面上时不产生任何变更（find 落空也不能报错）', () => {
    const s = store()
    const before = s.exportJson()
    s.toggleLockMany(['不存在的卡'])
    expect(s.exportJson()).toBe(before)
  })

  it('传入空 ids 时版面不变', () => {
    const s = store()
    const before = s.exportJson()
    s.toggleLockMany([])
    expect(s.exportJson()).toBe(before)
  })
})

/** 存储适配器契约：store 只认 get/set 两个方法，自定义实现必须被原样使用 */
it('storage 适配器按 key 读写，出厂版面会被落一次盘', () => {
  const calls: string[] = []
  const spy: StorageAdapter = {
    get: (k) => {
      calls.push(`get:${k}`)
      return null
    },
    set: (k, v) => {
      calls.push(`set:${k}:${v.length}`)
    },
  }
  const s = createLayoutStore({ registry: REGISTRY, storage: spy, key: '自定义键', templateKey: '模板键' })
  expect(calls).toContain('get:自定义键')
  expect(calls.some((c) => c.startsWith('set:自定义键:'))).toBe(true)
  s.setTemplateChoice('focus')
  expect(calls.some((c) => c.startsWith('set:模板键:'))).toBe(true)
})
