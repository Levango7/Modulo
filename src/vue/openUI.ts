/**
 * 命令总线的「打开某个界面」分派（2026-10-24 从 `App.vue` 的 `cmdCtx.openUI` 抽出）。
 *
 * 命令表（`commands.ts`）只发名字，不知道界面长什么样；名字 → 宿主处理函数的映射
 * 原来是一串 if/else if 长在 App.vue 的命令上下文里，五个名字各一个分支、零断言。
 * 抽成查表后每个名字命中自己的处理函数、且不碰另外四个，可由单测钉住。
 *
 * 未知名（类型上到不了，JS 调用方可能给）一律静默无操作 —— 与原来 switch 落空
 * 全部 else if 的行为一致，不抛。
 *
 * 注意：「workbench 要在编辑态才取消」这类**带宿主状态的守卫不在这里**，
 * 由调用方写在自己的闭包里（见 `App.vue` 装配处）。
 */
export type OpenUIName = 'templates' | 'settings' | 'palette' | 'edit' | 'workbench'

export function makeOpenUI(handlers: Record<OpenUIName, () => void>): (name: OpenUIName) => void {
  return (name) => {
    handlers[name]?.()
  }
}
