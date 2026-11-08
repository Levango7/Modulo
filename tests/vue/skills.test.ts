import { describe, expect, it } from 'vitest'
import {
  addSkills,
  excerptWithSkills,
  newSkillId,
  parseSkills,
  removeSkill,
  serializeSkills,
  skillChoices,
  skillExcerpt,
  SKILL_DOC_KEY,
  SKILL_MAX,
  SKILL_NAME_MAX,
  SKILL_TEXT_MAX,
  SKILL_UNITS_MAX,
  type Skill,
} from '../../src/vue/skills'
import {
  buildMessages,
  CONTEXT_MAX,
  contextBlock,
  contextUsage,
  permNote,
  type CardChoice,
} from '../../src/vue/aiChat'
import { docChoices, excerptWithDocs, KNOWLEDGE_EXCERPT_MAX, type KnowledgeDoc } from '../../src/vue/knowledge'

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: 's1',
  name: '周报助手',
  text: '把下面的要点写成三句话',
  chars: 11,
  addedAt: 0,
  ...over,
})

const doc = (over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id: 'kb1',
  name: '验收清单.md',
  text: '交付 A 与交付 B',
  chars: 8,
  addedAt: 0,
  truncated: false,
  ...over,
})

const card = (): CardChoice => ({ id: 'sticky', module: 'sticky', title: '便签', label: '便签' })

describe('技能：盘上的文档不可信（PR-F3）', () => {
  it('没有 / 坏 JSON / 形状不对 —— 一律空清单，不抛', () => {
    expect(parseSkills(null)).toEqual([])
    expect(parseSkills('{oops')).toEqual([])
    expect(parseSkills('[]')).toEqual([])
    expect(parseSkills('{"skills":"nope"}')).toEqual([])
    expect(parseSkills('{"skills":[null,7,"x"]}')).toEqual([])
    expect(SKILL_DOC_KEY).toBe('modulo.skills.v1')
  })

  it('坏条目丢弃、好条目留下（盘上手改的也要过入库那几道闸门）', () => {
    const raw = JSON.stringify({
      skills: [
        { id: 'a', name: '好的.md', text: '正文' },
        { id: '', name: '没 id', text: 'x' },
        { id: 'b', name: '   ', text: 'x' },
        { id: 'c', name: '没正文' },
        { id: 'a', name: '重复 id', text: 'x' },
        { id: 'd', name: '二进制', text: 'PNG\u0000' },
        { id: 'e', name: '盘上超长', text: '字'.repeat(SKILL_TEXT_MAX + 1) },
        { id: 'f', name: ' 补默认值 ', text: '正文', chars: 'x', addedAt: null },
        // 盘上空白正文：addSkills 拒收空内容，读盘也必须同一道闸门（否则 chip 挂着却没内容）
        { id: 'g', name: '盘上空白', text: '  \n\t ' },
        // 盘上 emoji：码点 1200 过第一道、UTF-16 2400 过不了第二道 ⇒ 与 addSkills 一样拒收
        { id: 'h', name: '盘上表情', text: '😀'.repeat(SKILL_TEXT_MAX) },
        { id: 'i', name: '名'.repeat(SKILL_NAME_MAX + 1), text: 'x' },
      ],
    })
    const out = parseSkills(raw)
    expect(out.map((s) => s.name)).toEqual(['好的.md', '补默认值'])
    // 坏的 chars / addedAt 回落到实测值，不让 undefined 进界面
    expect(out[1].chars).toBe(2)
    expect(out[1].addedAt).toBe(0)
    // 没有 truncated 字段：v1 超长是拒收不是截断，盘上也没有半个 truncated 可伪造
    expect(out[0]).not.toHaveProperty('truncated')
  })

  it('份数上限：盘上多出来的尾部读进来也丢掉；序列化同一道闸门', () => {
    const many = Array.from({ length: SKILL_MAX + 3 }, (_, i) => ({
      id: `s${i}`,
      name: `技能${i}`,
      text: 'x',
    }))
    expect(parseSkills(JSON.stringify({ skills: many }))).toHaveLength(SKILL_MAX)
    expect(JSON.parse(serializeSkills(many as Skill[])).skills).toHaveLength(SKILL_MAX)
  })

  it('盘上 CRLF：先归一 LF 再判，1200 码点的 CRLF 数据不被静默丢弃（与 addSkills 同口径）', () => {
    // '一\r\n' × 600：未归一 = 1800 码点，会被当成超长整条丢掉（QA A1：静默丢数据）。
    // 归一后 = 600 个「一」+ 600 个 \n = 1200 码点 / 1200 UTF-16，两道闸门都过。
    const raw = JSON.stringify({
      skills: [{ id: 'crlf', name: 'CRLF.md', text: '一\r\n'.repeat(600) }],
    })
    const out = parseSkills(raw)
    expect(out, '归一后应读回 1 条，不是静默丢数据').toHaveLength(1)
    expect(out[0].text, '盘上文本也要规整成 LF').not.toContain('\r')
    expect(out[0].chars, 'chars 按 LF 口径记账').toBe(1200)
  })

  it('序列化 → 解析往返一致', () => {
    const list = [skill(), skill({ id: 's2', name: 'b.txt', text: 'x', chars: 1 })]
    expect(parseSkills(serializeSkills(list))).toEqual(list)
  })
})

