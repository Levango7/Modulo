<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { LayoutGrid, LayoutTemplate, Redo2, Settings, SlidersHorizontal, TriangleAlert, Undo2, Wand2, Check, ChevronDown, X } from 'lucide-vue-next'
import { useElementSize } from './vue/useElementSize'
import { useProjection } from './vue/useProjection'
import { measureWantedRows } from './vue/useDensity'
import * as E from '@levango7/engine'
import type { LayoutStore } from './vue/store'
import type { PersistentStorage } from './vue/fileStorage'
import type { CardDataApi } from './vue/cardData'
import type { ContentHistoryApi } from './vue/contentHistory'
import { CARD_COMPONENTS } from './vue/cardComponents'
import { useAppearance } from './vue/useAppearance'
import { useBackup } from './vue/useBackup'
import { useSchemes } from './vue/useSchemes'
import { isDesktop, useShell } from './vue/useShell'
import { useDetached } from './vue/useDetached'
import CommandPalette from './vue/components/CommandPalette.vue'
import { createCommandBus, type CommandBus } from './vue/commandBus'
import type { CommandContext } from './vue/commands'
import { floatCard, floatingSupported, unfloatCard } from './float/api'
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
const contentHistory = inject<ContentHistoryApi>('contentHistory')!
const appearance = useAppearance(storage)
provide('appearance', appearance)
const schemes = useSchemes(store, storage)
provide('schemes', schemes)
/** 完整备份（含卡片内容）：拼包在 backup.ts，这里只挂上胶水 */
const backup = useBackup(store, schemes, () => cardDataApi.state, {
  storage,
  // 备份里的设置段只收"恢复后应该长得一样"的非敏感项：外观 + 上次选的模板。
  // 全局快捷键不在里面（要在 Rust 侧重新注册，写进去不等于生效）。
  settings: {
    get: () => ({
      appearance: JSON.parse(JSON.stringify(appearance.state.value)) as Record<string, unknown>,
      template: store.templateId.value,
    }),
    apply: (s) => {
      if (s.appearance) appearance.set(s.appearance as unknown as Parameters<typeof appearance.set>[0])
      if (typeof s.template === 'string') store.setTemplateChoice(s.template)
    },
  },
})
provide('backup', backup)
provide('shell', useShell(storage))

const view = ref<'workbench' | 'edit'>('workbench')

/**
 * 撤销/重做的路由（2026-10-20）。版面与内容各有一份历史：
 *  - 编辑态：只在改版面 ⇒ 永远撤版面（与之前行为一致）；
 *  - 工作台态：谁更近撤谁（内容改动通常更近），平手时内容优先；选中的那边没得撤就退到另一边。
 * 两个栈不合并时间线 —— 只比"最近一次改动"，比共享一条历史容易解释得多。
 */
const lastUndoKind = ref<'layout' | 'content'>('layout')
const canUndoAny = computed(() => store.canUndo.value || contentHistory.canUndo.value)
const canRedoAny = computed(() => store.canRedo.value || contentHistory.canRedo.value)
function undoLatest(): void {
  if (view.value === 'edit') {
    store.undo()
    lastUndoKind.value = 'layout'
    return
  }
  const preferContent = contentHistory.lastAt.value >= store.lastAt.value
  const order: ('content' | 'layout')[] = preferContent ? ['content', 'layout'] : ['layout', 'content']
  for (const kind of order) {
    if (kind === 'content') {
      if (contentHistory.undo()) {
        lastUndoKind.value = 'content'
        return
      }
    } else if (store.canUndo.value) {
      store.undo()
      lastUndoKind.value = 'layout'
      return
    }
  }
}
function redoLatest(): void {
  if (view.value === 'edit') {
    store.redo()
    lastUndoKind.value = 'layout'
    return
  }
  const preferContent = lastUndoKind.value === 'content'
  const order: ('content' | 'layout')[] = preferContent ? ['content', 'layout'] : ['layout', 'content']
  for (const kind of order) {
    if (kind === 'content') {
      if (contentHistory.canRedo.value) {
        contentHistory.redo()
        lastUndoKind.value = 'content'
        return
      }
    } else if (store.canRedo.value) {
      store.redo()
      lastUndoKind.value = 'layout'
      return
    }
  }
}
const settingsOpen = ref(false)
/**
 * 编辑器事务（2026-10-12 用户口径：「工作台=用+微调，布局编辑=增删改」）。
 *
 * 进编辑器拍一张快照；「保存」= 确认改动并退出；「取消」= 有改动先问一句、确认才还原。
 * 编辑期间 Ctrl+Z 照常可用（历史是全局的），取消只是往历史里再压一步 —— `store.restore`
 * 复用 `apply`，所以"取消"本身也能被撤销（不会把历史撕开一个洞）。
 * 点「工作台」tab 与 Esc 都走同一条取消路径 —— 否则事务会被 tab 切换绕开。
 */
