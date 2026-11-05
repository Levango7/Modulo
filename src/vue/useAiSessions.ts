/**
 * AI 会话列表的**共享层**（改天换地 PR-D）。
 *
 * 为什么单独一个文件：会话的「列表 / 切换 / 删除」此前是 ChatDock 的私有实现
 * （历史面板），左栏要做 Session 列表就得第二份实现——两份清单迟早不一致。
 * 抽到这里之后，坞（发送 / 续聊）与左栏（列表 / 切换 / 删除）共用同一份状态。
 *
 * 纪律（与 ChatDock 原实现逐条相同，只是搬家）：
 * ① **不探测、不预加载**：列表只在挂载 / 显式刷新时拉（`ai_history_list`），
 *    与 provider 列表"现读镜像"同一条理由；
 * ② **删除的两步确认在 UI 层**，这里只做真删；删的是当前会话 ⇒ `activeId` 归零
 *    （下一条消息由后端生成新的 conv-xxx，与坞的 `newConversation` 同一语义）；
 * ③ 错误一律落 `error`（人话字符串），不静默吞——坞原来把 err 直接 String() 展示，
 *    这里保持同一口径。
 *
 * 后端命令（Rust `ai` 模块，E2E 走 tauri-stub 的同形实现）：
 *   `ai_history_list` → HistoryItem[]（id / title / updatedAt / messageCount，不带消息体）
 *   `ai_history_get`  → { id, messages }（HistoryMsg[]）
 *   `ai_history_delete` / `ai_history_clear`
 */
import { ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { HistoryItem, HistoryMsg } from './aiChat'

export interface AiSessionsApi {
  /** 会话清单（updatedAt 倒序由后端保证；这里不再排一遍） */
  items: Ref<HistoryItem[]>
  /** 最近一次 `load` 的结果（消息体）。坞 watch 它把气泡换掉 —— 栏只管"选"，不碰 turns */
  lastLoaded: Ref<{ id: string; messages: HistoryMsg[] } | null>
  /** 当前会话 id；null = 新会话（下一条消息由后端生成 conv-xxx）——坞直接写它 */
  activeId: Ref<string | null>
  /** 最近一次操作的人话错误；null = 没出错 */
  error: Ref<string | null>
  /** 列表请求在途（防双击重复拉，UI 据此禁用刷新钮） */
  loading: Ref<boolean>
  refresh(): Promise<void>
  /** 取一条会话的消息体；调用方（坞）负责把 turns 换成返回值并把 active 指过去由这里做 */
  load(id: string): Promise<{ id: string; messages: HistoryMsg[] }>
  remove(id: string): Promise<void>
  clearAll(): Promise<void>
  /** 开新会话：只把 active 归零，不调后端（后端在收到首条消息时才建） */
  startNew(): void
}

export function createAiSessions(): AiSessionsApi {
  const items = ref<HistoryItem[]>([])
  const lastLoaded = ref<{ id: string; messages: HistoryMsg[] } | null>(null)
  const activeId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)

  async function refresh(): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      items.value = await invoke<HistoryItem[]>('ai_history_list')
      error.value = null
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function load(id: string): Promise<{ id: string; messages: HistoryMsg[] }> {
    try {
      const d = await invoke<{ id: string; messages: HistoryMsg[] }>('ai_history_get', { id })
      activeId.value = d.id
      lastLoaded.value = { id: d.id, messages: d.messages }
      error.value = null
      return d
    } catch (err) {
      error.value = String(err)
      throw err
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await invoke('ai_history_delete', { id })
      if (activeId.value === id) activeId.value = null
      error.value = null
      await refresh()
    } catch (err) {
      error.value = String(err)
    }
  }

  async function clearAll(): Promise<void> {
    try {
      await invoke('ai_history_clear')
      activeId.value = null
      error.value = null
      await refresh()
    } catch (err) {
      error.value = String(err)
    }
  }

  function startNew(): void {
    activeId.value = null
  }

  return { items, lastLoaded, activeId, error, loading, refresh, load, remove, clearAll, startNew }
}
