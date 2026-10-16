import { describe, expect, it } from 'vitest'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampZoom,
  clientToLogical,
  panBy,
} from '../../packages/engine/src/zoom'

describe('clampZoom：量化 + 夹紧', () => {
  it('越界值夹紧到边界（架构文档 §10 验收用例）', () => {
    expect(clampZoom(0.4)).toBe(ZOOM_MIN) // 0.4 → 0.5
    expect(clampZoom(2.5)).toBe(ZOOM_MAX) // 2.5 → 2.0
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
  })

  it('界内值按 0.1 步进量化，浮点尾巴被吃掉', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(1.234)).toBe(1.2)
    expect(clampZoom(1.26)).toBe(1.3) // 四舍五入到最近格
    // 0.1 * 13 的经典浮点尾巴必须归格成 1.3，不能是 1.30000000000000004
    expect(clampZoom(ZOOM_STEP * 13)).toBe(1.3)
  })

  it('先量化后夹紧：量化结果低于下界时向上夹到 MIN', () => {
    // 0.3 < ZOOM_MIN，夹紧到 0.5 是正确行为，不是 bug
    expect(clampZoom(ZOOM_STEP * 3)).toBe(ZOOM_MIN)
  })

  it('坏值诚实回退 1:1（NaN / ±∞ / ≤0），不产出 NaN 缩放', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(-0.7)).toBe(1)
  })

  it('边界常量自洽：MIN < NEUTRAL < MAX，STEP 整除区间', () => {
    expect(ZOOM_MIN).toBeLessThan(1)
    expect(ZOOM_MAX).toBeGreaterThan(1)
    expect(Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP)).toBe(15)
  })
})

describe('clientToLogical：屏幕坐标 → 逻辑坐标', () => {
  const rect = { left: 100, top: 50 }

  it('z=1 时是纯平移', () => {
    expect(clientToLogical(180, 90, rect, 1)).toEqual({ x: 80, y: 40 })
  })

  it('z=2 放大视图：屏幕 1px 对应逻辑 0.5px（除不是乘）', () => {
    expect(clientToLogical(300, 250, rect, 2)).toEqual({ x: 100, y: 100 })
  })

  it('z=0.5 缩小视图：屏幕 1px 对应逻辑 2px', () => {
    expect(clientToLogical(200, 150, rect, 0.5)).toEqual({ x: 200, y: 200 })
  })

  it('指针落在容器原点时，任何缩放档都是逻辑 (0,0)', () => {
    for (const z of [0.5, 1, 2]) {
      expect(clientToLogical(100, 50, rect, z)).toEqual({ x: 0, y: 0 })
    }
  })

  it('坏 zoom 降级为 1:1，不给 Infinity 坐标', () => {
    expect(clientToLogical(180, 90, rect, 0)).toEqual({ x: 80, y: 40 })
    expect(clientToLogical(180, 90, rect, Number.NaN)).toEqual({ x: 80, y: 40 })
  })
})

describe('panBy：视口平移累积', () => {
  it('单次累积', () => {
    expect(panBy({ ox: 0, oy: 0 }, 30, -20)).toEqual({ ox: 30, oy: -20 })
  })

  it('链式累积与合并等价（纯函数无状态）', () => {
    const chained = panBy(panBy(panBy({ ox: 0, oy: 0 }, 10, 0), 0, 5), -3, 2)
    expect(chained).toEqual(panBy({ ox: 0, oy: 0 }, 7, 7))
  })

  it('不修改入参（调用方持有的旧偏移必须原样）', () => {
    const offset = { ox: 5, oy: 5 }
    panBy(offset, 100, 100)
    expect(offset).toEqual({ ox: 5, oy: 5 })
  })
})
