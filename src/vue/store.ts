import { computed, reactive, shallowRef } from 'vue'
import * as E from '@levango7/engine'

export interface StorageAdapter {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
}

/**
 * 把某张卡过去写在**裸 `localStorage`** 里的数据接管进存储适配器（一次性）。
 *
 * 为什么要有这一步：桌面壳的 `get` 只读启动 hydrate 出来的文件镜像（见 `fileStorage.ts`），
 * 而 rss / probe 这两张卡此前直接读写 `localStorage` —— 数据能跨重启（WebView2 的
 * user data 目录），但**不在文件镜像里、不在备份清单里、也不参与同步**。搬进适配器之后
 * 三件事一起成立，代价是老用户的那份历史要搬一次家。
 *
 * 三条纪律：
 *  1. **只在镜像为空时搬**：镜像有值就以镜像为准，绝不拿旧值覆盖新的。
 *  2. **搬完不删旧值**：写盘是异步的、失败会挂在 `error` 上（`fileStorage` 那套）。
 *     删掉旧值等于把"写失败"变成"数据没了"；而且下次镜像为空时它还能再搬一次。
 *  3. **空串当没有**：`localStorage` 里的空串不是有效归档，搬过去只会让"有没有历史"判错。
 *
 * @returns 可用的原始 JSON 文本（镜像优先），没有就 null。**不解析** —— 解析与容错由调用方
 *          照旧处理（那两张卡各自有坏数据兜底）。
 */
export function adoptLegacyKey(
  storage: StorageAdapter,
  readLegacy: (key: string) => string | null,
  key: string,
): string | null {
  const current = storage.get(key)
  if (current !== null && current !== '') return current
  let legacy: string | null = null
  try {
    legacy = readLegacy(key)
  } catch {
    return null // 隐私模式 / 配额限制下读 localStorage 会抛，按"没有"处理
  }
  if (!legacy) return null
  try {
    storage.set(key, legacy)
  } catch {
    /* 写不进适配器就先不搬：旧值还在，下次再试（这条卡的数据本来就是可丢的缓存） */
  }
  return legacy
}

export function browserStorage(): StorageAdapter {
  return typeof localStorage === 'undefined' ? memoryStorage() : { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }
}

/**
 * 出厂默认版面 = 模板表里的 `general`（`src/engine/templates.ts`）。
 * 这里不再自己排第二套坐标 —— 两份真相迟早会漂，而"没存档时看到什么"必须和模板选择器里
 * 那张「通用」卡片画的逐格一致。
 */
function starterDoc(reg: E.ModuleRegistry): E.LayoutDoc {
  return E.buildTemplate(reg, E.templateById(E.DEFAULT_TEMPLATE_ID)!)
}