const editSnapshot = ref<E.LayoutDoc | null>(null)
const cancelAskOpen = ref(false)
const editDirty = computed(
  () => editSnapshot.value !== null && JSON.stringify(store.doc.value) !== JSON.stringify(editSnapshot.value),
)
/**
 * 「N 处改动」：按**版面差异**数（卡片增删改 + 行的增删改），不是按历史步数 ——
 * 拖一步再拖回来在历史上是两步、在版面差异上却是 0 处，而用户看的是版面。
 */
const editChangeCount = computed(() => {
  const a = editSnapshot.value
  if (!a) return 0
  const b = store.doc.value
  let n = 0
  const am = new Map(a.items.map((p) => [p.id, p]))
  const bm = new Map(b.items.map((p) => [p.id, p]))
  for (const [id, p] of bm) if (!am.has(id) || JSON.stringify(am.get(id)) !== JSON.stringify(p)) n++
  for (const id of am.keys()) if (!bm.has(id)) n++
  const ar = new Map((a.rows ?? []).map((r) => [r.id, r]))
  const br = new Map((b.rows ?? []).map((r) => [r.id, r]))
  for (const [id, r] of br) if (!ar.has(id) || JSON.stringify(ar.get(id)) !== JSON.stringify(r)) n++
  for (const id of ar.keys()) if (!br.has(id)) n++
  return n
})

function enterEdit(): void {
  if (view.value === 'edit') return
  editSnapshot.value = store.doc.value
  view.value = 'edit'
}
/** 保存 = 确认改动并退出（刷新一次基线，万一还留在编辑态也不重复确认） */
function saveEdit(): void {
  editSnapshot.value = store.doc.value
  view.value = 'workbench'
}
function cancelEdit(): void {
  if (!editDirty.value) {
    editSnapshot.value = null
    view.value = 'workbench'
    return
  }
  cancelAskOpen.value = true
}
function confirmCancelEdit(): void {
  if (editSnapshot.value) store.restore(editSnapshot.value)
  cancelAskOpen.value = false
  editSnapshot.value = null
  view.value = 'workbench'
}
function dismissCancelAsk(): void {
  cancelAskOpen.value = false
}
/**
 * 版面模板选择器。它会整体替换版面，但**不再单独加一层确认框** ——
 * 选择器本身就是"看着图挑一个"的界面，卡片上画的就是会换成什么样，
 * 而且换完在同一个弹层里就能再点一张、或 Ctrl+Z 退回。确认框在这里只是多一步。
 * 编辑中换模板 = 重建编辑基线（新快照），取消只退回到那次换模板之后。
 */
const templatesOpen = ref(false)
/**
 * 「排布」下拉：把整理 / 紧凑 / 收紧 / 撑满 四个语义重叠的动作收在一起。
 * 选完就关（外部点击 + Esc 关闭）。
 * 注：「添加卡片」菜单原在这个分组里，2026-10-12 已按用户口径搬进编辑器模块库
 * （组件 `CardCatalogMenu.vue`）。
 */
const arrangeOpen = ref(false)
const arrangeWrap = ref<HTMLElement | null>(null)
function runArrange(fn: () => void): void {
  arrangeOpen.value = false
  fn()
}

