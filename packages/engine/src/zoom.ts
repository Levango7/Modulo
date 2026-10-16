/**
 * 画布缩放：视图层的纯函数集。
 *
 * 纪律（ADR-007）：**缩放只属于视图层** —— 用 `transform: scale(z)` +
 * `transform-origin: 0 0` 实现，容器尺寸按 `100% / z` 补偿；引擎的投影
 * 公式（projection.ts）一个字不动，1154 条既有测试照常跑。卡片数据里
 * 永远只有逻辑坐标，zoom 状态随视图持久化，不进网格数据。
 *
 * 因此本模块只回答三个问题：
 * 1. 一个缩放值合不合法（`clampZoom`：步进量化 + 夹紧）；
 * 2. 指针在**屏幕上**的位置换算回**逻辑坐标**是多少（`clientToLogical`，
 *    拖拽命中、双击定位都用它）；
 * 3. 视口平移偏移怎么累积（`panBy`）。
 *
 * 全部是纯函数：不碰任何宿主环境对象（无副作用、无全局状态），可在 node 环境单测。
 */

/** 缩放边界与步长。0.5x 起（再小字就看不清了），2x 封顶，滚轮一步 10% */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.0
export const ZOOM_STEP = 0.1

/** 缩放的中性值。坏输入（NaN/∞/≤0）诚实回退到 1:1，与仓库"降级要诚实"同一口径 */
export const ZOOM_NEUTRAL = 1

/**
 * 把任意缩放值整理成合法值：先按 0.1 步进量化（滚轮/滑杆的脏值归格），
 * 再夹紧到 [ZOOM_MIN, ZOOM_MAX]。量化在前、夹紧在后，保证出参永远在界内。
 *
 * 坏输入（NaN / ±∞ / ≤0）返回 1：一个坏掉的缩放状态不该把画布顶到
 * Infinity 尺寸，回 1:1 是唯一安全的降级。
 */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return ZOOM_NEUTRAL
  // 量化到 0.1 网格；先乘 10 取整再除回去，吃掉 0.30000000000000004 这类浮点尾巴
  const quantized = Math.round(z / ZOOM_STEP) * ZOOM_STEP
  const snapped = Math.round(quantized * 10) / 10
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped))
}

/** 容器在屏幕上的矩形（client 坐标系）。用结构类型而非 DOMRect，纯函数不依赖 DOM 构造器 */
export interface ClientRectLike {
  left: number
  top: number
}

/**
 * 屏幕坐标 → 逻辑坐标。视图被 `scale(z)` 放大 z 倍后，指针在屏幕上移动
 * 1px 对应逻辑坐标 1/z px，所以是**除**不是乘。
 *
 * zoom 非法（NaN/∞/≤0）时按 1:1 换算：与 `clampZoom` 同一条降级纪律，
 * 宁可退回未缩放的映射，也不给调用方 Infinity 坐标。
 */
export function clientToLogical(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  zoom: number,
): { x: number; y: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : ZOOM_NEUTRAL
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z }
}

/** 视口平移偏移（逻辑坐标下，内容原点相对容器的位移） */
export interface PanOffset {
  ox: number
  oy: number
}

/**
 * 平移累积：把本次位移加到当前偏移上。**故意不夹紧** —— 画布内容尺寸
 * 是调用方才知道的事，纯函数拿不到就不装懂；越界回弹（若有）属于
 * 交互层的事，不在这里做。
 */
export function panBy(offset: PanOffset, dx: number, dy: number): PanOffset {
  return { ox: offset.ox + dx, oy: offset.oy + dy }
}
