import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage, type StorageAdapter } from '../../src/vue/store'

/**
 * useShell 是「桌面壳才成立」的那层，headless Chrome 里 isDesktop 恒为 false，E2E 测不到。
 * 这里在 import 之前把 window 伪造成 Tauri 注入过的样子，再用假 invoke 把整条改键链路跑通。
 */
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const KEY = 'modulo.shell.v1'
const DEFAULTS = [
  { kind: 'summon', keys: 'Ctrl+Alt+M', label: '唤出 / 隐藏 Modulo', registered: true },
  { kind: 'ontop', keys: 'Ctrl+Alt+T', label: '窗口置顶', registered: true },
]

const settled = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Rust 那边 set_shortcut 的返回就是这条的新状态，测试里让它照客户端给的 chord 回 */
function mockRust(rejectChord?: string) {
  invoke.mockImplementation(async (cmd: string, args?: { kind?: string; chord?: string }) => {
    if (cmd === 'global_shortcuts') return DEFAULTS.map((d) => ({ ...d }))
    if (cmd === 'set_shortcut') {
      if (rejectChord !== undefined && args?.chord === rejectChord) throw `注册 ${rejectChord} 失败（多半被别的程序占用）`
      return { kind: args?.kind, keys: args?.chord, label: '唤出 / 隐藏 Modulo', registered: true }
    }
    return undefined
  })
}

async function boot(storage: StorageAdapter) {
  const { useShell } = await import('../../src/vue/useShell')
  const shell = useShell(storage)
  await settled()
  return shell
}

beforeAll(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
})

beforeEach(() => {
  invoke.mockReset()
})

describe('桌面壳设置持久化', () => {
  it('一个 key 存两样东西：拨「收进托盘」不会抹掉已改的快捷键', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'global_shortcuts'
        ? [
            { kind: 'summon', keys: 'Ctrl+Alt+F13', label: '唤出 / 隐藏 Modulo', registered: true },
            { kind: 'ontop', keys: 'Ctrl+Alt+T', label: '窗口置顶', registered: true },
          ]
        : undefined,
    )
    const storage = memoryStorage()
    storage.set(KEY, JSON.stringify({ hideOnClose: false, summon: 'Ctrl+Alt+F13', ontop: 'Ctrl+Alt+T' }))
    const shell = await boot(storage)
    shell.setHideOnClose(true)
    const saved = JSON.parse(storage.get(KEY) ?? '{}') as Record<string, unknown>
    expect(saved.hideOnClose).toBe(true)
    expect(saved.summon).toBe('Ctrl+Alt+F13')
    expect(shell.shortcutError.value).toBeNull()
  })

  it('启动时把存档里改过的键推回 Rust（Rust 侧不落地，默认档会被重新注册）', async () => {
    mockRust()
    const storage = memoryStorage()
    storage.set(KEY, JSON.stringify({ summon: 'Ctrl+Alt+F13' }))
    await boot(storage)
    expect(invoke).toHaveBeenCalledWith('set_shortcut', { kind: 'summon', chord: 'Ctrl+Alt+F13' })
  })

  it('存档里的键和 Rust 注册的一致就不重复注册', async () => {
    mockRust()
    const storage = memoryStorage()
    storage.set(KEY, JSON.stringify({ summon: 'ctrl+alt+m' }))
    await boot(storage)
    expect(invoke.mock.calls.filter((c) => c[0] === 'set_shortcut')).toHaveLength(0)
  })

  it('改键成功后落盘，列表里那条跟着换', async () => {
    mockRust()
    const storage = memoryStorage()
    const shell = await boot(storage)
    await expect(shell.setShortcut('summon', 'Ctrl+Alt+B')).resolves.toBe(true)
    expect(shell.shortcuts.value.find((s) => s.kind === 'summon')?.keys).toBe('Ctrl+Alt+B')
    expect(JSON.parse(storage.get(KEY) ?? '{}').summon).toBe('Ctrl+Alt+B')
    expect(shell.shortcutError.value).toBeNull()
  })

  it('注册失败既不落盘也不改列表，原因留给界面显示', async () => {
    mockRust('Ctrl+Alt+B')
    const storage = memoryStorage()
    const shell = await boot(storage)
    invoke.mockClear()
    await expect(shell.setShortcut('summon', 'Ctrl+Alt+B')).resolves.toBe(false)
    expect(shell.shortcuts.value.find((s) => s.kind === 'summon')?.keys).toBe('Ctrl+Alt+M')
    expect(JSON.parse(storage.get(KEY) ?? '{}').summon).toBeUndefined()
    expect(shell.shortcutError.value).toContain('占用')
  })

  it('半截写坏的存档回落到默认值，而不是让启动崩掉', async () => {
    mockRust()
    const storage = memoryStorage()
    storage.set(KEY, '{"hideOnClose":tru')
    const shell = await boot(storage)
    expect(shell.hideOnClose.value).toBe(false)
    expect(shell.shortcuts.value.map((s) => s.kind)).toEqual(['summon', 'ontop'])
  })

  it('非桌面环境（vite dev / E2E 的 Chrome）改键直接返回 false，不冒充成功', async () => {
    mockRust()
    vi.stubGlobal('window', {})
    vi.resetModules()
    const { useShell } = await import('../../src/vue/useShell')
    const shell = useShell(memoryStorage())
    await expect(shell.setShortcut('summon', 'Ctrl+Alt+B')).resolves.toBe(false)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  })
})
