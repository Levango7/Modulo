/**
 * 按实例取数的**判定层**（F-01 阶段 2，2026-10-28）。
 *
 * ## 为什么单独一个文件
 *
 * 本仓没有组件测试设施（无 `@vue/test-utils`、无 jsdom），判定嵌在组件里就只剩 E2E 一层兜底。
 * 抽成纯函数进受测层锁 100 —— 与 `floatList.ts` / `moduleFilter.ts` 同一条理由。
 *
 * ## 口径（三条，逐条都有理由）
 *
 * 1. **第一实例仍用顶层那一份。** 实例 id 等于模块 id（或两者有一个拿不到）时读写都走顶层。
 *    理由：旧档、模板、单实例的形状必须**逐字不变** —— 顶层那些字段本来就是"不分实例时的
 *    内容"，第一实例继续用它，就不需要迁移、也不需要把同一份内容存两遍。
 * 2. **第二实例读自己那一份；没有就是空白。**
 *    不回落顶层 —— 回落的话，新拖出来的第二张便签会显示第一张的字，那正是阶段 1 那个
 *    "两个实例共享同一份内容"的缺陷，阶段 2 是来消掉它而不是保留它。
 *    代价（如实记）：升级前就已经摆着两张便签的用户，第二张会从"跟着第一张显示"变成空白。
 *    内容没丢 —— 它一直在第一张上。这条写进 CHANGELOG。
 * 3. **写才建立。** 第二实例第一次输入时才生成 `byInstance[实例 id]`，
 *    不在渲染时播种（渲染有副作用会让撤销历史与写盘都变得说不清）。
 *
 * ## 不做的事
 *
 * - **不解析 `:2` 后缀**：是不是"第二实例"由"实例 id ≠ 模块 id"判定，不靠字符串形状
 *   （与 `moduleIdOf` 只认 `p.module ?? p.id` 同一条纪律）。
 * - 只有 `sticky` / `todos` 两个字段按实例分。其余字段（速记 / 记账 / 四象限 / 习惯 /
 *   倒数日……）仍是按模块共享，那是它们各自的下一笔。
 */
import type { CardData, Todo } from './cardDataTypes'

/** 取数只需要这三个字段，测试不必造一整份 `CardData` */
export type InstanceSource = Pick<CardData, 'sticky' | 'todos' | 'byInstance'>

/**
 * 便签正文：按实例读。
 *
 * @param moduleId   该实例所属模块（工作台传 `r.module ?? r.id`，浮窗传解析出的模块 id）
 * @param instanceId 实例 id；拿不到（undefined / 空）时按"不分实例"处理
 */
export function stickyOf(data: InstanceSource, moduleId?: string, instanceId?: string): string {
  if (!isSecondInstance(moduleId, instanceId)) return data.sticky ?? ''
  return data.byInstance?.[instanceId as string]?.sticky ?? ''
}

/**
 * 便签正文：按实例写。**方法本身不改语义，只决定写在哪** ——
 * 上限与清洗在读盘那道（`cardDataSanitize.ts`），这里不重复实现一遍。
 */
export function writeSticky(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  value: string,
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.sticky = value
    return
  }
  const bag = data.byInstance ?? {}
  // 整条替换而不是原地改字段：Vue 的深层 watch 依赖"值变了"才触发写盘，
  // 换一个新对象比"改了里面一个字符串"的信号更明确（也更好断言）。
  bag[instanceId as string] = { ...bag[instanceId as string], sticky: value }
  data.byInstance = bag
}

/**
 * 待办清单：按实例读。
 *
 * 口径与便签**完全相同**（第一条：第一实例仍用顶层那一份；第二条：第二实例没有就是空清单，
 * 不回落顶层 —— 回落会让新拖出来的第二张待办卡显示第一张的清单）。
 * 差别只有一处：没有内容时的"空"是空数组而不是空串（渲染侧直接 `filter`，不必再判空）。
 */
export function todosOf(data: InstanceSource, moduleId?: string, instanceId?: string): Todo[] {
  if (!isSecondInstance(moduleId, instanceId)) return data.todos ?? []
  return data.byInstance?.[instanceId as string]?.todos ?? []
}

/**
 * 待办清单：按实例写。**只决定写在哪，不改语义** —— 加/勾/删由调用方先在数组上做，
 * 这里整条替换回去（与 `writeSticky` 同一条理由：深层 watch 靠"值变了"才触发写盘）。
 */
export function writeTodos(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: Todo[],
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.todos = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], todos: next }
  data.byInstance = bag
}

/**
 * 是不是"第二（及以后）个实例"。
 *
 * 两个 id 都要有才敢判 —— 只拿到实例 id 时按"不分实例"处理，
 * 这样任何还没传模块 id 的渲染点都回落到**今天的行为**，不会静默变空。
 */
function isSecondInstance(moduleId?: string, instanceId?: string): boolean {
  if (!moduleId || !instanceId) return false
  return moduleId !== instanceId
}
