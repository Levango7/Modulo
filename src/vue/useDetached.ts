/**
 * 主窗侧的「脱离浮窗」状态（2026-10-13 第一批）。
 *
 * 只有一句话的职责：**哪些卡现在在桌面上浮动**（`Set<cardId>`）。
 * 来源两条：启动时 `list_floats` 拉一次、之后 `modulo:floats-changed` 增量同步 ——
 * 浮窗的开关可能由任意窗口触发（关浮窗、浮窗里点还原），所以不能只信本地动作。
 * 网页版恒为空集，入口按钮按 `floatingSupported()` 隐藏。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchFloats, onFloatsChanged } from '../float/api'

export function useDetached() {
  const detached = ref<Set<string>>(new Set())
  let off: (() => void) | null = null

  const apply = (ids: string[]) => {
    detached.value = new Set(ids)
  }

  onMounted(() => {
    void fetchFloats().then((list) => apply(list.map((e) => e.card_id)))
    off = onFloatsChanged((list) => apply(list.map((e) => e.card_id)))
  })
  onBeforeUnmount(() => off?.())

  const isDetached = (id: string): boolean => detached.value.has(id)

  return { detached, isDetached }
}
