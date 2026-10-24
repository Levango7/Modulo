/**
 * 把卡片脱离成桌面浮窗时的**几何计算**（App.vue `detachCard` 里那几行的纯函数化）。
 *
 * 首次脱离的窗口尺寸取该卡在**当前形态下的理想格数**换算成像素，口径与浏览态一致：
 * 12 列等分舞台宽、列间 gap 从总宽里先扣掉。之后由用户拖出来/缩出来的几何记忆在
 * Rust 侧，这里只管第一次。
 *
 * 下限是硬编码的：宽 240、高 160（+24 是标题栏高度，**在 round 之外** ——
 * 拆出来时逐字保留原表达式，别"顺手整理"成 round(h + 24)，那会改变进位）。
 */

import { moduleIdOf, type ModuleDef, type Placement, type VariantDef } from '@levango7/engine'

export interface DetachGeometryInput {
  /** 该卡当前形态的理想格数（缺失时按 4×3 兜底，与拆分前一致） */
  idealW?: number
  idealH?: number
}

export interface StageGeometry {
  stageW: number
  cols: number
  gap: number
  rowPx: number
}

/** 算脱离窗口的像素尺寸（已按 round 取整，调用方直接交给 floatCard） */
export function detachGeometry(v: DetachGeometryInput | undefined, g: StageGeometry): { w: number; h: number } {
  const colW = Math.max(40, (g.stageW - g.gap * (g.cols - 1)) / g.cols)
  const w = (v?.idealW ?? 4) * (colW + g.gap) - g.gap
  const h = (v?.idealH ?? 3) * (g.rowPx + g.gap)
  return { w: Math.round(Math.max(240, w)), h: Math.round(Math.max(160, h)) + 24 }
}

/**
 * 脱离浮窗前，按实例 id 找出该卡**当前形态**的定义（App.vue `detachCard` 里那两行
 * 查找的纯函数化）：版面里按 id 找条目 → 注册表里按 id 找模块 → 在模块的形态里
 * 找条目上记的那个（条目没记形态时用模块的默认形态），找不到退回第一个形态。
 *
 * 注册表查找必须走 `moduleIdOf(p)`（2026-10-25 修，此前是已知缺陷，见 §12.20）：
 * 多实例下第二个实例的 id 是 `模块:2`（见 `Placement.id` 的注释），拿实例 id 直接
 * 查注册表必然落空 ⇒ 形态兜底 4×3，浮窗按默认尺寸算而不是按这张卡的真实理想尺寸。
 * 引擎侧（ops.ts / validate.ts / fitHeight.ts）一律 `moduleIdOf(p)`，本处原来漏了。
 * 版面里找不到条目（版面外 id）时无从得知模块 ⇒ undefined，由调用方按 4×3 兜底；
 * 畸形 `X:2`（缺 `module` 字段）到不了这里 —— sanitize 层会跳过它并回写 module
 * （validate.ts），且 `moduleIdOf` 只认 `p.module ?? p.id`，不解析 id 后缀。
 */
export function resolveDetachVariant(
  items: readonly Placement[],
  reg: readonly ModuleDef[],
  id: string,
): VariantDef | undefined {
  const p = items.find((q) => q.id === id)
  const mod = p ? reg.find((m) => m.id === moduleIdOf(p)) : undefined
  return mod?.variants.find((x) => x.id === (p?.variant ?? mod?.defaultVariant)) ?? mod?.variants[0]
}