describe('技能：入库的闸门（超长拒收、不截断）', () => {
  it('同名 / 空名 / 空内容 / 二进制 —— 逐条拒收，理由带名字', () => {
    const r = addSkills([skill()], [
      { name: '周报助手', text: '改一版' },
      { name: '   ', text: 'x' },
      { name: '空.md', text: '  \n\t' },
      { name: '图.png', text: 'PNG\u0000' },
    ], 1_700_000_000_000)
    expect(r.skills).toHaveLength(1)
    expect(r.rejected).toHaveLength(4)
    expect(r.rejected[0]).toContain('已经有这条技能')
    expect(r.rejected[3]).toContain('不像文本')
  })

  it('超上限：整条拒收，不悄悄截成半份（§12.68 定死的那一条）', () => {
    const r = addSkills([], [{ name: '长模板', text: '字'.repeat(SKILL_TEXT_MAX + 1) }], 1)
    expect(r.skills).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0]).toContain(String(SKILL_TEXT_MAX))
    // 拒收 ≠ 截断：清单里绝不多出一条被裁短的
    expect(r.skills.some((s) => s.text.length < SKILL_TEXT_MAX + 1)).toBe(false)
  })

  it('边界：正好等于上限可入，+1 拒收（off-by-one，防沉默逻辑错误）', () => {
    const ok = addSkills([], [{ name: '刚好', text: '字'.repeat(SKILL_TEXT_MAX) }], 1)
    expect(ok.skills).toHaveLength(1)
    expect(ok.skills[0].chars).toBe(SKILL_TEXT_MAX)
    expect(ok.rejected).toEqual([])
    const over = addSkills([], [{ name: '超了', text: '字'.repeat(SKILL_TEXT_MAX + 1) }], 1)
    expect(over.skills).toHaveLength(0)
  })

  it('emoji：码点与 UTF-16 双闸门 —— 1200 个 emoji 因 UTF-16 翻倍被拒（预算是 UTF-16 口径）', () => {
    // 1200 个 emoji = 码点 1200（过第一道）/ UTF-16 2400（过不了第二道）⇒ 整条拒收。
    // 这正是 QA 抓到的真缺陷：只编码点会让「合法入库」的技能在引用层被截断。
    const r = addSkills([], [{ name: '满屏表情', text: '😀'.repeat(SKILL_TEXT_MAX) }], 1)
    expect(r.skills).toHaveLength(0)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0]).toContain('太长')
    // 两道闸门同值（1200），emoji 的 UTF-16 是码点的 2 倍 ⇒ emoji 上限就是 SKILL_UNITS_MAX / 2
    expect(SKILL_UNITS_MAX).toBe(SKILL_TEXT_MAX)
    const half = addSkills([], [{ name: '刚好', text: '😀'.repeat(SKILL_UNITS_MAX / 2) }], 1)
    expect(half.skills).toHaveLength(1)
    expect(half.skills[0].chars).toBe(SKILL_UNITS_MAX / 2)
    // 多一个就 1202 单元，超第二道
    expect(
      addSkills([], [{ name: '多一个', text: '😀'.repeat(SKILL_UNITS_MAX / 2 + 1) }], 1).skills,
    ).toHaveLength(0)
  })

  it('名字上限 40 码点：41 字整条拒收、40 字可入（超长名字会把引用块预算挤爆）', () => {
    const over = addSkills([], [{ name: '名'.repeat(SKILL_NAME_MAX + 1), text: 'x' }], 1)
    expect(over.skills).toHaveLength(0)
    expect(over.rejected[0]).toContain('名字')
    const ok = addSkills([], [{ name: '名'.repeat(SKILL_NAME_MAX), text: 'x' }], 1)
    expect(ok.skills).toHaveLength(1)
  })

  it('份数上限：第 13 条进不来，已入库的 12 条不动', () => {
    const full = Array.from({ length: SKILL_MAX }, (_, i) => skill({ id: `s${i}`, name: `技能${i}` }))
    const r = addSkills(full, [{ name: '再来一条', text: 'x' }], 1)
    expect(r.skills).toHaveLength(SKILL_MAX)
    expect(r.rejected[0]).toContain(String(SKILL_MAX))
  })

  it('CRLF 归一；chars 按码点记账（不是 UTF-16 单元）', () => {
    const r = addSkills([], [
      { name: 'a', text: '一\r\n二' },
      { name: 'b', text: '😀😀' },
    ], 1_700_000_000_000)
    expect(r.skills[0].text).toBe('一\n二')
    expect(r.skills[0].chars).toBe(3)
    expect(r.skills[1].chars).toBe(2)
  })

  it('id：同一毫秒内多份也不撞；撞了就让位', () => {
    const r = addSkills([], [{ name: 'a', text: 'x' }, { name: 'b', text: 'y' }], 1_700_000_000_000)
    expect(new Set(r.skills.map((s) => s.id)).size).toBe(2)
    expect(newSkillId(1_700_000_000_000, 0, [r.skills[0].id])).not.toBe(r.skills[0].id)
  })

  it('移除按 id，其余顺序不动', () => {
    const list = [skill({ id: 'a' }), skill({ id: 'b' }), skill({ id: 'c' })]
    expect(removeSkill(list, 'b').map((s) => s.id)).toEqual(['a', 'c'])
    expect(removeSkill(list, 'nope')).toHaveLength(3)
  })
})

