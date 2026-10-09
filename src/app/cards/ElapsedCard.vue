<script setup lang="ts">
/**
 * 正计时：自某个日子起，今天第 N 天（戒烟 / 坚持 / 开业……正面口径的倒数日）。
 * 内容（名字 + 起始日）存 `cardData` —— **跟着完整备份走**。
 * "第 N 天"= 已过天数 + 1（开始那天算第 1 天，这是这类卡片的通行口径）。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { formatDateLabel, isValidDate } from '@levango7/engine'
import { CalendarClock, Pencil } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cardData = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const el = computed(() => cardData.state.elapsed)
const days = computed(() => (el.value.date && isValidDate(el.value.date) ? daysSince(el.value.date, now.value) : null))
/** 已过天数：从起始日的次日起算 1 —— 与 `daysUntil` 的负数同源，口径共用一套 */
function daysSince(date: string, at: Date): number {
  const p = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) }
  const start = new Date(p.y, p.m - 1, p.d)
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  return Math.round((today.getTime() - start.getTime()) / 86_400_000)
}

const editing = ref(false)
const draftLabel = ref('')
const draftDate = ref('')

function openEdit(): void {
  draftLabel.value = el.value.label
  draftDate.value = el.value.date
  editing.value = true
}

function save(): void {
  el.value.label = draftLabel.value.trim().slice(0, 24)
  if (isValidDate(draftDate.value)) el.value.date = draftDate.value
  editing.value = false
}
</script>

<template>
  <div class="card elapsed" :data-v="variant">
    <div class="card-body">
      <template v-if="editing">
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="在坚持什么？（如：不喝奶茶）" aria-label="正计时名字" />
        <input v-model="draftDate" class="in" type="date" aria-label="起始日期" />
        <div class="acts">
          <button class="primary" @click="save()">保存</button>
        </div>
      </template>
      <template v-else-if="days !== null">
        <div class="top">
          <span class="label">{{ el.label || '正计时' }}</span>
          <button class="edit" title="改名字 / 改起始日" aria-label="编辑正计时" @click="openEdit()"><Pencil :size="11" /></button>
        </div>
        <div class="num">第 {{ days + 1 }} 天</div>
        <p class="cap">自 {{ formatDateLabel(el.date) }} 起</p>
      </template>
      <template v-else>
        <div class="top">
          <CalendarClock class="ico" :size="16" />
          <button class="edit" title="设起始日" aria-label="设置正计时" @click="openEdit()"><Pencil :size="11" /></button>
        </div>
        <p class="hint">点右上角，设一个开始的日子</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.elapsed .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edit {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  opacity: 0.7;
}
.edit:hover,
.edit:focus-visible {
  opacity: 1;
  color: var(--text-1);
}
.num {
  font-size: clamp(18px, 7.6cqw, 34px);
  line-height: 1.1;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.ico {
  color: var(--mod, var(--brand-500));
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.acts button {
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 8px;
}
.acts .primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
</style>
