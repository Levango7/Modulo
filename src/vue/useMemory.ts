/**
 * 「AI 记忆」的存储胶水（第十五笔）：盘上文档 ⇄ 界面 ref 的唯一一座桥。
 * 与 `useKnowledge` 同一条纪律：构造时读档、每次变更落盘；清洗与限长全在 `aiMemory.ts`。
 * `now` 可注入（测试用；不注入走 `Date.now`）。
 */
import { ref, type Ref } from 'vue'
import type { StorageAdapter } from './store'
import {
  addMemory,
  MEMORY_DOC_KEY,
  parseMemoryDoc,
  removeMemory,
  serializeMemoryDoc,
  type MemoryEntry,
} from './aiMemory'

export interface MemoryApi {
  entries: Ref<MemoryEntry[]>
  /** 记一条；**拒收理由逐条回给调用方**（界面 / 动作负责说出来），空数组 = 记下了 */
  add(text: string): string[]
  remove(id: string): void
}

export function createMemory(storage: StorageAdapter, now: () => number = Date.now): MemoryApi {
  // 盘上的文档不可信：解析与逐条清洗都在 parseMemoryDoc 里（坏条目丢弃，不整份报废）
  const entries = ref<MemoryEntry[]>(parseMemoryDoc(storage.get(MEMORY_DOC_KEY)))
  const save = (): void => storage.set(MEMORY_DOC_KEY, serializeMemoryDoc(entries.value))
  return {
    entries,
    add(text) {
      const r = addMemory(entries.value, text, now())
      if (!r.rejected.length) {
        entries.value = r.entries
        save()
      }
      return r.rejected
    },
    remove(id) {
      entries.value = removeMemory(entries.value, id)
      save()
    },
  }
}
