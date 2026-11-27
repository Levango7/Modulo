/**
 * 卡片原位展开（FLIP）的**几何判定层**（视觉刀 1·四，2026-11-28）。
 *
 * 只算两帧动画该从哪到哪：源矩形 → 居中放大后的目标矩形。缩放是等比的 ——
 * 展开体与源卡是同一张卡、同一份内容，等比飞行途中不会出现"内容先变形再回弹"的错位感。
 * 真正的挂载、WAAPI 播放与关闭回收留在 GridLayout.vue。
 */

/** 展开体四周要留的视口边距（px）——不贴边、不越界，均由它兜 */
const MARGIN = 24

/** 展开体尺寸上限（px）：比上限大的源卡不再放大，只居中 */
const MAX_W = 680
const MAX_H = 560

export interface FlipRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * CSSStyleMap 形状的一帧：值带 px 单位，可直接喂 WAAPI 的 keyframes。
 * **是 type 别名不是 interface**——lib.dom 的 `Keyframe` 带字符串索引签名，
 * interface 没有隐式索引签名、赋不进去（TS2322），type 别名才有。
 */
export type FlipFrame = {
  left: string
  top: string
  width: string
  height: string
}

export interface FlipPlan {
  from: FlipFrame
  to: FlipFrame
  target: FlipRect
}

/**
 * 源矩形 + 视口 → 展开动画的两帧与目标矩形。
 *
 * ## 口径
 *
 * 1. **只放大到上限**：目标尺寸 = 源尺寸 × `max(1, min(maxW/w, maxH/h))` ——
 *    比上限盒大的源卡（大视口里的大卡）保持原尺寸居中，不倒缩。
 * 2. **不超视口**：再与"视口减边距能放下的极限"取 min —— 小视口里哪怕缩小也要装下
 *    （"不超视口"的优先级高于"只放大"）。
 * 3. **居中**：目标矩形以视口中心放置。
 * 4. 边距自适应下限：视口小到留不出 24px（< 96px 的极端）时边距按视口 1/4 收缩、
 *    保底 4px，让"钳制"永远给出一个正的可视盒，不出负尺寸。
 * 5. 非正/非法的源矩形不参与除法，恒等返回——调用方拿到一帧"原地不动"的计划，不出 NaN。
 */
export function flipFrames(src: FlipRect, vw: number, vh: number, maxW = MAX_W, maxH = MAX_H): FlipPlan {
  const ok =
    [src.left, src.top, src.width, src.height, vw, vh, maxW, maxH].every((n) => Number.isFinite(n)) &&
    src.width > 0 &&
    src.height > 0 &&
    vw > 0 &&
    vh > 0
  if (!ok) {
    const same = px(src)
    return { from: same, to: same, target: { ...src } }
  }
  const pad = Math.min(MARGIN, Math.max(4, Math.floor(Math.min(vw, vh) / 4)))
  const grow = Math.max(1, Math.min(maxW / src.width, maxH / src.height))
  const fit = Math.min((vw - 2 * pad) / src.width, (vh - 2 * pad) / src.height)
  const scale = Math.max(0, Math.min(grow, fit))
  const target: FlipRect = {
    left: (vw - src.width * scale) / 2,
    top: (vh - src.height * scale) / 2,
    width: src.width * scale,
    height: src.height * scale,
  }
  return { from: px(src), to: px(target), target }
}

function px(r: FlipRect): FlipFrame {
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  }
}

/** 展开函数的注入形状：GridLayout provide，卡组件（TodoCard 等）inject 后调用 */
export type CardExpandFn = (moduleId: string, placementId: string, sourceEl: HTMLElement) => void
