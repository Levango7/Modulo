/**
 * 命令总线的宿主侧装配（2026-10-13 批 2 的 App.vue 那段，拆分 ② 抽出）。
 *
 * **只创建、不 provide**：`provide('commandBus', …)` 是组件级动作，留给 App.vue ——
 * composable 隐式 provide 会让"谁 provide 的"在调用点看不见。
 *
 * 入口（顶栏 / 键盘 / 编辑器 / 命令面板）只发 `dispatch(id)`；校验、执行、面板让位都在
 * `commandBus.ts` 收口。这里负责的只有**宿主拦截项**：那 5 条命令的实现在本组件
 * （要编辑基线 / 要真实渲染高度 / 要界面状态），文案与可用性仍在命令表里。
 * 命令表不知道"界面长什么样"，只知道"有个动作叫切到工作台"。
 */

import { createCommandBus, type CommandBus } from './commandBus'
import type { CommandContext } from './commands'

/** 5 条被拦截命令的宿主实现（App 的界面钩子，由调用方给） */
export interface AppCommandHooks {
  /** `edit.save`：确认这次编辑 */
  saveEdit: () => void
  /** `layout.fit`：按真实渲染高度收紧（外面套了"选完就关下拉"） */
  fitLayout: () => void
  /** `layout.compact`：先收紧再聚拢空行 */
  compactLayout: () => void
  /** `view.edit`：进布局编辑 */
  enterEdit: () => void
  /** `view.workbench`：退出布局编辑（带取消事务语义） */
  leaveEdit: () => void
}

export function useAppCommands(ctx: CommandContext, hooks: AppCommandHooks): CommandBus {
  const commandBus: CommandBus = createCommandBus(ctx)
  commandBus.registerIntercept('edit.save', () => hooks.saveEdit())
  commandBus.registerIntercept('layout.fit', () => hooks.fitLayout())
  commandBus.registerIntercept('layout.compact', () => hooks.compactLayout())
  commandBus.registerIntercept('view.edit', () => hooks.enterEdit())
  commandBus.registerIntercept('view.workbench', () => hooks.leaveEdit())
  return commandBus
}
