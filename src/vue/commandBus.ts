/**
 * 命令总线（2026-10-13 批 2）：**唯一分派点**。
 *
 * 入口（顶栏 / 键盘 / 编辑器 / 命令面板 / 将来的扩展）只发 `dispatch(id, args)`；
 * 校验、执行、面板让位都在这里收口。为什么要一个总线而不是"各处直接调 store"：
 *
 * 1. **可用性校验只写一次**：`when` 是纯函数，键盘按下去的路径与面板点下去的路径
 *    走同一道闸 —— 不会出现"菜单里灰着、键盘却按得动"。
 * 2. **拦截点**：少数命令要等宿主提供真实渲染数据（`wait: 'workbench-measure'`）
 *    或需要 App 的界面状态（保存/取消要刷新编辑基线）。宿主注册 `intercepts`
 *    就能接管 —— 命令表照旧登记它们的文案与可用性。
 * 3. **可观测**：每次派发都过这里，将来接扩展/宏/审计只需要挂一处。
 */
import type { CommandArgs, CommandContext, CommandDef } from './commands'
import { COMMANDS } from './commands'

export type DispatchResult =
  | { ok: true; id: string }
  | { ok: false; id: string; reason: 'unknown' | 'unavailable'; message: string }

export interface CommandBus {
  /** 全部登记项（键盘桥与面板都从这里取真相） */
  defs: readonly CommandDef[]
  byId: (id: string) => CommandDef | undefined
  dispatch: (id: string, args?: CommandArgs) => DispatchResult
  /** 宿主拦截项：`wait` 类命令与需要界面状态的命令（App 注册） */
  registerIntercept: (id: string, handler: (ctx: CommandContext, args?: CommandArgs) => void) => void
}

export function createCommandBus(ctx: CommandContext): CommandBus {
  const intercepts = new Map<string, (ctx: CommandContext, args?: CommandArgs) => void>()
  const byId = (id: string): CommandDef | undefined => COMMANDS.find((c) => c.id === id)

  function dispatch(id: string, args?: CommandArgs): DispatchResult {
    const def = byId(id)
    if (!def) return { ok: false, id, reason: 'unknown', message: `没有登记过的命令：${id}` }
    if (def.when && !def.when(ctx, args)) {
      return { ok: false, id, reason: 'unavailable', message: def.why ?? '此刻不可用' }
    }
    const handler = intercepts.get(id)
    if (handler) {
      handler(ctx, args)
      return { ok: true, id }
    }
    if (def.run) {
      def.run(ctx, args)
      return { ok: true, id }
    }
    if (def.effect) {
      def.effect(ctx)
      return { ok: true, id }
    }
    // 既没有内联实现、也没登记拦截项 —— 这是接线漏了，不静默吞
    return { ok: false, id, reason: 'unknown', message: `命令「${def.label}」没有实现（wait=${def.wait ?? '无'}）` }
  }

  return { defs: COMMANDS, byId, dispatch, registerIntercept: (id, h) => void intercepts.set(id, h) }
}