describe('技能：进对话时是全文，且与卡片 / 资料共用同一条 @ 通道', () => {
  it('skillExcerpt 返回全文（trim），不截断、不加「摘录到此」后缀', () => {
    expect(skillExcerpt(skill())).toBe('把下面的要点写成三句话')
    const atLimit = skill({ text: '字'.repeat(SKILL_TEXT_MAX), chars: SKILL_TEXT_MAX })
    expect(skillExcerpt(atLimit)).toHaveLength(SKILL_TEXT_MAX)
    expect(skillExcerpt(atLimit)).not.toContain('摘录到此')
  })

  it('空正文给空串（界面负责说"没有可引用的内容"，模型侧不编）', () => {
    expect(skillExcerpt(skill({ text: '   \n ' }))).toBe('')
  })

  it('坞里那个入口：技能走全文、卡片 / 资料原样交回注入的摘录函数', () => {
    const skills = [skill({ id: 'sk', name: '周报', text: '技能正文' })]
    const other = (c: CardChoice): string => `别的：${c.label}`
    const fn = excerptWithSkills(skills, other)
    expect(fn({ id: 'sk', module: 'skills', title: '周报', label: '周报' })).toBe('技能正文')
    expect(fn(card())).toBe('别的：便签')
    expect(fn({ id: 'gone', module: 'skills', title: '没了', label: '没了' })).toBe('')
  })

  it('候选形状与卡片 / 资料一致（module=skills，label 就是名字）', () => {
    expect(skillChoices([skill({ id: 'sk', name: '周报' })])).toEqual([
      { id: 'sk', module: 'skills', title: '周报', label: '周报' },
    ])
  })

  // 验收判据 4：卡片 / 资料 / 技能同选只产出**一个** system 块，走同一条 excerptOf 通道。
  // 这里刻意用短内容，为的是一眼看全「三份都在」；顶格组合的真实超预算 / 封顶行为
  // 由下面 (b) 单独如实钉住，不靠把资料 / 卡片缩成极短来凑一个绿的数值。
  it('三者同选：卡片 / 资料 / 技能合成**一个** system 块，共用同一条 @ 通道', () => {
    const skills = [skill({ id: 'sk', name: '周报', text: '把要点压成三句话' })]
    const docs = [doc({ id: 'kb', name: '清单.md', text: '交付 A 与交付 B' })]
    const chips: CardChoice[] = [
      ...docChoices(docs),
      ...skillChoices(skills),
      card(),
    ]
    // 与 ChatDock 的接法逐字同构：技能薄壳包住资料薄壳，资料薄壳包住卡片摘录
    const excerptOf = excerptWithSkills(skills, excerptWithDocs(docs, (c) => `卡片：${c.label}`))
    const messages = buildMessages([], chips, excerptOf)
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1)
    const block = messages[0].content
    expect(block).toContain('交付 A')
    expect(block).toContain('把要点压成三句话')
    expect(block).toContain('卡片：便签')
  })

  // (a) 双闸门入库的顶格单条：`## name\n正文` 在 UTF-16 口径下远低于 2000 ⇒ over===false、
  // 无「已截断」、全文在块内。这是 SKILL_TEXT_MAX=1200 且**录入同时卡 UTF-16 单元**的机械理由。
  // 走 addSkills 的真实闸门（不再直接构造 Skill 对象），才证明「入库过的东西真的不会被截」。
  it('(a) 双闸门顶格技能（名字 40 + 正文 1200 汉字）：over===false、无「已截断」、全文在块内', () => {
    const name = '名'.repeat(SKILL_NAME_MAX)
    const full = '技'.repeat(SKILL_TEXT_MAX)
    const added = addSkills([], [{ name, text: full }], 1_700_000_000_000)
    expect(added.skills, '两道闸门都顶格但都没超 ⇒ 应入库').toHaveLength(1)
    expect(added.rejected).toEqual([])
    const skills = added.skills
    const excerptOf = excerptWithSkills(skills, () => '')
    const chips = skillChoices(skills)
    const usage = contextUsage(chips, excerptOf)
    // 42(head) + 2 + '## '(3) + 40 + '\n'(1) + 1200 = 1288，稳落 2000 内
    expect(usage.over).toBe(false)
    expect(usage.used).toBeLessThanOrEqual(CONTEXT_MAX)
    const block = contextBlock(chips, excerptOf)
    expect(block).not.toBeNull()
    expect(block).not.toContain('已截断')
    expect(block).toContain(full) // 全文，不是被 skillExcerpt 提前裁短的半份
    expect(block).toContain(name)
    expect(block!.length).toBeLessThanOrEqual(CONTEXT_MAX)
  })

  // (b) 组合「行为如实」：顶格技能 + 顶格资料 + 一张卡片必然超预算（1200+1200+400+head>2000）。
  // 不把它做成绿的：断言 over===true 与既有「已截断」，并证明 F3 没给技能开特殊通道 ——
  // 技能与资料都按全文交给同一个 contextBlock，一起在末尾被整块 slice 封顶，没有单独预裁。
  it('(b) 顶格技能 + 顶格资料 + 卡片：如实超预算、既有整块封顶、三者同一套规则、技能没被单独预裁', () => {
    const skillText = '技'.repeat(SKILL_TEXT_MAX)         // 1200，正好顶格
    const docText = '资'.repeat(KNOWLEDGE_EXCERPT_MAX)  // 1200，正好顶格
    const skills = [skill({ id: 'sk', name: '周报', text: skillText, chars: SKILL_TEXT_MAX })]
    const docs = [doc({ id: 'kb', name: '清单.md', text: docText, chars: KNOWLEDGE_EXCERPT_MAX })]
    // 刻意把技能排在首位：它的全文应完整落在截断线内，被整块 slice 切掉的是靠后的资料/卡片 ——
    // 这是 contextBlock 对所有 module 一视同仁的既定行为，不是针对技能的小灶。
    const chips: CardChoice[] = [
      ...skillChoices(skills),
      ...docChoices(docs),
      card(),
    ]
    const excerptOf = excerptWithSkills(skills, excerptWithDocs(docs, (c) => `卡片：${c.label}`))
    // spy：记录 contextBlock / contextUsage 实际拿到的每个 chip 正文长度
    const lens: Record<string, number> = {}
    const spied = (c: CardChoice): string => {
      const body = excerptOf(c)
      lens[c.module] = body.length
      return body
    }

    const usage = contextUsage(chips, spied)
    expect(usage.over).toBe(true)
    expect(usage.used).toBeGreaterThan(CONTEXT_MAX)

    const block = contextBlock(chips, spied)!
    expect(block).toContain('已截断')
    expect(block.length).toBeLessThanOrEqual(CONTEXT_MAX)
    // 三者同一套规则：技能 / 资料都按全文（各 1200）交给同一条通道，进块前没被单独裁短；
    // 技能全文完整保留 —— 被 slice 截的是排在后面的内容，不是「技能专属」的提前截断。
    expect(lens['skills']).toBe(SKILL_TEXT_MAX)
    expect(lens['knowledge']).toBe(KNOWLEDGE_EXCERPT_MAX)
    expect(block).toContain(skillText)
  })
})

