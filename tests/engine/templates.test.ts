import { describe, expect, it } from 'vitest'
import * as E from '@levango7/engine'
import { TEMPLATES, DEFAULT_TEMPLATE_ID, buildTemplate, templateById, validateTemplate, type LayoutTemplate } from '@levango7/engine/templates'
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
          /** 形态也要钉住：写错形态名时 resolveVariant 会悄悄回退，只数 x/y/w/h 发现不了 */
          expect(p.variant, `${c.id} 形态`).toBe(c.variant)
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

  /**
   * 反向自测：上面那条「validateTemplate 返回 []」只证明了"没报错"，没证明"会报错"。
   * 这三条钉住它必须拦住的三种写法 —— 否则哪天守卫退化成永远返回空数组，绿灯一个都不会变。
   */
  describe('validateTemplate 不是摆设', () => {
    const base = templateById(DEFAULT_TEMPLATE_ID)!
    const withCells = (cells: LayoutTemplate['cells']): LayoutTemplate => ({ ...base, cells })

    it('用了未注册的模块要报出来', () => {
      const w = validateTemplate(withCells([{ id: 'nope', variant: 'big', x: 0, y: 0, w: 4, h: 4 }]), REGISTRY)
      expect(w.join('\n')).toContain('未注册的模块')
    })

    it('形态不存在要报出来', () => {
      const w = validateTemplate(withCells([{ id: 'clock', variant: 'nope', x: 0, y: 0, w: 4, h: 4 }]), REGISTRY)
      expect(w.join('\n')).toContain('形态 nope 不存在')
    })

    it('小于形态最小尺寸要报出来（注册表里最小的 minW 是 2，所以 1×1 必定越界）', () => {
      const w = validateTemplate(withCells([{ id: 'clock', variant: 'big', x: 0, y: 0, w: 1, h: 1 }]), REGISTRY)
      expect(w.join('\n')).toContain('小于最小尺寸 3×3')
    })

    it('合法模板仍然 0 条（防止上面三条靠"什么都报"蒙过去）', () => {
      expect(validateTemplate(withCells(base.cells), REGISTRY)).toEqual([])
    })
  })
})

/**
 * 降档对齐守卫（2026-10-10 加）：出厂「通用」在各窄档的取整投影。
 *
 * 背景：旧坐标（clock 5 宽@x0、sticky 3 宽@x5、todo 4 宽@x8）在 4 列档会让便签
 * 落到与时钟压边的位置、被"就近塞"顶下去 —— 屏幕上就是一张浮在中列的"楼梯"。
 * 新坐标是全枚举搜索选出来的（硬约束：todo ≥4 逻辑列否则 4 档裁字（E2E 实测抓过）、
 * sticky ≤3（1.5× 理想宽上限）、recent ≥4），在 N=12/8/4 三档零空洞、零内部洞。
 * **N=6 一档**被这三条约束夹住，五张卡排不成无洞两列，有一次通道式折行 —— 如实
 * 记为已知折行并设回归线，不用"凑到过"的假守卫盖住。
 */
describe('通用模板的降档对齐', () => {
  const stats = (n: number) => {
    const doc = buildTemplate(REGISTRY, templateById(DEFAULT_TEMPLATE_ID)!)
    const p = E.project(doc, REGISTRY, n)
    const occ = new Set<string>()
    for (const r of p.rects)
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) occ.add(`${x},${y}`)
    const rows = Math.max(...p.rects.map((r) => r.y + r.h))
    let holes = 0
    let interior = 0
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < p.cols; x++)
        if (!occ.has(`${x},${y}`)) {
          holes++
          // 洞的右边还有卡片 → 内部洞（"楼梯感"的来源；右侧留白不算）
          if (p.rects.some((r) => y >= r.y && y < r.y + r.h && r.x > x)) interior++
        }
    return { holes, interior, rows }
  }

  for (const n of [12, 8, 4]) {
    it(`N=${n}：0 空洞、0 内部洞`, () => {
      const s = stats(n)
      expect(s.holes, `N=${n} 空洞`).toBe(0)
      expect(s.interior, `N=${n} 内部洞`).toBe(0)
    })
  }

  it('N=6：已知折行的回归线（空洞 ≤15；改坐标或改取整规则会先在这里红）', () => {
    expect(stats(6).holes).toBeLessThanOrEqual(15)
  })

  it('N=6：折行按"贴左"落位（不再有浮在中列的孤岛）', () => {
    const doc = buildTemplate(REGISTRY, templateById(DEFAULT_TEMPLATE_ID)!)
    const { rects } = E.project(doc, REGISTRY, 6)
    // 折下来的便签贴到 x=0，而不是留在原列带的中列位置
    expect(rects.find((r) => r.id === 'notes')!.x).toBe(0)
  })
})