function onDocMousedown(e: MouseEvent): void {
  if (arrangeOpen.value && arrangeWrap.value && !arrangeWrap.value.contains(e.target as Node)) arrangeOpen.value = false
}
const stageEl = ref<HTMLElement | null>(null)
/** 编辑器实例：Esc 编排要问它"这层还有没有可退的"（选中/批量条/目录下拉） */
const editorRef = ref<InstanceType<typeof CanvasEditor> | null>(null)
/** 宽给 1200 / 高给 0：挂载前算出的列数与行高与改动前完全一致，尺寸到位后才有一次抬升 */
const { width: stageW, height: stageH } = useElementSize(stageEl, 1200, 0)
/** 脱离浮窗的卡不参与工作台投影（文档不动，回工作台时原样复位） */
const { detached } = useDetached()
const { cols, rowPx, gap, projection, mode } = useProjection(store, stageW, stageH, detached)

/**
 * 把卡片脱离成桌面浮窗（2026-10-13 第一批，参考 x-hub 的脱离机制）。
 * 首次脱离的窗口尺寸取该卡在**当前形态下的理想格数**换算成像素（与浏览态同口径），
 * 之后由用户拖出来/缩出来的几何记忆在 Rust 侧。网页版隐藏入口。
 */
function detachCard(id: string): void {
  const p = store.doc.value.items.find((q) => q.id === id)
  const mod = store.reg.find((m) => m.id === id)
  const v = mod?.variants.find((x) => x.id === (p?.variant ?? mod?.defaultVariant)) ?? mod?.variants[0]
  // 列宽与浏览态同口径：12 列等分舞台宽、列间 gap 从总宽里先扣掉
  const colW = Math.max(40, (stageW.value - gap * (cols.value - 1)) / cols.value)
  const w = (v?.idealW ?? 4) * (colW + gap) - gap
  const h = (v?.idealH ?? 3) * (rowPx.value + gap)
  void floatCard(id, Math.round(Math.max(240, w)), Math.round(Math.max(160, h)) + 24)
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('mousedown', onDocMousedown)
  /** 首启（没有存档、也没挑过模板）自动开一次选择器 —— 这正是"选项"该出现的地方 */
  if (store.firstRun) templatesOpen.value = true
  /** 自动备份：没有基线就建一份；版本变过或距上一份超过 24h 也各留一份（只桌面） */
  backup.initAutoBackup()
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
  enterEdit()
}

/**
 * 关掉就等于"这次先不挑"：记下选择，下次启动不再拦。
 * 拦两次就成了骚扰 —— 但一次都不拦，新用户就看不到这些排法。
 */
function closeTemplates() {
  templatesOpen.value = false
  if (!store.templateId.value) store.setTemplateChoice(E.DEFAULT_TEMPLATE_ID)
}

/**
 * 命令总线（2026-10-13 批 2）：入口只发命令，执行只有一条路。
 * 上下文里的界面钩子都指向本组件已有的函数 —— 命令表不知道"界面长什么样"，
 * 只知道"有个动作叫切到工作台"（要 UI 的分支在这里收口）。
 */
const paletteOpen = ref(false)
/** 编辑器选中集（经 CanvasEditor 广播同步；工作台为空集） */
const selection = ref<ReadonlySet<string>>(new Set())
/** 焦点所在的卡（键盘单格操作的目标；命令的 targetCard 用） */
const focusedCard = ref<string | null>(null)
const cmdCtx: CommandContext = {
  store,
  view,
  selection,
  focusedCard,
  editDirty,
  detached,
  floatingSupported: floatingSupported(),
  stageW,
  cols,
  gap,
  rowPx,
  detach: (id) => detachCard(id),
  unfloat: (id) => void unfloatCard(id),
  openUI: (name) => {
    if (name === 'palette') paletteOpen.value = true
    else if (name === 'settings') settingsOpen.value = true
    else if (name === 'templates') templatesOpen.value = true
    else if (name === 'workbench' && view.value === 'edit') cancelEdit()
    else if (name === 'edit') enterEdit()
  },
}
const commandBus: CommandBus = createCommandBus(cmdCtx)
provide('commandBus', commandBus)

