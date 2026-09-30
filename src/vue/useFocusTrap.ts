import { onBeforeUnmount, onMounted, type Ref } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'

/**
 * 焦点陷阱：Tab / Shift+Tab 只在容器内循环，关闭后把焦点还给打开它的元素。
 * 打开时聚焦容器本身（容器需 tabindex="-1"），这样读屏会播报对话框，
 * 且第一次 Tab 自然落到第一个控件。
 *
 * 焦点行为只在真浏览器里可验证，因此它的测试放在 e2e 层而不是单测层。
 */
export function useFocusTrap(rootRef: Ref<HTMLElement | null>): void {
  let restoreTo: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    const root = rootRef.value
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return
    const root = rootRef.value
    if (!root) return
    const els = focusables()
    if (!els.length) {
      e.preventDefault()
      root.focus()
      return
    }
    const first = els[0]
    const last = els[els.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey) {
      if (active === first || active === root || !root.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    restoreTo = document.activeElement as HTMLElement | null
    rootRef.value?.focus()
    rootRef.value?.addEventListener('keydown', onKeydown)
  })
  onBeforeUnmount(() => {
    rootRef.value?.removeEventListener('keydown', onKeydown)
    restoreTo?.focus?.()
  })
}
