import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { StorageAdapter } from './store'

/** 只有 Tauri 注入过 __TAURI_INTERNALS__ 才算跑在桌面壳里；vite dev 和 E2E 的 Chrome 都不是。 */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface ShortcutStatus {
  keys: string
  label: string
  registered: boolean
}

const KEY = 'modulo.shell.v1'

export function useShell(storage: StorageAdapter) {
  const hideOnClose = ref(read(storage))
  const shortcuts = ref<ShortcutStatus[]>([])

  function push(on: boolean): void {
    if (isDesktop) void invoke('set_hide_on_close', { on }).catch(() => {})
  }

  function setHideOnClose(on: boolean): void {
    hideOnClose.value = on
    storage.set(KEY, JSON.stringify({ hideOnClose: on }))
    push(on)
  }

  // 启动时把持久化的开关推给 Rust：Rust 侧不落地，默认「关闭即退出」
  push(hideOnClose.value)
  if (isDesktop) {
    void invoke<ShortcutStatus[]>('global_shortcuts')
      .then((v) => {
        shortcuts.value = v
      })
      .catch(() => {})
  }

  return { hideOnClose, setHideOnClose, shortcuts }
}

function read(storage: StorageAdapter): boolean {
  try {
    return JSON.parse(storage.get(KEY) ?? '{}').hideOnClose === true
  } catch {
    return false
  }
}

export type ShellApi = ReturnType<typeof useShell>
