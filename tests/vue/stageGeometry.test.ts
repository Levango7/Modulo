/**
 * 脱离浮窗的几何（App.vue `detachCard` 里那几行的纯函数化）。
 *
 * 逐字保留原表达式，包括两处**容易在"顺手整理"时被改错**的地方：
 *  ① `Math.round(Math.max(160, h)) + 24` —— **+24 在 round 之外**（标题栏高度）。
 *     改成 `round(h + 24)` 会改变进位，窗口高度会差 1px 量级；
 *  ② 列宽下限 40、宽下限 240、高下限 160 三个硬编码数字原样保留。
 */
import { describe, expect, it } from 'vitest'
import type { Placement } from '@levango7/engine'
import { detachGeometry, resolveDetachVariant } from '../../src/vue/stageGeometry'

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

describe('resolveDetachVariant', () => {
  // 两个模块：clock（默认 big，三个形态）/ note（默认 note，两个形态）
  const reg = [
    {
      id: 'clock',
      title: '时钟',
      defaultVariant: 'big',
      variants: [
        { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
        { id: 'minimal', name: '极简', minW: 2, minH: 1, idealW: 2, idealH: 1 },
        { id: 'lunar', name: '日期', minW: 2, minH: 2, idealW: 3, idealH: 2 },
      ],
    },
    {
      id: 'note',
      title: '便签',
      defaultVariant: 'note',
      variants: [
        { id: 'note', name: '便签', minW: 2, minH: 2, idealW: 3, idealH: 3 },
        { id: 'wide', name: '宽便签', minW: 4, minH: 2, idealW: 6, idealH: 2 },
      ],
    },
  ]
  const items = [
    { id: 'clock', variant: 'minimal', x: 0, y: 0, w: 2, h: 1 },
    // 第二实例：id 是 `模块:2`，并带 module 字段记住自己属于哪个模块 —— 引擎建实例时
    // 就这么写（ops.ts:49），sanitize 层也会回写（validate.ts:70）。2026-10-25 修缺陷前
    // 这个夹具没带 module，连"正确代码"都过不了，是不真实的最小夹具。
    { id: 'clock:2', module: 'clock', variant: 'big', x: 2, y: 0, w: 4, h: 3 },
    { id: 'note', variant: 'wide', x: 0, y: 2, w: 6, h: 2 },
  ]

  it('条目记了形态 → 返回该形态', () => {
    expect(resolveDetachVariant(items, reg, 'clock')?.id).toBe('minimal')
    expect(resolveDetachVariant(items, reg, 'note')?.id).toBe('wide')
  })

  it('条目没记 variant（旧档）→ 用模块的 defaultVariant', () => {
    // 旧档条目没记 variant（`Placement.variant` 是后来才必填的）：那时条目 id 就是模块 id，
    // 所以拿一个模块 id 单造一条旧档条目来钉这条路径。规格初版把 id 写成 'legacy'，
    // 但注册表里没有这个模块 —— 模块查找落空只能返回 undefined，题意反而钉不到。
    const legacyItems = [{ id: 'clock', x: 0, y: 4, w: 3, h: 3 } as unknown as Placement]
    expect(resolveDetachVariant(legacyItems, reg, 'clock')?.id).toBe('big')
  })

  it('条目记了不存在的形态 id → 兜底第一个形态', () => {
    const bad = [{ id: 'clock', variant: 'nope', x: 0, y: 0, w: 2, h: 1 }]
    expect(resolveDetachVariant(bad, reg, 'clock')?.id).toBe('big')
  })

  it('条目不在版面里（id 找不到）→ undefined（版面外 id 无从得知模块）', () => {
    // 2026-10-25 修 clock:2 前的形状是「仍按裸 id 命中模块、返回默认形态」——
    // 那正是缺陷的一半（拿实例 id 查模块表）。现在统一：找不到条目就找不到模块，
    // 由调用方按 4×3 兜底。该路径实际不可达（detachCard 的 id 只来自渲染中的卡）。
    expect(resolveDetachVariant([], reg, 'clock')).toBeUndefined()
  })

  it('多实例第二例按 module 字段解析到模块 → 返回条目记的形态（2026-10-25 修缺陷）', () => {
    // 修缺陷前：`clock:2` 查不到模块 → undefined → 浮窗按 4×3 默认尺寸算。
    // 现在：module 字段解析到 clock 模块，按条目记的 variant 取形态。
    expect(resolveDetachVariant(items, reg, 'clock:2')?.id).toBe('big')
  })

  it('第二实例的浮窗按真实形态算宽度，不再是 4×3 兜底（修缺陷的可观察收益）', () => {
    // 取一个 3×2 形态（lunar）的第二例：真实窗口宽 = 3 列 = round(3*(92.667+8)-8) = 294；
    // 缺陷期形态落空 → 4×3 兜底 = 395。宽下限 240 拦不住 294，这条断言有射程。
    const lunar2 = [{ id: 'clock:2', module: 'clock', variant: 'lunar', x: 0, y: 0, w: 3, h: 2 }]
    expect(detachGeometry(resolveDetachVariant(lunar2, reg, 'clock:2'), stage).w).toBe(294)
    // 对照：同一张卡在缺陷期会落到 4×3（395）
    expect(detachGeometry(undefined, stage).w).toBe(395)
  })

  it('注册表为空 → undefined', () => {
    expect(resolveDetachVariant(items, [], 'clock')).toBeUndefined()
  })
})
