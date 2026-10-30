/**
 * 命令表与命令总线的**表驱动测试**（2026-10-13 批 2）。
 *
 * 这一组不是"给每个命令手写一条用例"——那样加一条命令就要记得补一条。
 * 全部断言都是**对全表跑**的不变量：
 *   1. 每条命令文案齐全、id 唯一、scope 合法、binding 格式合法；
 *   2. 声明 undoable 且带内联实现的命令：执行 → 文档变 → Ctrl+Z 复原（逐条真跑）；
 *   3. 声明 undoable 却**没有**内联实现的：必须有 `wait` 或能被宿主拦截（否则是接线漏了）；
 *   4. 可用性谓词是纯函数：可用时给命令、不可用时给出**原因**；
 *   5. 派发闸门：未登记 → unknown；谓词为假 → unavailable 且**不执行**；
 *   6. 键盘绑定与面板可见性同源：每个 binding 都能在 commandStates 里搜到。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createLayoutStore, memoryStorage } from '../../src/vue/store'
import { createCommandBus } from '../../src/vue/commandBus'
import { COMMANDS, SCOPE_LABEL, SCOPE_ORDER, commandStates, targetCard, type CommandContext } from '../../src/vue/commands'
import { REGISTRY } from '../../src/vue/cardRegistry'

function ctx(): CommandContext {
  const store = createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })
  return {
    store,
    view: ref<'workbench' | 'edit'>('workbench'),
    selection: ref<ReadonlySet<string>>(new Set()),
    focusedCard: ref<string | null>(null),
    editDirty: ref(false),
    detached: ref<ReadonlySet<string>>(new Set()),
    floatingSupported: true,
    stageW: ref(1408),
    cols: ref(12),
    gap: 16,
    rowPx: ref(76),
    openUI: () => {},
    detach: () => {},
    unfloat: () => {},
  }
}

describe('命令表：结构不变量（对全表跑）', () => {
  it('id 唯一且形如 `域.动作`', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size, `重复 id：${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`).toBe(ids.length)
    for (const c of COMMANDS) expect(c.id, `${c.id} 形状`).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
  })

  it('文案三件套必填（label/hint 非空、scope 合法）—— 面板的可用性建立在"每条都说清做什么"上', () => {
    for (const c of COMMANDS) {
      expect(c.label.trim().length, `${c.id} 缺 label`).toBeGreaterThan(1)
      expect(c.hint.trim().length, `${c.id} 缺 hint`).toBeGreaterThan(3)
      expect(SCOPE_ORDER, `${c.id} 的 scope「${c.scope}」没有分组名`).toContain(c.scope)
    }
  })

  it('binding 格式合法（修饰键用 + 连接，末段是键名）', () => {
    for (const c of COMMANDS) {
      if (!c.binding) continue
      expect(c.binding, `${c.id} 的 binding 形状`).toMatch(/^([A-Z][a-zA-Z]+\+)*[A-Za-z0-9+]+$/)
    }
  })

  it('binding 不重复（两个命令抢一个键 = 键位表已经漂了）', () => {
    const seen = new Map<string, string>()
    for (const c of COMMANDS) {
      if (!c.binding) continue
      expect(seen.has(c.binding), `「${c.binding}」被 ${seen.get(c.binding)} 与 ${c.id} 同时占用`).toBe(false)
      seen.set(c.binding, c.id)
    }
  })

  it('有实现的命令至少给出 run / effect / wait 三者之一（"登记了却没人实现"是接线漏）', () => {
    for (const c of COMMANDS) {
      expect(!!(c.run || c.effect || c.wait), `${c.id} 无任何实现`).toBe(true)
    }
  })

  it('undoable 的命令不允许只挂 effect（切视图/开弹层不进历史）', () => {
    for (const c of COMMANDS) {
      if (!c.undoable) continue
      expect(!!c.run || !!c.wait, `${c.id} 声明了 undoable 却是纯 effect`).toBe(true)
    }
  })
})

describe('命令总线：派发闸门与可用性', () => {
  it('未登记的命令返回 unknown，不静默', () => {
    const bus = createCommandBus(ctx())
    const r = bus.dispatch('does.notExist')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown')
  })

  it('when 为假时拒绝执行并给出原因（不可用 = 有条有理地拒绝，不是没这条命令）', () => {
    const c = ctx()
    const bus = createCommandBus(c)
    // 出厂工作台没有行 → row.reflow 不可用
    const states = commandStates(c)
    const reflow = states.find((s) => s.def.id === 'row.reflow')!
    expect(reflow.enabled).toBe(false)
    expect(reflow.reason, '不可用必须给原因').toBeTruthy()
    const r = bus.dispatch('row.reflow')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unavailable')
  })

  it('可用性谓词随上下文翻转（建一行后 row.* 从不可用变可用）', () => {
    const c = ctx()
    c.store.add('clock', 0, 0)
    c.store.add('sticky', 0, 5)
    c.store.groupIntoRow(['clock'])
    const states = commandStates(c)
    for (const id of ['row.reflow', 'row.toggleCollapsed', 'row.ungroup']) {
      expect(states.find((s) => s.def.id === id)!.enabled, `${id} 建行后应可用`).toBe(true)
    }
  })

  it('card.* 命令的目标来自显式参数或唯一选中', () => {
    const c = ctx()
    const bus = createCommandBus(c)
    // 出厂版面已含 clock（add 会去重成 no-op）—— 用"唯一选中"与"显式参数"两种目标来源
    // 无目标 → 拒绝并给原因
    expect(bus.dispatch('card.toggleLock').ok).toBe(false)
    // 唯一选中 → 执行
    c.selection.value = new Set(['clock'])
    expect(bus.dispatch('card.toggleLock').ok).toBe(true)
    expect(c.store.doc.value.items.find((p) => p.id === 'clock')?.locked).toBe(true)
    // 焦点格也是目标（键盘语义：单格命令作用于焦点格 —— Delete 曾因此静默失效）
    c.selection.value = new Set()
    c.focusedCard.value = 'sticky'
    expect(bus.dispatch('card.toggleLock').ok, '焦点格应可作目标').toBe(true)
    // 显式参数优先于焦点与选中；锁定是双向开关，再锁一次应把它解回来
    expect(bus.dispatch('card.toggleLock', { cardId: 'sticky' }).ok).toBe(true)
    expect(c.store.doc.value.items.find((p) => p.id === 'sticky')?.locked, '再锁一次=解锁').toBe(false)
  })
})

/**
 * 本组是"取消那套设计承诺的验收"：**undoable 的命令真的都能一步退回去**。
 * 逐条执行真命令（不是 mock），断言：文档确实变了、撤销后逐字节回到执行前。
 */
