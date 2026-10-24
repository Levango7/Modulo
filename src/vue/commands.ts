/**
 * 命令表（2026-10-13 批 2）
 *
 * ## 为什么要有这张表
 *
 * 引擎的 `ops.ts` 是纯函数，每一次版面编辑**早已**是一条有契约、可测试、可撤销的操作。
 * 但它们此前被**三条互不相识的路**调用：顶栏按钮直接调 `store.tidy()`、键盘经
 * `keyboard.ts` 的意图再各自调 store、编辑器 UI 调 `store.groupIntoRow(...)`。
 * 同一件事有三个真相 —— 加第四个入口（命令面板）只是再加一条路，那样做没有意义。
 *
 * 这张表把"能被用户发起的动作"收成**一份清单**：入口（顶栏 / 键盘 / 编辑器 / 命令面板）
 * 只负责 `dispatch(id)`，执行只有一条路。收益是可验证的：
 * - 键盘绑定从这张表读 → **面板里搜得到的，就是键盘按得到的**（不再有两套真相）；
 * - `undoable` 声明 + 表驱动测试 → "执行 → Ctrl+Z 复原"对**全表**成立；
 * - `when` 是纯函数 → "不可用的命令为什么不可用"可单测、可在面板里说明；
 * - 以后扩展要注册命令，挂的就是这张表（批 3/4 的前置件）。
 *
 * ## 规矩（写新命令前先读这三条）
 *
 * 1. **`run` 只做一件事：把纯操作交给 store**。不写 UI 逻辑、不弹窗、不 fetch。
 *    要弹层的（模板选择器/设置面板/命令面板自己）用 `effect` —— 它的语义是
 *    "这条命令只是把某个界面打开"，面板借它知道"执行后该让位"。
 * 2. **id 只增不改**。改 id 等于改名：快捷键配置、将来的用户宏、扩展清单全会断。
 * 3. **文案三件套必填**（label / hint）；测试会拦下没写全的条目 ——
 *    命令面板的可用性建立在"每条命令都说清自己做什么"上。
 */
import type { Ref } from 'vue'
import * as E from '@levango7/engine'
import type { LayoutStore } from './store'

/** 上下文域：决定"此刻这条命令是否存在"。面板按 scope 分组、按 when 过滤 */
export type CommandScope =
  | 'layout' // 版面级：整理 / 撑满 / 模板 / 撤销重做
  | 'row' // 行容器：重排 / 折叠 / 解组
  | 'card' // 卡片级：形态 / 锁定 / 脱离 / 移除（作用于"当前选中或唯一目标"）
  | 'view' // 视图与导航：工作台 / 布局编辑 / 外观
  | 'edit' // 编辑事务：保存 / 取消
  | 'app' // 应用级：备份 / 设置

export interface CommandContext {
  store: LayoutStore
  /** 当前视图（'workbench' | 'edit'） */
  view: Ref<'workbench' | 'edit'>
  /** 编辑器里选中的卡（工作台为空集） */
  selection: Ref<ReadonlySet<string>>
  /**
   * 编辑器里**焦点所在**的卡（键盘语义：单格操作作用于焦点格，多选/批量另有其路径）。
   * 命令的"目标"按 显式参数 > 聚焦格 > 唯一选中 解析 —— 2026-10-13 把 card.remove
   * 并入总线时发现只认"选中"会让 Delete 静默失效（键盘用户从来不先框选）。
   */
  focusedCard: Ref<string | null>
  /** 编辑事务是否有改动（用于「保存」文案与可用性） */
  editDirty: Ref<boolean>
  /** 命令面板等界面的开关（effect 类命令用） */
  openUI: (name: 'templates' | 'settings' | 'palette' | 'edit' | 'workbench') => void
  /** 把某张卡脱离成浮窗 / 还原（批 1 的入口，桌面壳才可用） */
  detach: (id: string) => void
  unfloat: (id: string) => void
  /** 当前在浮动的卡 */
  detached: Ref<ReadonlySet<string>>
  /** 桌面壳能力检测（浮窗/走查类命令按它显隐） */
  floatingSupported: boolean
  /** 按当前舞台宽度换算"每格像素"，供面板显示尺寸类提示（可空） */
  stageW: Ref<number>
  cols: Ref<number>
  gap: number
  rowPx: Ref<number>
}

