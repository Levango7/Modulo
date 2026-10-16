<script setup lang="ts">
/**
 * 行头：版面上一条整宽的分组带（编辑态）。
 *
 * - **拖 = 整组移动**：pointerdown 上抛给父组件接入既有拖拽状态机（把成员全选中
 *   再 startMove —— 复用成组拖拽的实时预览与让位规则，不新造一套）。
 * - **双击标题 = 改名**（内联输入，Enter/失焦提交、Esc 取消）。
 * - **箭头 = 折叠/展开**：折叠是**可逆的整段位移**（成员隐藏、下方上移；展开还原
 *   并让位）—— 引擎 `rows.ts` 的坐标系说明见那里。
 * - **✕ = 解组**：收回行头那一行。
 *
 * 组件本身不碰 store：动作全部 emit 给 CanvasEditor（行头是"长什么样"，
 * 怎么改 doc 是父组件的编排）。
 */
import { nextTick, ref } from 'vue'
import { ChevronDown, ChevronRight, GripVertical, RefreshCw, Ungroup } from 'lucide-vue-next'

const props = defineProps<{
  title: string
  count: number
  collapsed: boolean
  /** 该行存的自动重排参数（没有 = 还没重排过，用全局默认） */
  auto: { per: number; rowH: number }
}>()

const emit = defineEmits<{
  (e: 'drag', ev: PointerEvent): void
  (e: 'toggle'): void
  (e: 'ungroup'): void
  (e: 'rename', title: string): void
  (e: 'reflow', per: number, rowH: number): void
}>()

/** 参数本地即时读取（不落盘）；点「重排」时才随结果一起提交 —— 改下拉不该产生历史 */
const per = ref(props.auto.per)
const rowH = ref(props.auto.rowH)

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

async function startRename(): Promise<void> {
  editing.value = true
  draft.value = props.title
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}
function commit(): void {
  if (!editing.value) return
  editing.value = false
  const t = draft.value.trim()
  if (t && t !== props.title) emit('rename', t)
}
</script>

<template>
  <div class="rowband" :data-collapsed="collapsed">
    <span class="grip" title="拖动整组移动" @pointerdown="emit('drag', $event)">
      <GripVertical :size="11" />
    </span>
    <button class="chev" :title="collapsed ? '展开这一行' : '折叠这一行'" :aria-label="collapsed ? '展开行' : '折叠行'" @pointerdown.stop @click="emit('toggle')">
      <ChevronRight v-if="collapsed" :size="12" />
      <ChevronDown v-else :size="12" />
    </button>
    <template v-if="editing">
      <input
        ref="inputEl"
        v-model="draft"
        class="rename"
        maxlength="24"
        aria-label="行标题"
        @pointerdown.stop
        @keydown.enter.prevent="commit()"
        @keydown.esc="editing = false"
        @blur="commit()"
      />
    </template>
    <span v-else class="title" title="双击改名" @dblclick="startRename()">{{ title }}</span>
    <span class="meta">{{ collapsed ? `已收起 ${count} 张` : `${count} 张` }}</span>
    <!-- 自动重排（阶段 C）：参数化一键动作，不连续跟随 -->
    <span v-if="!collapsed" class="auto" title="自动重排该行（可 Ctrl+Z 退回）">
      <label>每行</label>
      <select v-model.number="per" aria-label="每行张数" @pointerdown.stop>
        <option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }}</option>
      </select>
      <label>高</label>
      <select v-model.number="rowH" aria-label="行高" @pointerdown.stop>
        <option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }}</option>
      </select>
      <button class="reflow" title="按上面的参数重排这一行" aria-label="重排行" @pointerdown.stop @click="emit('reflow', per, rowH)">
        <RefreshCw :size="11" />
      </button>
    </span>
    <button class="ungroup" title="解组（收回行头那一行）" aria-label="解组" @pointerdown.stop @click="emit('ungroup')">
      <Ungroup :size="11" />
    </button>
  </div>
</template>

<style scoped>
.rowband {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 100%;
  min-width: 0;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--brand-500) 10%, var(--bg-card-soft));
  border: 1px solid color-mix(in srgb, var(--brand-500) 35%, transparent);
  font-size: 12px;
  color: var(--text-2);
}
.grip {
  display: inline-flex;
  cursor: grab;
  color: var(--text-4);
  touch-action: none;
}
.grip:hover {
  color: var(--text-2);
}
.chev,
.ungroup {
  display: inline-flex;
  align-items: center;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.chev:hover,
.ungroup:hover {
  color: var(--text-1);
}
/* 解组给两种记号：图标（语义）+ 关闭（第一直觉）—— 留着旧的 X 位置不动手感 */
.x {
  margin-left: var(--space-1);
}
.title {
  font-weight: 600;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
  cursor: text;
}
.meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.auto {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-3);
}
.auto select {
  font: inherit;
  font-size: 11px;
  padding: 0 2px;
  background: var(--input-bg);
  color: var(--text-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.reflow {
  display: inline-flex;
  align-items: center;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.reflow,
.chev,
.ungroup {
  position: relative;
}
/* 行头三枚图标钮视觉都只有 13×13px，低于最小可点区（手指点不中）。
   不改 padding（行头 22px 高会被撑变形），用伪元素把热区撑到 22×22 —— 与行头等高，
   命中区变大、视觉没变（同 .cbtn 的做法）。 */
.reflow::after,
.chev::after,
.ungroup::after {
  content: '';
  position: absolute;
  inset: -4px -5px;
  min-width: 22px;
  min-height: 22px;
}
.reflow:hover,
.reflow:focus-visible {
  color: var(--text-1);
}
.rename {
  font: inherit;
  font-weight: 600;
  color: var(--text-1);
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  max-width: 40%;
}
</style>
