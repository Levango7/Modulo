import type { ModuleDef, VariantDef } from './types'

/**
 * 投影后宽度不足时挑一个装得下的形态：优先保留用户当前形态，
 * 否则取能装下的最大者（面积优先，并列时取更宽的），一个都装不下返回 null → 上层收起该卡。
 */
export function pickVariantForSize(
  mod: ModuleDef,
  preferredId: string,
  availW: number,
  availH: number,
): VariantDef | null {
  const preferred = mod.variants.find((v) => v.id === preferredId)
  if (preferred && preferred.minW <= availW && preferred.minH <= availH) return preferred

  const fits = mod.variants.filter((v) => v.minW <= availW && v.minH <= availH)
  if (fits.length === 0) return null
  return fits.sort(
    (a, b) => b.minW * b.minH - a.minW * a.minH || b.minW - a.minW || a.id.localeCompare(b.id),
  )[0]
}
