import type { VariantDef } from './types'

export type FitLevel = 'below' | 'mid' | 'ideal' | 'room'

export interface Fit {
  level: FitLevel
  label: string
}

/** 格子尺寸 vs 形态 min/ideal 的适配状态：编辑器徽标与拖拽警示共用一个口径 */
export function fitState(size: { w: number; h: number }, v: VariantDef): Fit {
  if (size.w < v.minW || size.h < v.minH) {
    return { level: 'below', label: `低于最小 ${v.minW}×${v.minH}` }
  }
  if (size.w >= v.idealW && size.h >= v.idealH) {
    return size.w === v.idealW && size.h === v.idealH
      ? { level: 'ideal', label: '正好铺满' }
      : { level: 'room', label: `弹性空间 · 推荐 ${v.idealW}×${v.idealH}` }
  }
  return { level: 'mid', label: `紧凑可读 · 推荐 ${v.idealW}×${v.idealH}` }
}

export function fitsVariant(size: { w: number; h: number }, v: VariantDef): boolean {
  return size.w >= v.minW && size.h >= v.minH
}