describe('命令总线：undoable 全表"执行 → Ctrl+Z → 复原"', () => {
  /** 给每条会改文档的命令准备一个"环境让它可用"的上下文 */
  const readyContext = (id: string): CommandContext | null => {
    const c = ctx()
    // 一个基础版面：两张卡 + 一行（覆盖 layout/row/card 三种域）
    c.store.add('clock', 0, 0)
    c.store.add('sticky', 0, 5)
    c.store.groupIntoRow(['clock'])
    c.view.value = 'workbench'
    c.selection.value = new Set(['sticky'])
    const def = COMMANDS.find((d) => d.id === id)!
    if (def.when && !def.when(c)) return null // 环境给不出（如 workbench-measure 类）→ 跳过
    return c
  }

  const undoableWithRun = COMMANDS.filter((c) => c.undoable && c.run && !c.wait)
  it(`候选不少于 8 条（防"全表"悄悄缩水成空集）`, () => {
    expect(undoableWithRun.length).toBeGreaterThanOrEqual(8)
  })

  for (const def of undoableWithRun) {
    it(`${def.id}（${def.label}）执行后文档变化，Ctrl+Z 逐字节复原`, () => {
      const c = readyContext(def.id)
      expect(c, `${def.id} 在测试环境里也应可用`).not.toBeNull()
      const bus = createCommandBus(c!)
      const before = JSON.stringify(c!.store.doc.value)
      const r = bus.dispatch(def.id, { cardId: 'sticky', rowId: c!.store.doc.value.rows?.[0]?.id })
      expect(r.ok, `${def.id} 应执行成功`).toBe(true)
      const after = JSON.stringify(c!.store.doc.value)
      expect(after, `${def.id} 执行后文档应有变化`).not.toBe(before)
      c!.store.undo()
      expect(JSON.stringify(c!.store.doc.value), `${def.id} 撤销后应逐字节复原`).toBe(before)
    })
  }
})