/** 宿主拦截项：这些命令的实现在本组件（要编辑基线/要真实渲染高度），文案与可用性仍在命令表里 */
commandBus.registerIntercept('edit.save', () => saveEdit())
commandBus.registerIntercept('layout.fit', () => runArrange(fitContent))
commandBus.registerIntercept('layout.compact', () => runArrange(compact))
commandBus.registerIntercept('view.edit', () => enterEdit())
commandBus.registerIntercept('view.workbench', () => {
  if (view.value === 'edit') cancelEdit()
})

/** 面板里"跳到某张卡"：切到布局编辑并交给编辑器选中+滚动到视野 */
function goCard(id: string): void {
  enterEdit()
  void nextTick(() => editorRef.value?.revealCard(id))
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
    /** Esc 从最上面一层往下走：先关命令面板与确认框，再交编辑器自退（选中/批量条/目录下拉），
     *  然后才是"取消这次编辑"，最后是各弹层。编辑器先吃 —— 它手里有比"取消整场编辑"
     *  更局部的"退一步"（清选中），否则选了卡按 Esc 会直接弹放弃确认。 */
    if (paletteOpen.value) paletteOpen.value = false
    else if (cancelAskOpen.value) cancelAskOpen.value = false
    else if (editorRef.value?.escapePressed()) {
      /* 编辑器消费掉了（清选中/关目录下拉） */
    } else if (view.value === 'edit') cancelEdit()
    else if (arrangeOpen.value) arrangeOpen.value = false
    else if (templatesOpen.value) closeTemplates()
    else if (settingsOpen.value) settingsOpen.value = false
  }
  // Ctrl+K 是全局键：即使在输入框里也生效（这是"任何地方唤出"的语义）
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = true
    return
  }
  if (isEditable(e.target)) return
  const k = e.key.toLowerCase()
  // 撤销/重做也并入总线（可用性谓词与面板同源：面板里灰着的时候，键也按不动）
  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault()
    if (e.shiftKey) redoLatest()
    else undoLatest()
  } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
    e.preventDefault()
    redoLatest()
  }
}
</script>

