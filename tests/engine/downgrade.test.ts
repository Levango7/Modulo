import { describe, expect, it } from 'vitest'
import { pickVariantForSize } from '@modulo/engine/downgrade'
import { REGISTRY } from '../fixtures'

const clock = REGISTRY.find((m) => m.id === 'clock')!
const sticky = REGISTRY.find((m) => m.id === 'sticky')!

describe('pickVariantForSize', () => {
  it('当前形态装得下就保持不变', () => {
    expect(pickVariantForSize(clock, 'big', 4, 3)?.id).toBe('big')
  })
  it('装不下时降到能装下的最大形态', () => {
    expect(pickVariantForSize(clock, 'big', 2, 3)?.id).toBe('lunar')
    expect(pickVariantForSize(clock, 'big', 2, 1)?.id).toBe('minimal')
  })
  it('一个形态都装不下时返回 null（上层收起该卡）', () => {
    expect(pickVariantForSize(sticky, 'note', 1, 1)).toBeNull()
    expect(pickVariantForSize(clock, 'big', 1, 1)).toBeNull()
  })
})
