import { ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { browserStorage, type StorageAdapter } from './store'
import { isDesktop } from './useShell'
import { AUTO_INDEX_KEY, AUTO_SLOT_COUNT, autoSlotKey } from './useBackup'
import { REMINDERS_KEY } from './useReminders'
import { MIGRATE_BACKUP_KEY } from './migrate'
import { AI_DOC_KEY } from './aiSettings'

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
  // 自动备份（P0-③，`useBackup.ts`）：索引 + 环形 7 槽。
  // 这张表是桌面 `get` 的**唯一**数据来源（启动 hydrate 成内存镜像，之后读镜像），
  // 少登记一个键的症状不是报错，而是"写下去了、重启就看不见"—— 环形 7 份会变成每次启动重建基线。
  // 只在桌面用（网页版配额不适合放 7 份整包），但键名两边同源，所以两边都进表。
  AUTO_INDEX_KEY,
  ...Array.from({ length: AUTO_SLOT_COUNT }, (_, n) => autoSlotKey(n)),
  // 提醒（P0-④ 阶段 1，`useReminders.ts`）：设置 + "今天提醒过哪些"。
  // 同一条纪律：这张表是桌面 `get` 的唯一来源，漏登记 = 写得下去、重启读不到
  // （症状是每分钟重复提醒同一件事，因为"今天已提醒过"全丢了）。
  REMINDERS_KEY,
  // 迁移现场（P0-⑤，`migrate.ts`）：写入前快照，最多留最近 3 次；
  // 同样必须登记，否则写了快照、重启读不到，退路就是假的。
  MIGRATE_BACKUP_KEY,
  // 2026-10-24 补登记：这 8 个键此前能写进磁盘，但**没进这张表** ⇒ 重启后 `get` 恒为 null。
  // 症状分两种，都不报错：① 缓存类 —— 天气/空气/汇率/HN/仓库快照/更新检查一重启就重新联网，
  // 「上次取回的数据」连同 30 分钟 TTL 全部形同没写过；② 偏好类 —— 世界时钟挑的城市、GitHub 卡
  // 填的仓库名，重启直接回到默认值（用户视角就是「我明明选了」）。
  // 缓存类不进完整备份、不进自动备份（`backup.ts` 是显式字段清单，与这张表无关）。
  'modulo.weather.v1',
  'modulo.air.v1',
  'modulo.fx.v1',
  'modulo.hn.v1',
  'modulo.repo.v1',
  'modulo.repo-snapshot.v1',
  'modulo.update.v1',
  'modulo.worldclock.v1',
  // 两张卡自己的历史（2026-10-27 搬回适配器）：RSS 抓到的条目 / 探测的延迟样本。
  // 此前它们写**裸 localStorage** —— 跨重启还在，但不在文件镜像、不在备份清单、也不参与同步；
  // 搬进来之后前两件成立（备份仍是显式清单，不含它们：机器采的历史不该进备份）。
  'modulo.rss.v1',
  'modulo.probe.v1',
  // 多端同步的设置与各段戳（`syncStore.ts`，2026-10-25）：端点 / 用户名 / 设备标识 /
  // 上次同步时刻 / 每段「本机最后写过」的时刻与指纹。**口令不在这些字段里** —— 它只在
  // 本次运行的内存中，或用户显式勾选后进系统凭据库（Rust `webdav.rs`）。
  'modulo.sync.v1',
  // 首启引导是否了结（`onboarding.ts`，2026-10-28）：`{done, skipped, at}`。**不进备份/同步** ——
  // 它记的是"这台机器看过没有"，搬到新机器上要么跳过引导、要么在老机器上重弹，两种都不对。
  'modulo.onboarding.v1',
  // AI 模型服务的配置（F-12 一期，2026-10-29）：`{providers:[{id,kind,baseUrl,model}]}`。
  // **键名不是 `modulo.*`** —— Rust 按 `ai::settings::SETTINGS_DOC`（`ai-settings.v1`）
  // 直读 `data/ai-settings.v1.json`，这里必须一字不差，否则"界面写进去了、Rust 读不到"。
  // 密钥不在这个文件里：它只进系统凭据库（`ai_set_key`）。也不进备份/同步（一期）。
  AI_DOC_KEY,
]


