import { describe, expect, it } from 'vitest'
import { ROW_UNIT_MAX_SCALE, ROW_UNIT_REF_H, rowUnitPx, rowUnitScale } from '../../src/vue/rowUnit'

/** 版面总高 = 行数 × 行高 + (行数−1) × 间距 —— 与 GridLayout 的 gridTemplateRows 同式 */
const layoutHeight = (rows: number, rowPx: number, gap = 16) => rows * rowPx + (rows - 1) * gap

describe('rowUnitScale', () => {
  it('参考窗（默认窗口 1280×800 的可用高）及更矮的窗口：倍率恒为 1，不缩格子', () => {
    expect(rowUnitScale(ROW_UNIT_REF_H)).toBe(1)
    expect(rowUnitScale(ROW_UNIT_REF_H - 1)).toBe(1)
    expect(rowUnitScale(684 - 84)).toBe(1)
    expect(rowUnitScale(0)).toBe(1)
  })

  it('挂载前量不到尺寸（0 / NaN / Infinity）时按 1 处理 —— 首屏不能因为没量到就跳', () => {
    expect(rowUnitScale(0)).toBe(1)
    expect(rowUnitScale(Number.NaN)).toBe(1)
    expect(rowUnitScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(rowUnitScale(-100)).toBe(1)
  })

  it('更高的窗口线性抬升，且封顶在 ROW_UNIT_MAX_SCALE', () => {
    expect(rowUnitScale(816)).toBeCloseTo(816 / 684, 6)
    expect(rowUnitScale(1356)).toBeCloseTo(1356 / 684, 6)
    // 封顶点：684 × 2
    expect(rowUnitScale(ROW_UNIT_REF_H * ROW_UNIT_MAX_SCALE)).toBe(ROW_UNIT_MAX_SCALE)
    expect(rowUnitScale(2076)).toBe(ROW_UNIT_MAX_SCALE)
    expect(rowUnitScale(20000)).toBe(ROW_UNIT_MAX_SCALE)
  })

  it('对窗口高度单调不减（逐像素扫一遍，比随机抽样更彻底：这是一元函数）', () => {
    let prev = rowUnitScale(0)
    for (let h = 0; h <= 2400; h++) {
      const cur = rowUnitScale(h)
      expect(cur).toBeGreaterThanOrEqual(prev)
      expect(cur).toBeGreaterThanOrEqual(1)
      expect(cur).toBeLessThanOrEqual(ROW_UNIT_MAX_SCALE)
      prev = cur
    }
  })
})

describe('rowUnitPx', () => {
  it('默认窗口下与引擎原值逐像素一致（这是"不动已经调好的观感"那条承诺）', () => {
    expect(rowUnitPx(64, ROW_UNIT_REF_H)).toBe(64)
    expect(rowUnitPx(64, 0)).toBe(64)
    expect(rowUnitPx(60, 600)).toBe(60)
  })

  it('实测四档窗口：64px 基准抬到 76 / 93 / 104 / 127', () => {
    expect(rowUnitPx(64, 816)).toBe(76) // 1408×900 → 可用高 816
    expect(rowUnitPx(64, 996)).toBe(93) // 1080 高
    expect(rowUnitPx(64, 1116)).toBe(104) // 1200 高
    expect(rowUnitPx(64, 1356)).toBe(127) // 1440 高
  })

  it('封顶时是整数（行轨落半像素会让"卡片高 = span 个行轨 + 间距"那条门禁飘）', () => {
    for (let h = 0; h <= 3000; h += 7) {
      expect(Number.isInteger(rowUnitPx(64, h))).toBe(true)
      expect(Number.isInteger(rowUnitPx(52, h))).toBe(true)
    }
    expect(rowUnitPx(64, 20000)).toBe(128)
  })

  it('非法基准值原样返回，不制造 NaN 行轨', () => {
    expect(rowUnitPx(0, 1356)).toBe(0)
    expect(rowUnitPx(-64, 1356)).toBe(-64)
    expect(rowUnitPx(Number.NaN, 1356)).toBeNaN()
  })
})

/**
 * 这一条是**回归守卫**，守的是 `docs/ARCHITECTURE.md` §10.10 那条旧结论：
 * 当初行轨用 `minmax(rowMin, 1fr)` 时，"按内容收紧"完全看不出效果 ——
 * 行数变少＝每行变高，总高不动。否掉 1fr、改成固定 px 就是为了救「收紧」。
 *
 * 现在行高开始随窗口高度变了，于是这条性质**有被重新破坏的风险**：
 * 只要有人把倍率写成"把可用高度摊给现有几行"（即依赖行数），
 * 收紧就会再次变成零效果。所以在这里把它钉死 ——
 * 同一个窗口下，行数少的版面必须严格更矮。
 */
describe('行高与行数无关（「收紧」必须仍然看得出效果）', () => {
  it('同一窗口里，行数从 12 收到 6，总高按 6 行 × 行高 + 6 × 间距严格变矮', () => {
    const gap = 16
    for (const stageH of [0, 684, 816, 996, 1356, 2076]) {
      const rowPx = rowUnitPx(64, stageH)
      const tall = layoutHeight(12, rowPx, gap)
      const short = layoutHeight(6, rowPx, gap)
      expect(short).toBeLessThan(tall)
      expect(tall - short).toBe(6 * rowPx + 6 * gap)
    }
  })

  it('倍率不含行数：同一个窗口下，第 1 行的行高与第 20 行的行高是同一个数', () => {
    // 反证写法：只要 rowUnitPx 的入参里没有行数，这条就恒成立；
    // 一旦有人给它加了 rows 形参，下面的调用会编译失败（参数个数对不上）。
    const a = rowUnitPx(64, 1356)
    const b = rowUnitPx(64, 1356)
    expect(a).toBe(b)
    expect(rowUnitPx.length).toBe(2)
  })
})
