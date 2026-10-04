import { computed, type Ref } from 'vue'
import * as E from '@modulo/engine'
import type { LayoutStore } from './store'

/**
 * 「一份逻辑版面 → 物理矩形集」的全部派生。
 *
 * 这段原先散在 App.vue 的七个 computed 里（cols / rowPx / projection / mode），
 * 抽出来之后模板下面只剩一层装配 —— 而且这些派生现在可以被不依赖组件的
 * 测试直接断言（投影只读、幂等这类纪律本来就不该绑在某个 .vue 文件上）。
 */
export function useProjection(store: LayoutStore, stageW: Ref<number>) {
  const reg = store.reg
  const cols = computed(() => E.physicalCols(stageW.value))
  const rowPx = computed(() => E.rowHeight(stageW.value))
  const gap = 16
  const projection = computed(() => E.project(store.doc.value, reg, cols.value))
  const mode = computed(() => E.editorMode(stageW.value))
  return { cols, rowPx, gap, projection, mode }
}
