/**
 * 全局键盘装配（拆分 ②）：从公开接口驱动 onGlobalKey。
 *
 * 与 `keyboard.test.ts` 的分工：那边钉 `appKeyIntent` 的纯决策，这边钉**deps 透传**——
 * 每一层的 ref 是否接对、动作是否接到对的函数上、thunk 的调用时机、输入控件的放行。
 * 接错一条的症状全是界面行为（某层 Esc 不关 / 输入框里按 Ctrl+Z 撤销了打字），
 * 单元测试不抓就没人抓。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useGlobalKeys, type GlobalKeysDeps, type GlobalKeyLike } from '../../src/vue/useGlobalKeys'
import type { KeyLike } from '../../src/vue/keyboard'
import type { TxView } from '../../src/vue/useEditTransaction'

function setup(over: Partial<GlobalKeysDeps> = {}) {
  const deps: GlobalKeysDeps = {
    paletteOpen: ref(false),
    cancelAskOpen: ref(false),
    editorEscape: vi.fn(() => false),
    view: ref<TxView>('workbench'),
    arrangeOpen: ref(false),
    floatOpen: ref(false),
    templatesOpen: ref(false),
    settingsOpen: ref(false),
    dockExpanded: ref(false),
    dockVisible: ref(true),
    cancelEdit: vi.fn(),
    closeTemplates: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...over,
  }
  return { deps, onKey: useGlobalKeys(deps) }
}

/** 结构化键盘事件（同 keyboard.test.ts 的 k() 思路：不起 DOM）。
 *  `preventDefault` 是 spy —— Ctrl+K / Ctrl+Z 必须 preventDefault，否则浏览器
 *  自己的快捷键会把我们的动作绕开。返回事件与 spy 两个，断言时各取所需。 */
function key(o: Partial<KeyLike>, target?: EventTarget | null): { e: GlobalKeyLike; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn()
  const e: GlobalKeyLike = {
    key: 'k',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...o,
    target: target ?? null,
    preventDefault,
  }
  return { e, preventDefault }
}

describe('useGlobalKeys · Esc 七层', () => {
  it('面板开着 → 只关面板，不问编辑器、不取消编辑', () => {
    const { deps, onKey } = setup()
    deps.paletteOpen.value = true
    onKey(key({ key: 'Escape' }).e)
    expect(deps.paletteOpen.value).toBe(false)
    expect(deps.editorEscape).not.toHaveBeenCalled() // thunk 时机：上层开着压根不问
    expect(deps.cancelEdit).not.toHaveBeenCalled()
  })

  it('确认框开着 → 关确认框', () => {
    const { deps, onKey } = setup()
    deps.cancelAskOpen.value = true
    onKey(key({ key: 'Escape' }).e)
    expect(deps.cancelAskOpen.value).toBe(false)
  })

  it('编辑器可自退 → 它吃掉（清选中/关目录下拉），不弹放弃确认', () => {
    const { deps, onKey } = setup({ editorEscape: vi.fn(() => true) })
    deps.view.value = 'edit'
    onKey(key({ key: 'Escape' }).e)
    expect(deps.editorEscape).toHaveBeenCalledTimes(1)
    expect(deps.cancelEdit).not.toHaveBeenCalled()
  })

  it('编辑器不可退且编辑态 → 取消这次编辑', () => {
    const { deps, onKey } = setup()
    deps.view.value = 'edit'
    onKey(key({ key: 'Escape' }).e)
    expect(deps.cancelEdit).toHaveBeenCalledTimes(1)
  })

  it('弹层按 arrange → floats → templates → settings 的顺序逐层往下', () => {
    const a = setup()
    a.deps.arrangeOpen.value = true
    a.onKey(key({ key: 'Escape' }).e)
    expect(a.deps.arrangeOpen.value).toBe(false)
    expect(a.deps.closeTemplates).not.toHaveBeenCalled()

    const b = setup()
    b.deps.templatesOpen.value = true
    b.onKey(key({ key: 'Escape' }).e)
    expect(b.deps.closeTemplates).toHaveBeenCalledTimes(1)

    // F-08：浮窗清单这一层的 ref 是否接对 —— 接错的症状是"顶栏浮窗菜单按 Esc 不关"
    const f = setup()
    f.deps.floatOpen.value = true
    f.onKey(key({ key: 'Escape' }).e)
    expect(f.deps.floatOpen.value).toBe(false)
    expect(f.deps.closeTemplates).not.toHaveBeenCalled()

    const c = setup()
    c.deps.settingsOpen.value = true
    c.onKey(key({ key: 'Escape' }).e)
    expect(c.deps.settingsOpen.value).toBe(false)
  })

  it('全部关着 → Esc 无人接（不炸）', () => {
    const { deps, onKey } = setup()
    onKey(key({ key: 'Escape' }).e)
    expect(deps.cancelEdit).not.toHaveBeenCalled()
    expect(deps.editorEscape).toHaveBeenCalledTimes(1)
  })

  it('坞展开着 → Esc 收起它（F-12 二期，级联最底一层）', () => {
    const { deps, onKey } = setup()
    deps.dockExpanded.value = true
    onKey(key({ key: 'Escape' }).e)
    expect(deps.dockExpanded.value).toBe(false)
  })

  it('坞上面压着设置时，Esc 先关设置而不是收坞', () => {
    const { deps, onKey } = setup()
    deps.dockExpanded.value = true
    deps.settingsOpen.value = true
    onKey(key({ key: 'Escape' }).e)
    expect(deps.settingsOpen.value).toBe(false)
    expect(deps.dockExpanded.value).toBe(true)
  })
})