/**
 * 落盘通知（2026-10-13 浮窗配套）：主窗写 doc 后广播 `modulo:doc-written`，
 * 浮窗重读同一份文件。用动态 import 是为了网页版不带 @tauri-apps/api 的事件模块进包
 * —— 没有 Tauri 时这行会 reject，吞掉即可。
 */
async function notifyWritten(key: string): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('modulo:doc-written', { key })
  } catch {
    /* 网页版没有 Tauri 事件总线：属正常路径 */
  }
}

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
          // 广播"这条 key 落盘了"：浮窗（独立 WebviewWindow）据此重读数据。
          // 只在桌面壳有监听者；网页版 emit 一次没人听，可忽略。
          void notifyWritten(k)
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
 *
 * **读盘失败 ≠ 磁盘上没有文件**（权限拒绝 / IO 错误 / 文件被占用都会抛异常）。
 * 所以抛异常的键既不采 legacy 值进内存、也**绝不回写磁盘** —— 否则一旦磁盘上其实有数据，
 * 就成了拿 localStorage 旧值覆盖新数据（规格书 §4「可靠性」行点名过的风险）。
 * 失败的键经 `onReadError` 报出去：空值启动已经够糟了，不能再静默。
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
  onReadError?: (failedKeys: string[]) => void,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  const failed: string[] = []
  for (const key of DATA_KEYS) {
    let text: string | null = null
    try {
      text = await read(key)
    } catch {
      // 空值启动；不采 legacy、不回写（见上面函数注释）
      out[key] = null
      failed.push(key)
      continue
    }
    if (text === null) {
      const legacy = legacyGet(key)
      out[key] = legacy
      if (legacy !== null) await migrated(key, legacy).catch(() => undefined)
      continue
    }
    out[key] = text
  }
  if (failed.length) onReadError?.(failed)
  return out
}

/**
 * 网页版：localStorage 包一层错误可见性。
 *
 * 桌面壳那边（`createFileStorage`）写失败会把 `error` 填上、界面顶出红条 ——
 * 但网页版此前只是 `{ ...fallback, error: ref(null) }`：error 槽永远为 null，
 * **写失败（配额满 / 隐私模式限制）会从 set 里直接抛出去**，界面毫无提示，
 * 用户以为存上了、刷新就丢（2026-10-13 强制 setItem 抛错的桌面实验复现：pageerror
 * 一条 + `.storage-error` 不出现）。存储失败必须让人看见，这是仓库自己的规矩
 * （见上面 PersistentStorage 的注释）；补上这一层，两版行为对齐。
 */
export function webStorage(fallback: StorageAdapter): PersistentStorage {
  const error = ref<string | null>(null)
  const report = (kind: '写' | '读', key: string, e: unknown): void => {
    error.value = `「${key}」没能${kind}进浏览器存储：${String(e)}。当前改动只在内存里，刷新会丢 —— 建议立刻下载备份。`
  }
  return {
    error,
    get: (k) => {
      try {
        return fallback.get(k)
      } catch (e) {
        report('读', k, e)
        return null
      }
    },
    set: (k, v) => {
      try {
        fallback.set(k, v)
        // 同一个 key 之前失败过、这次成功 → 把红条撤掉（与桌面壳的"恢复即消警"对称）
        if (error.value?.startsWith(`「${k}」`)) error.value = null
      } catch (e) {
        report('写', k, e)
      }
    },
  }
}

export async function createStorage(desktop = isDesktop): Promise<PersistentStorage> {
  // browserStorage() 内部已经处理了"没有 localStorage 就用内存"
  if (!desktop) return webStorage(browserStorage())
  let readError: string | null = null
  const data = await hydrateData(
    tauriRead,
    serialize(tauriWrite),
    undefined,
    // 启动期读盘失败不阻止启动（空值启动），但必须从第一帧就顶出红条：
    // 这些键此刻是空的，用户看不见原因就会以为"数据没了"。
    (failed) => {
      const some = failed.length <= 3 ? failed.join('、') : `${failed[0]} 等 ${failed.length} 个`
      readError = `启动时读盘失败（${some}）：这些键暂以空值启动，且没有用 localStorage 旧值回填。改动仍会写穿，但重启前请先检查数据目录。`
    },
  )
  const storage = createFileStorage(data, tauriWrite)
  if (readError) storage.error.value = readError
  return storage
}

export async function dataDir(): Promise<string | null> {
  if (!isDesktop) return null
  try {
    return await invoke<string>('data_dir')
  } catch {
    return null
  }
}
