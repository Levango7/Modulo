<script setup lang="ts">
/**
 * 速记卡：最近几条速记。**内容（标题 + 正文 + 时间戳）存 `cardData`，跟着完整备份走。**
 *
 * F-01 阶段 2（2026-11-05）：内容按实例分（第八个、也是阶段 2 最后一个字段）——
 * 读用 `notesOf`：第二张速记卡读的是它自己那份（没有就是空白），不再是跟着第一张显示。
 * `recent`（最近改动）模块反过来按**聚合**口径（`allNotes`）：它的语义本来就是
 * "这块板最近动过的内容"，只看顶层会把第二张的速记漏掉（§12.50 同一条纪律）。
 * 单实例 / 第一实例仍读顶层那一份，与改造前逐字相同。
 *
 * 写入入口（2026-11-05 §12.58）：标题 + 正文两个输入、回车落一笔 —— 与 `TodoCard`
 * 同一条模式（`addNote` 的 `moduleId` / `instanceId` 尾参是 §12.57 铺好的，写哪一份
 * 由判定层定，组件里不放"是不是第二张"的判断）。`bar` 变体（一条速显的窄条）与
 * `recent`（聚合只读视图）不显示入口 —— 后者没有"这个实例"可写。
 */
import { computed, inject, ref } from 'vue'
import { FileText, History } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { allNotes, notesOf } from '../../vue/instanceData'

const props = defineProps<{ variant: string; moduleId?: string; instanceId?: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!
const limit = computed(() => (props.variant === 'tall' ? 20 : props.variant === 'bar' ? 6 : 4))
const items = computed(() => {
  const list = props.moduleId === 'recent'
    ? allNotes(cards.state)
    : notesOf(cards.state, props.moduleId, props.instanceId)
  return list.slice(0, limit.value)
})
/** 写入入口的可见性：窄条与「最近改动」不显示（理由见文件头） */
const canWrite = computed(() => props.moduleId !== 'recent' && props.variant !== 'bar')
const draftTitle = ref('')
const draftBody = ref('')

function submit(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  cards.addNote(draftTitle.value, draftBody.value, props.moduleId, props.instanceId)
  draftTitle.value = ''
  draftBody.value = ''
}

function when(at: number): string {
  const d = Math.floor((Date.now() - at) / 60000)
  if (d < 1) return '刚刚'
  if (d < 60) return `${d} 分钟前`
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`
  return `${Math.floor(d / 1440)} 天前`
}
</script>

<template>
  <div class="card">
    <div v-if="!chromeless" class="card-head">
      <History v-if="moduleId === 'recent'" :size="14" /><FileText v-else :size="14" />
      <span>{{ moduleId === 'recent' ? '最近改动' : '速记' }}</span>
    </div>
    <div class="card-body">
      <div v-if="canWrite" class="compose">
        <input v-model="draftTitle" class="ti" placeholder="标题（可空）" aria-label="速记标题" @keydown="submit" />
        <input v-model="draftBody" class="bi" placeholder="记一笔，回车确认" aria-label="速记内容" @keydown="submit" />
      </div>
      <p v-if="!items.length" class="muted empty">还没有内容</p>
      <ul class="list">
        <li v-for="n in items" :key="n.id">
          <div class="t">{{ n.title }}</div>
          <div class="s muted">{{ when(n.at) }}</div>
          <div v-if="variant !== 'bar'" class="b">{{ n.body }}</div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(4px, 1cqw, 12px);
}
/* 写入入口（§12.58）：标题窄、正文宽，回车落一笔。无边框透明底 —— 与便签的 textarea、
   待办的 .add 同一条卡面语言（卡体自己就是输入面板）；字级不低于 11px（E2E 最小字号铁律） */
.compose {
  display: flex;
  gap: clamp(4px, 1cqw, 10px);
  margin-bottom: clamp(6px, 1.4cqw, 12px);
  border-bottom: 1px solid var(--border-soft, rgba(0, 0, 0, 0.08));
  padding-bottom: clamp(4px, 1cqw, 8px);
}
.ti {
  flex: 0 0 30%;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: clamp(12px, 1.3cqw, 14px);
  font-weight: 600;
  color: var(--text-1);
  padding: 0;
}
.bi {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: clamp(12px, 1.3cqw, 14px);
  color: var(--text-2);
  padding: 0;
}
.ti:focus,
.bi:focus {
  outline: none;
  box-shadow: none;
}
.ti::placeholder,
.bi::placeholder {
  color: var(--text-3);
}
.t {
  font-weight: 600;
  font-size: clamp(12px, 1.4cqw, 15px);
}
.s {
  font-size: clamp(11px, 1.1cqw, 12px);
}
.b {
  color: var(--text-2);
  font-size: clamp(12px, 1.3cqw, 14px);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.empty {
  text-align: center;
  margin-top: 20%;
}
</style>