describe('权限行：技能是第三档，两参调用逐字不变（PR-F3）', () => {
  it('沿用 F1 的两参文案，一个字都不改（E2E 与 aiChat.test.ts 钉着）', () => {
    expect(permNote(0, 0)).toBeNull()
    expect(permNote(1, 0)).toBe('本次可读 1 张卡的内容（各 ≤400 字）')
    expect(permNote(3, 0)).toBe('本次可读 3 张卡的内容（各 ≤400 字）')
    expect(permNote(0, 2)).toBe(`本次可读 2 份资料的内容（卡片各 ≤400 字、资料各 ≤${KNOWLEDGE_EXCERPT_MAX} 字）`)
    expect(permNote(1, 1)).toBe(`本次可读 1 张卡 + 1 份资料的内容（卡片各 ≤400 字、资料各 ≤${KNOWLEDGE_EXCERPT_MAX} 字）`)
  })

  it('带技能就把第三档上限写出来；0/0/0 仍是 null', () => {
    expect(permNote(0, 0, 0)).toBeNull()
    expect(permNote(0, 0, 1)).toBe(
      `本次可读 1 份技能的内容（卡片各 ≤400 字、资料各 ≤${KNOWLEDGE_EXCERPT_MAX} 字、技能各 ≤${SKILL_TEXT_MAX} 字）`,
    )
    expect(permNote(1, 1, 1)).toBe(
      `本次可读 1 张卡 + 1 份资料 + 1 份技能的内容（卡片各 ≤400 字、资料各 ≤${KNOWLEDGE_EXCERPT_MAX} 字、技能各 ≤${SKILL_TEXT_MAX} 字）`,
    )
  })
})
