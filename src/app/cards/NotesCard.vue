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
 * 如实记：本卡今天**没有写入入口**（`addNote` 在 `cardData.ts` 里有，自初始提交起
 * 只有测试在调）—— 本笔只改读路径，写入入口补不补留给产品裁决。
 */
import { computed, inject } from 'vue'
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
