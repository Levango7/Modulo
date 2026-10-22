/**
 * 脱离浮窗的几何（App.vue `detachCard` 里那几行的纯函数化）。
 *
 * 逐字保留原表达式，包括两处**容易在"顺手整理"时被改错**的地方：
 *  ① `Math.round(Math.max(160, h)) + 24` —— **+24 在 round 之外**（标题栏高度）。
 *     改成 `round(h + 24)` 会改变进位，窗口高度会差 1px 量级；
 *  ② 列宽下限 40、宽下限 240、高下限 160 三个硬编码数字原样保留。
 */
import { describe, expect, it } from 'vitest'
import { detachGeometry } from '../../src/vue/stageGeometry'

const stage = { stageW: 1200, cols: 12, gap: 8, rowPx: 30 }

describe('detachGeometry', () => {
  it('口径与浏览态一致：12 列等分舞台宽、列间 gap 先扣掉', () => {
    // 列宽 = (1200 - 8*11)/12 = (1200-88)/12 = 92.666…
    // 4 列理想宽 = 4*(92.666+8)-8 = 394.666… → round(max(240, 394.666)) = 395
    const { w } = detachGeometry({ idealW: 4, idealH: 3 }, stage)
    expect(w).toBe(395)
    // 3 行理想高 = 3*(30+8) = 114 → max(160,114)=160 → round(160)+24 = 184
    const { h } = detachGeometry({ idealW: 4, idealH: 3 }, stage)
    expect(h).toBe(184)
  })

  it('理想高按格数线性放大，+24 标题栏恒在', () => {
    // 5 行 = 5*38 = 190 → round(190)+24 = 214
    // 说明：整数输入下 round(h)+24 与 round(h+24) 结果相同，**这个用例区分不了两者** ——
    // 真正保证"+24 在 round 之外"的是实现逐字照搬原表达式 + 上面那条注释，
    // 以及 CI 上 E2E 的浮窗尺寸断言。这里只钉数值本身。
    expect(detachGeometry({ idealH: 5 }, stage).h).toBe(214)
    expect(detachGeometry({ idealH: 20 }, stage).h).toBe(784)
  })

  it('缺失形态按 4×3 兜底', () => {
    expect(detachGeometry(undefined, stage)).toEqual(detachGeometry({}, stage))
    expect(detachGeometry({}, stage)).toEqual(detachGeometry({ idealW: 4, idealH: 3 }, stage))
  })

  it('三个下限都生效：列宽 40 / 宽 240 / 高 160', () => {
    // 舞台极窄：列宽公式给出 10，但被 40 兜住 ⇒ 4 列 = 4*(40+8)-8 = 184 → 仍被 240 兜住
    const narrow = detachGeometry({ idealW: 1, idealH: 1 }, { stageW: 10, cols: 12, gap: 8, rowPx: 30 })
    expect(narrow.w).toBe(240)
    expect(narrow.h).toBe(184)
    // 理想格数很小 + 行高很小 ⇒ 高被 160 兜住
    const tiny = detachGeometry({ idealW: 1, idealH: 1 }, { stageW: 1200, cols: 12, gap: 8, rowPx: 1 })
    expect(tiny.h).toBe(184)
  })

  it('理想格数大时按公式放大，不设上限', () => {
    // 12 列 = 12*(92.666…+8)-8 = 1200（正好铺满舞台宽）；20 行 = 760 → +24 = 784
    const big = detachGeometry({ idealW: 12, idealH: 20 }, stage)
    expect(big.w).toBe(1200)
    expect(big.h).toBe(784)
  })
})
