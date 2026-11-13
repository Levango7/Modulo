<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
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
import { createOnboarding } from './vue/onboarding'
import { useReminders } from './vue/useReminders'
import type { Reminder } from './vue/reminders'
import { sendSystemNotifications, shouldSendSystemNotification } from './vue/notify'
import { useSchemes } from './vue/useSchemes'
import { useExtensions } from './vue/useExtensions'
import { isDesktop, useShell } from './vue/useShell'
import { useDetached } from './vue/useDetached'
import CommandPalette from './vue/components/CommandPalette.vue'
import AppToolbar from './vue/components/AppToolbar.vue'
import NoticeStrip from './vue/components/NoticeStrip.vue'
import CancelEditDialog from './vue/components/CancelEditDialog.vue'
import { type CommandBus } from './vue/commandBus'
import type { CommandContext } from './vue/commands'
import { fetchFloats, floatCard, floatingSupported, focusFloat, moveFloat, unfloatCard } from './float/api'
import { floatArrangeTargets } from './vue/floatArrange'
import { floatItems } from './vue/floatList'
import GridLayout from './vue/components/GridLayout.vue'
import CanvasEditor from './vue/components/CanvasEditor.vue'
import StackEditor from './vue/components/StackEditor.vue'
import SettingsPanel from './vue/components/SettingsPanel.vue'
import OnboardingWizard from './vue/components/OnboardingWizard.vue'
import TemplatePicker from './vue/components/TemplatePicker.vue'
import TitleBar from './vue/components/TitleBar.vue'
import ChatDock from './vue/components/ChatDock.vue'
import ArtifactPanel from './vue/components/ArtifactPanel.vue'
import SessionRail from './vue/components/SessionRail.vue'
import {
  ART_DOC_KEY,
  artLayout,
  clampArtWidth,
  parseArtState,
  serializeArtState,
  type ArtifactView,
} from './vue/artifactPanel'
import { createAiSessions } from './vue/useAiSessions'
import { createKnowledge } from './vue/useKnowledge'
import { createMemory } from './vue/useMemory'
import { createCron } from './vue/useCron'
import { createSkills } from './vue/useSkills'
import { createWorkflow } from './vue/useWorkflow'
import { AI_DOC_KEY, parseAiDoc } from './vue/aiSettings'
import { canShowDock } from './vue/aiChat'

const storage = inject<PersistentStorage>('storage')!
const store = inject<LayoutStore>('store')!
const cardDataApi = inject<CardDataApi>('cardData')!
/** 已装扩展卡 → 模块注册表的同步（immediate：首帧就绪，模块库第一眼就能看到装好的卡） */
useExtensions(store, cardDataApi)
/**
 * 首启引导（F-10）：`firstRun` 是 store 的派生量（版面为空且没挑过模板）⇒ 升级上来的老用户
 * 永远看不到它，只有真首启才会遇到；见过一次就被盘上的 `done` 挡住。
 */
const onboarding = createOnboarding(storage, { firstRun: () => store.firstRun })
provide('onboarding', onboarding)
/**
 * 首启一屏（2026-11-05 PR-C）的两个"开门"动作：只开界面，不直接改数据 ——
 * 「让 AI 开始」展开对话坞（内容一个字不动）；「先看模板」开模板选择器。
 * 向导只负责点完关上（finish），不知道这两个界面长什么样（与命令总线的钩子同一条纪律）。
 */
provide('welcome', {
  startAI: () => {
    dockExpanded.value = true
  },
  templates: () => {
    templatesOpen.value = true
  },
})
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

/**
 * 三态视图（F-15 P0 起）：**chat = 对话主轴**（对话占满剩余宽度 + 右栏产物面板）/
 * workbench = 画布 + 底部坞 / edit = 布局编辑。
 *
 * 默认值是 `'chat'`（用户裁决 11-11，见 `docs/design/F-15-AGENT-UI.md`）：打开就在对话里，
 * 版面不再是被藏起来的另一个界面，而是右侧那块**产物**面板 —— 这是"agent 应用"与
 * "带聊天功能的看板"在布局上的那条分界。
 */
