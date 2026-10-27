/**
 * 把已装的扩展卡同步进模块注册表（store 的 ext 段）。
 *
 * 为什么存在：注册表是引擎加卡 / 钳制 / 降档的查表来源，而扩展是**运行时**装进来的
 * （用户在「原生卡」里导入卡包）—— 不同步的话，"导入后加卡"就是查无此模块。
 * 这里只做"名单变了 → 重建 ext 段"这一件事；卡 → ModuleDef 的映射与撞车防御都在
 * 引擎 `extModuleDefs`（纯函数，单测钉住），本文件不含判定。
 *
 * **浅监听就够**：`cardData.ts` 里 extCards 的全部写入动作都是整表替换（不可变更新），
 * 引用一变 watch 必触发。刻意不用 deep —— 桥写 extState 不该重建注册表。
 */
import { watch } from 'vue'
import type { CardDataApi } from './cardData'
import type { LayoutStore } from './store'

export function useExtensions(store: LayoutStore, cards: CardDataApi): void {
  watch(
    () => cards.state.extCards,
    (list) => {
      store.setExtensions(list.map((c) => ({ ...c, variants: c.variants.map((v) => ({ ...v })) })))
    },
    { immediate: true },
  )
}
