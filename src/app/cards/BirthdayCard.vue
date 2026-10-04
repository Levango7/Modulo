<script setup lang="ts">
/**
 * 生日提醒：一份名单，报"下一个是谁"。
 *
 * 内容存在 `cardData.birthdays`（**跟着完整备份走**）—— 用户敲进去的名字属于内容，不是偏好。
 * 算术全在引擎（`@modulo/engine/birthday`）：没有年就没有年龄、2 月 29 日在平年落到 28 日、
 * 跨年只比月日不比"还剩几天" —— 这三条由模块钉死，不让这张卡和别的卡各算各的。
 *
 * 三种模式而不是两个开关：`editing` 一个布尔要同时表示"在填表"和"在管理名单"，
 * 于是模板里出现 `editing = true` 却没填表、而删除按钮又只在 `editing` 时出现这种自相矛盾。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { birthdayText, parseMonthDay, upcomingBirthdays } from '@modulo/engine/birthday'
import { Cake, ListChecks, Pencil, Plus, X } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

/** 最近的在最前；同一天按名字排（引擎里排好了，这里不重排） */
const list = computed(() => upcomingBirthdays(cards.state.birthdays, now.value))
/** `next` 形态只报下一个；`list` 形态报一串 */
const shown = computed(() => list.value.slice(0, props.variant === 'next' ? 1 : 5))

type Mode = 'view' | 'add' | 'manage'
const mode = ref<Mode>('view')

const draftName = ref('')
/** 月日合成一个字符串存草稿：用两个数字输入框拼 `M-D`，省一个字段也少一处不一致 */
const draftWhen = ref('')
const draftYear = ref('')

function save(): void {
  const md = parseMonthDay(draftWhen.value)
  if (md) {
    const y = draftYear.value.trim()
    cards.addBirthday(draftName.value, md.month, md.day, y ? Number(y) : undefined)
    mode.value = 'view'
  }
  draftName.value = ''
  draftWhen.value = ''
  draftYear.value = ''
}
</script>

<template>
  <div class="card birthday" :data-v="variant">
    <div class="card-body">
      <template v-if="mode === 'add'">
        <input v-model="draftName" class="in" maxlength="24" placeholder="名字（如：妈妈）" aria-label="生日名字" />
        <div class="row">
          <input v-model="draftWhen" class="in" placeholder="月-日（如 3-5）" aria-label="生日月日" />
          <input v-model="draftYear" class="in year" inputmode="numeric" placeholder="出生年（可空）" aria-label="出生年" />
        </div>
        <div class="acts">
          <button class="primary" :disabled="!parseMonthDay(draftWhen)" @click="save()">添加</button>
          <button @click="mode = 'view'">取消</button>
        </div>
      </template>

      <template v-else-if="list.length">
        <div class="top">
          <span class="label">生日提醒</span>
          <div class="tools">
            <button class="edit" title="添加生日" aria-label="添加生日" @click="mode = 'add'"><Plus :size="12" /></button>
            <button
              class="edit"
              title="管理名单"
              aria-label="管理生日名单"
              :data-on="mode === 'manage'"
              @click="mode = mode === 'manage' ? 'view' : 'manage'"
            >
              <ListChecks :size="12" />
            </button>
          </div>
        </div>
        <ul class="list">
          <li v-for="b in shown" :key="b.date + b.b.name" :class="{ today: b.days === 0 }">
            <div class="who">
              <Cake v-if="b.days === 0" class="ico" :size="12" />
              <span class="name">{{ b.b.name }}</span>
            </div>
            <div class="when">
              <span class="head">{{ birthdayText(b).head }}</span>
              <span v-if="b.turns !== null" class="age">{{ b.turns }} 岁</span>
            </div>
            <button
              v-if="mode === 'manage'"
              class="del"
              :aria-label="`删除 ${b.b.name}`"
              @click="b.b.id && cards.removeBirthday(b.b.id)"
            >
              <X :size="11" />
            </button>
          </li>
        </ul>
        <p v-if="list.length > shown.length" class="cap">另有 {{ list.length - shown.length }} 位</p>
      </template>

      <template v-else>
        <div class="top">
          <Cake class="ico" :size="16" />
          <button class="edit" title="加一个生日" aria-label="添加生日" @click="mode = 'add'"><Pencil :size="11" /></button>
        </div>
        <p class="hint">记下月日，这里报下一个是谁</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.birthday .card-body {
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
.tools {
  display: flex;
  gap: 4px;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
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
.edit[data-on='true'] {
  opacity: 1;
  color: var(--text-1);
}
.edit:hover,
.edit:focus-visible {
  opacity: 1;
  color: var(--text-1);
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 0.8cqw, 6px);
}
.list li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.list li.today .head {
  color: var(--mod, var(--brand-500));
  font-weight: 600;
}
.who {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}
.name {
  font-size: clamp(11px, 2.8cqw, 14px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.when {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex: 0 0 auto;
}
.head {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.age {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
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
.row {
  display: flex;
  gap: 4px;
}
.in.year {
  flex: 0 0 40%;
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
.acts .primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.del {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover,
.del:focus-visible {
  color: var(--c-red, var(--text-1));
}
</style>
