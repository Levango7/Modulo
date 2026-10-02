import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { StorageAdapter } from './store'

/** 只有 Tauri 注入过 __TAURI_INTERNALS__ 才算跑在桌面壳里；vite dev 和 E2E 的 Chrome 都不是。 */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export type ShortcutKind = 'summon' | 'ontop'

export interface ShortcutStatus {
  /** Rust 侧的稳定标识，前端按它定位某一条；label 是给人看的中文，会随文案改。 */
  kind: string
  keys: string
  label: string
  registered: boolean
}

const KEY = 'modulo.shell.v1'

interface Prefs {
  hideOnClose: boolean
  chords: Partial<Record<ShortcutKind, string>>
}

export function useShell(storage: StorageAdapter) {
  const prefs = read(storage)
  const hideOnClose = ref(prefs.hideOnClose)
  const shortcuts = ref<ShortcutStatus[]>([])
  const shortcutError = ref<string | null>(null)

  /** 一个 key 存两样东西，所以每次写回都必须带全字段：只写 hideOnClose 会把改键抹掉。 */
  function persist(): void {
    storage.set(
      KEY,
      JSON.stringify({
        hideOnClose: prefs.hideOnClose,
        summon: prefs.chords.summon,
        ontop: prefs.chords.ontop,
      }),
    )
  }

  function push(on: boolean): void {
    if (isDesktop) void invoke('set_hide_on_close', { on }).catch(() => {})
  }

  function setHideOnClose(on: boolean): void {
    prefs.hideOnClose = on
    hideOnClose.value = on
    persist()
    push(on)
  }

  /**
   * 改键成功后才落盘：Rust 侧注册失败会自己滚回旧组合，这里若先存盘，
   * 下次启动就推一个「已知无效」的键，等于把一次失败变成长久失效。
   */
  async function setShortcut(kind: ShortcutKind, chord: string): Promise<boolean> {
    if (!isDesktop) return false
    try {
      const updated = await invoke<ShortcutStatus>('set_shortcut', { kind, chord })
      shortcuts.value = shortcuts.value.map((s) => (s.kind === kind ? updated : s))
      prefs.chords[kind] = updated.keys
      persist()
      shortcutError.value = null
      return true
    } catch (err) {
      shortcutError.value = String(err)
      return false
    }
  }

  // 启动时把持久化的开关推给 Rust：Rust 侧不落地，默认「关闭即退出」
  push(prefs.hideOnClose)
  if (isDesktop) {
    void invoke<ShortcutStatus[]>('global_shortcuts')
      .then(async (registered) => {
        shortcuts.value = registered
        // 存档里的键和 Rust 刚注册的默认键不一致 = 用户改过键，按存档覆盖回去
        for (const kind of ['summon', 'ontop'] as ShortcutKind[]) {
          const want = prefs.chords[kind]
          const cur = registered.find((s) => s.kind === kind)
          if (want && cur && want.toLowerCase() !== cur.keys.toLowerCase()) await setShortcut(kind, want)
        }
      })
      .catch(() => {})
  }

  return { hideOnClose, setHideOnClose, shortcuts, shortcutError, setShortcut }
}

function read(storage: StorageAdapter): Prefs {
  const prefs: Prefs = { hideOnClose: false, chords: {} }
  try {
    const raw = JSON.parse(storage.get(KEY) ?? '{}') as Record<string, unknown>
    prefs.hideOnClose = raw.hideOnClose === true
    for (const kind of ['summon', 'ontop'] as ShortcutKind[]) {
      const chord = raw[kind]
      if (typeof chord === 'string') prefs.chords[kind] = chord
    }
  } catch {
    // 半截写入或手改坏的存档：回落到默认值，比让启动崩掉好
  }
  return prefs
}

export type ShellApi = ReturnType<typeof useShell>
