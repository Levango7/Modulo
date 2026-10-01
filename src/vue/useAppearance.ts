import { onScopeDispose, ref } from 'vue'
import { accentColor, parseAppearance, resolveTheme, type Appearance } from './appearance'
import type { StorageAdapter } from './store'

const KEY = 'modulo.appearance.v1'

export function useAppearance(storage: StorageAdapter) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
  const state = ref<Appearance>(parseAppearance(storage.get(KEY)))

  function apply(): void {
    const el = document.documentElement
    el.dataset.skin = state.value.skin
    el.dataset.theme = resolveTheme(state.value.mode, !!mq?.matches)
    const c = accentColor(state.value.accent)
    if (c) el.style.setProperty('--accent', c)
    else el.style.removeProperty('--accent')
    storage.set(KEY, JSON.stringify(state.value))
  }

  function set(patch: Partial<Appearance>): void {
    state.value = { ...state.value, ...patch }
    apply()
  }

  mq?.addEventListener('change', apply)
  onScopeDispose(() => mq?.removeEventListener('change', apply))
  apply()

  return { state, set }
}

export type AppearanceApi = ReturnType<typeof useAppearance>
