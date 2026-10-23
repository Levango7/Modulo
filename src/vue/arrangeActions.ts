/**
 * 排布动作名 → 执行体（App.vue 拆分 ③ 抽出）。
 *
 * **为什么这点东西也要单独成文件**：顶栏搬进 `AppToolbar.vue` 之后，「点哪一项」与
 * 「执行哪个函数」被 emit 拆到了两个文件里 —— 顶栏只发名字（`arrange`），
 * App 负责把名字换成执行体。这个映射是拆分**新引入**的，写错了不报类型错：
 * `fit` 接到 `compact` 上，TS 一样过（两边都是 `() => void`），用户点了「收紧」
 * 得到的是「紧凑」，E2E 里只有整理 / 撑满 / 紧凑三条点名覆盖，**收紧与行重排没人点**。
 *
 * 与 `undoRouting.ts` 同一条纳入判据：纯查表，不开浏览器也能断言，
 * 所以进 `GATED_VUE_MODULES` 并锁 100（见 `vitest.config.ts`）。
 */

/** 顶栏「排布」下拉的五个动作名 —— `AppToolbar.vue` 的 `arrange` emit 与这里共用 */
export type ArrangeAction = 'tidy' | 'compact' | 'fit' | 'spread' | 'reflow'

/** 一个排布动作的执行体。五个都必须是"能直接调用"的闭包，App 侧装配时绑好 store */
export type ArrangeRunner = () => void

/**
 * 按名字取执行体。
 *
 * 参数是 `Record<ArrangeAction, …>` 而不是可选字段：少给一个名字，
 * 类型就过不去 —— 「五个动作都有人接」这条由编译期守着，
 * 「每个名字接到的是不是它自己那个」由 `tests/vue/arrangeActions.test.ts` 守着。
 */
export function arrangeRunner(action: ArrangeAction, runners: Record<ArrangeAction, ArrangeRunner>): ArrangeRunner {
  return runners[action]
}
