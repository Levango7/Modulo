import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/**
 * 观察单个元素的宽与高。
 *
 * 前身是 `useElementWidth.ts`（只量宽）。2026-10-08 加高，因为行高开始看窗口高度了
 * （`rowUnit.ts` 有完整理由）。宽高一次回调里读全，**不另开一个 ResizeObserver**：
 * 两次 observe 会在同一帧里各自触发一次回调，白白多跑一轮"改状态 → 重投影"。
 *
 * 行为与原样板一致：初值来自参数（不主动读 DOM，避免在挂载前碰到 `clientWidth` 触发强制回流），
 * 尺寸在 RO 回调里更新，卸载时断开观察，`el` 的引用变化时重新挂观察。
 * RO 在开始观察时会立刻投递一次当前尺寸，所以首帧过后就是真实值。
 *
 * **`initial` 只影响挂载前的那一次渲染**：宽给 1200 / 高给 0 时，
 * 行高倍率算出来正好是 1（见 `rowUnitScale`），于是首屏与改动前逐像素一致，
 * 真实尺寸到位后才有一次抬升 —— 而不是先渲染一个大尺寸再缩回去。
 */
export function useElementSize(
  el: Ref<HTMLElement | null>,
  initialWidth = 0,
  initialHeight = 0,
): { width: Ref<number>; height: Ref<number> } {
  const width = ref(initialWidth)
  const height = ref(initialHeight)
  let ro: ResizeObserver | null = null

  const cleanup = () => {
    ro?.disconnect()
    ro = null
  }

  const observe = () => {
    cleanup()
    const node = el.value
    if (!node || typeof ResizeObserver === 'undefined') return
    ro = new ResizeObserver(() => {
      const n = el.value
      if (!n) return
      width.value = n.clientWidth
      height.value = n.clientHeight
    })
    ro.observe(node)
  }

  onMounted(observe)
  watch(el, observe)
  onBeforeUnmount(cleanup)
  return { width, height }
}
