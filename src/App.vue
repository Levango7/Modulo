<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useElementSize } from './vue/useElementSize'
import { useProjection } from './vue/useProjection'
import { measureWantedRows } from './vue/useDensity'
import { useUndoRedo } from './vue/useUndoRedo'
import { detachGeometry, resolveDetachVariant } from './vue/stageGeometry'
import { useEditTransaction } from './vue/useEditTransaction'
import { useAppCommands } from './vue/useAppCommands'
import { useGlobalKeys } from './vue/useGlobalKeys'
import { arrangeRunner, type ArrangeAction } from './vue/arrangeActions'
import { insideAddWrap } from './vue/outsideClick'
import { makeOpenUI } from './vue/openUI'
import * as E from '@levango7/engine'
import type { LayoutStore } from './vue/store'
import type { PersistentStorage } from './vue/fileStorage'
import type { CardDataApi } from './vue/cardData'
import type { ContentHistoryApi } from './vue/contentHistory'
import { CARD_COMPONENTS } from './vue/cardComponents'
import { useAppearance } from './vue/useAppearance'
import { useBackup, applyParsedSections, APP_VERSION } from './vue/useBackup'
import { parseBackup, BACKUP_VERSION } from './vue/backup'
import { useSync, desktopTransport } from './vue/useSync'
import type { SyncStore } from './vue/syncStore'
import { useReminders } from './vue/useReminders'
import type { Reminder } from './vue/reminders'
import { sendSystemNotifications, shouldSendSystemNotification } from './vue/notify'
import { useSchemes } from './vue/useSchemes'
import { isDesktop, useShell } from './vue/useShell'
import { useDetached } from './vue/useDetached'
import CommandPalette from './vue/components/CommandPalette.vue'
import AppToolbar from './vue/components/AppToolbar.vue'
import NoticeStrip from './vue/components/NoticeStrip.vue'
import CancelEditDialog from './vue/components/CancelEditDialog.vue'
import { type CommandBus } from './vue/commandBus'
import type { CommandContext } from './vue/commands'
import { floatCard, floatingSupported, focusFloat, unfloatCard } from './float/api'
import { floatItems } from './vue/floatList'
import GridLayout from './vue/components/GridLayout.vue'
import CanvasEditor from './vue/components/CanvasEditor.vue'
import StackEditor from './vue/components/StackEditor.vue'
import SettingsPanel from './vue/components/SettingsPanel.vue'
import TemplatePicker from './vue/components/TemplatePicker.vue'
import TitleBar from './vue/components/TitleBar.vue'

const storage = inject<PersistentStorage>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
const contentHistory = inject<ContentHistoryApi>('contentHistory')!
const appearance = useAppearance(storage)
provide('appearance', appearance)
const schemes = useSchemes(store, storage)
provide('schemes', schemes)
/** 完整备份（含卡片内容）：拼包在 backup.ts，这里只挂上胶水 */
/** 备份与同步共用的「设置段」读写：两份功能都只认外观 + 上次选的模板这一口径 */
const backupSettings = {
  get: () => ({
    appearance: JSON.parse(JSON.stringify(appearance.state.value)) as Record<string, unknown>,
    template: store.templateId.value,
  }),
  apply: (s: { appearance?: Record<string, unknown>; template?: string | null }) => {
    if (s.appearance) appearance.set(s.appearance as unknown as Parameters<typeof appearance.set>[0])
    if (typeof s.template === 'string') store.setTemplateChoice(s.template)
  },
}
const backup = useBackup(store, schemes, () => cardDataApi.state, {
  storage,
  // 备份里的设置段只收"恢复后应该长得一样"的非敏感项：外观 + 上次选的模板。
  // 全局快捷键不在里面（要在 Rust 侧重新注册，写进去不等于生效）。
  settings: backupSettings,
})
provide('backup', backup)

/**
 * 多端同步（WebDAV）：裁决在引擎 `sync.ts`，传输在 Rust `webdav.rs`，这里只装线。
 * 拉下来的那几段**走备份的恢复管道**（`parseBackup` + `applyParsedSections`）——
 * 网盘上的文件同样是不可信输入，不该有第二条更宽松的落地路径。
 */
