/**
 * 联网卡的共用取数层：**首次渲染才查、TTL 内不重复查、取不到保留上一份**。
 *
 * 为什么抽出来：天气卡把这三条口径写进文件头之后，汇率 / 空气质量 / GitHub / HN 四张卡
 * 要走的是同一套流程 —— 复制四遍就是四份会各自漂移的口径。收窄响应仍然各卡自己写
 * （在引擎的纯函数里，有真夹具单测），这里只管"取回来、存起来、把状态摆出来"。
 *
 * 与 `useUpdateCheck` 同一层级：**网络胶水不进单测门禁**（要真 fetch / 真计时），
 * 它的验收在 E2E 与"取不到是合法状态"这条纪律上。
 */

import { ref } from 'vue'
import type { StorageAdapter } from './store'

export interface RemoteOptions<T> {
  /** 本地缓存 key（每张卡一个） */
  key: string
  /** 请求地址；`null` 表示"现在没条件查"（比如仓库名还没填对） */
  url: () => string | null
  /** 收窄响应（引擎里的纯函数） */
  parse: (payload: unknown, now: number) => T | null
  /** 多久算新鲜 */
  ttlMs: number
  /**
   * 这份缓存属于"哪个目标"（城市 / 仓库名…）。变了就重查 —— 只看 TTL 的话，
   * 用户换了城市却要等缓存过期才生效（这正是天气卡修过的那个坑，这里做成通用的一条）。
   * 不需要区分目标的卡（汇率、热榜）可以不传。
   */
  freshKey?: () => string
  timeoutMs?: number
  /** 多请求的卡（HN 是 1 + N 条）：自己实现取数，返回值直接交给 parse 的前一步 */
  fetchList?: () => Promise<unknown>
}

interface Cached<T> {
  snapshot: T
  freshKey?: string
}

export function useRemote<T extends { fetchedAt: number }>(
  storage: StorageAdapter,
  opts: RemoteOptions<T>,
) {
  const read = (): { snapshot: T | null; freshKey: string } => {
    try {
      const raw = JSON.parse(storage.get(opts.key) ?? '') as Partial<Cached<T>>
      const s = raw?.snapshot
      if (s && typeof s === 'object' && typeof (s as T).fetchedAt === 'number') {
        return { snapshot: s as T, freshKey: typeof raw?.freshKey === 'string' ? raw.freshKey : '' }
      }
    } catch {
      /* 坏缓存当没有 */
    }
    return { snapshot: null, freshKey: '' }
  }

  const cachedAtBoot = read()
  const snapshot = ref<T | null>(cachedAtBoot.snapshot) as ReturnType<typeof ref<T | null>>
  const loadedKey = ref(cachedAtBoot.freshKey)
  const status = ref<'idle' | 'loading' | 'error'>('idle')
  const message = ref('')

  function persist(s: T): void {
    try {
      storage.set(opts.key, JSON.stringify({ snapshot: s, freshKey: opts.freshKey?.() ?? '' } satisfies Cached<T>))
    } catch {
      /* 存不下就只留内存里，别因为一次写盘失败把卡弄空 */
    }
  }

  async function load(): Promise<void> {
    const url = opts.url()
    if (!url) {
      status.value = 'error'
      message.value = '还没填好要查什么'
      return
    }
    status.value = 'loading'
    message.value = ''
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000)
    try {
      const payload = opts.fetchList ? await opts.fetchList() : await fetchJson(url, ctrl.signal)
      const parsed = opts.parse(payload, Date.now())
      if (!parsed) throw new Error('响应形状不认识')
      snapshot.value = parsed
      loadedKey.value = opts.freshKey?.() ?? ''
      status.value = 'idle'
      persist(parsed)
    } catch (err) {
      status.value = 'error'
      message.value = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(timer)
    }
  }

  function ensureFresh(now = Date.now()): void {
    const s = snapshot.value
    // 目标变了（换城市 / 换仓库）→ 不管新不新鲜都重查
    const targetChanged = opts.freshKey ? opts.freshKey() !== loadedKey.value : false
    if (!targetChanged && s && now - s.fetchedAt < opts.ttlMs) return
    void load()
  }

  function refresh(): void {
    void load()
  }

  return { snapshot, status, message, ensureFresh, refresh }
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`接口返回 ${res.status}`)
  return res.json()
}
