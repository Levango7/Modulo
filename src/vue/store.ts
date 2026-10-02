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
 * 首次启动的推荐版面。
 *
 * 坐标和尺寸都是**显式**的，理由有两层：
 * - 只写坐标、让 `fillRows` 去补宽度，会把"单张卡的带"整个拉成通栏 —— 实测把 1 条内容的速记
 *   撑成 12 列横幅，空洞是没了，观感更糟。所以宽度自己排，`spreadLayout` 只当兜底。
 * - 同一带里的卡必须同高，否则撑开后会与下一带相撞，那一整带会被 `fillRows` 整行放弃
 *   （旧版留 37.9% 空洞就有这个原因：`todo` 的 `list` 形态 6 行高，跟谁都不齐）。
 *
 * 旧写法是 `clock(0,0) / todo(8,0) / sticky(0,3) / notes(2,3) / recent(0,9)`：空洞率实测 37.9%，
 * 其中 y7、y8 两整行全空（recent 的 y 是写死的，而上面的卡最高只到 y=6）。
 * 现在两带各自铺满 12 列、0 空洞，由 `tests/vue/starter.test.ts` 守着（含"任何卡不许被撑到
 * 超过理想宽 1.5 倍"这条，专门防上面那个通栏事故）。
 */
function starterDoc(reg: E.ModuleRegistry): E.LayoutDoc {
  let d = E.emptyDoc()
  // id, variant, x, y, w, h
  // 待办用 `list` 形态（4×6）竖在右侧一整列：一来首启就看到"待办是主卡"，
  // 二来它是那张**明显比内容高**的卡 —— 「收紧」这个动作得有东西可收，
  // 出厂就把每张卡都贴内容排，等于把收紧/紧凑的实测场景抹掉了（E2E 那两条就是这么挂的）。
  const plan: Array<[string, string, number, number, number, number]> = [
    ['clock', 'big', 0, 0, 5, 3],
    ['sticky', 'note', 5, 0, 3, 3],
    ['todo', 'list', 8, 0, 4, 6],
    ['notes', 'overview', 0, 3, 4, 3],
    ['recent', 'bar', 4, 3, 4, 3],
  ]
  for (const [id, variant, x, y, w, h] of plan) {
    if (!E.findModule(reg, id)) continue
    /**
     * 三步不能省：`addItem` 只按形态的 **ideal** 尺寸找空位（给它 x,y 也只是起点，
     * 放不下就自己挪走 —— 实测 12 宽的通栏被塞到下一带，于是速记成了"单卡带"，
     * 被 `fillRows` 拉成 12 列横幅），所以要 resize 到目标尺寸、再 move 回这一带的槽位。
     */
    d = E.addItem(d, reg, id, x, y, variant) ?? d
    d = E.resizeItem(d, reg, id, w, h) ?? d
    d = E.moveItem(d, id, x, y) ?? d
  }
  return E.spreadLayout(d)
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
