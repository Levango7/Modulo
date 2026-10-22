/**
 * 命令总线的宿主侧装配（拆分 ②）：5 条拦截命令与总线的接线。
 *
 * 钉住三件事：
 *  ① 5 条拦截 id 与 hooks 的对应关系（edit.save→saveEdit、layout.fit→fitLayout、
 *     layout.compact→compactLayout、view.edit→enterEdit、view.workbench→leaveEdit）——
 *     接错一条的症状是"面板点了没反应"，而那是界面行为，单元测试不抓就没人抓；
 *  ② 非拦截命令走命令表原路径不被破坏（layout.tidy → store.tidy）；
 *  ③ effect 类命令仍触发 ctx.openUI（app.settings → openUI('settings')）。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAppCommands, type AppCommandHooks } from '../../src/vue/useAppCommands'
import type { CommandContext } from '../../src/vue/commands'

function fakeStore() {
  return { tidy: vi.fn(), restore: vi.fn(), undo: vi.fn() } as unknown as CommandContext['store']
}

function fakeCtx(): CommandContext {
  const openUI = vi.fn()
  const detach = vi.fn()
  const unfloat = vi.fn()
  const store = fakeStore()
  const ctx: CommandContext = {
    store,
    view: ref('workbench'),
    selection: ref(new Set<string>()),
    focusedCard: ref(null),
    editDirty: ref(false),
    openUI,
    detach,
    unfloat,
    detached: ref(new Set<string>()),
    floatingSupported: false,
    stageW: ref(1200),
    cols: ref(12),
    gap: 8,
    rowPx: ref(40),
  }
  return ctx
}

function fakeHooks(): AppCommandHooks {
  return {
    saveEdit: vi.fn(),
    fitLayout: vi.fn(),
    compactLayout: vi.fn(),
    enterEdit: vi.fn(),
    leaveEdit: vi.fn(),
  }
}

function setup(view: 'workbench' | 'edit' = 'workbench') {
  const ctx = fakeCtx()
  ctx.view.value = view
  const hooks = fakeHooks()
  const bus = useAppCommands(ctx, hooks)
  return { ctx, hooks, bus }
}

describe('useAppCommands', () => {
  it('5 条拦截命令在各自可用态下触发对应 hook（接错线这里就红）', () => {
    // 每条命令的 when 不同（save 要 edit 态；fit/compact 要 workbench 态；
    // view.edit 要非 edit；view.workbench 要非 workbench）—— 分开断言，
    // 顺带钉住"宿主拦截不改变可用态语义"。
    const edit = setup('edit')
    expect(edit.bus.dispatch('edit.save')).toEqual({ ok: true, id: 'edit.save' })
    expect(edit.hooks.saveEdit).toHaveBeenCalledTimes(1)

    const wb = setup('workbench')
    expect(wb.bus.dispatch('layout.fit').ok).toBe(true)
    expect(wb.hooks.fitLayout).toHaveBeenCalledTimes(1)
    expect(wb.bus.dispatch('layout.compact').ok).toBe(true)
    expect(wb.hooks.compactLayout).toHaveBeenCalledTimes(1)
    expect(wb.bus.dispatch('view.edit').ok).toBe(true)
    expect(wb.hooks.enterEdit).toHaveBeenCalledTimes(1)

    const nonWb = setup('edit')
    expect(nonWb.bus.dispatch('view.workbench').ok).toBe(true)
    expect(nonWb.hooks.leaveEdit).toHaveBeenCalledTimes(1)
  })

  it('非拦截命令走命令表原路径（layout.tidy → store.tidy）', () => {
    const ctx = fakeCtx()
    const bus = useAppCommands(ctx, fakeHooks())
    expect(bus.dispatch('layout.tidy').ok).toBe(true)
    expect(ctx.store.tidy).toHaveBeenCalledTimes(1)
  })

  it('effect 类命令触发 openUI（app.settings → settings）', () => {
    const ctx = fakeCtx()
    const bus = useAppCommands(ctx, fakeHooks())
    expect(bus.dispatch('app.settings').ok).toBe(true)
    expect(ctx.openUI).toHaveBeenCalledWith('settings')
  })

  it('可用性谓词在拦截之前：view.edit 在 edit 态时 unavailable，hook 不被调', () => {
    const ctx = fakeCtx()
    ctx.view.value = 'edit'
    const hooks = fakeHooks()
    const bus = useAppCommands(ctx, hooks)
    const r = bus.dispatch('view.edit')
    expect(r).toMatchObject({ ok: false, id: 'view.edit', reason: 'unavailable' })
    expect(hooks.enterEdit).not.toHaveBeenCalled()
  })

  it('宿主拦截优先于命令表 effect：dispatch(view.edit) 只走 enterEdit，不另开 openUI', () => {
    const ctx = fakeCtx()
    ctx.view.value = 'workbench'
    const hooks = fakeHooks()
    const bus = useAppCommands(ctx, hooks)
    expect(bus.dispatch('view.edit').ok).toBe(true)
    expect(hooks.enterEdit).toHaveBeenCalledTimes(1)
    // 命令表里 view.edit 也挂着 effect: openUI('edit') —— intercept 先吃到，
    // 不会两条路都走（否则一次派发进两次编辑器）
    expect(ctx.openUI).not.toHaveBeenCalled()
  })

  it('没实现也没拦截的命令不静默吞（palette.open 反例：它有 effect）', () => {
    const ctx = fakeCtx()
    const bus = useAppCommands(ctx, fakeHooks())
    // palette.open 在命令表里有 effect —— 走原路径，证明总线没被拦截注册破坏
    expect(bus.dispatch('palette.open').ok).toBe(true)
    expect(ctx.openUI).toHaveBeenCalledWith('palette')
  })

  it('createCommandBus 的只读面透传（defs / byId）', () => {
    const ctx = fakeCtx()
    const bus = useAppCommands(ctx, fakeHooks())
    expect(bus.defs.length).toBeGreaterThan(0)
    expect(bus.byId('edit.save')?.id).toBe('edit.save')
    expect(bus.byId('nope')).toBeUndefined()
  })
})
