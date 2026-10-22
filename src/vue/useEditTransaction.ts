/**
 * 编辑事务的胶水层（2026-10-12 立的"进编辑器拍快照 / 保存确认 / 取消还原"那套）。
 *
 * 从 App.vue 抽出（拆分 ②）。纯判定在 `editTransaction.ts`（isEditDirty /
 * countLayoutChanges），这一层只持有 ref 与副作用：
 *  - 进编辑器拍一张快照；「保存」= 确认改动并退出；「取消」= 有改动先问一句、确认才还原。
 *  - 编辑期间 Ctrl+Z 照常可用（历史是全局的），取消只是往历史里再压一步 —— `store.restore`
 *    复用 `apply`，所以"取消"本身也能被撤销（不会把历史撕开一个洞）。
 *  - 点「工作台」tab 与 Esc 都走同一条取消路径 —— 否则事务会被 tab 切换绕开。
 *
 * **`view` 由调用方传入、不在这里创建**：它是整个应用的共享状态（顶栏 tab、Esc 级联、
 * 命令上下文都在读），搬进这个 composable 只会让其他关注点反向依赖它。
 */

import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { LayoutDoc } from '@levango7/engine'
import { countLayoutChanges, isEditDirty } from './editTransaction'
import type { LayoutStore } from './store'

export type TxView = 'workbench' | 'edit'

export interface EditTransactionOptions {
  store: LayoutStore
  /** 当前视图（编辑事务只负责改它，不拥有它） */
  view: Ref<TxView>
}

export function useEditTransaction(opts: EditTransactionOptions) {
  const { store, view } = opts
  const editSnapshot = ref<LayoutDoc | null>(null)
  const cancelAskOpen = ref(false)
  const editDirty = computed(() => isEditDirty(editSnapshot.value, store.doc.value))
  /**
   * 「N 处改动」：按**版面差异**数（卡片增删改 + 行的增删改），不是按历史步数 ——
   * 拖一步再拖回来在历史上是两步、在版面差异上却是 0 处，而用户看的是版面。
   */
  const editChangeCount = computed(() => {
    const a = editSnapshot.value
    if (!a) return 0
    return countLayoutChanges(a, store.doc.value)
  })

  function enterEdit(): void {
    if (view.value === 'edit') return
    editSnapshot.value = store.doc.value
    view.value = 'edit'
  }

  /** 保存 = 确认改动并退出（刷新一次基线，万一还留在编辑态也不重复确认） */
  function saveEdit(): void {
    editSnapshot.value = store.doc.value
    view.value = 'workbench'
  }

  function cancelEdit(): void {
    if (!editDirty.value) {
      editSnapshot.value = null
      view.value = 'workbench'
      return
    }
    cancelAskOpen.value = true
  }

  function confirmCancelEdit(): void {
    if (editSnapshot.value) store.restore(editSnapshot.value)
    cancelAskOpen.value = false
    editSnapshot.value = null
    view.value = 'workbench'
  }

  function dismissCancelAsk(): void {
    cancelAskOpen.value = false
  }

  return {
    editSnapshot,
    cancelAskOpen,
    editDirty,
    editChangeCount,
    enterEdit,
    saveEdit,
    cancelEdit,
    confirmCancelEdit,
    dismissCancelAsk,
  }
}