describe('useGlobalKeys · 全局快捷键', () => {
  it('Ctrl+K 开命令面板（输入框里也生效——"任何地方唤出"的语义）', () => {
    const { deps, onKey } = setup()
    const input = { tagName: 'INPUT' } as unknown as EventTarget
    const { e, preventDefault } = key({ key: 'k', ctrlKey: true }, input)
    onKey(e)
    expect(deps.paletteOpen.value).toBe(true)
    expect(preventDefault).toHaveBeenCalled() // 不让浏览器去吃这个组合键
  })

  it('Cmd+K 同效（macOS）', () => {
    const { deps, onKey } = setup()
    onKey(key({ key: 'k', metaKey: true }).e)
    expect(deps.paletteOpen.value).toBe(true)
  })

  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 四种形状各自路由', () => {
    const a = setup()
    a.onKey(key({ key: 'z', ctrlKey: true }).e)
    expect(a.deps.undo).toHaveBeenCalledTimes(1)
    expect(a.deps.redo).not.toHaveBeenCalled()

    const b = setup()
    b.onKey(key({ key: 'z', ctrlKey: true, shiftKey: true }).e)
    expect(b.deps.redo).toHaveBeenCalledTimes(1)
    expect(b.deps.undo).not.toHaveBeenCalled()

    const c = setup()
    c.onKey(key({ key: 'y', ctrlKey: true }).e)
    expect(c.deps.redo).toHaveBeenCalledTimes(1)

    const d = setup()
    d.onKey(key({ key: 'Z', ctrlKey: true }).e) // 大写（Shift 已松开的大小写不敏感）
    expect(d.deps.undo).toHaveBeenCalledTimes(1)
  })

  it('输入控件里的 Ctrl+Z 不抢（放行 isEditableTarget）', () => {
    for (const tag of ['INPUT', 'TEXTAREA']) {
      const { deps, onKey } = setup()
      onKey(key({ key: 'z', ctrlKey: true }, { tagName: tag } as unknown as EventTarget).e)
      expect(deps.undo, tag).not.toHaveBeenCalled()
    }
    const ce = setup()
    ce.onKey(key({ key: 'z', ctrlKey: true }, { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget).e)
    expect(ce.deps.undo).not.toHaveBeenCalled()
  })

  it('普通字符键无动作', () => {
    const { deps, onKey } = setup()
    onKey(key({ key: 'a' }).e)
    expect(deps.undo).not.toHaveBeenCalled()
    expect(deps.redo).not.toHaveBeenCalled()
    expect(deps.paletteOpen.value).toBe(false)
  })

  it('Ctrl+J 开合对话坞；坞不在场（编辑态等）时既不拦也不动', () => {
    const a = setup()
    a.onKey(key({ key: 'j', ctrlKey: true }).e)
    expect(a.deps.dockExpanded.value).toBe(true)
    a.onKey(key({ key: 'j', ctrlKey: true }).e)
    expect(a.deps.dockExpanded.value).toBe(false)

    const b = setup({ dockVisible: ref(false) })
    const { e, preventDefault } = key({ key: 'j', ctrlKey: true })
    b.onKey(e)
    expect(b.deps.dockExpanded.value).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled() // 没拦住：浏览器自己的快捷键照常
  })
})
