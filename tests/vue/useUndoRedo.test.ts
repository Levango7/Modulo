/**
 * 撤销/重做的 composable（App.vue L99-145 的 composable 化，拆分 Cut B）。
 *
 * 纯函数决策层（anyUndo/undoOrder/...）在 `undoRouting.ts` 已有 12 条钉子；
 * 这里钉的是**执行层**：两份历史的调用顺序、`lastUndoKind` 记账、以及
 * 拆分前留下的三处"刻意不查可用态"的保真行为：
 *  ① 编辑态无条件撤/重做版面（**不查 canUndo/canRedo**，空栈也调 —— 引擎 no-op）；
 *  ② 空栈撤销后 `lastUndoKind` 赋值照旧发生（它决定之后重做的偏好，不能丢）；
 *  ③ 内容分支 undo 看**返回值**（false = 没得撤，循环退到版面），redo 分支看 **canRedo**
 *     （与 undo 不对称，这是拆分前就有的形状，逐字保留）。
 */
import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useUndoRedo, type UseUndoRedoOptions } from '../../src/vue/useUndoRedo'

/** 造假的两份历史：canUndo/canRedo/lastAt 用 computed 包可写 ref（忠实反映真实类型：
 *  LayoutStore 三个都是 ComputedRef、ContentHistoryApi 的 lastAt 是 Ref），方法全是 vi.fn */
function makeDeps(over: {
  view?: 'workbench' | 'edit'
  layoutCanUndo?: boolean
  contentCanUndo?: boolean
  layoutCanRedo?: boolean
  contentCanRedo?: boolean
  layoutLastAt?: number
  contentLastAt?: number
  contentUndoReturns?: boolean
} = {}) {
  const state = {
    layoutCanUndo: ref(over.layoutCanUndo ?? true),
    layoutCanRedo: ref(over.layoutCanRedo ?? true),
    layoutLastAt: ref(over.layoutLastAt ?? 100),
    contentCanUndo: ref(over.contentCanUndo ?? true),
    contentCanRedo: ref(over.contentCanRedo ?? true),
    contentLastAt: ref(over.contentLastAt ?? 100),
  }
  const layout = {
    canUndo: computed(() => state.layoutCanUndo.value),
    canRedo: computed(() => state.layoutCanRedo.value),
    lastAt: computed(() => state.layoutLastAt.value),
    undo: vi.fn(),
    redo: vi.fn(),
  }
  const content = {
    canUndo: computed(() => state.contentCanUndo.value),
    canRedo: computed(() => state.contentCanRedo.value),
    lastAt: state.contentLastAt,
    undo: vi.fn(() => over.contentUndoReturns ?? true),
    redo: vi.fn(),
  }
  const view = ref<'workbench' | 'edit'>(over.view ?? 'workbench')
  return { layout, content, view, state }
}

const use = (deps: ReturnType<typeof makeDeps>): UseUndoRedoOptions => ({
  layout: deps.layout,
  content: deps.content,
  view: deps.view,
})

describe('useUndoRedo：初始态与按钮可用态', () => {
  it('初始 lastUndoKind 是 layout，routingCaps 六字段透传两份历史', () => {
    const d = makeDeps({ layoutLastAt: 42, contentLastAt: 99 })
    const api = useUndoRedo(use(d))
    expect(api.lastUndoKind.value).toBe('layout')
    expect(api.routingCaps.value).toEqual({
      layoutCanUndo: true,
      contentCanUndo: true,
      layoutCanRedo: true,
      contentCanRedo: true,
      layoutLastAt: 42,
      contentLastAt: 99,
    })
  })

  it('两边都没得撤时 canUndoAny/canRedoAny 全灭', () => {
    const d = makeDeps({ layoutCanUndo: false, contentCanUndo: false, layoutCanRedo: false, contentCanRedo: false })
    const api = useUndoRedo(use(d))
    expect(api.canUndoAny.value).toBe(false)
    expect(api.canRedoAny.value).toBe(false)
  })

  it('任一边还能撤/还能重做，按钮就亮（两份各自单独钉）', () => {
    const onlyLayout = makeDeps({ layoutCanUndo: true, contentCanUndo: false })
    expect(useUndoRedo(use(onlyLayout)).canUndoAny.value).toBe(true)
    const onlyContent = makeDeps({ layoutCanUndo: false, contentCanUndo: true })
    expect(useUndoRedo(use(onlyContent)).canUndoAny.value).toBe(true)
    const onlyLayoutRedo = makeDeps({ layoutCanRedo: true, contentCanRedo: false })
    expect(useUndoRedo(use(onlyLayoutRedo)).canRedoAny.value).toBe(true)
    const onlyContentRedo = makeDeps({ layoutCanRedo: false, contentCanRedo: true })
    expect(useUndoRedo(use(onlyContentRedo)).canRedoAny.value).toBe(true)
  })

  it('routingCaps 跟着历史状态变（computed 不是快照）', () => {
    const d = makeDeps({ layoutLastAt: 100 })
    const api = useUndoRedo(use(d))
    d.state.layoutLastAt.value = 555
    expect(api.routingCaps.value.layoutLastAt).toBe(555)
    d.state.layoutCanUndo.value = false
    expect(api.canUndoAny.value).toBe(true) // 内容侧还能撤，仍亮
    d.state.contentCanUndo.value = false
    expect(api.canUndoAny.value).toBe(false)
  })
})

