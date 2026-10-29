/**
 * `floatArrange.ts` 的判定层单测（F-08「按版面重摆」，2026-10-29）。
 *
 * 11 条把口径逐条钉死：精确映射、单卡、幽灵 id、空集、退化包围盒（不除零）、
 * 尺寸兜底、装不下的工作区、半装不下、pad 自定义、**未脱离的条目也参与包围盒**、
 * 输出顺序与取整。坐标全部手算核对（映射公式见 floatArrange.ts 文件头）。
 */
import { describe, expect, it } from 'vitest'
import type { Placement } from '@levango7/engine'
import { floatArrangeTargets, type WorkArea } from '../../src/vue/floatArrange'

const place = (id: string, x: number, y: number, w = 2, h = 1): Placement => ({
  id,
  variant: 'sticky',
  x,
  y,
  w,
  h,
})

const WA: WorkArea = { x: 0, y: 0, w: 1000, h: 800 }
const SIZE = { w: 180, h: 120 }
const sizes = (m: Record<string, { w: number; h: number }>) => new Map(Object.entries(m))

describe('floatArrangeTargets：按版面重摆的坐标映射', () => {
  it('两卡一左上一下右：相对位置原样映射进工作区（精确坐标）', () => {
    // 包围盒外沿 (0,0)-(12,6)；B 的 nx=10/12、ny=5/6；spanX=1000-32-180=788、spanY=800-32-120=648
    const out = floatArrangeTargets(
      [place('a', 0, 0), place('b', 10, 5)],
      new Set(['a', 'b']),
      sizes({ a: SIZE, b: SIZE }),
      WA,
    )
    expect(out).toEqual([
      { id: 'a', x: 16, y: 16 },
      { id: 'b', x: 673, y: 556 }, // round(16 + (10/12)*788) / round(16 + (5/6)*648)
    ])
  })

  it('单卡：包围盒就是它自己 → 相对位置 0，落在左上角（pad 偏移）', () => {
    const out = floatArrangeTargets([place('a', 3, 2)], new Set(['a']), sizes({ a: SIZE }), WA)
    expect(out).toEqual([{ id: 'a', x: 16, y: 16 }])
  })

  it('detached 里有 items 没有的 id（幽灵）：跳过，不产出坐标', () => {
    const out = floatArrangeTargets([place('a', 0, 0)], new Set(['ghost']), sizes({ a: SIZE }), WA)
    expect(out).toEqual([])
  })

  it('items 为空或没有浮窗：都返回空数组', () => {
    expect(floatArrangeTargets([], new Set(['a']), sizes({ a: SIZE }), WA)).toEqual([])
    expect(floatArrangeTargets([place('a', 0, 0)], new Set(), sizes({ a: SIZE }), WA)).toEqual([])
  })

  it('包围盒退化（条目尺寸为 0 的类型合法输入）：宽或高为 0 → 相对位置取 0，不除零', () => {
    // 包围盒按外沿算：同位同尺寸的正常条目 bw = (0+2)-0 = 2 永远 >0；
    // 只有 w/h 为 0（TS 类型不禁止）才退化 —— 钉的是"退化输入不出 NaN"。
    const out = floatArrangeTargets(
      [place('a', 3, 4, 0, 0), place('b', 3, 4, 0, 0)],
      new Set(['a', 'b']),
      sizes({ a: SIZE, b: SIZE }),
      WA,
    )
    expect(out).toEqual([
      { id: 'a', x: 16, y: 16 },
      { id: 'b', x: 16, y: 16 },
    ])
  })

  it('sizes 缺某张窗：按 180×120 兜底参与运算（B 若按 320 宽算会是 567，不是 673）', () => {
    const out = floatArrangeTargets(
      [place('a', 0, 0), place('b', 10, 5)],
      new Set(['a', 'b']),
      sizes({ a: SIZE }), // b 缺席
      WA,
    )
    expect(out[1]).toEqual({ id: 'b', x: 673, y: 556 })
  })

  it('工作区装不下窗（减边距再减自身为负）：位移量取 0，都贴在 wa+pad', () => {
    const out = floatArrangeTargets(
      [place('a', 0, 0), place('b', 10, 5)],
      new Set(['a', 'b']),
      sizes({ a: SIZE, b: SIZE }),
      { x: 0, y: 0, w: 200, h: 100 },
    )
    expect(out).toEqual([
      { id: 'a', x: 16, y: 16 },
      { id: 'b', x: 16, y: 16 },
    ])
  })

  it('半装不下（宽够高不够）：y 全贴 pad，x 仍随相对位置展开', () => {
    const out = floatArrangeTargets(
      [place('a', 0, 0), place('b', 10, 5)],
      new Set(['a', 'b']),
      sizes({ a: SIZE, b: SIZE }),
      { x: 0, y: 0, w: 2000, h: 100 },
    )
    expect(out[0]).toEqual({ id: 'a', x: 16, y: 16 })
    expect(out[1]!.x, 'spanX=2000-32-180=1788 → round(16+(10/12)*1788)=1506').toBe(1506)
    expect(out[1]!.y, 'spanY=max(100-32-120,0)=0').toBe(16)
  })

  it('pad 可自定义（0 = 顶到工作区原点）', () => {
    const out = floatArrangeTargets([place('a', 3, 2)], new Set(['a']), sizes({ a: SIZE }), WA, 0)
    expect(out).toEqual([{ id: 'a', x: 0, y: 0 }])
  })

  it('未脱离的条目也参与包围盒：没有它 A 会误判成最左（这是"版面形状"口径的钉子）', () => {
    const out = floatArrangeTargets(
      [place('c', 0, 0), place('a', 10, 5)], // c 没脱离，a 脱离
      new Set(['a']),
      sizes({ a: SIZE }),
      WA,
    )
    // 若包围盒只算脱离的（只有 a 自己），a 的相对位置恒 0 → x=16；这里必须是 673
    expect(out).toEqual([{ id: 'a', x: 673, y: 556 }])
  })

  it('输出顺序跟随 items（不按脱离先后）；坐标是取整后的整数', () => {
    const out = floatArrangeTargets(
      [place('b', 10, 5), place('a', 0, 0)],
      new Set(['a', 'b']),
      sizes({ a: SIZE, b: SIZE }),
      WA,
    )
    expect(out.map((t) => t.id)).toEqual(['b', 'a'])
    for (const t of out) {
      expect(Number.isInteger(t.x), `${t.id}.x 取整`).toBe(true)
      expect(Number.isInteger(t.y), `${t.id}.y 取整`).toBe(true)
    }
  })
})
