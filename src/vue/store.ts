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

/** 首次启动的推荐布局：按各模块 ideal 尺寸铺一张能直接用的版面 */
function starterDoc(reg: E.ModuleRegistry): E.LayoutDoc {
  let d = E.emptyDoc()
  const plan: Array<[string, string, number, number]> = [
    ['clock', 'big', 0, 0],
    ['todo', 'list', 8, 0],
    ['sticky', 'note', 0, 3],
    ['notes', 'overview', 2, 3],
    ['recent', 'bar', 0, 9],
  ]
  for (const [id, variant] of plan) {
    if (!E.findModule(reg, id)) continue
    const at = plan.find((p) => p[0] === id)!
    d = E.addItem(d, reg, id, at[2], at[3], variant) ?? d
  }
  return d
}

export function createLayoutStore(opts: { registry: E.ModuleRegistry; storage?: StorageAdapter; key?: string }) {
  const reg = opts.registry
  const storage = opts.storage ?? browserStorage()
  const key = opts.key ?? 'modulo.layout.v1'

  const parsed = E.parseLayout(storage.get(key) ?? '', reg)
  const usedStarter = parsed.doc.items.length === 0
  const initial = usedStarter ? starterDoc(reg) : parsed.doc
  /** 推荐布局也要立刻落盘：否则用户不动版面就永远没有存档，导出/迁移会拿到空布局 */
  if (usedStarter) storage.set(key, E.docToJson(initial))

  const doc = shallowRef<E.LayoutDoc>(initial)
  const hist = shallowRef<E.HistoryState>(E.createHistory(initial))
  const warnings = shallowRef<string[]>(parsed.warnings)

  function apply(next: E.LayoutDoc | null): void {
    if (!next || next === doc.value) return
    hist.value = E.commit(hist.value, next, { at: Date.now() })
    doc.value = E.currentDoc(hist.value)
    storage.set(key, E.docToJson(doc.value))
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
    move: (id: string, x: number, y: number) => apply(E.moveItem(doc.value, id, x, y)),
    resize: (id: string, w: number, h: number) => apply(E.resizeItem(doc.value, reg, id, w, h)),
    setVariant: (id: string, variant: string) => apply(E.setVariant(doc.value, reg, id, variant)),
    cycleVariant: (id: string) => {
      const p = doc.value.items.find((q) => q.id === id)
      const mod = p && E.findModule(reg, p.id)
      if (!p || !mod || mod.variants.length < 2) return
      const i = mod.variants.findIndex((v) => v.id === p.variant)
      apply(E.setVariant(doc.value, reg, id, mod.variants[(i + 1) % mod.variants.length].id))
    },
    remove: (id: string) => apply(E.removeItem(doc.value, id)),
    moveMany: (ids: readonly string[], dx: number, dy: number) => apply(E.moveMany(doc.value, ids, dx, dy)),
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
    restoreStarter: () => apply(starterDoc(reg)),
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