describe('useUndoRedo：undoLatest 执行', () => {
  it('编辑态无条件撤版面：不查 canUndo，layoutCanUndo=false 也调 store.undo', () => {
    const d = makeDeps({ view: 'edit', layoutCanUndo: false, contentLastAt: 999 })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(d.layout.undo).toHaveBeenCalledTimes(1)
    expect(d.content.undo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('layout')
  })

  it('编辑态空栈撤销：lastUndoKind 赋值照旧发生（保住之后重做的偏好）', () => {
    // 与上一条同场景，单独钉"赋值"这个可观察效果：引擎对空栈 no-op，
    // 拆分前的行为差异只剩这一项，丢了它重做偏好会漂
    const d = makeDeps({ view: 'edit', layoutCanUndo: false })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(api.lastUndoKind.value).toBe('layout')
  })

  it('工作台态平手（内容 >= 版面）：先试内容，撤成功就不碰版面', () => {
    const d = makeDeps({ layoutLastAt: 100, contentLastAt: 100, contentUndoReturns: true })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(d.content.undo).toHaveBeenCalledTimes(1)
    expect(d.layout.undo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('content')
  })

  it('工作台态版面更近：先试版面，且工作台态查 canUndo（false 时跳过）', () => {
    const d = makeDeps({ layoutLastAt: 200, contentLastAt: 100 })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(d.layout.undo).toHaveBeenCalledTimes(1)
    expect(d.content.undo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('layout')

    // 同顺序但版面没得撤：退到内容
    const d2 = makeDeps({ layoutLastAt: 200, contentLastAt: 100, layoutCanUndo: false, contentUndoReturns: true })
    const api2 = useUndoRedo(use(d2))
    api2.undoLatest()
    expect(d2.layout.undo).not.toHaveBeenCalled()
    expect(d2.content.undo).toHaveBeenCalledTimes(1)
    expect(api2.lastUndoKind.value).toBe('content')
  })

  it('工作台态内容没得撤（undo 返回 false）：退到版面', () => {
    const d = makeDeps({ layoutLastAt: 100, contentLastAt: 100, contentUndoReturns: false })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(d.content.undo).toHaveBeenCalledTimes(1)
    expect(d.layout.undo).toHaveBeenCalledTimes(1)
    expect(api.lastUndoKind.value).toBe('layout')
  })

  it('两边都没得撤：版面 undo 不被调，内容 undo 调一次但落空（无副作用）', () => {
    // 内容分支是"调了看返回值"（false = 落空），**不查 canUndo** —— 与 redo 分支
    // 先查 canRedo 的不对称见文件头 ③。版面分支才查 canUndo（false 时跳过不调）。
    const d = makeDeps({
      layoutCanUndo: false,
      contentCanUndo: false,
      layoutLastAt: 100,
      contentLastAt: 100,
      contentUndoReturns: false,
    })
    const api = useUndoRedo(use(d))
    api.undoLatest()
    expect(d.content.undo).toHaveBeenCalledTimes(1)
    expect(d.layout.undo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('layout') // 未动过，保持原值
  })
})

describe('useUndoRedo：redoLatest 执行', () => {
  it('工作台态跟 lastUndoKind 走：上次撤的是内容就先试内容，且内容分支查 canRedo', () => {
    const d = makeDeps({ contentCanRedo: true })
    const api = useUndoRedo(use(d))
    api.lastUndoKind.value = 'content'
    api.redoLatest()
    expect(d.content.redo).toHaveBeenCalledTimes(1)
    expect(d.layout.redo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('content')

    // 内容侧没得重做：退到版面（与 undo 的"退到另一边"对称）
    const d2 = makeDeps({ contentCanRedo: false })
    const api2 = useUndoRedo(use(d2))
    api2.lastUndoKind.value = 'content'
    api2.redoLatest()
    expect(d2.content.redo).not.toHaveBeenCalled()
    expect(d2.layout.redo).toHaveBeenCalledTimes(1)
    expect(api2.lastUndoKind.value).toBe('layout')
  })

  it('工作台态上次撤的是版面：先试版面（不查 canRedo 之外的顺序问题）', () => {
    const d = makeDeps({ layoutLastAt: 200, contentLastAt: 100 })
    const api = useUndoRedo(use(d))
    api.redoLatest()
    expect(d.layout.redo).toHaveBeenCalledTimes(1)
    expect(d.content.redo).not.toHaveBeenCalled()
  })

  it('编辑态无条件重做版面：不查 canRedo，空转也调（保住 lastUndoKind 赋值）', () => {
    const d = makeDeps({ view: 'edit', layoutCanRedo: false })
    const api = useUndoRedo(use(d))
    api.redoLatest()
    expect(d.layout.redo).toHaveBeenCalledTimes(1)
    expect(d.content.redo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('layout')
  })

  it('两边都没得重做：两个 redo 都不被调（顺序里每一步都落空，无副作用）', () => {
    // undo 的对称场景见上；redo 的内容分支查 canRedo（false 不进）、版面分支
    // 工作台态查 canRedo（false 不进）⇒ 循环自然结束，两个 redo 都没被调
    const d = makeDeps({ layoutCanRedo: false, contentCanRedo: false })
    const api = useUndoRedo(use(d))
    api.redoLatest()
    expect(d.content.redo).not.toHaveBeenCalled()
    expect(d.layout.redo).not.toHaveBeenCalled()
    expect(api.lastUndoKind.value).toBe('layout') // 未动过，保持原值
  })
})

describe('useUndoRedo：computed 形态的 view 也收', () => {
  it('view 是 ComputedRef 时按当前值路由', () => {
    const d = makeDeps({ view: 'edit', layoutCanUndo: false })
    const api = useUndoRedo({
      layout: d.layout,
      content: d.content,
      view: computed(() => d.view.value),
    })
    api.undoLatest()
    expect(d.layout.undo).toHaveBeenCalledTimes(1)
    expect(d.content.undo).not.toHaveBeenCalled()
  })
})
