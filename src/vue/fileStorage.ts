import { ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { browserStorage, type StorageAdapter } from './store'
import { isDesktop } from './useShell'

/**
 * 桌面壳的数据落盘。
 *
 * store / useSchemes / createCardData 的存储适配器都是同步接口，而写文件是异步的 ——
 * 所以这里在启动时一次性 hydrate 成内存镜像，之后 get 只读镜像、set 立刻异步写穿。
 * 不做防抖：拖拽只在 pointerup 提交一次，写频率就是用户动作频率，几百字节而已。
 */
/** 一个 key 一个文件。外观与桌面开关虽然小，也一起走同一条路，省掉"哪些会备份哪些不会"的口头约定。 */
export const DATA_KEYS: readonly string[] = [
  'modulo.layout.v1',
  'modulo.schemes.v1',
  'modulo.carddata.v1',
  'modulo.appearance.v1',
  'modulo.shell.v1',
  'modulo.template.v1',
]

export interface PersistentStorage extends StorageAdapter {
  /** 落盘失败必须让用户看见：静默失败的存储迟早会变成"我明明存了"的数据丢失 */
  error: Ref<string | null>
}

type Reader = (name: string) => Promise<string | null>
type Writer = (name: string, content: string) => Promise<unknown>

const tauriRead: Reader = (name) => invoke<string | null>('read_doc', { name })
const tauriWrite: Writer = (name, content) => invoke('write_doc', { name, content })

/**
 * 同一个 key 的写必须排队。
 * 不排队的话两次并发写会共用同一个临时文件名，前一次还没 rename 就被后一次截断，
 * 落盘的可能是两份内容拼起来的半份 JSON。
 */
function serialize(write: Writer): Writer {
  const tail = new Map<string, Promise<unknown>>()
  return (name, content) => {
    const prev = tail.get(name) ?? Promise.resolve()
    const next = prev.then(() => write(name, content))
    // 失败也不能断链，否则后面所有写永远等在一个 rejected promise 上
    tail.set(name, next.catch(() => undefined))
    return next
  }
}

/**
 * @param initial 启动时 hydrate 好的内容
 * @param write   真正落盘的实现，测试可注入假的；串行化在内部强制做，调用方忘不掉
 */
export function createFileStorage(initial: Record<string, string | null>, write: Writer = tauriWrite): PersistentStorage {
  const queued = serialize(write)
  const mirror = new Map<string, string>()
  const error = ref<string | null>(null)

  for (const [k, v] of Object.entries(initial)) if (v !== null) mirror.set(k, v)

  return {
    error,
    get: (k) => mirror.get(k) ?? null,
    set: (k, v) => {
      mirror.set(k, v)
      queued(k, v).then(
        () => {
          if (error.value?.startsWith(`「${k}」`)) error.value = null
        },
        (e: unknown) => {
          error.value = `「${k}」没能写入磁盘：${String(e)}。当前改动只在内存里，重启会丢。`
        },
      )
    },
  }
}

/**
 * 读盘，并把桌面壳早期只存在 WebView2 localStorage 里的数据搬过来。
 * 迁移是单向的：磁盘上有内容就以磁盘为准，避免用户回滚过的旧 localStorage 覆盖新数据。
 */
export async function hydrateData(
  read: Reader = tauriRead,
  migrated: Writer = serialize(tauriWrite),
  legacyGet: (key: string) => string | null = (k) => {
    // Node 24 起有个默认关闭的 localStorage 全局，typeof 判不住，只能试了再说
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(k)
    } catch {
      return null
    }
  },
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const key of DATA_KEYS) {
    let text: string | null = null
    try {
      text = await read(key)
    } catch {
      text = null
    }
    if (text === null) {
      const legacy = legacyGet(key)
      out[key] = legacy
      if (legacy !== null) await migrated(key, legacy).catch(() => undefined)
      continue
    }
    out[key] = text
  }
  return out
}

/** 网页版直接沿用 localStorage，接口对齐好让上层不用分支。 */
export function webStorage(fallback: StorageAdapter): PersistentStorage {
  return { ...fallback, error: ref<string | null>(null) }
}

export async function createStorage(desktop = isDesktop): Promise<PersistentStorage> {
  // browserStorage() 内部已经处理了"没有 localStorage 就用内存"
  if (!desktop) return webStorage(browserStorage())
  return createFileStorage(await hydrateData())
}

export async function dataDir(): Promise<string | null> {
  if (!isDesktop) return null
  try {
    return await invoke<string>('data_dir')
  } catch {
    return null
  }
}
