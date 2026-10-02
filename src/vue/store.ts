import { computed, shallowRef } from 'vue'
import * as E from '../engine'

export interface StorageAdapter {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) }
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
}) {
  const reg = opts.registry
  const storage = opts.storage ?? browserStorage()
  const key = opts.key ?? 'modulo.layout.v1'
  /** 只是"上次选了哪张模板"的记录，用于高亮；用户手动拖过之后它就不再代表版面了。 */
  const templateKey = opts.templateKey ?? 'modulo.template.v1'

  const parsed = E.parseLayout(storage.get(key) ?? '', reg)
  const usedStarter = parsed.doc.items.length === 0
  const initial = usedStarter ? starterDoc(reg) : parsed.doc
  /** 推荐布局也要立刻落盘：否则用户不动版面就永远没有存档，导出/迁移会拿到空布局 */
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

  return {
    reg,
    doc,
    warnings,
    canUndo: computed(() => E.canUndo(hist.value)),
    canRedo: computed(() => E.canRedo(hist.value)),
    /** 库里只展示未放置的模块 */
    available: computed(() => reg.filter((m) => !doc.value.items.some((p) => p.id === m.id))),

    add: (id: string, x: number, y: number, variant?: string) => apply(E.addItem(doc.value, reg, id, x, y, variant)),
    move: (id: string, x: number, y: number, mergeKey?: string) => apply(E.moveItem(doc.value, id, x, y), mergeKey),
    resize: (id: string, w: number, h: number, mergeKey?: string) => apply(E.resizeItem(doc.value, reg, id, w, h), mergeKey),
    setVariant: (id: string, variant: string) => apply(E.setVariant(doc.value, reg, id, variant)),
    cycleVariant: (id: string) => {
      const p = doc.value.items.find((q) => q.id === id)
      const mod = p && E.findModule(reg, p.id)
      if (!p || !mod || mod.variants.length < 2) return
      const i = mod.variants.findIndex((v) => v.id === p.variant)
      apply(E.setVariant(doc.value, reg, id, mod.variants[(i + 1) % mod.variants.length].id))
    },
    remove: (id: string) => apply(E.removeItem(doc.value, id)),
    moveMany: (ids: readonly string[], dx: number, dy: number, mergeKey?: string) =>
      apply(E.moveMany(doc.value, ids, dx, dy), mergeKey),
    removeMany: (ids: readonly string[]) => apply(E.removeMany(doc.value, ids)),
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
