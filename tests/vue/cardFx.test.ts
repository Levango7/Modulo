/**
 * 卡面聚光 / 倾斜的判定与绑定层（src/vue/cardFx.ts）单测。
 *
 * 本文件在 **node 环境**跑，没有真 DOM —— window（matchMedia / rAF）与元素
 * （监听表 / style 变量袋 / rect）全部用手写替身撑起，被测的是「环境守卫、
 * 倾角几何、变量写入与解绑」本身。真机的视觉链（玻璃壳 / 聚光 / 倾斜手感）
 * 由真机走查兜 —— 与 outsideClick.test.ts 同一条分工纪律。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachCardFx, shouldSkipCardFx, tiltFor } from '../../src/vue/cardFx'

/** matchMedia 替身：只对两个被查的查询词给出指定答案，其余一律不命中 */
function fakeWin(opts: { reduce?: boolean; hoverNone?: boolean } = {}): Window {
  return {
    matchMedia: (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)' ? !!opts.reduce : q === '(hover: none)' ? !!opts.hoverNone : false,
    }),
  } as unknown as Window
}

interface RuffleEl {
  el: HTMLElement
  listeners: Map<string, (e: unknown) => void>
  props: Map<string, string>
  moves: ((e: unknown) => void)[]
  cancels: number[]
}

/** 元素替身：addEventListener 记进监听表，style.setProperty 记进变量袋，rect 给定值 */
function makeEl(rect: { left: number; top: number; width: number; height: number }): RuffleEl {
  const listeners = new Map<string, (e: unknown) => void>()
  const props = new Map<string, string>()
  const el = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, fn)
    },
    removeEventListener: (type: string) => {
      listeners.delete(type)
    },
    style: {
      setProperty: (k: string, v: string) => {
        props.set(k, v)
      },
    },
    getBoundingClientRect: () => rect,
  }
  return { el: el as unknown as HTMLElement, listeners, props, moves: [], cancels: [] }
}

describe('shouldSkipCardFx', () => {
  it('reduced-motion 命中 → 跳过（tokens.css 钳不住 JS 写的倾角，只能不绑）', () => {
    expect(shouldSkipCardFx(fakeWin({ reduce: true }))).toBe(true)
  })

  it('hover:none（触屏）命中 → 跳过', () => {
    expect(shouldSkipCardFx(fakeWin({ hoverNone: true }))).toBe(true)
  })

  it('正常鼠标环境 → 不跳过', () => {
    expect(shouldSkipCardFx(fakeWin())).toBe(false)
  })
})

describe('tiltFor', () => {
  const W = 200
  const H = 100

  it('中心为 0', () => {
    expect(tiltFor(W / 2, H / 2, W, H)).toEqual({ rx: '0deg', ry: '0deg' })
  })

  it('上边抬头：指针在上边 → rotateX 负角（顶边朝向观察者）', () => {
    expect(tiltFor(W / 2, 0, W, H).rx).toBe('-4deg')
    expect(tiltFor(W / 2, 0, W, H).ry).toBe('0deg')
  })

  it('下边对应 rotateX 正角，左右两侧各侧倾 ±4', () => {
    expect(tiltFor(W / 2, H, W, H).rx).toBe('4deg')
    expect(tiltFor(W, H / 2, W, H).ry).toBe('-4deg')
    expect(tiltFor(0, H / 2, W, H).ry).toBe('4deg')
  })

  it('四角各 ≈ ±4（两个分量同时到边）', () => {
    expect(tiltFor(0, 0, W, H)).toEqual({ rx: '-4deg', ry: '4deg' })
    expect(tiltFor(W, 0, W, H)).toEqual({ rx: '-4deg', ry: '-4deg' })
    expect(tiltFor(0, H, W, H)).toEqual({ rx: '4deg', ry: '4deg' })
    expect(tiltFor(W, H, W, H)).toEqual({ rx: '4deg', ry: '-4deg' })
  })

  it('越界钳制：指针滑出卡外不放大角度，钳回边缘值', () => {
    expect(tiltFor(-50, H / 2, W, H).ry).toBe('4deg')
    expect(tiltFor(W + 80, H / 2, W, H).ry).toBe('-4deg')
    expect(tiltFor(W / 2, -99, W, H).rx).toBe('-4deg')
    expect(tiltFor(W + 500, H + 500, W, H)).toEqual({ rx: '4deg', ry: '-4deg' })
  })

  it('非正尺寸与非法坐标不出 NaN，一律回 0', () => {
    expect(tiltFor(10, 10, 0, 100)).toEqual({ rx: '0deg', ry: '0deg' })
    expect(tiltFor(10, 10, 200, -1)).toEqual({ rx: '0deg', ry: '0deg' })
    expect(tiltFor(NaN, 10, 200, 100)).toEqual({ rx: '0deg', ry: '0deg' })
  })

  it('maxDeg 可调：8° 上限时边缘即 ±8', () => {
    expect(tiltFor(0, H / 2, W, H, 8).ry).toBe('8deg')
    expect(tiltFor(W / 2, 0, W, H, 8).rx).toBe('-8deg')
  })
})

