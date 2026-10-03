<script setup lang="ts">
/**
 * 设置页里的「版面方案」一块：另存为 / 覆盖 / 新建空白 / 排序 / 改名 / 删除。
 *
 * 抽出来的理由与 BackupSection 一样：这一块有**自己的局部状态**（改名中的那条 + 草稿名）
 * 和**自己的交互模式**（拖拽排序 + Alt+↑/↓ 键盘排序）。混在父组件里时，
 * `draftName` / `editing` 这两个 ref 谁都说不清归谁 —— 抽出来之后作用域一眼可见。
 *
 * E2E 按**精确文本**点按钮（「另存为」「新建空白」），所以这里的文案与父组件曾经的一样，
 * 改文案等于改测试 —— 这条约束原样保留。
 */
import { inject, ref } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import type { SchemesApi } from '../useSchemes'
import type { Scheme } from '@modulo/engine'

const schemes = inject<SchemesApi>('schemes')!

const draftName = ref('')
const editing = ref<string | null>(null)
const editingName = ref('')

function save() {
  schemes.saveAs(draftName.value)
  draftName.value = ''
}
function newBlank() {
  schemes.createBlank(draftName.value)
  draftName.value = ''
}
function startRename(s: Scheme) {
  editing.value = s.id
  editingName.value = s.name
}
function commitRename() {
  if (editing.value) schemes.rename(editing.value, editingName.value)
  editing.value = null
}
function when(ts: number): string {
  if (!ts) return '未知时间'
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const dragId = ref<string | null>(null)
function onDragStart(id: string) {
  dragId.value = id
}
function onDrop(index: number) {
  if (dragId.value) schemes.move(dragId.value, index)
  dragId.value = null
}
</script>

<template>
  <section>
    <h3>版面方案</h3>
    <div class="row wrap">
      <input v-model="draftName" placeholder="方案名称" maxlength="32" @keydown.enter="save" />
      <button @click="save">另存为</button>
      <button :disabled="!schemes.active.value" @click="schemes.overwrite()">覆盖当前</button>
      <button @click="newBlank">新建空白</button>
    </div>
    <ul class="schemes">
      <li
        v-for="(s, i) in schemes.book.value.schemes"
        :key="s.id"
        :data-active="s.id === schemes.book.value.activeId"
        draggable="true"
        tabindex="0"
        @dragstart="onDragStart(s.id)"
        @dragover.prevent
        @drop="onDrop(i)"
        @keydown.alt.up="schemes.move(s.id, i - 1)"
        @keydown.alt.down="schemes.move(s.id, i + 1)"
      >
        <GripVertical :size="13" class="grip" title="拖动排序，或 Alt+↑/↓" />
        <template v-if="editing === s.id">
          <input v-model="editingName" maxlength="32" @keydown.enter="commitRename" @keydown.esc="editing = null" />
          <button @click="commitRename">存</button>
        </template>
        <strong v-else>{{ s.name }}</strong>
        <span class="muted meta">{{ when(s.updatedAt) }} · {{ s.doc.items.length }} 个模块</span>
        <span class="ops">
          <button v-if="s.id !== schemes.book.value.activeId" @click="schemes.activate(s.id)">应用</button>
          <button @click="startRename(s)">改名</button>
          <button @click="schemes.remove(s.id)">删除</button>
        </span>
      </li>
    </ul>
    <p v-if="!schemes.book.value.schemes.length" class="muted hint">还没有保存过方案：把版面排好后，在上面起个名字点「另存为」。</p>
    <p v-else class="muted hint">拖动左边的把手可以排序，键盘用 Alt+↑/↓。「新建空白」会存一条零模块的方案并切过去；当前版面没丢，Ctrl+Z 能退回来。</p>
  </section>
</template>

<style scoped>
/* 这段样式是从 SettingsPanel 整段搬过来的，一个字节都没改 ——
   搬的时候顺手"重写"一遍看着整洁，实际是丢掉了几条真规则
   （focus-visible 的焦点环、grip 的 hover 反馈、strong 的省略号）。 */
.schemes {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.schemes li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-card-soft);
}
.schemes .grip {
  flex: none;
  color: var(--text-4);
  cursor: grab;
}
.schemes li:hover .grip {
  color: var(--text-2);
}
.schemes li:focus-visible {
  outline: 2px solid var(--brand-500);
  outline-offset: 1px;
}
.schemes li[data-active='true'] {
  border-color: var(--brand-500);
}
.schemes strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}
.meta {
  font-size: 11px;
  margin-right: auto;
  white-space: nowrap;
}
.ops {
  display: flex;
  gap: var(--space-1);
}
.ops button {
  font-size: 12px;
  padding: 2px 8px;
}
</style>
