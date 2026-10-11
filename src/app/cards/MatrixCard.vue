<script setup lang="ts">
/**
 * 四象限待办（艾森豪威尔矩阵）：按"重要 × 紧急"两轴把事归到四个象限。
 *
 * 与普通待办卡的关系：**兄弟卡，不是变体** —— 数据分开存（用户可以两卡并存），
 * 但语义同源（勾选/删除/doneAt 完成时刻）。象限挪动用每条右侧的 ←/→ 按钮
 * （在四个象限间循环），不做拖拽 —— 跨象限拖拽在 12 列的小格里没有精度可言。
 *
 * `grid` 形态画整张 2×2；`focus` 形态只画上半区（重要两象限纵排）——
 * "重要不紧急" quadrant 是最值得常驻屏幕的那一格（它防止重要的事被紧急的事挤掉）。
 */
import { computed, inject, ref } from 'vue'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import type { CardDataApi, Quadrant } from '../../vue/cardData'
import { QUADRANTS } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const QMETA: Record<Quadrant, { label: string; sub: string }> = {
  do: { label: '重要 · 紧急', sub: '现在就做' },
  plan: { label: '重要 · 不紧急', sub: '排进日程' },
  delegate: { label: '紧急 · 不重要', sub: '交给别人 / 快速过' },
  drop: { label: '不重要 · 不紧急', sub: '能删就删' },
}

const drafts = ref<Record<string, string>>({})
const items = computed(() => cards.state.matrix)
const inQuadrant = (q: Quadrant) => items.value.filter((t) => t.q === q && (props.variant !== 'focus' || q === 'do' || q === 'plan'))
const quadrants = computed<Quadrant[]>(() => (props.variant === 'focus' ? ['do', 'plan'] : [...QUADRANTS]))

function add(q: Quadrant): void {
  const text = drafts.value[q]?.trim()
  if (!text) return
  cards.addMatrixTodo(text, q)
  drafts.value[q] = ''
}
/** 在四个象限间循环挪动：右按钮正序、左按钮逆序 —— 挪到目标格比拖拽省事 */
function shift(id: string, dir: 1 | -1): void {
  const t = items.value.find((x) => x.id === id)
  if (!t) return
  const i = QUADRANTS.indexOf(t.q)
  cards.moveMatrixTodo(id, QUADRANTS[(i + dir + QUADRANTS.length) % QUADRANTS.length])
}
</script>

<template>
  <div class="card matrix" :data-v="variant">
    <div class="card-body">
      <div class="grid" :data-focus="variant === 'focus'">
        <section v-for="q in quadrants" :key="q" class="quad" :data-q="q">
          <header class="qhead">
            <span class="qlabel">{{ QMETA[q].label }}</span>
            <span class="qsub">{{ QMETA[q].sub }}</span>
          </header>
          <ul class="rows">
            <li v-for="t in inQuadrant(q)" :key="t.id" :data-done="t.done">
              <input
                :id="`mx-${t.id}`"
                type="checkbox"
                :checked="t.done"
                :aria-label="`完成 ${t.text}`"
                @change="cards.toggleMatrixTodo(t.id)"
              />
              <label :for="`mx-${t.id}`" class="txt">{{ t.text }}</label>
              <span class="ops">
                <button title="挪到左邻象限" :aria-label="`挪动 ${t.text}`" @click="shift(t.id, -1)"><ChevronLeft :size="10" /></button>
                <button title="挪到右邻象限" :aria-label="`挪动 ${t.text}`" @click="shift(t.id, 1)"><ChevronRight :size="10" /></button>
                <button title="删除" :aria-label="`删除 ${t.text}`" @click="cards.removeMatrixTodo(t.id)"><Trash2 :size="10" /></button>
              </span>
            </li>
          </ul>
          <div class="add-row">
            <input
              v-model="drafts[q]"
              class="in"
              maxlength="48"
              placeholder="加一条，回车"
              :aria-label="`在${QMETA[q].label}加一条`"
              @keydown.enter.prevent="add(q)"
            />
            <button class="add" :aria-label="`在${QMETA[q].label}加一条`" @click="add(q)"><Plus :size="11" /></button>
          </div>
        </section>
      </div>
      <p v-if="!items.length" class="empty">四个格各自加一条试试 —— 象限间用条目右侧的箭头挪</p>
    </div>
  </div>
</template>

<style scoped>
.matrix .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2cqw, 16px);
}
.grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: clamp(3px, 1cqw, 8px);
}
.grid[data-focus='true'] {
  grid-template-rows: 1fr;
}
.quad {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 60%, transparent);
  border-radius: var(--radius-sm);
  padding: clamp(3px, 1cqw, 8px);
  overflow: hidden;
}
.quad[data-q='do'] {
  background: color-mix(in srgb, var(--c-red) 7%, transparent);
}
.quad[data-q='plan'] {
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 7%, transparent);
}
.quad[data-q='delegate'] {
  background: color-mix(in srgb, var(--c-amber) 7%, transparent);
}
.qhead {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
}
.qlabel {
  font-size: clamp(11px, 1.9cqw, 11px);
  font-weight: 600;
  color: var(--text-2);
  white-space: nowrap;
}
.qsub {
  font-size: clamp(11px, 1.7cqw, 10px);
  color: var(--text-4);
  white-space: nowrap;
}
.rows {
  flex: 1 1 auto;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rows li {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.rows li[data-done='true'] .txt {
  color: var(--text-4);
  text-decoration: line-through;
}
.rows input[type='checkbox'] {
  flex: none;
  margin: 0;
}
.txt {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.ops {
  flex: none;
  display: none;
  gap: 1px;
}
.rows li:hover .ops,
.rows li:focus-within .ops {
  display: inline-flex;
}
.ops button {
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.ops button:hover,
.ops button:focus-visible {
  color: var(--text-1);
}
.add-row {
  display: flex;
  gap: 3px;
  align-items: center;
}
.in {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 1.9cqw, 11px);
  padding: 1px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.add {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.add:hover,
.add:focus-visible {
  color: var(--text-1);
}
.empty {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
}
</style>
