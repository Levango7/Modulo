/**
 * 卡片原位展开（FLIP）几何层（src/vue/expandFlip.ts）单测。
 *
 * 纯函数、node 环境直跑，不需要 DOM。锁三条主口径：常规居中放大、小视口钳制
 * （"不超视口"压过"只放大"）、源已达目标形状时恒等不抖。附带锁住"只放大不倒缩"
 * 与 from/to 的 px 字符串形状（WAAPI 直接吃）。
 */
import { describe, expect, it } from 'vitest'
import { flipFrames } from '../../src/vue/expandFlip'

describe('flipFrames：常规视口居中放大', () => {
  const vw = 1440
  const vh = 900
  const src = { left: 100, top: 200, width: 300, height: 220 }

  it('等比放大到宽度上限 680，目标居中', () => {
    const { target } = flipFrames(src, vw, vh)
    // grow = min(680/300, 560/220) = 680/300 → 宽恰达上限，高等比
    expect(target.width).toBeCloseTo(680)
    expect(target.height).toBeCloseTo((220 * 680) / 300)
    expect(target.left).toBeCloseTo((vw - 680) / 2)
    expect(target.top).toBeCloseTo((vh - (220 * 680) / 300) / 2)
  })

  it('不越视口：目标四周留边距', () => {
    const { target } = flipFrames(src, vw, vh)
    expect(target.left).toBeGreaterThanOrEqual(24)
    expect(target.top).toBeGreaterThanOrEqual(24)
    expect(target.left + target.width).toBeLessThanOrEqual(vw - 24)
    expect(target.top + target.height).toBeLessThanOrEqual(vh - 24)
  })

  it('from = 源 rect 的 px 串，to = 目标的 px 串（WAAPI 直接可喂）', () => {
    const { from, to } = flipFrames(src, vw, vh)
    expect(from).toEqual({ left: '100px', top: '200px', width: '300px', height: '220px' })
    expect(to.left).toMatch(/px$/)
    expect(Number.parseFloat(to.left)).toBeCloseTo((vw - 680) / 2)
    expect(Number.parseFloat(to.width)).toBeCloseTo(680)
  })

  it('高比宽先到上限时按高算（min 起作用）', () => {
    const tall = { left: 0, top: 0, width: 100, height: 400 }
    const { target } = flipFrames(tall, vw, vh)
    // grow = min(6.8, 1.4) = 1.4 → 高达 560
    expect(target.height).toBeCloseTo(560)
    expect(target.width).toBeCloseTo(140)
  })
})

describe('flipFrames：小视口钳制', () => {
  it('视口装不下"只放大"的结果时缩小装下，且仍居中、仍留边距', () => {
    const src = { left: -100, top: 50, width: 400, height: 300 }
    const vw = 320
    const vh = 480
    const { target } = flipFrames(src, vw, vh)
    // fit = min((320-48)/400, (480-48)/300) = 0.68 → 272×204
    expect(target.width).toBeCloseTo(272)
    expect(target.height).toBeCloseTo(204)
    expect(target.left).toBeCloseTo(24)
    expect(target.top).toBeCloseTo(138)
    expect(target.left).toBeGreaterThanOrEqual(24)
    expect(target.top).toBeGreaterThanOrEqual(24)
    expect(target.left + target.width).toBeLessThanOrEqual(vw)
    expect(target.top + target.height).toBeLessThanOrEqual(vh)
  })

  it('比上限还大的源卡在正常视口不倒缩：保持原尺寸、只居中', () => {
    const src = { left: 0, top: 0, width: 800, height: 600 }
    const { target } = flipFrames(src, 1440, 900)
    expect(target).toEqual({ left: 320, top: 150, width: 800, height: 600 })
  })

  it('极端窄视口：边距收缩但仍给出正的可视盒，不出负尺寸', () => {
    const src = { left: 0, top: 0, width: 400, height: 300 }
    const { target } = flipFrames(src, 60, 90)
    expect(target.width).toBeGreaterThan(0)
    expect(target.height).toBeGreaterThan(0)
    expect(target.left).toBeGreaterThanOrEqual(0)
    expect(target.top).toBeGreaterThanOrEqual(0)
    expect(target.left + target.width).toBeLessThanOrEqual(60)
    expect(target.top + target.height).toBeLessThanOrEqual(90)
  })
})

describe('flipFrames：恒等形状', () => {
  it('源已处于目标位（上限盒居中）→ 三元全等，动画两帧相同、不抖', () => {
    const vw = 1440
    const vh = 900
    const src = { left: (vw - 680) / 2, top: (vh - 560) / 2, width: 680, height: 560 }
    const { from, to, target } = flipFrames(src, vw, vh)
    expect(target).toEqual(src)
    expect(from).toEqual(to)
  })
})

describe('flipFrames：非法输入不炸', () => {
  it('零尺寸 / 非有限数 → 原地恒等计划（两帧相同），调用方拿到的是"不动"而非 NaN 除法结果', () => {
    const zero = { left: 10, top: 10, width: 0, height: 0 }
    const plan = flipFrames(zero, 1440, 900)
    expect(plan.target).toEqual(zero)
    expect(plan.from).toEqual(plan.to)

    const nan = { left: NaN, top: 0, width: 100, height: 100 }
    const plan2 = flipFrames(nan, 1440, 900)
    expect(plan2.from).toEqual(plan2.to)
  })
})
