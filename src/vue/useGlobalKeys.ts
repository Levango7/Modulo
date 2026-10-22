/**
 * 全局键盘监听（App.vue `onGlobalKey` 的 composable 化，拆分 ②）。
 *
 * **只返回处理函数，不自己挂载**：挂载/卸载时机留在 App.vue 的 onMounted / onBeforeUnmount ——
 * composable 内部自挂载会按注册顺序插入 Vue 的生命周期队列，改变与"首启开选择器 /
 * 自动备份 / 提醒对表"的先后关系，那是行为变更，不是重构。
 *
 * Esc 的七层级联顺序定在 `keyboard.ts` 的 `appKeyIntent`（含"编辑器先吃"与 thunk 时机）；
 * 这里只提供各层的当前状态与动作。撤销/重做是全局能力：整理、换模板这类动作也可能在
 * 工作台上做，不能只在编辑器里可撤销。
 */

import type { Ref } from 'vue'
import { appKeyIntent, isEditableTarget, isPaletteHotkey, isUndoHotkey, type AppKeyLayers, type KeyLike } from './keyboard'
import type { TxView } from './useEditTransaction'

/**
 * 与 `keyboard.ts` 的 `KeyLike` 同宗：结构化输入让单测不必造 KeyboardEvent
 * （vitest 默认 node 环境，没有 DOM）。App.vue 挂载时传的就是真 KeyboardEvent ——
 * 结构完全兼容（key/shift/alt/ctrl/meta/target/preventDefault 它都有）。
 */
export interface GlobalKeyLike extends KeyLike {
  /** 必填（真 KeyboardEvent 一定有 target；测试用 null 表示"无目标"） */
  target: EventTarget | null
  preventDefault: () => void
}

export interface GlobalKeysDeps {
  paletteOpen: Ref<boolean>
  cancelAskOpen: Ref<boolean>
  /** 编辑器自退（清选中 / 关目录下拉）的 thunk —— 问到那层才问 */
  editorEscape: () => boolean
  view: Ref<TxView>
  arrangeOpen: Ref<boolean>
  templatesOpen: Ref<boolean>
  settingsOpen: Ref<boolean>
  cancelEdit: () => void
  closeTemplates: () => void
  undo: () => void
  redo: () => void
}

export function useGlobalKeys(deps: GlobalKeysDeps): (e: GlobalKeyLike) => void {
  return function onGlobalKey(e: GlobalKeyLike): void {
    if (e.key === 'Escape') {
      /**
       * `editorEscape` 是 thunk 而不是布尔值 —— 问编辑器"这层还有没有可退的"必须发生在
       * 走到这一层的时候，早问会把编辑器本来能吃掉的 Esc 提前判死。
       */
      const layers: AppKeyLayers = {
        paletteOpen: deps.paletteOpen.value,
        cancelAskOpen: deps.cancelAskOpen.value,
        editorEscape: deps.editorEscape,
        view: deps.view.value,
        arrangeOpen: deps.arrangeOpen.value,
        templatesOpen: deps.templatesOpen.value,
        settingsOpen: deps.settingsOpen.value,
      }
      switch (appKeyIntent(e, layers)?.kind) {
        case 'closePalette': deps.paletteOpen.value = false; break
        case 'closeCancelAsk': deps.cancelAskOpen.value = false; break
        case 'editorEscape': break // 编辑器消费掉了（清选中/关目录下拉）
        case 'cancelEdit': deps.cancelEdit(); break
        case 'closeArrange': deps.arrangeOpen.value = false; break
        case 'closeTemplates': deps.closeTemplates(); break
        case 'closeSettings': deps.settingsOpen.value = false; break
        default: break // 级联走到底也没人接
      }
    }
    // Ctrl+K 是全局键：即使在输入框里也生效（这是"任何地方唤出"的语义）
    if (isPaletteHotkey(e)) {
      e.preventDefault()
      deps.paletteOpen.value = true
      return
    }
    // 输入控件里不抢撤销/重做（本地原来那份 isEditable 与 keyboard.ts 的
    // isEditableTarget 是同一份逻辑写两遍，拆分时统一到后者）
    if (isEditableTarget(e.target)) return
    const undo = isUndoHotkey(e)
    if (undo) {
      e.preventDefault()
      if (undo === 'redo') deps.redo()
      else deps.undo()
    }
  }
}
