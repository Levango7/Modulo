<script setup lang="ts">
/**
 * 习惯打卡：一周格子 + 连续天数。**内容（名字 + 打卡记录）存 `cardData`，跟着完整备份走。**
 * streak 口径在引擎（`habit.ts`）：今天没打卡不归零，锚点取"今天或昨天"里更晚的那个。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { lastNDays, streakDays } from '@levango7/engine/habit'
import { Pencil } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cardData = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const habit = computed(() => cardData.state.habit)
const editing = ref(false)
const draftName = ref('')

const week = computed(() => lastNDays(habit.value.days, now.value))
const streak = computed(() => streakDays(habit.value.days, now.value))
/** 周几标签：格子上面那行"一 二 三 四 五 六 日"按本周对齐 */
const dayLabels = computed(() => week.value.map((x) => '周' + ['日', '一', '二', '三', '四', '五', '六'][new Date(x.date + 'T12:00:00').getDay()].slice(1)))

function toggle(date: string): void {
  const set = new Set(habit.value.days)
  if (set.has(date)) set.delete(date)
  else set.add(date)
  habit.value.days = [...set].sort()
}

function openEdit(): void {
  draftName.value = habit.value.name
  editing.value = !editing.value
}

function saveName(): void {
  habit.value.name = draftName.value.trim().slice(0, 16)
  editing.value = false
}
</script>

<template>
  <div class="card habit" :data-v="variant">
    <div class="card-body">
      <template v-if="editing">
        <input v-model="draftName" class="in" maxlength="16" placeholder="这个习惯叫什么" aria-label="习惯名字" />
        <div class="acts">
          <button class="primary" @click="saveName()">保存</button>
        </div>
      </template>
      <template v-else>
        <div class="top">
          <span class="name">{{ habit.name || '给习惯起个名' }}</span>
          <span class="streak" :class="{ zero: streak === 0 }">连续 {{ streak }} 天</span>
          <button class="edit" title="改习惯名字" aria-label="编辑习惯名字" @click="openEdit()"><Pencil :size="11" /></button>
        </div>
        <div class="week" role="group" aria-label="最近七天打卡">
          <button
            v-for="(x, i) in week"
            :key="x.date"
            class="d"
            :class="{ done: x.done, today: x.date === week[week.length - 1].date }"
            :title="`${x.date}${x.done ? '（已打卡）' : ''}`"
            @click="toggle(x.date)"
          >
            <span class="lab">{{ dayLabels[i] }}</span>
            <span class="mark">{{ x.done ? '✓' : '' }}</span>
          </button>
        </div>
        <p class="cap">点格子打卡；连着数到今天（或昨天）</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.habit .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  gap: clamp(3px, 1cqw, 8px);
  min-width: 0;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.streak {
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--brand-600);
  white-space: nowrap;
}
.streak.zero {
  color: var(--text-3);
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
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: clamp(2px, 0.6cqw, 4px);
}
.d {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: clamp(1px, 0.4cqw, 3px) 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  min-width: 0;
}
.d .lab {
  font-size: clamp(11px, 1.8cqw, 10px);
  color: var(--text-3);
}
.d .mark {
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-1);
  line-height: 1.1;
  min-height: 1.1em;
}
.d.done {
  border-color: var(--mod, var(--brand-500));
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 14%, transparent);
}
.d.done .mark {
  color: var(--text-1);
}
.d.today {
  border-style: dashed;
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
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
.cap {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
}
</style>
