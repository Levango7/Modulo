import { describe, expect, it } from 'vitest'
import { editorMode, physicalCols, rowHeight, scaleFactor } from '@modulo/engine/breakpoints'

describe('physicalCols', () => {
  it('按断点表取物理列数', () => {
    expect([physicalCols(1440), physicalCols(1200)]).toEqual([12, 12])
    expect([physicalCols(1199), physicalCols(960)]).toEqual([8, 8])
    expect([physicalCols(959), physicalCols(720)]).toEqual([6, 6])
    expect([physicalCols(719), physicalCols(480)]).toEqual([4, 4])
    expect([physicalCols(479), physicalCols(390), physicalCols(0)]).toEqual([1, 1, 1])
  })
})

describe('editorMode', () => {
  it('列数 <4 走堆叠编辑（避免 x-hub 那种 88px 画布）', () => {
    expect(editorMode(1440)).toBe('canvas')
    expect(editorMode(719)).toBe('canvas')
    expect(editorMode(479)).toBe('stack')
  })
})

describe('rowHeight / scaleFactor', () => {
  it('固定行高随列数收窄，且始终为正（不再用 1fr 拉伸）', () => {
    expect(rowHeight(1440)).toBe(64)
    expect(rowHeight(1440)).toBeGreaterThan(rowHeight(720))
    expect(rowHeight(0)).toBeGreaterThan(0)
  })
  it('压缩因子 = 12 / N', () => {
    expect(scaleFactor(6)).toBe(2)
    expect(scaleFactor(12)).toBe(1)
  })
})
