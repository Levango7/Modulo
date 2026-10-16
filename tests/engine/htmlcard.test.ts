/**
 * HTML 扩展（自定卡）引擎层单测。
 *
 * 这组断言的重点是**安全形状**而不是渲染结果：
 *   ① 输入校验给明确原因、不静默改写；
 *   ② `frameDoc` 把片段作为 **JSON 字符串**嵌入（结构上无法提前闭合外壳脚本）；
 *   ③ 桥的信封校验挡掉"任意页面 postMessage"（来源不对/没标记/带函数/超深超宽）。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_HTML_CARDS,
  MAX_SNIPPET_BYTES,
  snippetLiteral,
  isExtMessage,
  plainJson,
  sanitizeHtmlCards,
  validateSnippet,
} from '../../packages/engine/src/htmlcard'

describe('输入校验：给原因、不改写', () => {
  it('空 / 超长被拒（给原因）；带脚本的正常片段必须放行', () => {
    expect(validateSnippet('').ok).toBe(false)
    expect(validateSnippet('   ').reason).toContain('写点什么')
    expect(validateSnippet('x'.repeat(MAX_SNIPPET_BYTES + 1)).reason).toContain('太长')
    // 关键回归：`<script>…</script>` 是写脚本的标准写法，拦掉它等于"不让写脚本"
    // （早先版本在这里拦过，把带脚本的片段全拒了 —— 2026-10-13 实测踩到）
    const withScript = '<b>hi</b><script>document.title = 1</' + 'script>'
    expect(validateSnippet(withScript).ok, '带脚本的片段应放行').toBe(true)
    expect(validateSnippet('<b>你好</b>').ok).toBe(true)
  })
})

describe('snippetLiteral：注入防线（引擎里唯一的"渲染相关"纯逻辑）', () => {
  it('引号/反斜杠由 JSON 转义；**`</` 必须变成 `<\/`**（否则外壳脚本会被提前闭合）', () => {
    const lit = snippetLiteral('<b class="x">a\\b</b>')
    expect(lit.startsWith('"')).toBe(true)
    expect(lit).toContain('\\"') // 双引号被转义
  })

  it('片段里的 </script> 以 <\/ 形态出现（解析器认不出是结束标签）', () => {
    const snippet = '<script>document.title = 1</' + 'script>'
    const lit = snippetLiteral(snippet)
    expect(lit).toContain('<\\/script>')
    expect(lit.includes('</script>'), `字面量里不该有裸露的结束标签：${lit}`).toBe(false)
  })

  it('标题里的尖括号由宿主处理（这类显示细节不进引擎）——此处只守住不抛', () => {
    expect(() => snippetLiteral('')).not.toThrow()
    expect(snippetLiteral('')).toBe('""')
  })
})

describe('桥的信封校验：任何页面都能 postMessage，所以必须三查', () => {
  const win = {} as unknown as Window
  const other = {} as unknown as Window

  it('来源不对 / 没标记 / 非对象 一律拒', () => {
    expect(isExtMessage({ __modulo: 'ext', payload: 1 }, win, win)).toBe(true)
    expect(isExtMessage({ __modulo: 'ext', payload: 1 }, other, win), '来源不对').toBe(false)
    expect(isExtMessage({ payload: 1 }, win, win), '没标记').toBe(false)
    expect(isExtMessage('hi', win, win)).toBe(false)
    expect(isExtMessage(null, win, win)).toBe(false)
  })

  it('payload 必须是朴素 JSON：函数 / 类实例 / 环 / 超深一律拒', () => {
    expect(isExtMessage({ __modulo: 'ext', payload: { a: [1, 2, { b: 'x' }] } }, win, win)).toBe(true)
    expect(isExtMessage({ __modulo: 'ext', payload: () => 1 }, win, win), '函数').toBe(false)
    expect(isExtMessage({ __modulo: 'ext', payload: new Map() }, win, win), '非普通对象').toBe(false)
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(isExtMessage({ __modulo: 'ext', payload: cyc }, win, win), '环').toBe(false)
    let deep: unknown = 1
    for (let i = 0; i < 9; i++) deep = { d: deep }
    expect(isExtMessage({ __modulo: 'ext', payload: deep }, win, win), '超深').toBe(false)
    expect(plainJson(new Date(), 0), 'Date 不是朴素值').toBe(false)
    expect(plainJson(Object.create(null), 0), '无原型对象也行').toBe(true)
  })
})

describe('名单清洗：同其它卡片数据的骨架', () => {
  it('丢坏条并计数、id 撞了顺延、上限生效', () => {
    const { cards, rejected } = sanitizeHtmlCards([
      { id: 'a', title: '甲', html: '<b>1</b>' },
      { id: 'a', title: '乙', html: '<b>2</b>' }, // id 撞 → 顺延
      { title: '', html: '<i>3</i>' }, // 无 id → 自动
      { html: '<script>ok</script>' }, // 带脚本现在是合法条目（校验不再拦 </script>）
      { html: 42 }, // 形状不对 → rejected
      { html: '' }, // 空 → rejected
    ])
    expect(rejected, '42 与空串被拒；带脚本的条目保留').toBe(2)
    expect(cards.map((c) => c.id)).toEqual(['a', 'a_', 'h3', 'h4'])
    expect(cards[1].title).toBe('乙')
    const many = Array.from({ length: MAX_HTML_CARDS + 4 }, (_, i) => ({ html: `<b>${i}</b>` }))
    expect(sanitizeHtmlCards(many).cards).toHaveLength(MAX_HTML_CARDS)
  })
})
