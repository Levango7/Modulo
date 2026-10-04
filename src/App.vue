<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { LayoutGrid, LayoutTemplate, Maximize2, Minimize2, Plus, Redo2, Settings, SlidersHorizontal, Sparkles, TriangleAlert, Undo2, Wand2 } from 'lucide-vue-next'
import { useElementWidth } from './vue/useElementWidth'
import { useProjection } from './vue/useProjection'
import { measureWantedRows } from './vue/useDensity'
import * as E from '@modulo/engine'
import type { LayoutStore } from './vue/store'
import type { PersistentStorage } from './vue/fileStorage'
import type { CardDataApi } from './vue/cardData'
import { CARD_COMPONENTS } from './vue/cardComponents'
import { useAppearance } from './vue/useAppearance'
import { useBackup } from './vue/useBackup'
import { useSchemes } from './vue/useSchemes'
import { isDesktop, useShell } from './vue/useShell'
import GridLayout from './vue/components/GridLayout.vue'
import CanvasEditor from './vue/components/CanvasEditor.vue'
import StackEditor from './vue/components/StackEditor.vue'
import SettingsPanel from './vue/components/SettingsPanel.vue'
import TemplatePicker from './vue/components/TemplatePicker.vue'
import TitleBar from './vue/components/TitleBar.vue'
import BrandMark from './vue/components/BrandMark.vue'

const storage = inject<PersistentStorage>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
const reg = store.reg
const appearance = useAppearance(storage)
provide('appearance', appearance)
const schemes = useSchemes(store, storage)
provide('schemes', schemes)
/** 完整备份（含卡片内容）：拼包在 backup.ts，这里只挂上胶水 */
provide('backup', useBackup(store, schemes, () => cardDataApi.state))
provide('shell', useShell(storage))

const view = ref<'workbench' | 'edit'>('workbench')
const settingsOpen = ref(false)
/**
 * 版面模板选择器。它会整体替换版面，但**不再单独加一层确认框** ——
 * 选择器本身就是"看着图挑一个"的界面，卡片上画的就是会换成什么样，
 * 而且换完在同一个弹层里就能再点一张、或 Ctrl+Z 退回。确认框在这里只是多一步。
 */
const templatesOpen = ref(false)
/**
 * 「添加卡片」：把还没在版面上的模块加到第一个空位。
 *
 * 为什么需要这个入口：8 张模板管的是"起点"，而"起点之后想让版面上多一张卡"这件事，
 * 这个应用此前**没有任何入口**（`store.add` 一直没有调用方）。天气卡是第一位受益者。
 * 只列缺的那些，是因为数据模型就是单实例（`sanitizeItems` 会把重复模块去重）。
 */
const addOpen = ref(false)
const addWrap = ref<HTMLElement | null>(null)
const missingModules = computed(() => reg.filter((m) => !store.doc.value.items.some((i) => i.id === m.id)))
/** 菜单按分组渲染（19 种卡已经翻不动平铺列表了，目录里还有 20 张等着进来）。
 * 用普通数组而不是 Map：v-for 对 Map 的 (value, key) 顺序在不同版本里出过歧义，
 * 数组没有这个问题 —— 分组头直接读 `name`。 */
const missingByGroup = computed(() => {
  const groups: { name: string; cards: { id: string; title: string; blurb?: string }[] }[] = []
  for (const m of missingModules.value) {
    const name = m.group ?? '其他'
    let g = groups.find((x) => x.name === name)
    if (!g) {
      g = { name, cards: [] }
      groups.push(g)
    }
    g.cards.push(m)
  }
  return groups
})

function addCard(id: string): void {
  addOpen.value = false
  store.add(id, 0, 0)
}

function onDocMousedown(e: MouseEvent): void {
  if (addOpen.value && addWrap.value && !addWrap.value.contains(e.target as Node)) addOpen.value = false
}
const stageEl = ref<HTMLElement | null>(null)
const stageW = useElementWidth(stageEl, 1200)
const { cols, rowPx, gap, projection, mode } = useProjection(store, stageW)

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('mousedown', onDocMousedown)
  /** 首启（没有存档、也没挑过模板）自动开一次选择器 —— 这正是"选项"该出现的地方 */
  if (store.firstRun) templatesOpen.value = true
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('mousedown', onDocMousedown)
})

function fitContent() {
  store.fitToContent(measureWantedRows(stageEl.value?.querySelector<HTMLElement>('.grid') ?? null))
}

/** 组合动作：先按内容收紧、再聚拢空行。仍是两步历史，撤销可以分别退回 */
function compact() {
  fitContent()
  store.tidy()
}

/** 选择器里点「自己去编辑器排」：关掉弹层直接进编辑器，不用先挑一张 */
function pickAndEdit() {
  closeTemplates()
  view.value = 'edit'
}

/**
 * 关掉就等于"这次先不挑"：记下选择，下次启动不再拦。
 * 拦两次就成了骚扰 —— 但一次都不拦，新用户就看不到这些排法。
 */
function closeTemplates() {
  templatesOpen.value = false
  if (!store.templateId.value) store.setTemplateChoice(E.DEFAULT_TEMPLATE_ID)
}

/** 收紧/紧凑要读真实渲染出来的卡片高度，编辑器里没有那张 .grid，所以只能在工作台用 */
const onlyWorkbench = '回「工作台」可用：这一步要按真实渲染的卡片高度测量'

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null
  if (!n?.tagName) return false
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable
}

/** 撤销/重做是全局能力：整理、换模板这类动作也可能在工作台上做，不能只在编辑器里可撤销 */
function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    /** 弹层叠着时 Esc 只关最上面那层：先添加菜单，再模板选择器，再设置页 */
    if (addOpen.value) addOpen.value = false
    else if (templatesOpen.value) closeTemplates()
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
          <span ref="addWrap" class="add-wrap">
            <button
              class="wide"
              :disabled="!missingModules.length"
              :title="missingModules.length ? '把还没在版面上的卡片加进来（可 Ctrl+Z 退回）' : '所有卡片都已在版面上'"
              aria-haspopup="menu"
              :aria-expanded="addOpen"
              @click="addOpen = !addOpen"
            >
              <Plus :size="14" /> 添加卡片
            </button>
            <div v-if="addOpen" class="add-menu" role="menu" aria-label="可添加的卡片">
              <template v-for="g in missingByGroup" :key="g.name">
                <div class="gh" role="presentation">{{ g.name }}</div>
                <button v-for="m in g.cards" :key="m.id" role="menuitem" @click="addCard(m.id)">
                  <span class="t">{{ m.title }}</span>
                  <span class="v">{{ m.blurb }}</span>
                </button>
              </template>
            </div>
          </span>
          <button class="wide" title="挑一种排法：点一张卡片就换成那个版面（可 Ctrl+Z 退回）" @click="templatesOpen = true">
            <LayoutTemplate :size="14" /> 版面模板
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

    <TemplatePicker v-if="templatesOpen" @close="closeTemplates" @edit="pickAndEdit" />

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
.add-wrap {
  position: relative;
  display: inline-flex;
}
.add-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-menu);
  min-width: 208px;
  max-width: 260px;
  padding: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hover);
}
.add-menu .gh {
  font-size: 10px;
  color: var(--text-4);
  padding: var(--space-1) var(--space-2) 0;
}
.add-menu [role='menuitem'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.add-menu [role='menuitem']:hover,
.add-menu [role='menuitem']:focus-visible {
  background: var(--bg-card-soft);
}
.add-menu .t {
  font-size: 13px;
  color: var(--text-1);
}
.add-menu .v {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-3);
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
