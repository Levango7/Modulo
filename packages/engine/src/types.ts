export const LOGICAL_COLS = 12
export const TITLE_MAX = 24
export const SCHEMA_VERSION = 1

export interface VariantDef {
  id: string
  name: string
  /** 内容完整可见的最小格 */
  minW: number
  minH: number
  /** 内容正好铺满的推荐格 */
  idealW: number
  idealH: number
}

export interface ModuleDef {
  id: string
  title: string
  /** 一句话说清这张卡是干什么的 —— 「添加卡片」菜单里显示它（选卡的人不该靠名字猜） */
  blurb?: string
  defaultVariant: string
  variants: VariantDef[]
}

export type ModuleRegistry = readonly ModuleDef[]

export interface Placement {
  id: string
  variant: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  hideTitle?: boolean
  locked?: boolean
}

export interface LayoutDoc {
  schemaVersion: number
  cols: number
  items: Placement[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function emptyDoc(): LayoutDoc {
  return { schemaVersion: SCHEMA_VERSION, cols: LOGICAL_COLS, items: [] }
}

export function findModule(reg: ModuleRegistry, id: string): ModuleDef | undefined {
  return reg.find((m) => m.id === id)
}

/** 取形态；缺省 / 失效时回退 defaultVariant，再回退第一个形态 */
export function resolveVariant(mod: ModuleDef | undefined, variant?: string): VariantDef | undefined {
  if (!mod) return undefined
  return (
    mod.variants.find((v) => v.id === variant) ??
    mod.variants.find((v) => v.id === mod.defaultVariant) ??
    mod.variants[0]
  )
}

export function variantOf(reg: ModuleRegistry, moduleId: string, variant?: string): VariantDef | undefined {
  return resolveVariant(findModule(reg, moduleId), variant)
}
