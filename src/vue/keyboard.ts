/**
 * 编辑器的键盘意图 —— **纯函数**，不认识 KeyboardEvent，只认识"用户想干什么"。
 *
 * 为什么要抽出来：`CanvasEditor.vue` 原先把这段和 300 行指针状态机、模板、样式塞在一个文件里，
 * 于是键盘编排这条"卖点上的差距点"既没有单测，改动时也不敢碰。抽成纯函数之后，
 * 下面每一条语义都能被直接断言，而不必起浏览器。
 *
 * 一条规矩贯穿全部：**输入框里的按键一律放行**（`isEditableTarget`）。
 * 抢 Ctrl+Z / Backspace 的代价是用户在自己的输入框里按 Delete 删不掉字。
 */

import type { Placement } from '@levango7/engine'

/** 键盘事件里我们只看这几个字段 —— 结构化输入让单测不必造 KeyboardEvent */
export interface KeyLike {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export type KeyIntent =
  | { kind: 'clearSelection' }
  | { kind: 'selectAll' }
  | { kind: 'deleteSelection' }
  /** 多选且没按 Alt：只动当前格（`Alt+方向` 的"只动当前格"就是这条的反面） */
  | { kind: 'moveMany'; ids: string[]; dx: number; dy: number; mergeKey: string }
  | { kind: 'resize'; id: string; w: number; h: number; mergeKey: string }
  | { kind: 'move'; id: string; x: number; y: number; mergeKey: string }
  | { kind: 'toggleSelect'; id: string }
  | { kind: 'cycleVariant'; id: string }
  | { kind: 'toggleLock'; id: string }
  | { kind: 'remove'; id: string }

const DIRS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export function isEditableTarget(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null
  if (!n || !n.tagName) return false
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable === true
}

/** 全局层：Esc 清选、Ctrl/Cmd+A 全选、批量删除。`p` 为 null（焦点不在格子上） */
export function globalIntent(e: KeyLike, ctx: { items: readonly Placement[]; selCount: number }): KeyIntent | null {
  if (e.key === 'Escape') return { kind: 'clearSelection' }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') return { kind: 'selectAll' }
  // 批量删除只认"选了多个"：单个的删除走格子层，好让焦点落点由 removeCell 负责
  if ((e.key === 'Delete' || e.key === 'Backspace') && ctx.selCount > 1) return { kind: 'deleteSelection' }
  return null
}

/**
 * 格子层：焦点在某个格子上时的编排。
 *
 * 三条容易被忽略的语义都在这里：
 * - `Shift+方向` 改**尺寸**，`裸方向` 改**位置**；
 * - 多选时按方向动的是**整组**，除非按着 `Alt`（那时只动当前格）；
 * - 每条都带 `mergeKey`：连按方向键在 300ms 窗口内折叠成一步历史，
 *   所以把卡片从 4 列拉到 12 列之后，撤销不必一格一格爬回来。
 */
export function cellIntent(e: KeyLike, p: Placement, sel: readonly string[]): KeyIntent | null {
  const step = DIRS[e.key]
  if (step) {
    if (sel.length > 1 && !e.altKey) {
      const ids = [...sel].sort()
      return { kind: 'moveMany', ids, dx: step[0], dy: step[1], mergeKey: `kbd:moveMany:${ids.join(',')}` }
    }
    if (e.shiftKey) return { kind: 'resize', id: p.id, w: p.w + step[0], h: p.h + step[1], mergeKey: `kbd:resize:${p.id}` }
    return { kind: 'move', id: p.id, x: p.x + step[0], y: p.y + step[1], mergeKey: `kbd:move:${p.id}` }
  }
  if (e.key === ' ') return { kind: 'toggleSelect', id: p.id }
  if (e.key === 'Enter') return { kind: 'cycleVariant', id: p.id }
  if (e.key === 'l' || e.key === 'L') return { kind: 'toggleLock', id: p.id }
  if (e.key === 'Delete' || e.key === 'Backspace') return { kind: 'remove', id: p.id }
  return null
}

/**
 * 这些意图要 `preventDefault`，其余不拦（让浏览器处理 F5、Tab 之类）。
 *
 * 分界是"这个键在浏览器里本来有动作吗"：
 * - 方向键会滚动页面 → 拦；空格会翻页 → 拦；Backspace 在老浏览器里会后退 → 拦；
 * - Enter / L / Esc 在格子上没有原生动作 → 不拦（拦了反而可能吃掉输入框的提交）。
 */
export function shouldPrevent(intent: KeyIntent | null): boolean {
  if (!intent) return false
  return intent.kind !== 'cycleVariant' && intent.kind !== 'toggleLock'
}

/* ────────────────────────────────────────────────────────────────────────────
 * 应用层的键盘编排（Esc 级联 + 全局快捷键）
 *
 * 与上面两层（全局 / 格子）的关系：那两层管**编辑器里**的键，这一层管**整个应用**的键。
 * 拆开的理由是同一个 —— 这段级联此前长在 App.vue 的 `onGlobalKey` 里，
 * 七层 if-else 没有任何断言，而它恰好是最容易在加弹层时被改错的东西
 * （加一层忘插进级联 = 新弹层按 Esc 不关，用户只能点鼠标）。
 *
 * **编辑器先吃**：它手里有比"取消整场编辑"更局部的"退一步"（清选中），
 * 否则选了卡按 Esc 会直接弹放弃确认。所以 `editorEscape` 是一个 **thunk**
 * （`() => boolean`）而不是一个布尔值 —— 问编辑器"这层还有没有可退的"必须发生在
 * 走到这一层的时候，早问会把"编辑器本来能吃掉的 Esc"提前判死。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 走 Esc 级联时各层的当前状态（全是值，没有 ref） */
export interface AppKeyLayers {
  paletteOpen: boolean
  cancelAskOpen: boolean
  /** 编辑器自退（清选中 / 关目录下拉）；消费掉了返回 true */
  editorEscape: () => boolean
  view: 'workbench' | 'edit'
  arrangeOpen: boolean
  /** 顶栏「浮窗 N」清单开着（F-08，2026-10-26）—— 有浮窗时顶栏才出现这枚按钮 */
  floatOpen: boolean
  templatesOpen: boolean
  settingsOpen: boolean
  /**
   * AI 对话坞展开着（F-12 二期）。它排在**级联最底一层**：坞是常驻壳，
   * 上面任何一层全屏遮罩都该先吃 Esc。可选 = 旧调用方不传就是"没有坞"。
   */
  dockExpanded?: boolean
}

/** Esc 该落在哪一层。`null` = 这个键不是 Esc，或者级联走到底也没人接 */
export type AppKeyAction =
  | { kind: 'closePalette' }
  | { kind: 'closeCancelAsk' }
  | { kind: 'editorEscape' }
  | { kind: 'cancelEdit' }
  | { kind: 'closeArrange' }
  | { kind: 'closeFloats' }
  | { kind: 'closeTemplates' }
  | { kind: 'closeSettings' }
  | { kind: 'collapseDock' }

/**
 * Esc 从最上面一层往下走：先关命令面板与确认框，再交编辑器自退，
 * 然后才是"取消这次编辑"，最后是各弹层。
 */
export function appKeyIntent(e: KeyLike, layers: AppKeyLayers): AppKeyAction | null {
  if (e.key !== 'Escape') return null
  if (layers.paletteOpen) return { kind: 'closePalette' }
  if (layers.cancelAskOpen) return { kind: 'closeCancelAsk' }
  if (layers.editorEscape()) return { kind: 'editorEscape' }
  if (layers.view === 'edit') return { kind: 'cancelEdit' }
  if (layers.arrangeOpen) return { kind: 'closeArrange' }
  if (layers.floatOpen) return { kind: 'closeFloats' }
  if (layers.templatesOpen) return { kind: 'closeTemplates' }
  if (layers.settingsOpen) return { kind: 'closeSettings' }
  // 坞在最后：它是常驻的，先让所有全屏遮罩与编辑事务吃掉 Esc
  if (layers.dockExpanded) return { kind: 'collapseDock' }
  return null
}

/**
 * 全局快捷键里"Ctrl+K 唤出命令面板"的判定。它是**全局键**：即使在输入框里也生效
 * （这是"任何地方唤出"的语义），所以它不能走 `isEditableTarget` 那道放行。
 */
export function isPaletteHotkey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
}

/**
 * Ctrl+J 开合 AI 对话坞（F-12 二期）。与 Ctrl+K 同族：**输入框里也生效** ——
 * 用户在坞里打字时按 Ctrl+J 就是"收起来"，这是 toggle 的语义。
 * `Ctrl+Shift+J` 也算（与 Ctrl+K 的 Shift 口径一致，Shift 不改变意图）。
 */
export function isDockHotkey(e: KeyLike): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j'
}

/** 全局快捷键里"撤销/重做"的判定。大小写不敏感（Ctrl+Shift+Z 与 ctrl+z 同效） */
export function isUndoHotkey(e: KeyLike): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null
  const k = e.key.toLowerCase()
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (k === 'y') return 'redo'
  return null
}

