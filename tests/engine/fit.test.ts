import { describe, expect, it } from 'vitest'
import { fitState, fitsVariant } from '@levango7/engine/fit'

const v = { id: 'x', name: 'x', minW: 3, minH: 2, idealW: 5, idealH: 4 }

describe('fitState', () => {
  it('低于最小 → below', () => {
    expect(fitState({ w: 2, h: 2 }, v).level).toBe('below')
    expect(fitState({ w: 3, h: 1 }, v).level).toBe('below')
  })
  it('正好铺满 → ideal', () => {
    expect(fitState({ w: 5, h: 4 }, v)).toEqual({ level: 'ideal', label: '正好铺满' })
  })
  it('大于推荐 → room', () => {
    expect(fitState({ w: 6, h: 5 }, v).level).toBe('room')
  })
  it('够最小但小于推荐 → mid', () => {
    expect(fitState({ w: 4, h: 3 }, v).level).toBe('mid')
  })
})

describe('fitsVariant', () => {
  it('只判最小尺寸', () => {
    expect(fitsVariant({ w: 3, h: 2 }, v)).toBe(true)
    expect(fitsVariant({ w: 3, h: 1 }, v)).toBe(false)
  })
})
