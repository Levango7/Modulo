import type { LayoutDoc } from './types'

export interface Step {
  doc: LayoutDoc
  /** 同 mergeKey 且落在合并窗口内的连续提交折叠成一步（一次拖拽 / 一段连续输入） */
  mergeKey?: string
  at: number
}

export interface HistoryState {
  past: Step[]
  present: Step
  future: Step[]
  limit: number
}

export const DEFAULT_LIMIT = 50
export const DEFAULT_MERGE_WINDOW_MS = 300

export function createHistory(doc: LayoutDoc, limit: number = DEFAULT_LIMIT): HistoryState {
  return { past: [], present: { doc, at: 0 }, future: [], limit }
}

export function currentDoc(h: HistoryState): LayoutDoc {
  return h.present.doc
}

export function commit(
  h: HistoryState,
  doc: LayoutDoc,
  opts: { at: number; mergeKey?: string; mergeWindowMs?: number },
): HistoryState {
  if (doc === h.present.doc) return h
  const mergeWindow = opts.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS
  const canMerge =
    !!opts.mergeKey &&
    h.present.mergeKey === opts.mergeKey &&
    opts.at - h.present.at <= mergeWindow
  if (canMerge) {
    return { ...h, present: { doc, mergeKey: opts.mergeKey, at: opts.at }, future: [] }
  }
  const past = [...h.past, h.present]
  return {
    past: past.length > h.limit ? past.slice(past.length - h.limit) : past,
    present: { doc, mergeKey: opts.mergeKey, at: opts.at },
    future: [],
    limit: h.limit,
  }
}

export function undo(h: HistoryState): HistoryState {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [{ doc: h.present.doc, at: h.present.at }, ...h.future],
    limit: h.limit,
  }
}

export function redo(h: HistoryState): HistoryState {
  const next = h.future[0]
  if (!next) return h
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
    limit: h.limit,
  }
}

export function canUndo(h: HistoryState): boolean {
  return h.past.length > 0
}

export function canRedo(h: HistoryState): boolean {
  return h.future.length > 0
}
