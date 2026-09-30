import type { Rect } from './types'

export function collides(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function anyCollides(list: readonly Rect[], r: Rect): boolean {
  return list.some((q) => collides(q, r))
}

export function maxRow(items: readonly Rect[]): number {
  let m = 0
  for (const p of items) m = Math.max(m, p.y + p.h)
  return m
}

/** 注意：当 max < min 时返回 min（调用方须先保证尺寸不超过 cols） */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export function isInt(n: number | undefined): n is number {
  return Number.isInteger(n)
}
