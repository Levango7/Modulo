<script setup lang="ts">
/**
 * 倒数日：用户写的名字 + 一个日子 → "还有几天"。
 *
 * 内容存在 `cardData`（**跟着完整备份走**）—— 这就是它和"世界时钟选哪些城市"的区别：
 * 用户敲进去的字属于内容，偏好属于本机。算术在引擎（`@modulo/engine/countdown`，
 * 含闰日与"看着像日子但不是"的拒收）。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { countdownText, daysUntil, formatDateLabel, isValidDate } from '@modulo/engine/countdown'
import { CalendarClock, Pencil } from 'lucide-vue-next'
import type { CardDataApi } from '../cardData'

const props = defineProps<{ variant: string }>()
const cardData = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const cd = computed(() => cardData.state.countdown)
const days = computed(() => (cd.value.date ? daysUntil(cd.value.date, now.value) : null))

const editing = ref(false)
const draftLabel = ref('')
const draftDate = ref('')

function openEdit(): void {
  draftLabel.value = cd.value.label
  draftDate.value = cd.value.date
  editing.value = true
}

function save(): void {
  cd.value.label = draftLabel.value.trim().slice(0, 24)
  // 输入框里的日期可能还没填完（"2026-10-"这种中间态）：不合法就**保留原来的**，不当成清空
  if (isValidDate(draftDate.value)) cd.value.date = draftDate.value
  editing.value = false
}

function clear(): void {
  cd.value.label = ''
  cd.value.date = ''
  editing.value = false
}
</script>

<template>
  <div class="card countdown" :data-v="variant">
    <div class="card-body">
      <template v-if="editing">
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="给这个日子起个名（如：元旦假期）" aria-label="倒数日名字" />
        <input v-model="draftDate" class="in" type="date" aria-label="目标日期" />
        <div class="acts">
          <button class="primary" @click="save()">保存</button>
          <button @click="clear()">清空</button>
        </div>
      </template>
      <template v-else-if="days !== null">
        <div class="top">
          <span class="label">{{ cd.label || '倒数日' }}</span>
          <button class="edit" title="改名字 / 改日子" aria-label="编辑倒数日" @click="openEdit()"><Pencil :size="11" /></button>
        </div>
        <div class="num">{{ countdownText(days) }}</div>
        <p class="cap">{{ formatDateLabel(cd.date) }}<template v-if="variant !== 'row'"> 的那一天</template></p>
      </template>
      <template v-else>
        <div class="top">
          <CalendarClock class="ico" :size="16" />
          <button class="edit" title="设一个日子" aria-label="设置倒数日" @click="openEdit()"><Pencil :size="11" /></button>
        </div>
        <p class="hint">点右上角，给一个日子起个名</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.countdown .card-body {
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
.acts {
  display: flex;
  gap: var(--space-2);
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
