/**
 * MCP server 配置的共享状态（PR-F4a）。薄薄一层 API 管落盘与响应式，
 * 判定全在 `mcp.ts` 的纯函数里（那半不开浏览器也能断言）。
 *
 * 与 `useKnowledge` / `useCron` 同一手法，同一个 `StorageAdapter` 闸门 ——
 * 测试给内存实现，桌面/网页各走各的真实实现。
 *
 * **真去连 server 的动作不在这里**：那要 spawn 子进程、说 JSON-RPC，属 Rust 侧
 * （F4c）。这一层只保证「配置能存下来、重启读得回来」。
 */
import { ref, type Ref } from 'vue'
import type { StorageAdapter } from './store'
import {
  addServer,
  MCP_DOC_KEY,
  parseServers,
  removeServer,
  serializeServers,
  toggleServer,
  updateServer,
  type McpDraft,
  type McpServer,
} from './mcp'

export interface McpApi {
  servers: Ref<McpServer[]>
  /** 新增；成功返回 null，失败返回**要念给用户听的那句话** */
  add(draft: McpDraft): string | null
  /** 改一个；同上 */
  update(id: string, draft: McpDraft): string | null
  remove(id: string): void
  toggle(id: string, enabled: boolean): void
}

export function createMcp(storage: StorageAdapter): McpApi {
  // 盘上的数据不可信：解析与逐条清洗都在 parseServers 里（坏条目丢弃，不整份报废）
  const servers = ref<McpServer[]>(parseServers(storage.get(MCP_DOC_KEY)))
  const save = (): void => storage.set(MCP_DOC_KEY, serializeServers(servers.value))
  return {
    servers,
    add(draft) {
      const r = addServer(servers.value, draft)
      if (!r.ok) return r.error
      servers.value = r.list
      save()
      return null
    },
    update(id, draft) {
      const r = updateServer(servers.value, id, draft)
      if (!r.ok) return r.error
      servers.value = r.list
      save()
      return null
    },
    remove(id) {
      servers.value = removeServer(servers.value, id)
      save()
    },
    toggle(id, enabled) {
      servers.value = toggleServer(servers.value, id, enabled)
      save()
    },
  }
}
