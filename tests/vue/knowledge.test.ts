import { describe, expect, it } from 'vitest'
import {
  addDocs,
  docChoices,
  docExcerpt,
  excerptWithDocs,
  KNOWLEDGE_CHARS_MAX,
  KNOWLEDGE_EXCERPT_MAX,
  KNOWLEDGE_MAX_DOCS,
  newDocId,
  parseKnowledge,
  removeDoc,
  serializeKnowledge,
  type KnowledgeDoc,
} from '../../src/vue/knowledge'
import type { CardChoice } from '../../src/vue/aiChat'

const doc = (over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'k1',
  name: '规格.md',
  text: '一二三',
  chars: 3,
  addedAt: 0,
  truncated: false,
  ...over,
})

describe('资料：盘上的文档不可信（PR-F1）', () => {
  it('没有文档 / 坏 JSON / 形状不对 —— 一律空清单，不抛', () => {
    expect(parseKnowledge(null)).toEqual([])
    expect(parseKnowledge('{oops')).toEqual([])
    expect(parseKnowledge('[]')).toEqual([])
    expect(parseKnowledge('{"docs":"nope"}')).toEqual([])
    expect(parseKnowledge('{"docs":[null,7,"x"]}')).toEqual([])
  })

  it('坏条目丢弃、好条目留下（一条坏的不能拖走另外三条）', () => {
    const raw = JSON.stringify({
      docs: [
        { id: 'a', name: '好的.md', text: '正文' },
        { id: '', name: '没 id', text: 'x' },
        { id: 'b', name: '   ', text: 'x' },
        { id: 'c', name: '没正文' },
        { id: 'a', name: '重复 id', text: 'x' },
        { id: 'd', name: ' 补默认值.md ', text: '正文', chars: 'x', addedAt: null },
      ],
    })
    const out = parseKnowledge(raw)
    expect(out.map((d) => d.name)).toEqual(['好的.md', '补默认值.md'])
    // 坏的 chars / addedAt 回落到实测值，不让 undefined 进界面
    expect(out[1].chars).toBe(2)
    expect(out[1].addedAt).toBe(0)
    expect(out[1].truncated).toBe(false)
  })

  it('份数上限：盘上多出来的尾部条目读进来也丢掉', () => {
    const many = Array.from({ length: KNOWLEDGE_MAX_DOCS + 3 }, (_, i) => ({
      id: `k${i}`,
      name: `d${i}.md`,
      text: 'x',
    }))
    expect(parseKnowledge(JSON.stringify({ docs: many }))).toHaveLength(KNOWLEDGE_MAX_DOCS)
    // 序列化同一道闸门：写出去也不超
    expect(JSON.parse(serializeKnowledge(many as KnowledgeDoc[])).docs).toHaveLength(KNOWLEDGE_MAX_DOCS)
  })

  it('序列化 → 解析往返一致（含 truncated 标记）', () => {
    const list = [doc({ truncated: true }), doc({ id: 'k2', name: 'b.txt', text: 'x', chars: 1 })]
    expect(parseKnowledge(serializeKnowledge(list))).toEqual(list)
  })
})

