/**
 * 撤销/重做的 composable（2026-10-24，App.vue 拆分 Cut B）。
 *
 * 纯函数决策层在 `undoRouting.ts`（anyUndo/undoOrder/...，12 条钉子）；
 * 这里只把**执行**包成可测单元：两份历史的调用顺序、`lastUndoKind` 记账，
 * 以及拆分前留在 App.vue 里的三处保真行为（逐字保留，测试钉住）：
 *  ① 编辑态无条件撤/重做版面 —— **不查 canUndo/canRedo**。原代码编辑态分支就是
 *     无条件 `store.undo()`，引擎对空栈是 no-op（history.ts: `if (!prev) return h`），
 *     所以差别只剩 `lastUndoKind` 的赋值照旧发生，而它决定之后重做的偏好，不能丢；
 *  ② 工作台态才查可用态：选中的那边没得撤就退到另一边；
 *  ③ 内容分支 undo 看**返回值**（false = 没得撤，循环继续试另一边），
 *     redo 分支看 **canRedo** —— 与 undo 不对称，这是拆分前就有的形状。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { ContentHistoryApi } from './contentHistory'
import type { LayoutStore } from './store'
import { anyRedo, anyUndo, redoOrder, undoOrder, type UndoRoutingCaps, type UndoKind, type ViewKind } from './undoRouting'

export interface UseUndoRedoOptions {
  /** 版面历史（引擎 history.ts）：undo/redo 对空栈是 no-op，返回 void */
  layout: Pick<LayoutStore, 'canUndo' | 'canRedo' | 'lastAt' | 'undo' | 'redo'>
  /** 内容历史：undo/redo 返回"这一步步有没有真的动" */
  content: Pick<ContentHistoryApi, 'canUndo' | 'canRedo' | 'lastAt' | 'undo' | 'redo'>
  /** 当前视图（编辑态只在改版面 ⇒ 永远撤版面）；ref 与 computed 都收 */
  view: Ref<ViewKind> | ComputedRef<ViewKind>
}

export interface UndoRedoApi {
  lastUndoKind: Ref<UndoKind>
  routingCaps: ComputedRef<UndoRoutingCaps>
  canUndoAny: ComputedRef<boolean>
  canRedoAny: ComputedRef<boolean>
  undoLatest(): void
  redoLatest(): void
}

export function useUndoRedo(opts: UseUndoRedoOptions): UndoRedoApi {
  const lastUndoKind = ref<UndoKind>('layout')
  /** 路由所需的输入（全是值）；撤销/重做按钮的可用态与顺序都从它算 */
  const routingCaps = computed<UndoRoutingCaps>(() => ({
    layoutCanUndo: opts.layout.canUndo.value,
    contentCanUndo: opts.content.canUndo.value,
    layoutCanRedo: opts.layout.canRedo.value,
    contentCanRedo: opts.content.canRedo.value,
    layoutLastAt: opts.layout.lastAt.value,
    contentLastAt: opts.content.lastAt.value,
  }))
  const canUndoAny = computed(() => anyUndo(routingCaps.value))
  const canRedoAny = computed(() => anyRedo(routingCaps.value))
  /** 顺序由 `undoRouting.ts` 定（编辑态永远撤版面；工作台态谁更近撤谁）；这里只负责执行 */
  function undoLatest(): void {
    for (const kind of undoOrder({ view: opts.view.value, lastUndoKind: lastUndoKind.value }, routingCaps.value)) {
      if (kind === 'content') {
        if (opts.content.undo()) {
          lastUndoKind.value = 'content'
          return
        }
      } else if (opts.view.value === 'edit' || opts.layout.canUndo.value) {
        // 编辑态恒撤版面，且**不查 canUndo** —— 与拆分前逐字一致：原代码编辑态分支是
        // 无条件 store.undo()。引擎对空栈是 no-op（history.ts: `if (!prev) return h`），
        // 所以差别只剩 lastUndoKind 的赋值照旧发生，而它决定之后重做的偏好，不能丢。
        // 工作台态才查 canUndo：选中的那边没得撤就退到另一边。
        opts.layout.undo()
        lastUndoKind.value = 'layout'
        return
      }
    }
  }
  function redoLatest(): void {
    for (const kind of redoOrder({ view: opts.view.value, lastUndoKind: lastUndoKind.value }, routingCaps.value)) {
      if (kind === 'content') {
        if (opts.content.canRedo.value) {
          opts.content.redo()
          lastUndoKind.value = 'content'
          return
        }
      } else if (opts.view.value === 'edit' || opts.layout.canRedo.value) {
        // 同 undoLatest：编辑态无条件重做版面（含空转），保住 lastUndoKind 赋值
        opts.layout.redo()
        lastUndoKind.value = 'layout'
        return
      }
    }
  }
  return { lastUndoKind, routingCaps, canUndoAny, canRedoAny, undoLatest, redoLatest }
}
