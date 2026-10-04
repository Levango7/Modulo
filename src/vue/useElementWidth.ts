import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/**
 * 观察单个元素的宽度。App 里 stageW 原来是「一段 ResizeObserver 手搓逻辑 +
 * onMounted/onBeforeUnmount 里的样板」—— 每换一个需要量宽的组件都要重抄一遍，
 * 所以抽成 composable。行为与原样板一致：初始值来自参数，宽度在 RO 回调里
 * 更新，卸载时断开观察；el 的引用变化时重新挂观察。
 */
export function useElementWidth(el: Ref<HTMLElement | null>, initial = 0): Ref<number> {
  const width = ref(initial)
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
      if (n) width.value = n.clientWidth
    })
    ro.observe(node)
  }

  onMounted(observe)
  watch(el, observe)
  onBeforeUnmount(cleanup)
  return width
}