export interface CommandDef {
  /** 稳定标识：`域.动作`，只增不改 */
  id: string
  /** 面板里的标题（动词 + 对象），键盘与面板共用同一句 */
  label: string
  /** 一句人话说明"它做什么、什么时候用" */
  hint: string
  scope: CommandScope
  /**
   * 可用性谓词（纯函数）。不可用时面板灰显并展示 `why` 的原因。
   * 带 `args` 的原因：**可用性要针对"这次派发的真实目标"判**，不是默认目标 ——
   * 否则"给指定卡 dispatch 一张已浮动的卡"会被误判（2026-10-13 全量执行测试抓到）。
   */
  when?: (ctx: CommandContext, args?: CommandArgs) => boolean
  /** when 为假时的原因（一句话） */
  why?: string
  /** 是否进历史（撤销）。声明了就必须过"执行→Ctrl+Z→复原"的表驱动测试 */
  undoable?: boolean
  /** 键盘绑定，形如 `Ctrl+K` / `Delete`（显示用；真实派发见 keyboard 桥） */
  binding?: string
  /**
   * 执行体：只做一件事 —— 把纯操作交给 store。
   * 声明 `wait` 的命令**没有内联实现**：它要等宿主把真实渲染的数据送进来
   * （如「收紧」要量卡片实际高度），由 App 在派发点拦截执行 —— 命令表仍然登记它，
   * 所以它在面板里照样搜得到、有文案、有可用性谓词，只是执行落在宿主。
   */
  run?: (ctx: CommandContext, args?: CommandArgs) => void
  /** 需要宿主实现（并说明等什么）：`workbench-measure` = 要按真实渲染高度测量 */
  wait?: 'workbench-measure'
  /** 纯界面效应（打开弹层/切视图）——面板据此在执行后收起 */
  effect?: (ctx: CommandContext) => void
}

/** 命令参数（当前只有"指定目标"，后续扩展系统会用结构化参数） */
export interface CommandArgs {
  /** 卡片 id（card 域命令的目标） */
  cardId?: string
  /** 行 id（row 域命令的目标） */
  rowId?: string
}

/** 目标卡：显式参数 → 焦点格 → 唯一选中；都没有则返回 null（命令判不可用而非猜） */
export function targetCard(ctx: CommandContext, args?: CommandArgs): string | null {
  if (args?.cardId) return args.cardId
  if (ctx.focusedCard.value) return ctx.focusedCard.value
  if (ctx.selection.value.size === 1) return [...ctx.selection.value][0]
  return null
}
function targetRow(ctx: CommandContext, args?: CommandArgs): E.Row | null {
  const rows = ctx.store.doc.value.rows ?? []
  if (args?.rowId) return rows.find((r) => r.id === args.rowId) ?? null
  return rows.length === 1 ? rows[0] : null
}

/**
 * 命令表本体。**顺序即面板里的默认顺序**（按 scope 分组的呈现另见面板）。
 * 覆盖面 = "已经存在、已可用"的动作全集；本表不发明新功能。
 */