const syncStore = inject<SyncStore>('syncStore')!
const sync = useSync({
  store: syncStore,
  transport: isDesktop ? desktopTransport() : null,
  desktop: isDesktop,
  sections: () => ({
    layout: JSON.parse(JSON.stringify(store.doc.value)) as unknown,
    schemes: JSON.parse(JSON.stringify(schemes.book.value)) as unknown,
    cardData: JSON.parse(JSON.stringify(cardDataApi.state)) as unknown,
    settings: backupSettings.get(),
  }),
  applyRemote: (remote) => {
    const payload = { kind: 'modulo.backup', version: BACKUP_VERSION, app: APP_VERSION, ...remote }
    const parsed = parseBackup(JSON.stringify(payload), store.reg)
    if (parsed.kind !== 'backup') return { done: [], warnings: parsed.warnings }
    const done = applyParsedSections(parsed, {
      store,
      schemes,
      cardData: cardDataApi.state,
      settings: backupSettings,
    })
    return { done, warnings: parsed.warnings }
  },
})
provide('sync', sync)
// 自动同步的节拍挂在应用生命周期上，不跟设置面板走：关掉面板不等于关掉同步
onMounted(() => sync.startAuto())
onBeforeUnmount(() => sync.stopAuto())
provide('shell', useShell(storage))

/**
 * 提醒（P0-④ 阶段 1）：判定与去重在 `reminders.ts` / `useReminders.ts`，投递就在下面这个回调里 ——
 * 阶段 2 换成系统通知时只换这一处，判定一行不用动。
 * 应用内横幅只是"落地形态"：没有它，阶段 1 的规则表就是一段没人调用的代码。
 */
const reminderNotes = ref<Reminder[]>([])
/** 启动时数据迁移的结果（P0-⑤）：由 main.ts 在 store 读盘之前算出，这里只负责说一次 */
const migrationNotes = ref<string[]>([...inject<string[]>('migrationNotes', [])])
const reminders = useReminders(() => cardDataApi.state, {
  storage,
  deliver: (items) => {
    reminderNotes.value = [...reminderNotes.value, ...items]
    // 系统通知的总门抽成了 `shouldSendSystemNotification`（notify.ts）：桌面壳且开着才发。
    // 失败静默降级 —— 横幅已经在了，通知坏了不该让提醒本身也消失。
    // **Windows 上点击拿不到"点了哪一条"**：交互式 action 只有移动端有，所以这里没有深链，
    // 详见 vue/notify.ts 的文件头。
    if (shouldSendSystemNotification(isDesktop, reminders.state.settings.systemNotifications)) {
      void sendSystemNotifications(items)
    }
  },
})
provide('reminders', reminders)

const view = ref<'workbench' | 'edit'>('workbench')

/**
 * 撤销/重做（2026-10-20 起，2026-10-24 Cut B 抽成 `useUndoRedo.ts`）：版面与内容各有一份历史，
 *  - 编辑态：只在改版面 ⇒ 永远撤版面（与之前行为一致）；
 *  - 工作台态：谁更近撤谁（内容改动通常更近），平手时内容优先；选中的那边没得撤就退到另一边。
 * 两个栈不合并时间线 —— 只比"最近一次改动"，比共享一条历史容易解释得多。
 */
const { canUndoAny, canRedoAny, undoLatest, redoLatest } = useUndoRedo({
  layout: store,
  content: contentHistory,
  view,
})
const settingsOpen = ref(false)
/** 顶栏视图切换：edit 态点「工作台」走取消事务（与 Esc / tab 同一条路），否则直接切 */
function onSelectView(v: 'workbench' | 'edit'): void {
  if (v === 'workbench' && view.value === 'edit') cancelEdit()
  else view.value = v
}
/** 排布动作：顶栏只发命令名，执行体在这里按名字取（`arrangeActions.ts`），
 *  「选完就关」仍由 runArrange 收口 —— 与原模板逐字等价。 */