describe('attachCardFx', () => {
  /** rAF 替身：收进队列手动 flush，cancel 从队列摘除 —— 合帧行为全由它说话 */
  let rafQueue: Array<() => void>
  let rafCount: number

  beforeEach(() => {
    rafQueue = []
    rafCount = 0
    vi.stubGlobal('window', {
      ...fakeWin(),
      requestAnimationFrame: (cb: () => void) => {
        rafCount++
        rafQueue.push(cb)
        return rafCount
      },
      cancelAnimationFrame: (id: number) => {
        rafQueue = rafQueue.filter((_, i) => i + 1 !== id)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('环境要跳过时一个监听都不绑，返回的解绑函数可空跑', () => {
    vi.stubGlobal('window', fakeWin({ reduce: true }))
    const t = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    const unbind = attachCardFx(t.el)
    expect(t.listeners.size).toBe(0)
    expect(() => unbind()).not.toThrow()
    vi.stubGlobal('window', fakeWin({ hoverNone: true }))
    const t2 = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    attachCardFx(t2.el)
    expect(t2.listeners.size).toBe(0)
  })

  it('pointermove 经 rAF 合帧后写四个变量：位置与倾角同源一帧', () => {
    const t = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    const unbind = attachCardFx(t.el)
    const move = t.listeners.get('pointermove')!
    expect(move).toBeTruthy()
    move({ clientX: 150, clientY: 25 })
    expect(rafQueue.length).toBe(1)
    rafQueue[0]!()
    expect(t.props.get('--mx')).toBe('150px')
    expect(t.props.get('--my')).toBe('25px')
    // nx=0.5 → ry=-2deg；ny=-0.5 → rx=-2deg（指针右上，右上角朝观察者抬头）
    expect(t.props.get('--rx')).toBe('-2deg')
    expect(t.props.get('--ry')).toBe('-2deg')
    unbind()
  })

  it('一帧最多一次 rect 读取：同帧内两次 move 合并、后到的坐标赢', () => {
    const t = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    const unbind = attachCardFx(t.el)
    const move = t.listeners.get('pointermove')!
    move({ clientX: 150, clientY: 25 })
    move({ clientX: 200, clientY: 50 })
    expect(rafQueue.length).toBe(1)
    rafQueue[0]!()
    expect(t.props.get('--mx')).toBe('200px')
    expect(t.props.get('--my')).toBe('50px')
    expect(t.props.get('--rx')).toBe('0deg')
    expect(t.props.get('--ry')).toBe('-4deg')
    unbind()
  })

  it('pointerleave：倾角归零，未决的 rAF 一并撤销（离开后不再写帧）', () => {
    const t = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    const unbind = attachCardFx(t.el)
    t.listeners.get('pointermove')!({ clientX: 150, clientY: 25 })
    t.listeners.get('pointerleave')!(undefined)
    expect(t.props.get('--rx')).toBe('0deg')
    expect(t.props.get('--ry')).toBe('0deg')
    expect(rafQueue.length).toBe(0)
    const before = new Map(t.props)
    rafQueue.forEach((cb) => cb())
    expect([...t.props.entries()]).toEqual([...before.entries()])
    unbind()
  })

  it('解绑函数摘掉两个监听，之后再派发事件不再写任何变量', () => {
    const t = makeEl({ left: 0, top: 0, width: 200, height: 100 })
    const unbind = attachCardFx(t.el)
    expect(t.listeners.has('pointermove')).toBe(true)
    expect(t.listeners.has('pointerleave')).toBe(true)
    unbind()
    expect(t.listeners.size).toBe(0)
    const snapshot = new Map(t.props)
    t.listeners.get('pointermove')?.({ clientX: 10, clientY: 10 })
    expect(t.props.size).toBe(snapshot.size)
    expect(rafQueue.length).toBe(0)
  })
})
