<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { LayoutGrid, LayoutTemplate, Maximize2, Minimize2, Redo2, Settings, SlidersHorizontal, Sparkles, TriangleAlert, Undo2, Wand2 } from 'lucide-vue-next'
import { measureWantedRows } from './vue/useDensity'
import * as E from './engine'
import type { LayoutStore } from './vue/store'
import type { PersistentStorage } from './vue/fileStorage'
import { CARD_COMPONENTS } from './vue/cardComponents'
import { useAppearance } from './vue/useAppearance'
import { useSchemes } from './vue/useSchemes'
import { isDesktop, useShell } from './vue/useShell'
import GridLayout from './vue/components/GridLayout.vue'
import CanvasEditor from './vue/components/CanvasEditor.vue'
import StackEditor from './vue/components/StackEditor.vue'
import SettingsPanel from './vue/components/SettingsPanel.vue'
import TitleBar from './vue/components/TitleBar.vue'
import BrandMark from './vue/components/BrandMark.vue'

const storage = inject<PersistentStorage>('storage')!
const store = inject<LayoutStore>('store')!
const reg = store.reg
const appearance = useAppearance(storage)
provide('appearance', appearance)
const schemes = useSchemes(store, storage)
provide('schemes', schemes)
provide('shell', useShell(storage))

const view = ref<'workbench' | 'edit'>('workbench')
const settingsOpen = ref(false)
/** 「推荐布局」是这一排里唯一的破坏性动作（整体替换版面），所以要多一次确认。撤销仍然可用 */
const confirmStarter = ref(false)
const stageEl = ref<HTMLElement | null>(null)
const stageW = ref(1200)

const cols = computed(() => E.physicalCols(stageW.value))
const rowPx = computed(() => E.rowHeight(stageW.value))
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

function fitContent() {
  store.fitToContent(measureWantedRows(stageEl.value?.querySelector<HTMLElement>('.grid') ?? null))
}

/** 组合动作：先按内容收紧、再聚拢空行。仍是两步历史，撤销可以分别退回 */
function compact() {
  fitContent()
  store.tidy()
}

function applyStarter() {
  confirmStarter.value = false
  store.restoreStarter()
}

/** 弹层是 aria-modal 的，就得自己把焦点收进来 —— 否则键盘用户还在页面里 Tab，Esc 也到不了 */
const starterCancel = ref<HTMLElement | null>(null)
watch(confirmStarter, async (on) => {
  if (!on) return
  await nextTick()
  starterCancel.value?.focus()
})

/** 收紧/紧凑要读真实渲染出来的卡片高度，编辑器里没有那张 .grid，所以只能在工作台用 */
const onlyWorkbench = '回「工作台」可用：这一步要按真实渲染的卡片高度测量'

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  if (!n?.tagName) return false
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable
}

