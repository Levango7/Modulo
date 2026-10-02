import { describe, expect, it } from 'vitest'
import { createLayoutStore, memoryStorage } from '../../src/vue/store'
import { REGISTRY } from '../../src/vue/cardRegistry'
import * as E from '../../src/engine'
import type { LayoutDoc } from '../../src/engine/types'

/**
 * 起步版面是产品门面：新用户首启看到的就是这张。
 * 旧版把坐标写死（`todo` 在 x=8、`recent` 在 y=9），实测空洞率 37.9%、还带两整行全空 ——
 * 而这类问题单测/E2E 当时一个都抓不到（E2E 只断言不溢出、不裁字）。这几条就是补的那道闸。
 */
const COLS = 12

const starter = () => createLayoutStore({ registry: REGISTRY, storage: memoryStorage() }).doc.value

const usedRows = (doc: LayoutDoc) => Math.max(...doc.items.map((i) => i.y + i.h))

/** 矩形 [0,cols) × [0,usedRows) 里没被任何卡覆盖的格子数 */
const holeCells = (doc: LayoutDoc) => {
  const occ = new Set<string>()
  for (const i of doc.items) for (let y = i.y; y < i.y + i.h; y++) for (let x = i.x; x < i.x + i.w; x++) occ.add(`${x},${y}`)
  let holes = 0
  for (let y = 0; y < usedRows(doc); y++) for (let x = 0; x < COLS; x++) if (!occ.has(`${x},${y}`)) holes++
  return holes
}

describe('起步版面', () => {
  it('注册表里有几张模块，出厂就摆几张', () => {
    const d = starter()
    expect(d.items.map((i) => i.id).sort()).toEqual(REGISTRY.map((m) => m.id).sort())
  })

  it('12 列 × 已用行数之内不留任何空洞（旧版实测 37.9%）', () => {
    const d = starter()
    expect(holeCells(d)).toBe(0)
  })

  it('不留整行空，总行数收在 9 行内（旧版 11 行里有两整行是空的）', () => {
    const d = starter()
    expect(usedRows(d)).toBeLessThanOrEqual(9)
  })

  it('互不重叠、且每张卡都在列范围内', () => {
    const d = starter()
    for (const a of d.items) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w).toBeLessThanOrEqual(COLS)
      for (const b of d.items) {
        if (a.id === b.id) continue
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false)
      }
    }
  })

  it('宽度不低于形态的 minW（spread 只变宽，理论上不会破，这条防的是以后改契约）', () => {
    const d = starter()
    for (const i of d.items) {
      const v = REGISTRY.find((m) => m.id === i.id)!.variants.find((q) => q.id === i.variant)!
      expect(i.w, `${i.id} 宽`).toBeGreaterThanOrEqual(v.minW)
      expect(i.h, `${i.id} 高`).toBeGreaterThanOrEqual(v.minH)
    }
  })

  /**
   * 上限这条是被截图逼出来的：只靠 spread 补宽度时，"某一带只有一张卡"会被整幅拉成通栏 ——
   * 速记 1 条内容占满 12 列，空洞率 0 了，观感反而更糟。数字达标不等于长得对，所以把
   * "不许撑到理想宽 1.5 倍以上"也写成守卫。
   */
  it('没有任何卡被撑到理想宽度的 1.5 倍以上（防单卡带被拉成通栏）', () => {
    const d = starter()
    for (const i of d.items) {
      const v = REGISTRY.find((m) => m.id === i.id)!.variants.find((q) => q.id === i.variant)!
      expect(i.w, `${i.id} 宽 ${i.w}，ideal ${v.idealW}`).toBeLessThanOrEqual(Math.ceil(v.idealW * 1.5))
    }
  })

  it('出厂形态就是「整理 + 撑满」的不动点：用户再点这两个按钮，版面一格都不动', () => {
    const d = starter()
    expect(E.spreadLayout(d).items).toEqual(d.items)
    expect(E.tidyLayout(d).items).toEqual(d.items)
  })
})
