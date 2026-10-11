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
  /** 菜单分组名（时间 / 记录 / 工具 / 联网 / 专注）—— 卡到 40 张时平铺菜单没法翻 */
  group?: string
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
  /** 所属行（`Row.id`）。无此字段 = 不属任何行，直接摆在画布上 */
  row?: string
}

/**
 * 行（单层分组容器）—— 版面上的一个整宽横向段。
 *
 * **行头占用真实的逻辑行**（`groupIntoRow` 插入式：成员与其下方内容整体下移一行），
 * 所以渲染零覆盖、折叠/展开是可逆的整段位移 —— 代价是"成员坐标不动"要读作
 * "成员的**相对**布局不动"（成组/解组时整体移一行收回一行）。
 *
 * 折叠时成员从 `items` 里整体移出、按**相对偏移**（`dy` 相对成员区顶部）存进
 * `stash`：偏移量锚定行头 `y`，于是嵌套折叠（折叠 A 后 B 的 y 与 stash 一起被
 * 平移）在同一个坐标系里自洽 —— 这是这个模型唯一需要想清楚的地方。
 */
export interface StashedPlacement {
  id: string
  variant: string
  x: number
  /** 相对成员区顶部（`row.y + 1`）的行偏移 */
  dy: number
  w: number
  h: number
  title?: string
  hideTitle?: boolean
  locked?: boolean
  /**
   * `true` = 折叠现场里的**带内非成员**（不是这一行的卡，但纵向坐落在成员区里）。
   * 折叠后留不下它们，移到带下方；展开时按同样的相对锚点还原、**不设** `row` 归属。
   * 没有这个标记的现场条目是成员，展开时还原归属。
   */
  guest?: true
}

export interface Row {
  id: string
  title: string
  /** 行头所在的逻辑 y */
  y: number
  collapsed?: boolean
  /** 折叠时的成员现场（相对偏移）；展开时按当前 y+1 还原 */
  stash?: StashedPlacement[]
}

export interface LayoutDoc {
  schemaVersion: number
  cols: number
  items: Placement[]
  /** 行容器；加法字段，旧档没有它时按空表处理（schemaVersion 保持 1） */
  rows?: Row[]
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