<template>
  <div class="app">
    <TitleBar v-if="isDesktop" />
    <div class="shell">
    <header class="bar">
      <span class="brand"><BrandMark :size="20" /><span class="brand-name">Modulo</span></span>
      <nav class="seg">
        <button :data-active="view === 'workbench'" title="看版面、做点微调（增删改在「布局编辑」）" @click="view === 'edit' ? cancelEdit() : (view = 'workbench')">
          <LayoutGrid :size="14" /> 工作台
        </button>
        <button :data-active="view === 'edit'" title="增删改卡片：改完「保存」生效，或「取消」全部还原" @click="enterEdit">
          <SlidersHorizontal :size="14" /> 布局编辑
        </button>
      </nav>
      <div class="tools">
        <span class="pill muted metric">{{ stageW }}px · {{ cols }} 列 · {{ mode === 'canvas' ? '画布' : '堆叠' }}</span>
        <span class="sep" aria-hidden="true"></span>
        <!-- 编辑事务（2026-10-12）：编辑态给「取消 / 保存」；改动数只在真正改过时才出现 -->
        <span v-if="view === 'edit'" class="grp edit-tx" role="group" aria-label="编辑事务">
          <button class="wide" title="全部还原到进编辑器之前（有改动会先问一句；Esc 同效）" @click="cancelEdit">
            <X :size="14" /> <span class="label">取消</span>
          </button>
          <button class="wide primary" :title="editDirty ? '确认这次编辑' : '没有改动'" @click="saveEdit">
            <Check :size="14" /> <span class="label">保存</span>
            <span v-if="editDirty" class="tx-count">{{ editChangeCount }}</span>
          </button>
          <span class="sep" aria-hidden="true"></span>
        </span>
        <span class="grp" role="group" aria-label="历史">
          <button class="icon" :disabled="!canUndoAny" title="撤销上一步 (Ctrl+Z)" @click="undoLatest()">
            <Undo2 :size="14" />
          </button>
          <button class="icon" :disabled="!canRedoAny" title="重做 (Ctrl+Shift+Z)" @click="redoLatest()">
            <Redo2 :size="14" />
          </button>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <!-- 「整理/紧凑/收紧/撑满」四个动作语义高度重叠，平铺时只能靠 title 区分 ——
             这是顶栏最乱的一处。收进下拉后每项都有一整行说明，反而比四个按钮更分得清。 -->
        <span ref="arrangeWrap" class="add-wrap">
          <button
            class="wide"
            aria-haspopup="menu"
            :aria-expanded="arrangeOpen"
            title="重排版面"
            @click="arrangeOpen = !arrangeOpen"
          >
            <Wand2 :size="14" /> <span class="label">排布</span>
            <ChevronDown :size="12" class="caret" :class="{ up: arrangeOpen }" />
          </button>
          <div v-if="arrangeOpen" class="add-menu arrange-menu" role="menu" aria-label="重排版面">
            <button
              role="menuitem"
              :disabled="!store.canUndo.value && false"
              title="聚拢空洞（可撤销）"
              @click="runArrange(store.tidy)"
            >
              <span class="t">整理</span>
              <span class="v">把散开的卡片聚拢，填掉空洞</span>
            </button>
            <button
              role="menuitem"
              :disabled="view !== 'workbench'"
              :title="view === 'workbench' ? '收紧 + 整理，一步铺紧（可分步撤销）' : onlyWorkbench"
              @click="runArrange(compact)"
            >
              <span class="t">紧凑</span>
              <span class="v">收紧 + 整理，一步铺紧{{ view === 'workbench' ? '' : '（仅工作台）' }}</span>
            </button>
            <button
              role="menuitem"
              :disabled="view !== 'workbench'"
              :title="view === 'workbench' ? '按内容收紧卡片高度（可撤销）' : onlyWorkbench"
              @click="runArrange(fitContent)"
            >
              <span class="t">收紧</span>
              <span class="v">按内容收紧每张卡的高度{{ view === 'workbench' ? '' : '（仅工作台）' }}</span>
            </button>
            <button role="menuitem" title="按原比例把每行铺满（可撤销）" @click="runArrange(store.spread)">
              <span class="t">撑满</span>
              <span class="v">按原比例把每行铺满，不留右侧空档</span>
            </button>
            <button
              role="menuitem"
              :disabled="!store.doc.value.rows?.length"
              :title="store.doc.value.rows?.length ? '各行按自己存的参数重排一遍（可撤销）' : '版面上还没有行'"
              @click="runArrange(store.reflowAllRows)"
            >
              <span class="t">行重排</span>
              <span class="v">各行按存的参数自动重排{{ store.doc.value.rows?.length ? '' : '（还没有行）' }}</span>
            </button>
          </div>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <span class="grp" role="group" aria-label="版面与设置">
          <button class="wide" title="挑一种排法：点一张卡片就换成那个版面（可 Ctrl+Z 退回）" @click="templatesOpen = true">
            <LayoutTemplate :size="14" /> <span class="label">版面模板</span>
          </button>
          <button class="wide" title="外观设置" @click="settingsOpen = true"><Settings :size="14" /> <span class="label">外观</span></button>
        </span>
      </div>
    </header>

    <main ref="stageEl" class="stage">
      <p v-if="storage.error.value" class="storage-error" role="alert">
        <TriangleAlert :size="14" /> <span class="txt">{{ storage.error.value }}</span>
        <!-- 失败时的救命入口：当前状态只在内存里，先下载一份完整备份再谈别的。
             判据用「只在内存里」这句 —— 桌面壳与网页版的写失败文案都带它，读失败没有。
             网页版此前连这条红条都不会出现（见 fileStorage.webStorage 的注释）。 -->
        <button v-if="storage.error.value.includes('只在内存里')" class="rescue" @click="backup.exportBackup()">
          立刻下载备份
        </button>
      </p>
      <template v-if="view === 'workbench'">
        <p v-if="projection.collapsed.length" class="collapsed muted">
          当前宽度放不下：{{ projection.collapsed.map((c) => c.id).join('、') }}
        </p>
        <GridLayout
          :rects="projection.rects"
          :cols="cols"
          :row-px="rowPx"
          :gap="gap"
          :can-detach="floatingSupported()"
          @detach="detachCard"
        />
        <p v-if="!projection.rects.length" class="empty muted">版面是空的，去「布局编辑」拖几张卡进来。</p>
      </template>

      <CanvasEditor
        v-else-if="mode === 'canvas'"
        ref="editorRef"
        :row-px="rowPx"
        @selection-change="(ids: string[]) => (selection = new Set(ids))"
        @focus-change="(id: string | null) => (focusedCard = id)"
      >
        <template #default="{ item }">
          <component :is="CARD_COMPONENTS[E.moduleIdOf(item)]" :variant="item.variant" :module-id="E.moduleIdOf(item)" :chromeless="true" />
        </template>
      </CanvasEditor>
      <StackEditor v-else />
    </main>
    </div>

    <!-- 「取消」确认：有改动才弹。不是 window.confirm —— 原生弹窗在 Tauri 里样式跟不上，
         而且它不能被 Esc/外点关闭的统一逻辑收编 -->
    <div v-if="cancelAskOpen" class="tx-scrim" role="dialog" aria-modal="true" aria-label="放弃这次编辑" @click.self="dismissCancelAsk">
      <div class="tx-dialog">
        <h4>放弃这次编辑？</h4>
        <p class="muted">版面有 {{ editChangeCount }} 处改动，取消后全部还原到进编辑器之前（还原本身也能 Ctrl+Z 找回）。</p>
        <div class="tx-actions">
          <button class="wide" @click="dismissCancelAsk">继续编辑</button>
          <button class="wide danger" @click="confirmCancelEdit">放弃改动</button>
        </div>
      </div>
    </div>

    <CommandPalette v-if="paletteOpen" :ctx="cmdCtx" @close="paletteOpen = false" @go-card="goCard" />

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
/* 顶栏元素统一 28px 高。改之前是三种：撤销/重做 24（纯图标没文字撑）、
   视图切换 28、工具按钮 30 —— 同一行里三个高度，是"乱"最直接的来源。
   用固定 height 而不是 min-height：内容（13px 文字 × 1.55 行高 + 上下 padding + 边框）
   本来就有 30px，min-height 压不住。
   排除 [role='menuitem']：下拉菜单项也在 .bar 里，但它们是两行文字，28px 会把行挤在一起。 */
