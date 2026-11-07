/**
 * 「资料」的共享状态（PR-F1）：左栏列它、聊天里 `@` 它 —— 两处必须同一份。
 *
 * 与 `useAiSessions` 同一手法：薄薄一层 API 管落盘与响应式，判定全在 `knowledge.ts`
 * 的纯函数里（那半不开浏览器也能断言）。落盘走 `StorageAdapter` —— 与卡片数据、
 * AI 配置同一条闸门，测试可以给内存实现，桌面/网页各走各的真实实现。
 */
import { ref, type Ref } from 'vue'
import type { StorageAdapter } from './store'
import {
  addDocs,
  KNOWLEDGE_DOC_KEY,
  parseKnowledge,
  removeDoc,
  serializeKnowledge,
  type KnowledgeDoc,
  type PickedDoc,
} from './knowledge'

export interface KnowledgeApi {
  docs: Ref<KnowledgeDoc[]>
  /** 入库并落盘；**拒收理由逐条回给调用方**（界面负责说出来） */
  add(picked: readonly PickedDoc[]): string[]
  remove(id: string): void
  clearAll(): void
}

export function createKnowledge(storage: StorageAdapter): KnowledgeApi {
  // 盘上的文档不可信：解析与逐条清洗都在 parseKnowledge 里（坏条目丢弃，不整份报废）
  const docs = ref<KnowledgeDoc[]>(parseKnowledge(storage.get(KNOWLEDGE_DOC_KEY)))
  const save = (): void => storage.set(KNOWLEDGE_DOC_KEY, serializeKnowledge(docs.value))
  return {
    docs,
    add(picked) {
      const before = docs.value.length
      const r = addDocs(docs.value, picked, Date.now())
      docs.value = r.docs
      // 有实际入库才落盘（一次全是拒收的导入不必空写一遍）
      if (docs.value.length !== before) save()
      return r.rejected
    },
    remove(id) {
      docs.value = removeDoc(docs.value, id)
      save()
    },
    clearAll() {
      docs.value = []
      save()
    },
  }
}
