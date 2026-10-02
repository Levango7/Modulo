import { describe, expect, it } from 'vitest'
import * as E from '../../src/engine'
import { TEMPLATES, DEFAULT_TEMPLATE_ID, buildTemplate, templateById, validateTemplate } from '../../src/engine/templates'
import { REGISTRY } from '../../src/vue/cardRegistry'

const COLS = 12

/** 已用矩形 [0,cols)×[0,rows) 里没被任何卡盖住的格子 */
function holes(doc: E.LayoutDoc): number {
  const rows = Math.max(...doc.items.map((i) => i.y + i.h))
  const occ = new Set<string>()
  for (const i of doc.items) for (let y = i.y; y < i.y + i.h; y++) for (let x = i.x; x < i.x + i.w; x++) occ.add(`${x},${y}`)
  let n = 0
  for (let y = 0; y < rows; y++) for (let x = 0; x < COLS; x++) if (!occ.has(`${x},${y}`)) n++
  return n
}

function overlaps(doc: E.LayoutDoc): string[] {
  const bad: string[] = []
  for (const a of doc.items)
    for (const b of doc.items)
      if (a.id < b.id && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) bad.push(`${a.id}/${b.id}`)
  return bad
}

describe('版面模板', () => {
  it('id 唯一，且默认模板在列表里', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    expect(templateById(DEFAULT_TEMPLATE_ID)).toBeDefined()
  })

  it('至少有一个"少卡"模板（极简档不是说说而已）', () => {
    expect(Math.min(...TEMPLATES.map((t) => t.cells.length))).toBeLessThan(TEMPLATES[0].cells.length)
  })

  for (const t of TEMPLATES) {
    describe(`模板「${t.name}」`, () => {
      const doc = buildTemplate(REGISTRY, t)

      it('形态与尺寸都对得上注册表', () => {
        expect(validateTemplate(t, REGISTRY)).toEqual([])
      })

      it('不重叠、不出列', () => {
        expect(overlaps(doc)).toEqual([])
        for (const i of doc.items) {
          expect(i.x).toBeGreaterThanOrEqual(0)
          expect(i.x + i.w).toBeLessThanOrEqual(COLS)
        }
      })

      it('铺满：已用矩形里 0 空洞（这一条就是 v0.1.1 那次翻车的守卫）', () => {
        expect(holes(doc)).toBe(0)
      })

      it('不太长：总行数 ≤ 10', () => {
        expect(Math.max(...doc.items.map((i) => i.y + i.h))).toBeLessThanOrEqual(10)
      })

      it('每张卡都还在，且 buildTemplate 是逐格照搬（spread 兜底没有改动形状）', () => {
        expect(doc.items.map((i) => i.id).sort()).toEqual(t.cells.map((c) => c.id).sort())
        for (const c of t.cells) {
          const p = doc.items.find((i) => i.id === c.id)!
          expect([p.x, p.y, p.w, p.h], `${c.id} 位置尺寸`).toEqual([c.x, c.y, c.w, c.h])
        }
      })
    })
  }

  it('模板铺出来已经是 tidy / spread 的不动点（用户再点这两个按钮不该看到东西乱跳）', () => {
    for (const t of TEMPLATES) {
      const doc = buildTemplate(REGISTRY, t)
      expect(E.tidyLayout(doc).items, t.name).toEqual(doc.items)
      expect(E.spreadLayout(doc).items, t.name).toEqual(doc.items)
    }
  })
})
