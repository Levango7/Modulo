/**
 * 版本检查与（桌面端的）应用内更新。判定逻辑在 `src/engine/update.ts`（纯函数，可单测），
 * 这里只负责发请求、把状态摆出来、以及"别在启动时偷偷发请求"。
 *
 * 两条路，按运行环境分：
 * - **网页版**：查 GitHub Releases API，只显示"有新版"与下载页链接 —— 浏览器里没有安装能力。
 * - **桌面壳**：走 tauri-plugin-updater —— 查 Release 里的 `latest.json`，下载后按内嵌的
 *   minisign 公钥**验签**（验签发生在后端 download 里），最后拉起 NSIS 静默升级并自重启。
 *
 * 三条克制照旧：**不在启动时自动查**（一次启动不该顺手给 GitHub 发请求）、
 * **不自动下载**、**不自动安装**（三件事都由用户在设置页点出来）。
 */

import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { RELEASES_API, applyChunk, compareVersions, pickUpdate, plainText, type DownloadProgress, type UpdateState } from '@levango7/engine/update'
import type { Update } from '@tauri-apps/plugin-updater'
import { APP_VERSION } from './useBackup'
import { isDesktop } from './useShell'
import type { StorageAdapter } from './store'

const KEY = 'modulo.update.v1'
const TIMEOUT_MS = 8000
/** 一小时内查过就不再问，除非用户显式点「重新检查」 */
const TTL_MS = 60 * 60 * 1000

interface Cached {
  latest: string
  url: string
  checkedAt: number
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useUpdateCheck(storage: StorageAdapter = { get: () => null, set: () => {} }) {
  const state = ref<UpdateState>({ status: 'idle' })
  const desktop = isDesktop
  /** 桌面端 check 出来的更新句柄；下载 / 安装都挂在它上面（Rust 侧握着一个资源） */
  let handle: Update | null = null

  /** 上次查到的结果：网络失败时至少还能把"上次说有新版"这件事说出来。只用于网页版（桌面端的请求很轻）。 */
  function cached(): Cached | null {
    try {
      const raw = JSON.parse(storage.get(KEY) ?? '') as Partial<Cached>
      if (typeof raw?.latest === 'string' && typeof raw.url === 'string') return { latest: raw.latest, url: raw.url, checkedAt: Number(raw.checkedAt) || 0 }
    } catch {
      /* 坏缓存当没有 */
    }
    return null
  }

  async function check(force = false): Promise<void> {
    if (state.value.status === 'checking' || state.value.status === 'downloading' || state.value.status === 'installing') return
    if (desktop) return checkDesktop()
    const c = cached()
    if (!force && c && Date.now() - c.checkedAt < TTL_MS) {
      state.value = compareVersions(c.latest, APP_VERSION) > 0 ? { status: 'found', info: { latest: c.latest, url: c.url, notes: '', publishedAt: '' } } : { status: 'current' }
      return
    }
    state.value = { status: 'checking' }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(RELEASES_API, { signal: ctrl.signal, headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`)
      const info = pickUpdate(await res.json(), APP_VERSION)
      if (info) {
        storage.set(KEY, JSON.stringify({ latest: info.latest, url: info.url, checkedAt: Date.now() }))
        state.value = { status: 'found', info }
      } else {
        state.value = { status: 'current' }
      }
    } catch (err) {
      // 网络失败不是 bug，是常态（离线、内网、公司网关）。说清是哪一种，别弹一个红叉就完事。
      state.value = { status: 'failed', message: errText(err) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 桌面壳：端点与公钥都写死在 tauri.conf.json，检查结果里直接带版本号 / 更新说明 / 日期 */
  async function checkDesktop(): Promise<void> {
    state.value = { status: 'checking' }
    try {
      const { check: checkUpdater } = await import('@tauri-apps/plugin-updater')
      const update = await checkUpdater()
      if (!update) {
        state.value = { status: 'current' }
        return
      }
      await disposeHandle()
      handle = update
      state.value = {
        status: 'found',
        info: {
          latest: update.version,
          // latest.json 里没有网页可点的下载页；桌面端的动作是"下载更新"这个按钮
          url: '',
          notes: plainText(update.body ?? '').slice(0, 200),
          publishedAt: update.date ?? '',
        },
      }
    } catch (err) {
      state.value = { status: 'failed', message: errText(err) }
    }
  }

  /** 下载：后端在下载完成时**验签**，签不过会在这里抛错 —— 界面拿到的是"验签失败"，不是"装坏了" */
  async function download(): Promise<void> {
    if (!handle) return
    let progress: DownloadProgress = { downloaded: 0, total: null }
    state.value = { status: 'downloading', progress }
    try {
      await handle.download((e) => {
        progress = applyChunk(
          progress,
          e.event === 'Progress' ? e.data.chunkLength : 0,
          e.event === 'Started' ? e.data.contentLength : undefined,
        )
        state.value = { status: 'downloading', progress }
      })
      state.value = { status: 'downloaded' }
    } catch (err) {
      state.value = { status: 'failed', message: errText(err) }
    }
  }

  /**
   * 安装：Windows 上插件把 NSIS 安装器以 `/P /UPDATE` 拉起（安装完 `/R` 自重启），
   * 本进程随退出 —— 所以这一句正常返回之后界面就不必再做什么了。
   */
  async function install(): Promise<void> {
    if (!handle) return
    state.value = { status: 'installing' }
    try {
      await handle.install()
    } catch (err) {
      state.value = { status: 'failed', message: errText(err) }
    }
  }

  async function disposeHandle(): Promise<void> {
    const old = handle
    handle = null
    if (old) {
      try {
        await old.close()
      } catch {
        /* 关不掉就算了，进程退出时后端会回收 */
      }
    }
  }

  // 设置页关掉时把后端资源还回去（没关的话，已下载的字节会一直压在那儿）
  if (getCurrentScope()) onScopeDispose(() => void disposeHandle())

  return { state, check, download, install, current: APP_VERSION, desktop }
}

export type UpdateCheckApi = ReturnType<typeof useUpdateCheck>
