/**
 * 模块库搜索的判定层（`src/vue/moduleFilter.ts`，F-09）。
 *
 * 为什么要测它：这段判定将来会长（拼音 / 分组折叠 / 形态过滤迟早有人想加），
 * 而**组件层在本仓没有可断言的测试设施**（没有 @vue/test-utils、没有 jsdom） ——
 * 也就是说，除了 E2E 之外，这里是这段逻辑**唯一**能被钉住的地方。
 *
 * 每条断言都对着 `moduleFilter.ts` 文件头写明的口径，改口径会红在这里而不是红在 UI 上。
 */
import { describe, expect, it } from 'vitest'
import { filterModules } from '../../src/vue/moduleFilter'
import type { ModuleDef, VariantDef } from '../../packages/engine/src/types'

const v = (id: string, name: string): VariantDef => ({ id, name, minW: 1, minH: 1, idealW: 2, idealH: 2 })

const mod = (m: Partial<ModuleDef> & { id: string; title: string }): ModuleDef => ({
  defaultVariant: 'a',
  variants: [v('a', '标准')],
  ...m,
})

const registry: ModuleDef[] = [
  mod({ id: 'clock', title: '世界时钟', blurb: '多个时区的现在几点', group: '时间', variants: [v('a', '标准'), v('b', '宽版')] }),
  mod({ id: 'countdown', title: '倒数日', blurb: '距离某个日子还有多久', group: '时间' }),
  mod({ id: 'todo', title: '待办', group: '记录' }),
  // 刻意留一个**没有 blurb / 没有 group** 的：那两个 `??` 的右侧分支要有用例走
  mod({ id: 'note', title: '便签' }),
]

describe('模块库搜索：命中范围与多词口径', () => {
  it('空查询与纯空白返回原数组本身（不是拷贝）', () => {
    expect(filterModules(registry, '')).toBe(registry)
    expect(filterModules(registry, '   ')).toBe(registry)
    expect(filterModules(registry, '\n\t ')).toBe(registry)
  })

  it('标题命中，且大小写不敏感', () => {
    expect(filterModules(registry, '时钟').map((m) => m.id)).toEqual(['clock'])
    // 英文大小写：命中范围里夹英文时 `Clock` 与 `clock` 必须一样
    const en = [mod({ id: 'c', title: 'World Clock' })]
    expect(filterModules(en, 'clock').map((m) => m.id)).toEqual(['c'])
    expect(filterModules(en, 'CLOCK').map((m) => m.id)).toEqual(['c'])
  })

  it('一句话说明（blurb）也算命中 —— 人记得的是"那个倒计时的"', () => {
    // 标题里没有「多久」，说明里有
    expect(filterModules(registry, '多久').map((m) => m.id)).toEqual(['countdown'])
  })

  it('分组名也算命中（搜「时间」拿到整组）', () => {
    expect(filterModules(registry, '时间').map((m) => m.id)).toEqual(['clock', 'countdown'])
  })

  it('形态名也算命中，但命中的是模块 —— 形态照旧全显示', () => {
    const hit = filterModules(registry, '宽版')
    expect(hit.map((m) => m.id)).toEqual(['clock'])
    // 只保留命中的那条形态会让人误以为这张卡只有一种尺寸
    expect(hit[0].variants.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('多词是 AND：每个词都要命中', () => {
    // 「时钟 宽」= 既是时钟、又有宽版
    expect(filterModules(registry, '时钟 宽版').map((m) => m.id)).toEqual(['clock'])
    // 有一个词不命中 ⇒ 整条排除（「时钟」在、「待办」不在）
    expect(filterModules(registry, '时钟 待办')).toEqual([])
  })

  it('多词之间的空白形状不影响结果（连续空格 / 换行）', () => {
    expect(filterModules(registry, '时钟   宽版').map((m) => m.id)).toEqual(['clock'])
    expect(filterModules(registry, ' 时钟\n宽版 ').map((m) => m.id)).toEqual(['clock'])
  })

  it('无命中返回空数组，不抛也不兜底成全量', () => {
    expect(filterModules(registry, '不存在的卡')).toEqual([])
  })

  it('缺 blurb / group 的模块不炸，且仍按标题可搜（覆盖两个 ?? 的右侧分支）', () => {
    expect(filterModules(registry, '便签').map((m) => m.id)).toEqual(['note'])
    // 缺字段的模块不会因为拼检索串而丢掉其它模块
    expect(filterModules(registry, '记录').map((m) => m.id)).toEqual(['todo'])
  })

  it('顺序保持注册表原序（搜索不改排序 —— 打分排序是刻意不做的）', () => {
    expect(filterModules(registry, '时间').map((m) => m.id)).toEqual(['clock', 'countdown'])
  })
})