const view = ref<'workbench' | 'chat' | 'edit'>('chat')

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
/** 视图切换：edit 态点「工作台」走取消事务（与 Esc / tab 同一条路），否则直接切 */
function onSelectView(v: 'workbench' | 'chat' | 'edit'): void {
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
/**
 * 「按版面重摆」（F-08「定位」的收官，2026-10-29）：把每张浮窗搬到它在版面里的相对位置上。
 *
 * 坐标映射是纯判定层 `floatArrange.ts`（受测层锁 100）；尺寸用**此刻**的 `list_floats`
 * （用户拖出来的大小，重摆不碰）；工作区读主窗的 `window.screen`（摆到主窗这块屏，
 * 是最可预期的语义——浮窗可能在别的屏上，但"按版面排开"就是该有个确定的去处）。
 * Rust `move_float` 只做搬运，窗已不在的返回 false 静默跳过——与「提到最前」同一种幂等。
 */
async function arrangeFloatsByLayout(): Promise<void> {
  floatOpen.value = false
  const entries = await fetchFloats()
  const sizes = new Map(entries.map((e) => [e.card_id, { w: e.w, h: e.h }]))
  // availLeft/availTop 是 Chromium 扩展属性（TS DOM lib 没有），缺失时按 0 —— 单屏默认就在原点
  const scr = window.screen as Screen & { availLeft?: number; availTop?: number }
  const wa = {
    x: scr.availLeft ?? 0,
    y: scr.availTop ?? 0,
    w: scr.availWidth || 1024,
    h: scr.availHeight || 768,
  }
  for (const t of floatArrangeTargets(store.doc.value.items, detached.value, sizes, wa)) {
    void moveFloat(t.id, t.x, t.y)
  }
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
  // 首启不再开模板选择器，改由 OnboardingWizard 承接（见上面 createOnboarding 那处注释）
  /** 自动备份：没有基线就建一份；版本变过或距上一份超过 24h 也各留一份（只桌面） */
  backup.initAutoBackup()
  /** 提醒：启动先对一次表，之后每分钟一次（静默时段只压投递，不压事实） */
  reminders.start()
  /** 定时任务：同一个节奏对表。错过不补跑（PR-F2 的边界 1），网页版 start() 直接不开 */
  cron.start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('mousedown', onDocMousedown)
  reminders.stop()
  cron.stop()
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
 * 设置里那条「挑一种排法」：先关设置再开选择器 —— 两个全屏遮罩叠在一起，
 * 底下的焦点陷阱会互相抢 Esc（而且用户会分不清按 Esc 关的是哪一个）。
 */
function openTemplatesFromSettings() {
  settingsOpen.value = false
  templatesOpen.value = true
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

/**
 * AI 会话的共享状态（改天换地 PR-D）：坞与左栏（SessionRail）共用同一份清单与
 * active id —— 抽到 `useAiSessions` 的理由见那个文件头。列表在栏挂载时拉一次，
 * 发送完成后坞会再刷（`sessions.refresh()`）。
 */
const aiSessions = createAiSessions()
provide('aiSessions', aiSessions)
/**
 * 「资料」的共享状态（PR-F1 知识库第一格）：栏里列它、聊天里 `@` 它 —— 两处同一份。
 * 落盘走同一个 `storage`（与卡片数据、AI 配置一条闸门），所以它是本机数据，
 * 跟着备份/同步那套走，不另开通道。
 */
const knowledge = createKnowledge(storage)
provide('knowledge', knowledge)
/**
/**
 * 「AI 记忆」的共享状态（第十五笔）：dock 注入 system 块、设置面板列它删它 —— 两处同一份。
 * 与资料同一形状（构造时读档、变更落盘）；见 §12.73。
 */
const memory = createMemory(storage)
provide('memory', memory)
/**
 * 「技能」的共享状态（PR-F3 生态位第三格）：左栏列它、聊天里 `@` 它 —— 两处同一份。
 * 与资料 / 定时任务走同一条 `storage` 闸门，落盘键登记进 `DATA_KEYS`；
 * 没有执行体、没有自动跑，只是一份本地提示词模板清单（§12.68）。
 */
const skills = createSkills(storage)
provide('skills', skills)
/**
 * 「定时任务」的共享状态（PR-F2）：栏里列它、到点由这里驱动执行。
 * `providers` 读启动时 hydrate 的 ai-settings 镜像（与坞同一份，零 IO）；
 * `canRun` 门着网页版 —— ai_chat 是 Tauri IPC，网页没有这条通道（与坞同一条边界）。
 */
const cron = createCron({
  storage,
  providers: () => parseAiDoc(storage.get(AI_DOC_KEY)),
  canRun: () => isDesktop,
})
provide('cron', cron)
/**
 * 「工作流」的共享状态（PR-F3，生态位第三格）：栏里建它、点「跑一遍」由这里顺次执行。
 * 与定时任务分工明确 —— 定时管"什么时候跑"，工作流管"按什么顺序跑"。
 * **没有定时器**：跑一遍要花钱，只由用户点「跑一遍」触发，不自动开跑。
 */
const workflow = createWorkflow({
  storage,
  providers: () => parseAiDoc(storage.get(AI_DOC_KEY)),
})
provide('workflow', workflow)
/**
 * 左栏显隐（PR-D）：**按窗口宽自适应**，阈值取「12 列舞台 + 栏宽」——
 * 栏常驻会把 1440 视口的舞台压到 8 列，破坏「1440 → 12 列」的响应式承诺
 * （三档视口 E2E 与 README 都钉着它）。宽屏（≥1480）常驻；窄窗自动收起，
 * 12 列优先。常驻开关（用户手动钉住/收起）在 PR-E 与 composer 一起做。
 */
const windowW = ref(typeof window !== 'undefined' ? window.innerWidth : 1920)
const onWindowResize = () => {
  windowW.value = window.innerWidth
}
onMounted(() => window.addEventListener('resize', onWindowResize))
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))
const RAIL_MIN_VIEWPORT = 1480
const railVisible = computed(() => windowW.value >= RAIL_MIN_VIEWPORT)

/**
 * 右栏产物面板（F-15 P0 §1.2）：宽度 / 折叠 / 当前视图落盘，摆法由纯判定层
 * `artifactPanel.ts` 的 `artLayout` 算 —— 这里只做两件组件级的事：
 * ① 量「对话那一行」的真实可用宽（面板宽度要按它夹"对话保底 480"）；
 * ② 窄屏那个**不落盘**的浮层开关（它属于"这一次看了一眼"，跨启动记住是错的）。
 *
 * 存档键 `ART_DOC_KEY` 登记在 `fileStorage.ts` 的 `DATA_KEYS` 里 ——
 * 漏登记的症状不是报错，是"拖完了、重启回到 420"。
 */
const artState = ref(parseArtState(storage.get(ART_DOC_KEY)))
const artRowEl = ref<HTMLElement | null>(null)
const { width: artRowW } = useElementSize(artRowEl, 1200, 0)
const artOverlayOpen = ref(false)
const art = computed(() =>
  artLayout({
    winW: windowW.value,
    available: artRowW.value,
    state: artState.value,
    overlayOpen: artOverlayOpen.value,
  }),
)
/** 面板此刻是否在场（折叠 / 窄屏未展开 ⇒ 不在场，对话拿回满宽） */
const artOpen = computed(() => art.value.overlay || art.value.width > 0)
watch(artState, (s) => storage.set(ART_DOC_KEY, serializeArtState(s)), { deep: true })
/**
 * 顶栏那枚「产物」的开合。宽屏切的是**落盘的折叠态**，窄屏切的是这一次的浮层 ——
 * 两种形态的"关掉"不是同一件事，混成一个 ref 会让用户改一次窗口宽度就丢掉偏好。
 */
function toggleArtifact(): void {
  if (art.value.narrow) artOverlayOpen.value = !artOverlayOpen.value
  else artState.value = { ...artState.value, collapsed: !artState.value.collapsed }
}
function resizeArtifact(w: number): void {
  artState.value = { ...artState.value, width: clampArtWidth(w) }
}
function setArtifactView(v: ArtifactView): void {
  artState.value = { ...artState.value, view: v }
}

/** 面板里"跳到某张卡"：切到布局编辑并交给编辑器选中+滚动到视野 */
function goCard(id: string): void {
  enterEdit()
  void nextTick(() => editorRef.value?.revealCard(id))
}

/**
 * 底部 AI 对话坞（F-12 二期）：出场条件在 `aiChat.canShowDock` —— 布局编辑、有浮窗、
 * 全屏遮罩（设置/模板/命令面板/首启向导）时一律不渲染。展开态放这里而不是组件内部：
 * Esc 级联与 Ctrl+J 都要问它（`keyboard.ts` 的最底一层）。
 */
const dockExpanded = ref(false)
/**
 * 坞只在 `workbench` 出现（F-15 P0 契约 §1.1）。`canShowDock` 里那句
 * `view === 'chat' || 'workbench'` 是 E1 的旧口径（chat 用坞当脊柱），
 * 那时 chat 视图只有坞这一块；现在 chat 视图自带对话主轴，再浮一个坞就是两个输入框。
 *
 * 为什么门加在这里而不是改 `canShowDock`：契约 §三.4 划了"P0 不碰 aiChat.ts"
 * （P1a 要往那儿加事件类型）。等 P1a 落地后可以把这句并回去。
 */
const dockVisible = computed(
  () =>
    view.value === 'workbench' &&
    canShowDock({
      desktop: isDesktop,
      view: view.value,
      floats: detached.value.size,
      settingsOpen: settingsOpen.value,
      templatesOpen: templatesOpen.value,
      paletteOpen: paletteOpen.value,
      onboardingOpen: !!onboarding.visible.value,
    }),
)
// 坞被撤掉（切编辑/开设置/有浮窗）就收回展开态：回来时"自己弹开"是没有道理的
watch(dockVisible, (v) => {
  if (!v) dockExpanded.value = false
})

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
  dockExpanded,
  dockVisible,
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
    <SessionRail v-show="railVisible" :view="view" @select-view="onSelectView" />
    <div class="content">
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
      :artifact-open="artOpen"
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
      @arrange-floats="arrangeFloatsByLayout"
      @open-templates="templatesOpen = true"
      @open-settings="settingsOpen = true"
      @toggle-artifact="toggleArtifact"
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
      <!--
        对话主轴（F-15 P0）：chat 态是**两栏** —— 左边对话占满剩余宽度，右边是产物面板。
        桌面有 AI 后端（Tauri IPC）⇒ 全高坞当对话列；web 没有后端 ⇒ **诚实占位**
        （说明 AI 为什么只在桌面 + 出路在哪），而不是一个发不出消息的假输入框。
        产物面板两边都有：它只是版面的一个视图，不依赖任何 IPC。
      -->
      <div v-if="view === 'chat'" ref="artRowEl" class="chat-mode" data-chat-mode>
        <div class="chat-col">
          <ChatDock v-if="isDesktop" :expanded="true" full @update:expanded="() => {}" />
          <section v-else class="chat-web-note" data-chat-web-note>
            <h2>AI 对话在桌面版里</h2>
            <p>
              AI 的请求由桌面壳直接发给模型服务（不经过任何第三方服务器，你的密钥也不出本机）——
              网页版没有这条通道，所以这里不摆一个发不出消息的输入框。
            </p>
            <p>画布、卡片、本地数据这些都不受影响，随时切回「工作台」继续用。</p>
          </section>
        </div>
        <ArtifactPanel
          v-if="artOpen"
          :width="art.width"
          :overlay="art.overlay"
          :view="artState.view"
          :hidden="detached"
          :can-detach="floatingSupported()"
          @resize="resizeArtifact"
          @update:view="setArtifactView"
          @collapse="toggleArtifact"
          @detach="detachCard"
        />
      </div>
      <template v-else-if="view === 'workbench'">
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
          <!--
            `module-id` 是模块 id、`instance-id` 是实例 id（第二张起是 `模块:2`）——
            与 GridLayout（工作台）同一条纪律（见 `src/vue/components/GridLayout.vue`
            同款注释）。2026-11-05 修：这条编辑态渲染路径此前只传 module-id，
            多开的第二张卡在布局编辑态一律按"第一实例"读内容 —— 界面看着就是
            "编辑态里两张速记显示同一份"。F-01 阶段 2 八个字段全按实例分了才暴露它。
          -->
          <component
            :is="CARD_COMPONENTS[E.moduleIdOf(item)]"
            :variant="item.variant"
            :module-id="E.moduleIdOf(item)"
            :instance-id="item.id"
            :chromeless="true"
          />
        </template>
      </CanvasEditor>
      <StackEditor v-else />
    </main>

    <!--
      工作台态的底部坞：**必须在 .content 里**（内容列的最后一层）。外壳 `.shell` 被 E1
      改成左栏 + 内容列的行向布局后，坞若留在 shell 直下就会被 flex 当成右侧第三列
      （实测偷走 270px 舞台宽、1440 视口列数掉档）—— 这次是被窄窗用例当场抓出来的。
    -->
    <ChatDock v-if="dockVisible" :expanded="dockExpanded" @update:expanded="dockExpanded = $event" />
    </div>
    </div>

    <CancelEditDialog
      :open="cancelAskOpen"
      :change-count="editChangeCount"
      @dismiss="dismissCancelAsk"
      @confirm="confirmCancelEdit"
    />

    <CommandPalette v-if="paletteOpen" :ctx="cmdCtx" @close="paletteOpen = false" @go-card="goCard" />

    <TemplatePicker v-if="templatesOpen" @close="closeTemplates" @edit="pickAndEdit" />

    <OnboardingWizard v-if="onboarding.visible.value" />

    <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" @open-templates="openTemplatesFromSettings" />
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
  flex-direction: row;
  flex: 1;
  min-height: 0;
  gap: var(--space-4);
}
/* 改天换地 PR-D：左栏（SessionRail）+ 右侧内容列。原来的 shell 内边距搬到这里 ——
   栏是全高的，内容列才需要与视口保持距离 */
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  gap: var(--space-4);
}
/* 对话主轴（F-15 P0）：两栏 —— 对话占满剩余宽度 + 右栏产物。
   `position: relative` 是窄屏浮层形态的落点（ArtifactPanel 靠它 absolute 到底部） */
.chat-mode {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: row;
  gap: var(--space-4);
}
.chat-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 坞当对话列时要撑满（收起态那条 46px 老规则不能压着它）。
   面板本身的高度由 ChatDock 自己的 `.dock[data-full='1'] .panel` 给 ——
   这里再写一条 `.panel` 是死规则（scoped 属性加不到子组件的后代上），E1 时就没生效过。 */
.chat-col .dock {
  flex: 1;
  min-height: 0;
  height: auto !important;
}
.chat-web-note {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-5);
}
.chat-web-note h2 {
  margin: 0;
  font-size: 18px;
}
.chat-web-note p {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
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