function onArrange(action: ArrangeAction): void {
  runArrange(
    arrangeRunner(action, {
      tidy: store.tidy,
      compact,
      fit: fitContent,
      spread: store.spread,
      reflow: store.reflowAllRows,
    }),
  )
}
/**
 * 编辑器事务（2026-10-12 用户口径：「工作台=用+微调，布局编辑=增删改」）——
 * 实现在 `useEditTransaction.ts`（拆分 ② 抽出）。`view` 是共享状态，在这里创建、
 * 传进去；事务只负责改它，不拥有它。
 */
const {
  cancelAskOpen,
  editDirty,
  editChangeCount,
  enterEdit,
  saveEdit,
  cancelEdit,
  confirmCancelEdit,
  dismissCancelAsk,
} = useEditTransaction({ store, view })
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
/** 顶栏「浮窗 N」清单（F-08）：状态留在 App —— Esc 级联与「点外面就关」都要问它 */
const floatOpen = ref(false)
/**
 * 当前在浮动的卡片清单。判定层抽在 `src/vue/floatList.ts`（顺序按版面、同模块第二张标序号），
 * 这里只喂数据：条目取 `store.doc`，标题查注册表，集合取 `useDetached()` 的那一份
 * （浮窗开关可能由任意窗口触发，所以不能只信本地动作）。
 */
const floats = computed(() =>
  floatItems(store.doc.value.items, (m) => E.findModule(store.reg, m)?.title ?? m, detached.value),
)
/** 一键收回：逐个调 `unfloat_card`（Rust 侧每次都会广播 floats-changed，清单自己会缩短） */
function unfloatAll(): void {
  floatOpen.value = false
  for (const f of floats.value) void unfloatCard(f.id)
}
/**
 * 把一条浮窗提到最前（F-08 的「定位」）。
 *
 * 先关菜单再发命令：聚焦会让主窗失焦，菜单本就该收；这也顺手避免了"点完菜单还挂在屏幕上"。
 * 返回值 false = 那张窗已经不在了（刚被关掉）—— 这不是错误，**静默**，清单会由
 * floats-changed 广播自己收敛；为此跑一趟重拉反而是多余的。
 */
function focusFloatRow(id: string): void {
  floatOpen.value = false
  void focusFloat(id)
}
function runArrange(fn: () => void): void {
  arrangeOpen.value = false
  fn()
}

function onDocMousedown(e: MouseEvent): void {
  if (!arrangeOpen.value && !floatOpen.value) return
  // 落点判定（closest 从 target 自身开始，与 contains 语义一致）抽成了
  // `insideAddWrap`，理由与那道 instanceof 判断的必要性写在 outsideClick.ts 文件头。
  // F-08：浮窗菜单的容器刻意复用 `.add-wrap` 这一个 class，于是两个下拉共用同一道判定。
  if (insideAddWrap(e.target)) return
  arrangeOpen.value = false
  floatOpen.value = false
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
  // 「当前形态」的查找与几何都抽到了 stageGeometry.ts（resolveDetachVariant / detachGeometry）。
  // 注意 cols / rowPx 是 ref 而 gap 不是（useProjection 的解构就是这样的），照原样取值。
  const v = resolveDetachVariant(store.doc.value.items, store.reg, id)
  const { w, h } = detachGeometry(v, {
    stageW: stageW.value,
    cols: cols.value,
    gap,
    rowPx: rowPx.value,
  })
  void floatCard(id, w, h)
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('mousedown', onDocMousedown)
  /** 首启（没有存档、也没挑过模板）自动开一次选择器 —— 这正是"选项"该出现的地方 */
  if (store.firstRun) templatesOpen.value = true
  /** 自动备份：没有基线就建一份；版本变过或距上一份超过 24h 也各留一份（只桌面） */
  backup.initAutoBackup()
  /** 提醒：启动先对一次表，之后每分钟一次（静默时段只压投递，不压事实） */
  reminders.start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('mousedown', onDocMousedown)
  reminders.stop()
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
  // 名字 → 处理函数的映射抽成了 makeOpenUI（openUI.ts）；「workbench 要在编辑态才取消」
  // 这类带宿主状态的守卫留在闭包里，不冒充纯函数。
  openUI: makeOpenUI({
    palette: () => {
      paletteOpen.value = true
    },
    settings: () => {
      settingsOpen.value = true
    },
    templates: () => {
      templatesOpen.value = true
    },
    workbench: () => {
      if (view.value === 'edit') cancelEdit()
    },
    edit: () => enterEdit(),
  }),
}
// 宿主拦截项的装配在 `useAppCommands.ts`（拆分 ② 抽出）：只创建总线、不 provide ——
// provide 是组件级动作，留在这儿，调用点才看得见"谁 provide 的"。
const commandBus: CommandBus = useAppCommands(cmdCtx, {
  saveEdit,
  fitLayout: () => runArrange(fitContent),
  compactLayout: () => runArrange(compact),
  enterEdit,
  leaveEdit: () => {
    if (view.value === 'edit') cancelEdit()
  },
})
provide('commandBus', commandBus)