describe('资料：入库的三条闸门', () => {
  it('同名 / 空名 / 空内容 / 二进制 —— 逐条拒收，理由带文件名', () => {
    const r = addDocs([doc()], [
      { name: '规格.md', text: '改一版' },
      { name: '   ', text: 'x' },
      { name: '空.md', text: '  \n\t' },
      { name: '图.png', text: 'PNG\u0000' },
    ], 1_700_000_000_000)
    expect(r.docs).toHaveLength(1)
    expect(r.rejected).toHaveLength(4)
    expect(r.rejected[0]).toContain('已经在资料里')
    expect(r.rejected[3]).toContain('不像文本文件')
  })

  it('份数上限：第 13 份进不来，已入库的 12 份不动', () => {
    const full = Array.from({ length: KNOWLEDGE_MAX_DOCS }, (_, i) =>
      doc({ id: `k${i}`, name: `d${i}.md` }),
    )
    const r = addDocs(full, [{ name: '再来一份.md', text: 'x' }], 1)
    expect(r.docs).toHaveLength(KNOWLEDGE_MAX_DOCS)
    expect(r.rejected[0]).toContain(String(KNOWLEDGE_MAX_DOCS))
  })

  it('CRLF 归一；超长按字符截断并把事实记在资料上', () => {
    const r = addDocs([], [
      { name: 'a.txt', text: '一\r\n二' },
      { name: '长.md', text: '字'.repeat(KNOWLEDGE_CHARS_MAX + 10) },
    ], 1_700_000_000_000)
    expect(r.docs[0].text).toBe('一\n二')
    expect(r.docs[1].truncated).toBe(true)
    expect(r.docs[1].chars).toBe(KNOWLEDGE_CHARS_MAX)
  })

  it('id：同一毫秒内多份也不撞；撞了就让位', () => {
    const r = addDocs([], [
      { name: 'a.md', text: 'x' },
      { name: 'b.md', text: 'y' },
    ], 1_700_000_000_000)
    expect(new Set(r.docs.map((d) => d.id)).size).toBe(2)
    expect(newDocId(1_700_000_000_000, 0, [r.docs[0].id])).not.toBe(r.docs[0].id)
  })

  it('移除按 id，其余顺序不动', () => {
    const list = [doc({ id: 'a' }), doc({ id: 'b' }), doc({ id: 'c' })]
    expect(removeDoc(list, 'b').map((d) => d.id)).toEqual(['a', 'c'])
    expect(removeDoc(list, 'nope')).toHaveLength(3)
  })
})

describe('资料：进对话时给的是摘录，且截断要说', () => {
  it('短文原样；长文截到上限并在末尾报总字数', () => {
    expect(docExcerpt(doc())).toBe('一二三')
    const long = doc({ text: '字'.repeat(KNOWLEDGE_EXCERPT_MAX + 50), chars: KNOWLEDGE_EXCERPT_MAX + 50 })
    const out = docExcerpt(long)
    expect(out.startsWith('字'.repeat(10))).toBe(true)
    expect(out).toContain(`共 ${long.chars} 字`)
    expect(out.length).toBeGreaterThan(KNOWLEDGE_EXCERPT_MAX)
  })

  it('空正文给空串（界面负责说"没有可引用的内容"，模型侧不编）', () => {
    expect(docExcerpt(doc({ text: '   \n ' }))).toBe('')
  })

  it('emoji 按码点裁，不会劈成半个', () => {
    // 1200 个 emoji：UTF-16 长度是 2400，按码点正好等于上限 ⇒ 不该截
    const text = '😀'.repeat(KNOWLEDGE_EXCERPT_MAX)
    expect(docExcerpt(doc({ text, chars: KNOWLEDGE_EXCERPT_MAX }))).toBe(text)
  })

  it('坞里那个入口：资料走摘录、卡片原样交给注入的摘录函数', () => {
    const docs = [doc({ id: 'kb', name: '库.md', text: '资料正文' })]
    const cardExcerpt = (c: CardChoice): string => `卡片：${c.label}`
    const fn = excerptWithDocs(docs, cardExcerpt)
    expect(fn({ id: 'kb', module: 'knowledge', title: '库.md', label: '库.md' })).toBe('资料正文')
    expect(fn({ id: 'sticky', module: 'sticky', title: '便签', label: '便签' })).toBe('卡片：便签')
    // 资料被删了但 chip 还挂着：如实回空，不编
    expect(fn({ id: 'gone', module: 'knowledge', title: '没了', label: '没了' })).toBe('')
  })

  it('候选形状与卡片一致（module=knowledge，label 就是名字）', () => {
    expect(docChoices([doc({ id: 'kb', name: '库.md' })])).toEqual([
      { id: 'kb', module: 'knowledge', title: '库.md', label: '库.md' },
    ])
  })
})
