/**
 * 版本检查的网络与计时部分。判定逻辑在 `src/engine/update.ts`（纯函数，可单测），
 * 这里只负责发一次请求、把状态摆出来、以及"别在启动时偷偷发请求"。
 *
 * **刻意不在启动时自动查**：一次应用启动不该顺手给 GitHub 发请求。
 * 改成设置页里一枚按钮 + 记住上次查到的结果，代价是多点一次，收益是不打乱"离线也能用"的承诺。
 */

import { ref } from 'vue'
import { RELEASES_API, compareVersions, pickUpdate, type UpdateState } from '../engine/update'
import { APP_VERSION } from './useBackup'
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

export function useUpdateCheck(storage: StorageAdapter = { get: () => null, set: () => {} }) {
  const state = ref<UpdateState>({ status: 'idle' })

  /** 上次查到的结果：网络失败时至少还能把"上次说有新版"这件事说出来 */
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
    if (state.value.status === 'checking') return
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
      state.value = { status: 'failed', message: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
  }

  return { state, check, current: APP_VERSION }
}

export type UpdateCheckApi = ReturnType<typeof useUpdateCheck>
