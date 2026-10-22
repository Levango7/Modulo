/**
 * 撤销/重做的**路由**（2026-10-20 起 App.vue 里那段 if-else 的纯函数化）。
 *
 * 版面与内容各有一份历史，两套栈**不合并时间线** —— 只比"最近一次改动"，
 * 比共享一条历史容易解释得多。规则：
 *  - 编辑态：只在改版面 ⇒ 永远撤版面（与拆分前行为一致）；
 *  - 工作台态：谁更近撤谁（内容改动通常更近），平手时内容优先；
 *    选中的那边没得撤就退到另一边。
 *
 * 这里只做**决策**（该动哪一份、按什么顺序试），不动历史本身 ——
 * 执行留在调用方，因为"内容历史撤成功了没有"是 `contentHistory.undo()` 的返回值，
 * 不是事前能算出来的谓词。把执行也搬进来就得把两份 API 都注入进纯函数，
 * 那是拿可测性换复杂度，不划算。
 */

/** 历史归属：版面（布局编辑态改的东西）或内容（卡片里的数据） */
export type UndoKind = 'layout' | 'content'

export type ViewKind = 'workbench' | 'edit'

/** 路由所需的全部输入 —— 都是值，没有 ref、没有副作用 */
export interface UndoRoutingState {
  view: ViewKind
  /** 上一次实际撤销/重做动的是哪一份（redo 的偏好由它决定） */
  lastUndoKind: UndoKind
}

export interface UndoRoutingCaps {
  /** 两份历史各自的"能不能撤"（撤销/重做按钮的可用态） */
  layoutCanUndo: boolean
  contentCanUndo: boolean
  layoutCanRedo: boolean
  contentCanRedo: boolean
  /** 两份历史各自"最近一次改动"的时间戳（同单位；平手算内容近） */
  layoutLastAt: number
  contentLastAt: number
}

/** 撤销按钮的可用态：两份历史任一份还能撤就亮 */
export function anyUndo(caps: UndoRoutingCaps): boolean {
  return caps.layoutCanUndo || caps.contentCanUndo
}

/** 重做按钮的可用态：两份历史任一份还能重做就亮 */
export function anyRedo(caps: UndoRoutingCaps): boolean {
  return caps.layoutCanRedo || caps.contentCanRedo
}

/**
 * 撤销该按什么顺序试。**空数组 = 两边都没得撤**（调用方照旧要走一遍循环，
 * 只是每一步都会落空 —— 与拆分前"遍历一个空顺序"等价）。
 */
export function undoOrder(state: UndoRoutingState, caps: UndoRoutingCaps): UndoKind[] {
  if (state.view === 'edit') return ['layout']
  // 平手算内容近：内容改动通常更近，用户的主观期待也是"我刚打的字先回来"
  const preferContent = caps.contentLastAt >= caps.layoutLastAt
  return preferContent ? ['content', 'layout'] : ['layout', 'content']
}

/** 重做按什么顺序试：跟着上一次实际动的那一份走，不跟时间戳 */
export function redoOrder(state: UndoRoutingState, caps: UndoRoutingCaps): UndoKind[] {
  if (state.view === 'edit') return ['layout']
  return state.lastUndoKind === 'content' ? ['content', 'layout'] : ['layout', 'content']
}