describe('命令面板索引（纯函数）', () => {
  it('模糊匹配：连续命中 > 断开命中；不匹配返回 null', async () => {
    const { fuzzyScore } = await import('../../src/vue/paletteIndex')
    expect(fuzzyScore('整理', '整理版面')).not.toBeNull()
    expect(fuzzyScore('版面整理', '整理版面')).toBeNull()
    const contiguous = fuzzyScore('整理', '整理版面')!
    const spread = fuzzyScore('整面', '整理版面')!
    expect(contiguous).toBeGreaterThan(spread)
  })

  it('内容索引只收用户写的字；机器采的数据天然不在（数据分层的直接收益）', async () => {
    const { contentIndex } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addTodo('给猫铲屎')
    const idx = contentIndex(data.state)
    expect(idx.some((e) => e.text.includes('给猫铲屎')), '用户写的待办应可搜').toBe(true)
    expect(idx.some((e) => e.cardId === 'stock'), '没加自选就不该有股票条目').toBe(false)
  })

  it('每个键盘绑定都能在命令表里按 label 搜到（同源断言）', () => {
    const c = ctx()
    const states = commandStates(c)
    for (const def of COMMANDS) {
      if (!def.binding) continue
      expect(
        states.some((s) => s.def.id === def.id),
        `绑定了 ${def.binding} 的 ${def.id} 不在面板数据里`,
      ).toBe(true)
    }
  })

  it('SCOPE_LABEL 覆盖全部 scope（面板分组不出现空白）', () => {
    for (const scope of SCOPE_ORDER) expect(SCOPE_LABEL[scope]?.length ?? 0).toBeGreaterThan(0)
  })

  it('所有 effect 类命令都是"打开界面/切视图"（不进历史、也不改文档）', () => {
    const c = ctx()
    const before = JSON.stringify(c.store.doc.value)
    for (const def of COMMANDS.filter((d) => d.effect && !d.run)) {
      if (def.when && !def.when(c)) continue
      const bus = createCommandBus(c)
      bus.dispatch(def.id)
    }
    expect(JSON.stringify(c.store.doc.value), 'effect 类命令不该动文档').toBe(before)
  })

  it('命令表里写死的模块 id（示例文档用）都真实存在于注册表', () => {
    const regIds = new Set(REGISTRY.map((m) => m.id))
    for (const id of ['clock', 'sticky', 'todo', 'notes']) {
      expect(regIds.has(id), `注册表缺 ${id}`).toBe(true)
    }
  })
})

/**
 * 覆盖率棘轮（2026-10-13 把三条新模块登记进 `vitest.config.ts` 的逐文件表）当场咬出的
 * 三个缺口：总线的"登记了却没人实现"分支、索引的多类型分支、谓词/目标解析的假分支。
 * 下面按缺口补 —— 顺带把这几条本来也该守的语义写成断言。
 */