/** 撤销/重做是全局能力：整理、推荐布局这类动作也可能在工作台上做，不能只在编辑器里可撤销 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    /** 两层弹层叠着时 Esc 只关最上面那层：先确认框，再设置页 */
    if (confirmStarter.value) confirmStarter.value = false
    else if (settingsOpen.value) settingsOpen.value = false
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
  <div class="app">
    <TitleBar v-if="isDesktop" />
    <div class="shell">
    <header class="bar">
      <span class="brand"><BrandMark :size="20" />Modulo</span>
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
        <span class="sep" aria-hidden="true"></span>
        <span class="grp" role="group" aria-label="历史">
          <button :disabled="!store.canUndo.value" title="撤销 (Ctrl+Z)" @click="store.undo()">
            <Undo2 :size="14" />
          </button>
          <button :disabled="!store.canRedo.value" title="重做 (Ctrl+Shift+Z)" @click="store.redo()">
            <Redo2 :size="14" />
          </button>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <span class="grp" role="group" aria-label="自动排布">
          <button class="wide" title="聚拢空洞（可撤销）" @click="store.tidy()"><Sparkles :size="14" /> 整理</button>
          <button
            class="wide"
            :disabled="view !== 'workbench'"
            :title="view === 'workbench' ? '收紧 + 整理，一步铺紧（可分步撤销）' : onlyWorkbench"
            @click="compact()"
          >
            <Wand2 :size="14" /> 紧凑
          </button>
          <button
            class="wide"
            :disabled="view !== 'workbench'"
            :title="view === 'workbench' ? '按内容收紧卡片高度（可撤销）' : onlyWorkbench"
            @click="fitContent()"
          >
            <Minimize2 :size="14" /> 收紧
          </button>
          <button class="wide" title="按原比例把每行铺满（可撤销）" @click="store.spread()"><Maximize2 :size="14" /> 撑满</button>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <span class="grp" role="group" aria-label="版面与设置">
          <button class="wide danger" title="用推荐版面替换当前版面（会先确认）" @click="confirmStarter = true">
            <LayoutTemplate :size="14" /> 推荐布局
          </button>
          <button class="wide" title="外观设置" @click="settingsOpen = true"><Settings :size="14" /> 外观</button>
        </span>
      </div>
    </header>

    <main ref="stageEl" class="stage">
      <p v-if="storage.error.value" class="storage-error" role="alert">
        <TriangleAlert :size="14" /> {{ storage.error.value }}
      </p>
      <template v-if="view === 'workbench'">
        <p v-if="projection.collapsed.length" class="collapsed muted">
          当前宽度放不下：{{ projection.collapsed.map((c) => c.id).join('、') }}
        </p>
        <GridLayout :rects="projection.rects" :cols="cols" :row-px="rowPx" :gap="gap" />
        <p v-if="!projection.rects.length" class="empty muted">版面是空的，去「布局编辑」拖几张卡进来。</p>
      </template>

      <CanvasEditor v-else-if="mode === 'canvas'">
        <template #default="{ item }">
          <component :is="CARD_COMPONENTS[item.id]" :variant="item.variant" :module-id="item.id" :chromeless="true" />
        </template>
      </CanvasEditor>
      <StackEditor v-else />
    </main>
    </div>

    <div v-if="confirmStarter" class="scrim" @click.self="confirmStarter = false">
      <div class="confirm" role="dialog" aria-modal="true" aria-labelledby="starter-title">
        <h2 id="starter-title">载入推荐布局？</h2>
        <p>当前版面会被整体替换成推荐版面，并立刻写进存档。这一步可以撤销（Ctrl+Z）。</p>
        <div class="confirm-actions">
          <button ref="starterCancel" @click="confirmStarter = false">取消</button>
          <button class="primary" @click="applyStarter()">载入推荐布局</button>
        </div>
      </div>
    </div>

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
/* 簇与簇之间用发丝线分开，而不是靠加大间距 —— 间距再大也分不出「这几枚是同一件事」 */
.sep {
  width: 1px;
  align-self: stretch;
  min-height: 20px;
  margin: 0 var(--space-1);
  background: var(--border-soft);
}
.grp {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.tools button.danger {
  border-color: color-mix(in oklab, var(--c-red) 45%, transparent);
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: color-mix(in oklab, #000 45%, transparent);
}
.confirm {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: min(380px, calc(100vw - var(--space-4) * 2));
  padding: var(--space-4);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.confirm h2 {
  margin: 0;
  font-size: 15px;
}
.confirm p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.confirm-actions button {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  padding: var(--space-1) var(--space-3);
  font-size: 13px;
}
.confirm-actions .primary {
  border-color: transparent;
  background: var(--brand-500);
  color: #fff;
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
  /* 固定行高模型：版面超出视口时由这里承接滚动，不再拉伸行去填满屏幕 */
  overflow-y: auto;
  padding-right: var(--space-1);
}
.collapsed {
  margin: 0 0 var(--space-2);
  font-size: 12px;
}
.storage-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in oklab, var(--c-red) 45%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--c-red) 10%, var(--bg-card));
  color: var(--text-1);
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