.bar button:not([role='menuitem']) {
  height: 28px;
  padding-block: 0;
}
/* 纯图标按钮补成 28×28 正方形，否则比带文字的矮一截 */
.tools button.icon {
  width: 28px;
  padding: 0;
  justify-content: center;
}
/* 主 CTA 用"描边 + 淡底"而不是实心：实心是 .seg 选中态的专属语言（tokens.css），
   两个都实心就分不清"当前在哪"和"主要动作"了 */
.tools button.primary {
  background: var(--brand-50);
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 600;
}
.tools button.primary:hover {
  background: color-mix(in oklab, var(--brand-500) 18%, var(--bg-card));
}
.tools button.primary:disabled {
  background: var(--bg-card);
  border-color: var(--border-strong);
  color: var(--text-3);
  font-weight: 400;
}
.caret {
  transition: transform var(--dur-micro) var(--ease-out);
}
.caret.up {
  transform: rotate(180deg);
}
/* 编辑事务（2026-10-12）：改动计数徽标 + 取消确认框 */
.tx-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--brand-500);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tx-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  background: var(--scrim);
}
.tx-dialog {
  width: min(380px, calc(100vw - 48px));
  padding: var(--space-5);
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
}
.tx-dialog h4 {
  margin: 0 0 var(--space-2);
  font-size: 15px;
}
.tx-dialog p {
  margin: 0 0 var(--space-4);
  font-size: 13px;
  line-height: 1.6;
}
.tx-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.tx-actions button.wide {
  height: 28px;
}
/* 放弃类是破坏性动作：hover 用危险色的淡底，不用品牌色 */
.tx-actions button.danger {
  border-color: var(--c-red);
  color: var(--c-red);
}
.tx-actions button.danger:hover {
  background: color-mix(in oklab, var(--c-red) 12%, var(--bg-card));
}
/* 排布下拉比添加菜单宽一点：四项说明文字都比卡片名长 */
.arrange-menu {
  min-width: 248px;
}
.arrange-menu [role='menuitem']:disabled {
  opacity: 0.45;
  cursor: default;
}
.arrange-menu [role='menuitem']:disabled:hover {
  background: transparent;
}
/* ---- 窄屏降级 ----
   断点不是随手挑的，是对齐引擎 `packages/engine/src/breakpoints.ts` 的容器断点：
     引擎容器 1200 / 960 / 720 / 480 → 12 / 8 / 6 / 4 列
   容器宽 = 视口 − shell 内边距（16×2 = 32px），所以换算到视口是：
     992（容器 960，12→8 列）、752（容器 720，8→6 列）、512（容器 480，6→4 列）
   顶栏跟着同一套走，卡片降档和顶栏收起才会发生在同一刻，而不是各降各的。
   这套值也和业界对齐：Ant Design 官方断点是 480/576/768/992/1200/1600，
   Semi Design 栅格是 <576/≥575/≥768/≥992/≥1200，两家在 768 与 992 上完全重合，
   而 992 恰好就是引擎 960 容器对应的视口。 */