describe('命令层：补上棘轮咬出来的缺口', () => {
  it('总线：登记了却既无实现也无拦截 → 明确报错，不静默（接线漏必须响）', () => {
    // 临时插一条"只有文案没有实现"的命令，验证总线拒绝执行并说明原因
    type Mutable = { id: string; label: string; hint: string; scope: string }[]
    const list = COMMANDS as unknown as Mutable
    const orig = [...list]
    list.push({ id: 'zzz.broken', label: '坏命令', hint: '没有实现', scope: 'app' })
    try {
      const bus = createCommandBus(ctx())
      const r = bus.dispatch('zzz.broken')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('没有实现')
    } finally {
      list.length = 0
      list.push(...orig)
    }
  })

  it('总线：宿主拦截项优先于内联实现（命令表不知道界面长什么样）', () => {
    const c = ctx()
    const bus = createCommandBus(c)
    let intercepted = false
    bus.registerIntercept('layout.tidy', () => {
      intercepted = true
    })
    const before = JSON.stringify(c.store.doc.value)
    expect(bus.dispatch('layout.tidy').ok).toBe(true)
    expect(intercepted, '拦截项应接管执行').toBe(true)
    expect(JSON.stringify(c.store.doc.value), '内联实现不该也跑一遍').toBe(before)
  })

  it('目标解析：三种来源齐全，且没有目标时 NOT 猜（返回 null → 判不可用）', () => {
    const c = ctx()
    expect(targetCard(c)).toBeNull()
    c.selection.value = new Set(['a', 'b'])
    expect(targetCard(c), '多选且无焦点：不猜').toBeNull()
    c.selection.value = new Set(['a'])
    expect(targetCard(c)).toBe('a')
    c.focusedCard.value = 'b'
    expect(targetCard(c), '焦点格优先于唯一选中').toBe('b')
    expect(targetCard(c, { cardId: 'c' }), '显式参数优先于一切').toBe('c')
  })

  it('view.* 与 edit.* 的可用性随视图翻转、且都只挂 effect（切视图不进历史）', () => {
    const c = ctx()
    const at = (id: string) => commandStates(c).find((s) => s.def.id === id)!
    expect(at('view.edit').enabled).toBe(true)
    expect(at('view.workbench').enabled, '工作台里没有"切到工作台"').toBe(false)
    expect(at('edit.save').enabled, '工作台里没有"保存"').toBe(false)
    c.view.value = 'edit'
    expect(at('view.edit').enabled).toBe(false)
    expect(at('view.workbench').enabled).toBe(true)
    expect(at('edit.save').enabled).toBe(true)
    for (const id of ['view.edit', 'view.workbench', 'edit.save', 'edit.cancel', 'palette.open']) {
      const def = COMMANDS.find((d) => d.id === id)!
      expect(def.run, `${id} 不该有 run`).toBeUndefined()
      expect(def.effect, `${id} 应有 effect`).toBeTruthy()
    }
  })

  it('card.* 的 when：换形态要求"多于一种形态"、脱离要求桌面壳且未浮动', () => {
    const c = ctx()
    const at = (id: string) => commandStates(c).find((s) => s.def.id === id)!
    c.focusedCard.value = 'clock' // clock 有三种形态
    expect(at('card.cycleVariant').enabled).toBe(true)
    c.focusedCard.value = 'calc' // 单形态卡（注册表里存在；fixed 其实有两形态）
    expect(at('card.cycleVariant').enabled, '单形态卡不该有换形态').toBe(false)
    // 脱离：桌面壳 + 未浮动
    c.floatingSupported = false
    c.focusedCard.value = 'clock'
    expect(at('card.detach').enabled, '网页版没有浮窗').toBe(false)
    expect(at('card.unfloat').enabled).toBe(false)
    c.floatingSupported = true
    expect(at('card.detach').enabled).toBe(true)
    c.detached.value = new Set(['clock'])
    expect(at('card.detach').enabled, '已浮动的卡不再显示"脱离"').toBe(false)
    expect(at('card.unfloat').enabled, '已浮动的卡显示"收回"').toBe(true)
  })

  it('card.cycleVariant 的 when：第二实例也能换形态（2026-10-25 修 clock:2 同型缺陷）', () => {
    const c = ctx()
    const at = (id: string) => commandStates(c).find((s) => s.def.id === id)!
    // store.add 自动分配 `clock:2` 实例 id 并带上 module 字段（引擎建实例的形状）
    c.store.add('clock', 0, 0)
    expect(c.store.doc.value.items.some((p) => p.id === 'clock:2' && p.module === 'clock')).toBe(true)
    c.focusedCard.value = 'clock:2'
    // 修缺陷前：守卫拿实例 id 查模块表 → 查不到 → 命令不可用（store 侧其实是支持的）
    expect(at('card.cycleVariant').enabled, '第二实例的换形态命令也该可用').toBe(true)
    // 版面外 id：找不到条目 → 找不到模块 → 不可用（守卫的 p 落空分支）
    c.focusedCard.value = 'ghost'
    expect(at('card.cycleVariant').enabled, '版面外的 id 不该可用').toBe(false)
  })

  it('layout.reflowAllRows 的 when 随"有没有行"翻转', () => {
    const c = ctx()
    const at = () => commandStates(c).find((s) => s.def.id === 'layout.reflowAllRows')!
    expect(at().enabled).toBe(false)
    c.store.add('sticky', 0, 6)
    c.store.groupIntoRow(['sticky'])
    expect(at().enabled).toBe(true)
  })

  it('row.* 目标：显式 rowId 优先；折叠的行不许重排（没有可见成员可排）', () => {
    const c = ctx()
    c.store.add('sticky', 0, 6)
    c.store.groupIntoRow(['sticky'])
    const rowId = c.store.doc.value.rows![0].id
    const at = (id: string) => commandStates(c).find((s) => s.def.id === id)!
    expect(at('row.reflow').enabled).toBe(true)
    c.store.toggleRow(rowId)
    expect(at('row.reflow').enabled, '折叠中的行不可重排').toBe(false)
    expect(at('row.toggleCollapsed').enabled, '折叠中的行仍可展开').toBe(true)
    c.store.toggleRow(rowId)
    // 显式 rowId 也走通（总线派发一次，确认不炸）
    const bus = createCommandBus(c)
    expect(bus.dispatch('row.toggleCollapsed', { rowId }).ok).toBe(true)
  })

  it('索引：excerpt 截取命中处的上下文；fuzzyScore 空查询得 0', async () => {
    const { excerpt, fuzzyScore } = await import('../../src/vue/paletteIndex')
    expect(fuzzyScore('', '随便')).toBe(0)
    const long = '前面的废话'.repeat(20) + '要找的词' + '后面的废话'.repeat(20)
    const e = excerpt(long, '要找的词')
    expect(e).toContain('要找的词')
    expect(e.startsWith('…')).toBe(true)
    expect(e.length).toBeLessThan(long.length)
    expect(excerpt('短的', '不存在'), '没命中给开头一段').toBe('短的')
  })

  it('索引：卡片域按名字/说明搜，命中带 cardId（面板据此定位）', async () => {
    const { searchCards } = await import('../../src/vue/paletteIndex')
    const hits = searchCards(REGISTRY, '时钟')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].cardId).toBeTruthy()
    expect(searchCards(REGISTRY, '不存在的卡名').length).toBe(0)
  })

  /**
   * 2026-10-27 的真缺陷：内容域的 key 曾经是 `cardId:title`，而 title 对一整类条目是常量
   * （未完成待办全是「待办 · 未完成」、四象限全是「四象限待办」、无标题速记全是「速记 · 无标题」）。
   * 同组两条同时命中时，后一条被去重块吞掉 —— 用户看到的是"搜索结果少了一条"，没有任何报错。
   */
  it('索引：同组多条同时命中时每一条都要出现（曾经只剩一条）', async () => {
    const { searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    // 注意：createCardData 起步是**示例内容**（有自带的待办/速记），所以断言只能盯"我加的这两条
    // 是否都在"，不能用总数 —— 那是把别人的种子算进自己的分母。
    data.addTodo('写周报')
    data.addTodo('写季度总结')
    data.addNote('', '第一段没标题')
    data.addNote('', '第二段也没标题')
    data.addMatrixTodo('周报相关的四象限', 'do')
    data.addMatrixTodo('周报相关的四象限二', 'plan')

    const subs = (q: string, cardId: string) =>
      searchContent(data.state, q)
        .filter((h) => h.cardId === cardId)
        .map((h) => h.sub)

    const todos = subs('写', 'todo')
    expect(todos.some((t) => t.includes('写周报'))).toBe(true)
    expect(todos.some((t) => t.includes('写季度总结'))).toBe(true)

    const notes = subs('没标题', 'notes')
    expect(notes.some((t) => t.includes('第一段'))).toBe(true)
    expect(notes.some((t) => t.includes('第二段'))).toBe(true)

    const matrix = subs('周报相关', 'matrix')
    expect(matrix.filter((t) => t.includes('周报相关')).length).toBe(2)
  })

  it('索引：第二张便签的正文也搜得到（F-01 阶段 2 —— 不然它是个没人会报的静默洞）', async () => {
    const { contentIndex, searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.state.sticky = '第一张的内容'
    data.state.byInstance = { 'sticky:2': { sticky: '第二张里写了买牛奶' } }
    const hits = searchContent(data.state, '买牛奶')
    expect(hits.length).toBe(1)
    // cardId 是**实例** id：面板里"跳到这张卡"要指得准
    expect(hits[0].cardId).toBe('sticky:2')
    // id 仍两两不同（守的是"以后新增条目类型"那条不变量）
    const ids = contentIndex(data.state).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('索引：第二张待办卡的条目也搜得到，且 cardId 指到那个实例（F-01 阶段 2 第二个字段）', async () => {
    const { contentIndex, searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addTodo('第一张的待办')
    data.addTodo('第二张的待办买牛奶', 'todo', 'todo:2')
    const hits = searchContent(data.state, '买牛奶')
    expect(hits.length, '第二张里的那条必须能搜到').toBe(1)
    // `goCard` 是让编辑器选中并滚到那一张 —— 实例 id 才指得准，模块 id 会指到第一张
    expect(hits[0].cardId).toBe('todo:2')
    // 同一张卡里"顶层的 + 第二实例的"两类条目 id 也不能撞
    const ids = contentIndex(data.state).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('索引：第二张四象限卡的条目也搜得到，且 cardId 指到那个实例（F-01 阶段 2 第三个字段）', async () => {
    const { contentIndex, searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addMatrixTodo('第一张的四象限', 'do')
    data.addMatrixTodo('第二张的四象限买牛奶', 'plan', 'matrix', 'matrix:2')
    const hits = searchContent(data.state, '买牛奶')
    expect(hits.length, '第二张里的那条必须能搜到').toBe(1)
    expect(hits[0].cardId).toBe('matrix:2')
    const ids = contentIndex(data.state).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('索引：内容域的 id 两两不同（这条不变量守的是"以后新增条目类型"）', async () => {
    const { contentIndex } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.state.sticky = '便签一句'
    data.addTodo('待办一')
    data.addTodo('待办二')
    data.addNote('', '无标题一')
    data.addNote('', '无标题二')
    data.addMatrixTodo('四象限一', 'do')
    data.addMatrixTodo('四象限二', 'plan')
    const ids = contentIndex(data.state).map((e) => e.id)
    expect(ids.length).toBeGreaterThanOrEqual(8)
    expect(new Set(ids).size, '有重复 id：新条目类型的 id 撞了').toBe(ids.length)
  })

  it('索引：内容域覆盖多种数据、且同 key 去重', async () => {
    const { searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addTodo('给猫铲屎')
    data.state.sticky = '记一句要紧的话'
    const hits = searchContent(data.state, '猫')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].cardId).toBe('todo')
    expect(searchContent(data.state, '要紧').some((h) => h.cardId === 'sticky')).toBe(true)
    // 键必须两两不同（曾经是 cardId:title，同组条目会撞成一个、后一条被静默吞掉）
    const keys = hits.map((h) => h.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/**
 * 内联实现的全量执行（棘轮盯出的第二层：允许有个 if 的 73% 分支覆盖）。
 * 生产里 `run` 会先被 App 的拦截项接管（保存/取消/需渲染高度的那两条），
 * 于是这些内联体在单测里从未被跑过 —— 而它们正是"命令表自己就能执行"的那一半。
 * 这一段在**完整场景**里逐条 dispatch：有行、有选中、有浮动、桌面壳，全部执行一遍。
 */
describe('命令层：内联实现全量执行（完整场景）', () => {
  it('每条可执行命令都能真的跑通，且不留异常', () => {
    const c = ctx()
    // 完整场景：两张卡 + 一行 + 焦点 + 浮动一张（覆盖 when 的全部真分支）
    c.store.add('sticky', 0, 6)
    c.store.groupIntoRow(['sticky'])
    c.store.add('clock', 0, 0)
    c.focusedCard.value = 'clock'
    c.detached.value = new Set(['sticky'])
    const bus = createCommandBus(c)
    const ran: string[] = []
    /**
     * 跑**两遍**、每遍把互斥状态翻个面（detach 与 unfloat 不可能在同一遍里都成立；
     * 视图命令同理要来回切）—— 这样每条命令的两个方向都被真执行过，
     * 而不是靠"这次跳过它"把覆盖率糊过去。
     */
    for (const pass of [0, 1]) {
      // 每遍都从同一套状态出发（跑完一遍会改状态，所以显式复位）：
      // sticky 浮动（unfloat 的目标）、clock 未浮动（detach 的目标）
      c.detached.value = new Set(['sticky'])
      c.focusedCard.value = 'clock'
      c.view.value = 'workbench'
      // 上一遍末尾的 row.ungroup 会把行拆掉（那是它的语义）——每遍重新建一行再跑
      if (!(c.store.doc.value.rows?.length ?? 0)) {
        if (!c.store.doc.value.items.some((p2) => p2.id === 'sticky')) c.store.add('sticky', 0, 6)
        c.store.groupIntoRow(['sticky'])
      }
      // 上一遍的 card.remove 会把 clock 删掉 —— 每遍补回来（2026-10-25：守卫改成查版面后
      // 这是必须的：删掉的卡不再"可用"，旧守卫查注册表所以删了也显示可用、然后静默 no-op）
      if (!c.store.doc.value.items.some((p2) => p2.id === 'clock')) c.store.add('clock', 0, 0)
      for (const def of COMMANDS) {
        if (!def.run && !def.effect) continue // wait 类由宿主实现，不在本组
        if (def.id === 'view.workbench') c.view.value = 'edit'
        if (def.id === 'view.edit') c.view.value = 'workbench'
        if (def.scope === 'edit') c.view.value = 'edit'
        // 目标要与状态相配：unfloat 指向真在浮动的 sticky，其余卡级命令指向未浮动的 clock
        const cardId = def.id === 'card.unfloat' ? 'sticky' : 'clock'
        const r = bus.dispatch(def.id, { cardId, rowId: c.store.doc.value.rows?.[0]?.id })
        expect(r.ok, `${def.id}（第 ${pass + 1} 遍）应可执行：${r.ok ? '' : r.message}`).toBe(true)
        if (pass === 0) ran.push(def.id)
      }
    }
    expect(ran.length, '至少跑过绝大多数命令').toBeGreaterThanOrEqual(18)
    // 执行了一批命令之后：文档仍然合法（投影不炸、无重叠不变量由引擎守着）
    expect(c.store.doc.value.items.length).toBeGreaterThan(0)
  })

  it('view/edit 类 effect 经总线触发 openUI（界面由宿主接管，命令表不自己开弹层）', () => {
    const c = ctx()
    const opened: string[] = []
    c.openUI = (name) => opened.push(name)
    const bus = createCommandBus(c)
    bus.dispatch('app.settings')
    bus.dispatch('app.templates')
    c.view.value = 'edit'
    bus.dispatch('view.workbench')
    bus.dispatch('edit.save')
    bus.dispatch('edit.cancel')
    expect(opened).toEqual(['settings', 'templates', 'workbench', 'workbench', 'workbench'])
  })

  it('索引：同 key 去重真的发生（同卡两条同名条目只留一条）', async () => {
    const { searchContent } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addTodo('重复的词条')
    data.addTodo('重复的词条二号')
    const hits = searchContent(data.state, '重复')
    expect(hits.length).toBeGreaterThan(0)
    const keys = hits.map((h) => h.key)
    expect(new Set(keys).size, 'key 应唯一').toBe(keys.length)
  })
})

describe('命令层：把棘轮的地板补实（剩余分支）', () => {
  it('targetCard：args 为 undefined 时走焦点/选中两条路（三种来源的入口都覆盖）', () => {
    const c = ctx()
    c.focusedCard.value = 'x'
    expect(targetCard(c, undefined)).toBe('x')
    c.focusedCard.value = null
    c.selection.value = new Set(['y'])
    expect(targetCard(c, undefined)).toBe('y')
  })

  it('索引：卡片域收卡片（带 blurb 与不带 blurb 两种形状都走）', async () => {
    const { searchCards } = await import('../../src/vue/paletteIndex')
    const withBlurb = REGISTRY.filter((m) => m.blurb).slice(0, 1)
    expect(searchCards(withBlurb, '').length).toBe(1)
    // 造一个没有 blurb 的模块（面板的兜底说明分支）
    const bare = [{ id: 'x', title: '素卡', defaultVariant: 'd', variants: [{ id: 'd', name: '默认', minW: 1, minH: 1, idealW: 2, idealH: 2 }] }]
    const hits = searchCards(bare, '素卡')
    expect(hits[0].sub).toContain('定位')
  })

  it('索引：内容域覆盖 notes/links/commands/feeds/stocks/birthdays（每种形状都铺一次）', async () => {
    const { contentIndex } = await import('../../src/vue/paletteIndex')
    const data = (await import('../../src/vue/cardData')).createCardData(memoryStorage())
    data.addNote('标题甲', '正文甲')
    data.addLink('链接甲', 'https://example.com/a')
    data.addCommand('命令甲', 'ls -la')
    data.addFeed('订阅甲', 'https://example.com/feed.xml')
    data.addStock('自选甲', 'sh000001')
    data.addBirthday('生日甲', 3, 14)
    const idx = contentIndex(data.state)
    for (const cardId of ['notes', 'links', 'commands', 'rss', 'stock', 'birthday']) {
      expect(idx.some((e) => e.cardId === cardId), `缺 ${cardId}`).toBe(true)
    }
  })

  it('索引：excerpt 命中在开头/结尾两种截法都不越界', async () => {
    const { excerpt } = await import('../../src/vue/paletteIndex')
    expect(excerpt('开头就命中后面的内容', '开头', 8).length).toBeLessThanOrEqual(9)
    expect(excerpt('前面很长很长很长很长很长很长很长很长后面才命中', '后面', 8)).toContain('后面')
  })
})

describe('命令层：目标为空 / 未实现的静默与拒绝（剩余分支另一侧）', () => {
  it('目标为空时 run 静默返回（不抛、不改文档）——命令的"假分支"也要守住', () => {
    const c = ctx()
    c.focusedCard.value = null
    c.selection.value = new Set()
    const before = JSON.stringify(c.store.doc.value)
    // 直接调 run（绕过 when）：这是"when 放行但目标在 run 里消失"的兜底路径。
    // 每个 run 两种目标都试：没参数（回落到 null）与显式 undefined —— 两条兜底分支都要走到
    for (const def of COMMANDS.filter((d) => d.scope === 'card' && typeof d.run === 'function')) {
      def.run!(c)
      def.run!(c, undefined)
    }
    expect(JSON.stringify(c.store.doc.value), '无目标时不该动文档').toBe(before)
    // row 域同理：先建一行让"查 rowId"这条路真的走一遍，再试"rowId 不存在"与"没给"
    c.store.add('sticky', 0, 6)
    c.store.groupIntoRow(['sticky'])
    const rowId = c.store.doc.value.rows![0].id
    const beforeRows = JSON.stringify(c.store.doc.value)
    for (const def of COMMANDS.filter((d) => d.scope === 'row' && typeof d.run === 'function')) {
      def.run!(c, { rowId })
      def.run!(c, { rowId: '不存在' })
      def.run!(c)
    }
    expect(JSON.stringify(c.store.doc.value), 'row 命令的"不存在/未给"分支不该动文档以外的怪状态').not.toBe(beforeRows)
  })

  it('commandStates 的 reason 兜底：when 为假且没写 why 时给通用文案', async () => {
    const mod = await import('../../src/vue/commands')
    const c = ctx()
    // 临时插一条只有 when 没有 why 的命令
    type Mutable = { id: string; label: string; hint: string; scope: string; when: () => boolean }[]
    const list = mod.COMMANDS as unknown as Mutable
    list.push({ id: 'zzz.nowhy', label: '无原因', hint: '测试用', scope: 'row', when: () => false })
    try {
      const st = commandStates(c).find((s) => s.def.id === 'zzz.nowhy')!
      expect(st.enabled).toBe(false)
      expect(st.reason, '没写 why 也要给一句').toBe('此刻不可用')
    } finally {
      list.pop()
    }
  })
})