/** 面板里"跳到某张卡"：切到布局编辑并交给编辑器选中+滚动到视野 */
function goCard(id: string): void {
  enterEdit()
  void nextTick(() => editorRef.value?.revealCard(id))
}


/** 收紧/紧凑要读真实渲染出来的卡片高度，编辑器里没有那张 .grid，所以只能在工作台用 */
const onlyWorkbench = '回「工作台」可用：这一步要按真实渲染的卡片高度测量'

/** 全局键盘：Esc 七层级联 / Ctrl+K / Ctrl+Z（装配见 `useGlobalKeys.ts`，拆分 ② 抽出）。
 *  本地原来那份 `isEditable` 与 `keyboard.ts` 的 `isEditableTarget` 是同一份逻辑写两遍，
 *  随之删除（分步 ④ 提前完成）。 */
const onGlobalKey = useGlobalKeys({
  paletteOpen,
  cancelAskOpen,
  editorEscape: () => editorRef.value?.escapePressed() ?? false,
  view,
  arrangeOpen,
  floatOpen,
  templatesOpen,
  settingsOpen,
  cancelEdit,
  closeTemplates,
  undo: undoLatest,
  redo: redoLatest,
})
</script>

<template>
  <div class="app">
    <TitleBar v-if="isDesktop" />
    <div class="shell">
    <AppToolbar
      :view="view"
      :stage-w="stageW"
      :cols="cols"
      :mode="mode"
      :edit-dirty="editDirty"
      :edit-change-count="editChangeCount"
      :can-undo-any="canUndoAny"
      :can-redo-any="canRedoAny"
      :arrange-open="arrangeOpen"
      :float-open="floatOpen"
      :floats="floats"
      :has-rows="!!store.doc.value.rows?.length"
      :only-workbench="onlyWorkbench"
      @select-view="onSelectView"
      @enter-edit="enterEdit"
      @cancel-edit="cancelEdit"
      @save-edit="saveEdit"
      @undo="undoLatest"
      @redo="redoLatest"
      @arrange="onArrange"
      @update:arrange-open="arrangeOpen = $event"
      @toggle-floats="floatOpen = !floatOpen"
      @focus="focusFloatRow"
      @unfloat="(id: string) => void unfloatCard(id)"
      @unfloat-all="unfloatAll"
      @open-templates="templatesOpen = true"
      @open-settings="settingsOpen = true"
    />

    <main ref="stageEl" class="stage">
      <NoticeStrip
        :storage-error="storage.error.value"
        :migration-notes="migrationNotes"
        :reminder-notes="reminderNotes"
        @dismiss-migration="migrationNotes = []"
        @dismiss-reminder="reminderNotes = []"
        @export-backup="backup.exportBackup()"
      />
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

    <CancelEditDialog
      :open="cancelAskOpen"
      :change-count="editChangeCount"
      @dismiss="dismissCancelAsk"
      @confirm="confirmCancelEdit"
    />

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
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
</style>