export function createLayoutStore(opts: {
  registry: E.ModuleRegistry
  storage?: StorageAdapter
  key?: string
  templateKey?: string
  /**
   * 启动时就已装好的扩展卡（main.ts 在首次 parseLayout **之前**传入）。
   * 缺了它，旧版面里的 `ext:<id>` 条目会在静态表上解析、被当未知模块清洗掉。
   */
  extensions?: readonly E.ExtCard[]
}) {
  /**
   * 注册表 = 内置表 + 已装扩展卡。**reactive 数组**：扩展是运行时装进来的（用户导入卡包），
   * 而加卡 / 钳制 / 降档这些引擎调用都从这里查模块定义 —— 静态值会让"导入后加卡"查无此模块。
   * 原地 splice（`setExtensions`）而不是换引用：`store.reg` 的全部消费点拿到的都是同一个
   * 数组代理，一行不用改；Vue 的响应让依赖它的 computed（模块库清单等）自动重算。
   */
  const reg = reactive<E.ModuleDef[]>([...opts.registry, ...E.extModuleDefs(opts.registry, opts.extensions ?? [])])
  /** 内置表长度：ext 段永远排在它后面（引擎 `extModuleDefs` 的约定），splice 只动这一段 */
  const baseLen = opts.registry.length
  const storage = opts.storage ?? browserStorage()
  const key = opts.key ?? 'modulo.layout.v1'
  /** 只是"上次选了哪张模板"的记录，用于高亮；用户手动拖过之后它就不再代表版面了。 */
  const templateKey = opts.templateKey ?? 'modulo.template.v1'

  const parsed = E.parseLayout(storage.get(key) ?? '', reg)
  const usedStarter = parsed.doc.items.length === 0
  const initial = usedStarter ? starterDoc(reg) : parsed.doc
  /** 出厂默认也要立刻落盘：否则用户不动版面就永远没有存档，导出/迁移会拿到空布局 */
  if (usedStarter) storage.set(key, E.docToJson(initial))

  const doc = shallowRef<E.LayoutDoc>(initial)
  const hist = shallowRef<E.HistoryState>(E.createHistory(initial))
  const warnings = shallowRef<string[]>(parsed.warnings)
  const templateId = shallowRef<string | null>(storage.get(templateKey))
  /** 首启且用户还没挑过模板 —— App 用它决定要不要自动弹一次模板选择器（只弹一次，不能变成 nag） */
  const firstRun = usedStarter && !templateId.value

  /**
   * mergeKey 给「一段连续输入」用：同一个键在合并窗口（300ms）内的连续提交折叠成一步。
   * 只有键盘路径传它 —— 指针拖拽本来就只在 pointerup 提交一次，若也带上，
   * 快速连着拖两次反而会被误折成一步。
   */
  function apply(next: E.LayoutDoc | null, mergeKey?: string): void {
    if (!next || next === doc.value) return
    hist.value = E.commit(hist.value, next, { at: Date.now(), mergeKey })
    doc.value = E.currentDoc(hist.value)
    storage.set(key, E.docToJson(doc.value))
  }

  /** 只记"选过了哪张模板"，不动版面 —— 选择器被直接关掉时用它，避免下次再问 */
  function setTemplateChoice(id: string): void {
    templateId.value = id
    storage.set(templateKey, id)
  }

  /**
   * 换模板 = 整体替换版面（一步可撤销），并把选择记下来供选择器高亮。
   * 返回 false 表示模板 id 不存在 —— 调用方要能区分"没换成"和"换成了原样"，
   * 否则界面会说谎。
   */
  function applyTemplate(id: string): boolean {
    const t = E.templateById(id)
    if (!t) return false
    apply(E.buildTemplate(reg, t))
    setTemplateChoice(id)
    return true
  }

  /** 见 return 里 placedIds 的注释 */
  const placedIds = computed(() => {
    const ids = new Set(doc.value.items.map((p) => p.id))
    for (const row of doc.value.rows ?? []) for (const st of row.stash ?? []) ids.add(st.id)
    return ids
  })

  /**
   * 多开实例的下一个 id：第一张用模块 id（与旧档/模板完全一致），第二张起用 `模块:2`、`模块:3`。
   * 冒号是浮窗 label 允许的字符集（`floatwin.rs` 的 label 只允许 `[a-zA-Z0-9-/:_]`，
   * 所以别换成 `#`/`~`/空格）。已删掉的实例 id 可以被复用 —— 数据是按模块共享的，不存在归属问题。
   */
  const nextInstanceId = (moduleId: string): string => {
    const used = placedIds.value
    if (!used.has(moduleId)) return moduleId
    for (let n = 2; ; n++) {
      const id = `${moduleId}:${n}`
      if (!used.has(id)) return id
    }
  }

  return {
    reg,
    doc,
    warnings,
    canUndo: computed(() => E.canUndo(hist.value)),
    canRedo: computed(() => E.canRedo(hist.value)),
    /** 最近一次版面改动的时刻 —— App 用它和内容历史比"谁更近" */
    lastAt: computed(() => hist.value.present.at),
    /** 版面上已出现的实例 id（含折叠现场 —— 模块库据此标「已在版面」） */
    placedIds,
    /** 模块库的完整清单：**多开之后不再过滤已放置的模块**（同一个模块可以放第二张） */
    available: computed(() => reg.slice()),

    /**
     * 已装扩展卡 → 注册表 ext 段的整体替换（`useExtensions` 在 extCards 变化时调）。
     * 卡 → ModuleDef 的映射与撞车防御都在引擎 `extModuleDefs`（纯函数，单测钉住）；
     * 内置段一根手指都不碰。
     */
    setExtensions: (cards: readonly E.ExtCard[]) => {
      reg.splice(baseLen, reg.length - baseLen, ...E.extModuleDefs(opts.registry, cards))
    },

    /** 加卡：模块 id 进来，实例 id 由 nextInstanceId 生成（第一张仍是模块 id） */
    add: (id: string, x: number, y: number, variant?: string) =>
      apply(E.addItem(doc.value, reg, id, x, y, variant, nextInstanceId(id))),
    move: (id: string, x: number, y: number, mergeKey?: string) => apply(E.moveItem(doc.value, id, x, y), mergeKey),
    resize: (id: string, w: number, h: number, mergeKey?: string) => apply(E.resizeItem(doc.value, reg, id, w, h), mergeKey),
    setVariant: (id: string, variant: string) => apply(E.setVariant(doc.value, reg, id, variant)),
    cycleVariant: (id: string) => {
      const p = doc.value.items.find((q) => q.id === id)
      const mod = p && E.findModule(reg, E.moduleIdOf(p))
      if (!p || !mod || mod.variants.length < 2) return
      const i = mod.variants.findIndex((v) => v.id === p.variant)
      apply(E.setVariant(doc.value, reg, id, mod.variants[(i + 1) % mod.variants.length].id))
    },
    remove: (id: string) => apply(E.removeItem(doc.value, id)),
    moveMany: (ids: readonly string[], dx: number, dy: number, mergeKey?: string) =>
      apply(E.moveMany(doc.value, ids, dx, dy), mergeKey),
    removeMany: (ids: readonly string[]) => apply(E.removeMany(doc.value, ids)),
    /* ---- 行容器（单层分组，引擎 rows.ts）---- */
    /** 成组为行：成员与其下方内容下移 1 行腾出行头（见 rows.ts 文件头的偏离说明） */
    groupIntoRow: (ids: readonly string[], title?: string) => apply(E.groupIntoRow(doc.value, ids, title)),
    /** 解组：收回行头那一行；折叠中的行先展开 */
    ungroupRow: (rowId: string) => apply(E.ungroupRow(doc.value, rowId)),
    renameRow: (rowId: string, title: string) => apply(E.setRowTitle(doc.value, rowId, title)),
    /** 折叠/展开：可逆的整段位移（折叠=隐藏成员+下方上移，展开=还原+让位） */
    toggleRow: (rowId: string) => apply(E.toggleRowCollapsed(doc.value, rowId)),
    /**
     * 一键重排该行成员（阶段 C）：参数一并存进 row.auto，供「所有行重排」复用。
     * 显式动作、可 Ctrl+Z —— 刻意不做连续自动（不偷覆盖手工微调）。
     */
    reflowRow: (rowId: string, params: E.AutoParams) => {
      const next = E.autoLayout(doc.value, reg, { row: rowId }, params)
      if (!next) return
      apply({ ...next, rows: (next.rows ?? []).map((r) => (r.id === rowId ? { ...r, auto: { per: params.per, rowH: params.rowH } } : r)) })
    },
    /** 所有行各按自己存的参数重排一遍（排布菜单入口） */
    reflowAllRows: () => apply(E.autoLayoutAllRows(doc.value, reg)),
        /** 行头拖动 = 整组移动（复用 moveMany 的语义与让位规则） */
    moveRow: (rowId: string, dx: number, dy: number) => {
      const members = doc.value.items.filter((p) => p.row === rowId).map((p) => p.id)
      if (members.length) apply(E.moveMany(doc.value, members, dx, dy))
    },
    toggleLockMany: (ids: readonly string[]) => {
      const set = new Set(ids)
      const next = !doc.value.items.find((p) => set.has(p.id))?.locked
      apply({ ...doc.value, items: doc.value.items.map((p) => (set.has(p.id) ? { ...p, locked: next } : p)) })
    },
    toggleLock: (id: string) => apply(E.toggleLock(doc.value, id)),
    setTitle: (id: string, title: string | null) => apply(E.setItemTitle(doc.value, id, title)),
    clear: () => apply(E.clearLayout(doc.value)),
    /** 按需整理：聚拢空洞，一步可撤销；锁定项不参与 */
    tidy: () => apply(E.tidyLayout(doc.value)),
    /** 撑满：先聚拢再把每个行带按原比例铺满整行 */
    spread: () => apply(E.spreadLayout(doc.value)),
    /** 按内容收紧高度：只变矮不变高，且不低于形态最小尺寸 */
    fitToContent: (wanted: Record<string, number>) => apply(E.fitHeights(doc.value, reg, wanted)),
    /** 换模板（见下面 applyTemplate）；返回 false 表示模板 id 不存在 */
    applyTemplate,
    setTemplateChoice,
    templateId,
    firstRun,
    restoreStarter: () => applyTemplate(E.DEFAULT_TEMPLATE_ID),
    /**
     * 整份替换成快照 —— 编辑器的「取消」用它（进编辑器时拍一张，取消时还原）。
     * 刻意复用 apply 而不是直接赋值：还原因此**本身就是一步可撤销的历史**
     * （Ctrl+Z 能把"取消"再踩回去），而不是把历史撕开一个洞。
     */
    restore: (snapshot: E.LayoutDoc) => apply(snapshot),
    undo: () => {
      hist.value = E.undo(hist.value)
      doc.value = E.currentDoc(hist.value)
      storage.set(key, E.docToJson(doc.value))
    },
    redo: () => {
      hist.value = E.redo(hist.value)
      doc.value = E.currentDoc(hist.value)
      storage.set(key, E.docToJson(doc.value))
    },
    exportJson: () => E.docToJson(doc.value),
    importJson: (raw: string) => {
      const r = E.parseLayout(raw, reg)
      warnings.value = r.warnings
      apply(r.doc)
    },
  }
}

export type LayoutStore = ReturnType<typeof createLayoutStore>