@media (max-width: 992px) {
  .tools button .label {
    display: none;
  }
  .tools button.wide {
    padding: var(--space-1) var(--space-2);
  }
}
/* 更窄时连「排布」也收成图标，并让出状态条 ——
   它是"当前多少列"这类信息，不是操作，没资格在窄屏占掉一整行 */
@media (max-width: 752px) {
  .tools .pill {
    display: none;
  }
  .tools .label,
  .arrange-label {
    display: none;
  }
  .tools .sep {
    display: none;
  }
  /* 品牌名在最窄处也让位，logo 图标保留（BrandMark 本身是 svg，不在 .brand-name 里） */
  .brand .brand-name {
    display: none;
  }
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
  /* 菜单是压在任意内容上的浮层：卡片档半透明（亮彩皮肤 86%）会直接透字 ——
     用户实拍：待办清单从「整理/紧凑」菜单里透出来。换「实底」令牌 + 背景模糊，
     实测菜单空白列亮度波动 5 级 → 0 级、大块深色内容残留从 31 级降到 17 级。 */
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hover);
  /* 卡片从 10 张长到 41 张后菜单有 36 项：不限高就是 2264px，撑破 900px 视口，
     底部十几项要顶掉页面才够得着。限高 + 自身滚动，菜单才是一个菜单而不是一堵墙。 */
  max-height: min(70vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.add-menu .gh {
  font-size: 10px;
  color: var(--text-4);
  padding: var(--space-1) var(--space-2) 0;
  /* 分组头吸顶：滚到第二组时仍能看见「现在在哪一组」，这是长列表唯一的方位锚点 */
  position: sticky;
  top: calc(var(--space-1) * -1);
  z-index: 1;
  background: var(--bg-card-solid);
  margin: 0 calc(var(--space-1) * -1);
  padding: var(--space-2) var(--space-3) var(--space-1);
  /* 与菜单表面同档：不然滚动时吸顶头比菜单自己还透，滑过去的项会在标题下透出来 */
  backdrop-filter: blur(12px);
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
/* 菜单项按下要有实感：tokens.css 的 button:active 只缩 0.96，
   菜单是连续列表，缩放会让相邻项跳动，这里改成背景加深，更贴合「点中了」的直觉 */
.add-menu [role='menuitem']:active {
  background: var(--brand-50);
  transform: none;
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
/* 错误文案可以很长，让它占满中间、按钮靠右不被挤走 */
.storage-error .txt {
  flex: 1;
  min-width: 0;
}
.storage-error .rescue {
  flex: none;
  height: 24px;
  padding: 0 var(--space-3);
  border: 1px solid var(--c-red);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  color: var(--c-red);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.storage-error .rescue:hover {
  background: color-mix(in oklab, var(--c-red) 12%, var(--bg-card));
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
</style>
