<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { LayoutGrid, LayoutTemplate, Maximize2, Redo2, Settings, SlidersHorizontal, Sparkles, Undo2 } from 'lucide-vue-next'
import * as E from './engine'
import type { LayoutStore } from './vue/store'
import { CARD_COMPONENTS } from './vue/cardRegistry'
import { useAppearance } from './vue/useAppearance'
import GridLayout from './vue/components/GridLayout.vue'
import CanvasEditor from './vue/components/CanvasEditor.vue'
import StackEditor from './vue/components/StackEditor.vue'
import SettingsPanel from './vue/components/SettingsPanel.vue'

const store = inject<LayoutStore>('store')!
const reg = store.reg
const appearance = useAppearance()
provide('appearance', appearance)

const view = ref<'workbench' | 'edit'>('workbench')
const settingsOpen = ref(false)
const stageEl = ref<HTMLElement | null>(null)
const stageW = ref(1200)

const cols = computed(() => E.physicalCols(stageW.value))
const rowMin = computed(() => E.rowMinHeight(stageW.value))
const gap = 16
const projection = computed(() => E.project(store.doc.value, reg, cols.value))
const mode = computed(() => E.editorMode(stageW.value))

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    const el = stageEl.value
    if (el) stageW.value = el.clientWidth
  })
  if (stageEl.value) ro.observe(stageEl.value)
  window.addEventListener('keydown', onGlobalKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onGlobalKey)
})

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  if (!n?.tagName) return false
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable
}

/** 撤销/重做是全局能力：整理、推荐布局这类动作也可能在工作台上做，不能只在编辑器里可撤销 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && settingsOpen.value) {
    settingsOpen.value = false
    return
  }
  if (isEditable(e.target)) return
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) store.redo()
    else store.undo()
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault()
    store.redo()
  }
}
</script>

<template>
  <div class="shell">
    <header class="bar">
      <span class="brand"><i class="mark" />Modulo</span>
      <nav class="seg">
        <button :data-active="view === 'workbench'" @click="view = 'workbench'">
          <LayoutGrid :size="14" /> 工作台
        </button>
        <button :data-active="view === 'edit'" @click="view = 'edit'">
          <SlidersHorizontal :size="14" /> 布局编辑
        </button>
      </nav>
      <div class="tools">
        <span class="pill muted metric">{{ stageW }}px · {{ cols }} 列 · {{ mode === 'canvas' ? '画布' : '堆叠' }}</span>
        <button :disabled="!store.canUndo.value" title="撤销 (Ctrl+Z)" @click="store.undo()">
          <Undo2 :size="14" />
        </button>
        <button :disabled="!store.canRedo.value" title="重做 (Ctrl+Shift+Z)" @click="store.redo()">
          <Redo2 :size="14" />
        </button>
        <button class="wide" title="聚拢空洞（可撤销）" @click="store.tidy()"><Sparkles :size="14" /> 整理</button>
        <button class="wide" title="按原比例把每行铺满（可撤销）" @click="store.spread()"><Maximize2 :size="14" /> 撑满</button>
        <button class="wide" @click="store.restoreStarter()"><LayoutTemplate :size="14" /> 推荐布局</button>
        <button class="wide" title="外观设置" @click="settingsOpen = true"><Settings :size="14" /> 外观</button>
      </div>
    </header>

    <main ref="stageEl" class="stage">
      <template v-if="view === 'workbench'">
        <p v-if="projection.collapsed.length" class="collapsed muted">
          当前宽度放不下：{{ projection.collapsed.map((c) => c.id).join('、') }}
        </p>
        <GridLayout :rects="projection.rects" :cols="cols" :row-min="rowMin" :gap="gap" />
        <p v-if="!projection.rects.length" class="empty muted">版面是空的，去「布局编辑」拖几张卡进来。</p>
      </template>

      <CanvasEditor v-else-if="mode === 'canvas'">
        <template #default="{ item }">
          <component :is="CARD_COMPONENTS[item.id]" :variant="item.variant" :module-id="item.id" :chromeless="true" />
        </template>
      </CanvasEditor>
      <StackEditor v-else />
    </main>

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-4);
  gap: var(--space-4);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
  letter-spacing: 0.04em;
  font-size: 15px;
}
.brand .mark {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(135deg, var(--brand-500), color-mix(in oklab, var(--brand-500) 40%, #ff7ab6));
  box-shadow: 0 0 0 3px var(--brand-glow);
}
.seg,
.tools {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.seg {
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.seg button,
.tools button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  font-size: 13px;
}
.seg button[data-active='true'] {
  background: var(--brand-500);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.tools {
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: var(--space-1);
}
.tools button {
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
}
.tools button.wide {
  padding: var(--space-1) var(--space-3);
}
.tools button:disabled {
  opacity: 0.4;
  cursor: default;
}
.pill {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.metric {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.collapsed {
  margin: 0 0 var(--space-2);
  font-size: 12px;
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
</style>
