import { computed, type Ref } from 'vue'
import * as E from '@levango7/engine'
import type { LayoutStore } from './store'
import { rowUnitPx } from './rowUnit'

/**
 * 「一份逻辑版面 → 物理矩形集」的全部派生。
 *
 * 这段原先散在 App.vue 的七个 computed 里（cols / rowPx / projection / mode），
 * 抽出来之后模板下面只剩一层装配 —— 而且这些派生现在可以被不依赖组件的
 * 测试直接断言（投影只读、幂等这类纪律本来就不该绑在某个 .vue 文件上）。
 *
 * **宽与高分工明确（2026-10-08 起）**：
 * - `cols` / `mode` 只看**容器宽**。这是顶栏断点（视口 992 / 752 ↔ 容器 960 / 720）
 *   能与栅格同时降档的前提，加一个高度维度进来会让两者在不同时刻变 —— 那正是
 *   2026-10-08 上一轮刚修好的东西。
 * - `rowPx` 在引擎的宽档基准上再乘一个**窗口高度倍率**（`rowUnit.ts`）。
 *   单独给行高开口子，是因为"同一张卡在 13″ 与 27″ 屏上像素尺寸相同"是实测缺陷，
 *   而列数并没有这个问题 —— 12 列在任何屏上都成立。
 */
export function useProjection(store: LayoutStore, stageW: Ref<number>, stageH: Ref<number>) {
  const reg = store.reg
  const cols = computed(() => E.physicalCols(stageW.value))
  const rowPx = computed(() => rowUnitPx(E.rowHeight(stageW.value), stageH.value))
  const gap = 16
  const projection = computed(() => E.project(store.doc.value, reg, cols.value))
  const mode = computed(() => E.editorMode(stageW.value))
  return { cols, rowPx, gap, projection, mode }
}