export const COMMANDS: readonly CommandDef[] = [
  // ── 视图与导航 ────────────────────────────────────────────────
  {
    id: 'view.workbench',
    label: '切到工作台',
    hint: '看版面、做微调；正在编辑时先走「取消」的确认流程',
    scope: 'view',
    when: (c) => c.view.value !== 'workbench',
    why: '已经在工作台',
    effect: (c) => c.openUI('workbench'),
  },
  {
    id: 'view.edit',
    label: '切到布局编辑',
    hint: '增删改卡片；改完「保存」生效，或「取消」全部还原',
    scope: 'view',
    when: (c) => c.view.value !== 'edit',
    why: '已经在布局编辑',
    effect: (c) => c.openUI('edit'),
  },
  {
    id: 'app.settings',
    label: '打开：外观与设置',
    hint: '皮肤、主题、强调色、备份与版本',
    scope: 'app',
    effect: (c) => c.openUI('settings'),
  },
  {
    id: 'app.templates',
    label: '打开：版面模板',
    hint: '挑一种排法，整体替换版面（可 Ctrl+Z 退回）',
    scope: 'app',
    effect: (c) => c.openUI('templates'),
  },

  // ── 编辑事务 ──────────────────────────────────────────────────
  {
    id: 'edit.save',
    label: '保存这次编辑',
    hint: '确认改动并回到工作台',
    scope: 'edit',
    when: (c) => c.view.value === 'edit',
    why: '只在布局编辑里可用',
    effect: (c) => c.openUI('workbench'), // App 的拦截项：保存要先刷新编辑基线
  },
  {
    id: 'edit.cancel',
    label: '取消这次编辑',
    hint: '全部还原到进编辑器之前（有改动会先问一句）',
    scope: 'edit',
    when: (c) => c.view.value === 'edit',
    why: '只在布局编辑里可用',
    effect: (c) => c.openUI('workbench'), // App 的拦截项：编辑态取工作台 = 取消（走确认流程）
  },

  // ── 版面级 ────────────────────────────────────────────────────
  {
    id: 'layout.tidy',
    label: '整理版面',
    hint: '把散开的卡片聚拢、填掉空洞（锁定项不动）',
    scope: 'layout',
    undoable: true,
    run: (c) => c.store.tidy(),
  },
  {
    id: 'layout.fit',
    label: '收紧卡片高度',
    hint: '按内容把每张卡收紧到需要的高度，只变矮不变高',
    scope: 'layout',
    when: (c) => c.view.value === 'workbench',
    why: '要把卡片渲染出来量高度，只在工作台可用',
    wait: 'workbench-measure',
    undoable: true,
  },
  {
    id: 'layout.compact',
    label: '紧凑版面',
    hint: '收紧 + 整理，一步铺紧（分两步历史，可分别撤销）',
    scope: 'layout',
    when: (c) => c.view.value === 'workbench',
    why: '要把卡片渲染出来量高度，只在工作台可用',
    wait: 'workbench-measure',
    undoable: true,
  },
  {
    id: 'layout.spread',
    label: '撑满每行',
    hint: '按原比例把每行的卡片铺满整行，不留右侧空档',
    scope: 'layout',
    undoable: true,
    run: (c) => c.store.spread(),
  },
  {
    id: 'layout.reflowAllRows',
    label: '重排全部行',
    hint: '每一行按它自己存的「每行 N 张 / 高 N 行」重排一遍',
    scope: 'layout',
    when: (c) => (c.store.doc.value.rows?.length ?? 0) > 0,
    why: '版面上还没有行',
    undoable: true,
    run: (c) => c.store.reflowAllRows(),
  },
  {
    id: 'layout.undo',
    label: '撤销',
    hint: '退回上一步（连续的方向键/输入会折叠成一步）',
    scope: 'layout',
    binding: 'Ctrl+Z',
    when: (c) => c.store.canUndo.value,
    why: '已经没有可退回的步骤',
    run: (c) => c.store.undo(),
  },
  {
    id: 'layout.redo',
    label: '重做',
    hint: '把刚撤销的一步再做回来',
    scope: 'layout',
    binding: 'Ctrl+Shift+Z',
    when: (c) => c.store.canRedo.value,
    why: '没有可重做的步骤',
    run: (c) => c.store.redo(),
  },

  // ── 行容器 ────────────────────────────────────────────────────
  {
    id: 'row.reflow',
    label: '重排这一行',
    hint: '按行头设的「每行 N 张 / 高 N 行」把成员排成均匀的格子',
    scope: 'row',
    binding: 'Ctrl+Enter',
    when: (c) => {
      const r = targetRow(c)
      return !!r && !r.collapsed
    },
    why: '需要一行（折叠中的行没有可见成员可排）',
    undoable: true,
    run: (c) => {
      const r = targetRow(c)
      if (!r) return
      c.store.reflowRow(r.id, r.auto ?? { per: 3, rowH: 3 })
    },
  },
  {
    id: 'row.toggleCollapsed',
    label: '折叠 / 展开这一行',
    hint: '把整行成员收起来，或再放出来（可逆的整段位移）',
    scope: 'row',
    when: (c) => !!targetRow(c),
    why: '需要一行',
    undoable: true,
    run: (c) => {
      const r = targetRow(c)
      if (r) c.store.toggleRow(r.id)
    },
  },
  {
    id: 'row.ungroup',
    label: '把这一行解组',
    hint: '成员留在原地，收走行头那一行',
    scope: 'row',
    when: (c) => !!targetRow(c),
    why: '需要一行',
    undoable: true,
    run: (c) => {
      const r = targetRow(c)
      if (r) c.store.ungroupRow(r.id)
    },
  },

  // ── 卡片级 ────────────────────────────────────────────────────
  {
    id: 'card.cycleVariant',
    label: '换形态',
    hint: '在这张卡的下一种形态之间循环（大时钟 → 日期卡 → 极简…）',
    scope: 'card',
    binding: 'Enter',
    when: (c, a) => {
      const id = targetCard(c, a)
      // 按实例 id 找条目，再走 moduleIdOf 查注册表（2026-10-25 修 clock:2 同型缺陷，
      // 见 §12.20）：原来直接拿实例 id 查表，多实例第二例 `模块:2` 查不到模块，
      // 「换形态」对第二实例不可用 —— 而 store.cycleVariant 用的正是这个正确形状。
      const p = id ? c.store.doc.value.items.find((q) => q.id === id) : undefined
      const mod = p ? c.store.reg.find((m) => m.id === E.moduleIdOf(p)) : null
      return !!mod && mod.variants.length > 1
    },
    why: '先选中一张卡（或这张卡只有一种形态）',
    undoable: true,
    run: (c, a) => {
      const id = targetCard(c, a)
      if (id) c.store.cycleVariant(id)
    },
  },
  {
    id: 'card.toggleLock',
    label: '锁定 / 解锁',
    hint: '锁定后拖不动、也让让位算法绕开它',
    scope: 'card',
    binding: 'L',
    when: (c, a) => !!targetCard(c, a),
    why: '先选中一张卡',
    undoable: true,
    run: (c, a) => {
      const id = targetCard(c, a)
      if (id) c.store.toggleLock(id)
    },
  },
  {
    id: 'card.detach',
    label: '脱离成桌面浮窗',
    hint: '卡片离开工作台，变成置顶小窗；关掉小窗就回来',
    scope: 'card',
    when: (c, a) => c.floatingSupported && !!targetCard(c, a) && !c.detached.value.has(targetCard(c, a)!),
    why: '桌面壳才有浮窗（或这张卡已在浮动）',
    undoable: false,
    run: (c, a) => {
      const id = targetCard(c, a)
      if (id) c.detach(id)
    },
  },
  {
    id: 'card.unfloat',
    label: '把浮窗收回工作台',
    hint: '关掉那张卡在桌面上的小窗',
    scope: 'card',
    when: (c, a) => c.floatingSupported && !!targetCard(c, a) && c.detached.value.has(targetCard(c, a)!),
    why: '这张卡不在浮动',
    run: (c, a) => {
      const id = targetCard(c, a)
      if (id) c.unfloat(id)
    },
  },
  {
    id: 'card.remove',
    label: '移回模块库',
    hint: '把这卡从版面拿掉（回库，随时能再拖进来）',
    scope: 'card',
    binding: 'Delete',
    when: (c, a) => !!targetCard(c, a),
    why: '先选中一张卡',
    undoable: true,
    run: (c, a) => {
      const id = targetCard(c, a)
      if (id) c.store.remove(id)
    },
  },
  {
    id: 'palette.open',
    label: '打开命令面板',
    hint: '搜命令、找卡片、翻内容 —— 一个入口三件事',
    scope: 'app',
    binding: 'Ctrl+K',
    effect: (c) => c.openUI('palette'),
  },
]

/** 按 scope 的中文分组名（面板呈现顺序即此数组顺序） */
export const SCOPE_ORDER: readonly CommandScope[] = ['view', 'edit', 'layout', 'row', 'card', 'app']
export const SCOPE_LABEL: Record<CommandScope, string> = {
  view: '视图',
  edit: '编辑事务',
  layout: '版面',
  row: '行',
  card: '卡片',
  app: '应用',
}

/** 面板要的"此刻可用/不可用"视图（纯函数，可单测） */
export interface CommandState {
  def: CommandDef
  enabled: boolean
  /** 不可用原因（when 为假时给出 `why`；没写 why 时给通用兜底，不至于空着） */
  reason: string | null
}

export function commandStates(ctx: CommandContext, args?: CommandArgs): CommandState[] {
  return COMMANDS.map((def) => {
    const enabled = def.when ? def.when(ctx, args) : true
    return { def, enabled, reason: enabled ? null : (def.why ?? '此刻不可用') }
  })
}
