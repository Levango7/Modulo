/**
 * 卡面聚光 / 指针倾斜的**判定与绑定层**（视觉刀 1·三，2026-11-28）。
 *
 * ## 为什么单独一个文件
 *
 * 本仓没有组件测试设施（无 @vue/test-utils / jsdom）——判断与几何留在组件里就只剩 E2E 一层兜底。
 * 这里把三块可断言的东西抽成纯函数 / 最小依赖函数，锁进 `tests/vue/cardFx.test.ts`：
 * 环境判定（shouldSkipCardFx）、倾角几何（tiltFor）、变量写入（attachCardFx）。
 * 真机的视觉链（玻璃壳 / 聚光 / 倾斜的手感）由 E2E 之外的真机走查兜，与 instanceData.ts
 * 同一条分工纪律。
 *
 * ## 环境守卫为什么必须在 JS 侧
 *
 * `tokens.css` 的 `prefers-reduced-motion` 全局钳只压得住 CSS 动画 / 过渡时长，
 * **钳不住 JS pointermove 往 CSS 变量里写的倾角**——变量一变，transform 就跟着变，
 * 对 reduce 用户仍是持续运动。所以 `(prefers-reduced-motion: reduce)` 与
 * `(hover: none)`（触屏）任一命中就完全不绑监听，而不是绑了再靠 CSS 抹平。
 */

/**
 * 是否该跳过指针效果：reduced-motion 或 hover:none（触屏）任一命中即 true。
 *
 * 只依赖 `matchMedia` 的返回形状（`{ matches }`），node 单测用手写替身即可驱动；
 * 真 DOM 契约由浏览器保证。matchMedia 缺席的极端 webview 也按"跳过"处理——
 * 效果是锦上添花，缺了探测能力就退回静态卡面，不能反着赌。
 */
export function shouldSkipCardFx(win: { matchMedia(q: string): { matches: boolean } }): boolean {
  if (typeof win.matchMedia !== 'function') return true
  return win.matchMedia('(prefers-reduced-motion: reduce)').matches || win.matchMedia('(hover: none)').matches
}

/**
 * 指针在卡内相对位置 → rotateX / rotateY 字符串。
 *
 * ## 口径
 *
 * - 中心为 0，边缘 ≤ maxDeg；越界（指针滑出卡外）钳回边缘，角度不放大。
 * - 方向是"指针在哪侧、哪侧朝观察者抬头"：指针在上边 → `rotateX` 负角
 *   （CSS 的 y 轴朝下，正角把顶边推离观察者，负角才是"上边抬头"）；
 *   指针在右边 → `rotateY` 负角（正角把右边推离）。与原型同向。
 * - 宽或高非正（未布局的瞬时 0 尺寸）直接回 0，不出 NaN 角度。
 */
export function tiltFor(px: number, py: number, w: number, h: number, maxDeg = 4): { rx: string; ry: string } {
  if (w <= 0 || h <= 0 || !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(maxDeg)) {
    return { rx: '0deg', ry: '0deg' }
  }
  const nx = clamp((px - w / 2) / (w / 2))
  const ny = clamp((py - h / 2) / (h / 2))
  const rx = round2(ny * maxDeg)
  const ry = round2(-nx * maxDeg)
  return { rx: `${rx}deg`, ry: `${ry}deg` }
}

/**
 * 给一张卡的根元素挂上指针效果：pointermove / pointerleave → rAF 合帧后
 * 只写 CSS 变量 `--mx / --my`（聚光位置）与 `--rx / --ry`（倾角）。
 *
 * - **每帧一次 rect 读取**：pointermove 事件远密于帧，事件里只记坐标，
 *   rect 与角度的计算搬进 rAF 回调，一帧最多一次 `getBoundingClientRect`。
 * - leave 时倾角归零（聚光位置留着无妨——聚光层只在 hover 时可见）；
 *   离开同时撤销未决的 rAF，避免"离开后还写一帧"。
 * - 环境命中 shouldSkipCardFx 时不绑任何监听，返回空函数。
 * - 返回解绑函数；幂等（重复调用无害）。
 */
export function attachCardFx(el: HTMLElement): () => void {
  if (shouldSkipCardFx(window)) return () => {}

  let frame = 0
  let lastX = 0
  let lastY = 0

  const apply = (): void => {
    frame = 0
    const r = el.getBoundingClientRect()
    const dx = lastX - r.left
    const dy = lastY - r.top
    const tilt = tiltFor(dx, dy, r.width, r.height)
    el.style.setProperty('--mx', `${Math.round(dx)}px`)
    el.style.setProperty('--my', `${Math.round(dy)}px`)
    el.style.setProperty('--rx', tilt.rx)
    el.style.setProperty('--ry', tilt.ry)
  }

  const onMove = (e: PointerEvent): void => {
    lastX = e.clientX
    lastY = e.clientY
    if (!frame) frame = window.requestAnimationFrame(apply)
  }

  const onLeave = (): void => {
    if (frame) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  return () => {
    if (frame) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerleave', onLeave)
  }
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
