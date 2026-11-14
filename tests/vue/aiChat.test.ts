import { describe, expect, it } from 'vitest'
import {
  addFiles,
  applyEvent,
  applyToolEvent,
  attachFile,
  ATTACH_CHARS_MAX,
  ATTACH_MAX_FILES,
  ATTACH_TOTAL_MAX,
  attachmentLine,
  buildMessages,
  canShowDock,
  cardChoices,
  charsLabel,
  contextBlock,
  contextUsage,
  excerptFor,
  filesSummary,
  filterChoices,
  fullContentFor,
  historyWhen,
  mentionQuery,
  normalizeEvent,
  outgoingFromTurns,
  permNote,
  settleToolSteps,
  stripMention,
  summaryText,
  THINKING_LEVELS,
  thinkingLabel,
  TOOL_DETAIL_MAX,
  toolLabel,
  TOOL_RESULT_MAX,
  toolResultLine,
  toolRows,
  TOOL_STATE_EMPTY,
  truncateResult,
  turnsFromHistory,
  type AiEvent,
  type CardChoice,
  type ChatTurn,
  type ExcerptSource,
  type ToolResult,
  type ToolState,
} from '../../src/vue/aiChat'

/**
 * 对话坞的判定层（F-12 二期 → F-15 P1a 换成事件流）。钉的是"慢网络与手滑最容易出事"的那几条：
 * 流式事件归并、`@` 触发词的边界、引用块的预算、历史里混进 system 的处理。
 *
 * 事件流那组用例盯的是三条不变量（契约 §2.2）：**只认 `done` 收尾**、
 * **`error` 之后来的 `done` 不许洗白**、**旧形状 `{delta,done,error}` 仍能读**。
 * 这三条任一条破了，界面表现都是"转圈转到天荒地老"或"报错了还显示成功"。
 */

const turn = (patch: Partial<ChatTurn> = {}): ChatTurn => ({
  role: 'user',
  content: '你好',
  status: 'done',
  error: null,
  ...patch,
})

const choice = (patch: Partial<CardChoice> = {}): CardChoice => ({
  id: 'todo',
  module: 'todo',
  title: '待办',
  label: '待办',
  ...patch,
})

/** 一张有内容的卡 + 一份"全空"的数据，按需覆盖字段 */
const source = (patch: Partial<ExcerptSource> = {}): ExcerptSource => ({
  sticky: '',
  todos: [],
  matrix: [],
  notes: [],
  ledger: { symbol: '¥', entries: [] },
  links: [],
  countdown: { label: '', date: '' },
  elapsed: { label: '', date: '' },
  habit: { name: '', days: [] },
  birthdays: [],
  pickList: [],
  ...patch,
})

describe('版面 → @卡片 候选', () => {
  it('同模块多实例带序号，单实例不带 —— 否则「@待办」选中哪一张只能靠猜', () => {
    const items = [{ id: 'todo', module: 'todo' }, { id: 'todo:2', module: 'todo' }, { id: 'sticky' }]
    const out = cardChoices(items, (m) => (m === 'todo' ? '待办' : '便签'))
    expect(out.map((c) => c.label)).toEqual(['待办（1）', '待办（2）', '便签'])
    // 没有 module 字段的旧条目按 id 当模块（与 moduleIdOf 同一口径）
    expect(out[2].module).toBe('sticky')
  })

  it('标题查不到时原样回模块 id —— 不编一个名字出来', () => {
    const out = cardChoices([{ id: 'x1', module: 'unknown-mod' }], (m) => m)
    expect(out[0].title).toBe('unknown-mod')
  })
})

describe('@ 触发词', () => {
  it('行首或空白后的 @ 才算触发', () => {
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQuery('看看 @待', 6)).toEqual({ query: '待', start: 3 })
    // 邮箱不是触发词
    expect(mentionQuery('a@b.com', 7)).toBeNull()
    expect(mentionQuery('没有艾特', 4)).toBeNull()
  })

  it('查询里出现空白或第二个 @ 就结束', () => {
    expect(mentionQuery('@待 办', 4)).toBeNull()
    expect(mentionQuery('@a@b', 4)).toBeNull()
  })

  it('只看光标左边；光标越界按正文两端夹取', () => {
    // 光标在 @ 之前：右边写好的 `@待办` 不参与
    expect(mentionQuery('@待办', 0)).toBeNull()
    expect(mentionQuery('@待办', 99)).toEqual({ query: '待办', start: 0 })
  })

  it('选中候选取掉 @查询，光标落在原处', () => {
    expect(stripMention('看看 @待 吧', 3, 5)).toEqual({ text: '看看  吧', caret: 3 })
    // 光标在 start 之前（调用方传错）也不会把正文反向切坏
    expect(stripMention('abc', 2, 0)).toEqual({ text: 'abc', caret: 2 })
  })
})

describe('候选筛选', () => {
  const choices = [choice({ label: '待办（1）' }), choice({ id: 'n', module: 'notes', title: '速记', label: '速记' })]

  it('空查询列前几个；大小写不敏感；按标题也能命中', () => {
    expect(filterChoices(choices, '').map((c) => c.title)).toEqual(['待办', '速记'])
    expect(filterChoices(choices, '速').map((c) => c.title)).toEqual(['速记'])
    expect(filterChoices([choice({ title: 'Todo', label: 'Todo' })], 'TO').length).toBe(1)
  })

  it('有条数上限 —— 再多就没法用方向键选了', () => {
    const many = Array.from({ length: 20 }, (_, i) => choice({ id: `c${i}` }))
    expect(filterChoices(many, '').length).toBe(6)
    expect(filterChoices(many, '', 2).length).toBe(2)
  })
})

describe('事件流归并（applyEvent）', () => {
  it('text：增量累积，状态仍是 streaming', () => {
    const t = applyEvent(turn({ role: 'assistant', content: '', status: 'streaming' }), { t: 'text', delta: '你' })
    expect(t).toMatchObject({ content: '你', status: 'streaming' })
    expect(applyEvent(t, { t: 'text', delta: '好' }).content).toBe('你好')
  })

  it('空增量（SSE 心跳 / 空行）原样返回同一个对象 —— 不产生新引用，省一次重渲染', () => {
    const t = turn()
    expect(applyEvent(t, { t: 'text', delta: '' })).toBe(t)
  })

  it('错误压过一切：已经收到的一半留着，但状态不能被随后的 done 洗掉', () => {
    const a = applyEvent(turn({ role: 'assistant', content: '半句', status: 'streaming' }), {
      t: 'error',
      message: '连接失败',
    })
    expect(a).toMatchObject({ content: '半句', status: 'error', error: '连接失败' })
    // 契约：error 之后必有 done{reason:'error'} —— 它只说"流收尾了"，不说"成功了"
    const b = applyEvent(a, { t: 'done', reason: 'error' })
    expect(b).toBe(a)
    // 再来一条 text 也拉不回 streaming（用户看到的是"写了一半然后报错"，不是"又活了"）
    expect(applyEvent(b, { t: 'text', delta: '续' })).toBe(a)
  })

  it('done 收尾：三种 reason 都只表示"这轮结束了"，气泡一律 done', () => {
    const reasons = ['stop', 'tool', 'error'] as const
    for (const reason of reasons) {
      expect(applyEvent(turn({ status: 'streaming' }), { t: 'done', reason }).status).toBe('done')
    }
  })

  it('工具事件与轮次不动气泡 —— 它们属于时间线（applyToolEvent），不是正文', () => {
    const t = turn({ status: 'streaming' })
    const idle: AiEvent[] = [
      { t: 'round', n: 2 },
      { t: 'toolStart', id: 'c1', name: 'todo_add', args: { text: '交周报' } },
      { t: 'toolEnd', id: 'c1', ok: true, result: '已加', error: null },
    ]
    for (const ev of idle) expect(applyEvent(t, ev)).toBe(t)
  })
})

describe('normalizeEvent：一帧 → 事件数组（唯一的解析入口）', () => {
  it('text：增量原样带过；缺 delta 落成空串（不把 undefined 拼进正文）', () => {
    expect(normalizeEvent({ t: 'text', delta: '你好' })).toEqual([{ t: 'text', delta: '你好' }])
    expect(normalizeEvent({ t: 'text' })).toEqual([{ t: 'text', delta: '' }])
  })

  it('toolStart：args 原样透传（形状由具体工具决定，这一层不解释）', () => {
    const args = { text: '交周报', due: null }
    expect(normalizeEvent({ t: 'toolStart', id: 'c1', name: 'todo_add', args })).toEqual([
      { t: 'toolStart', id: 'c1', name: 'todo_add', args },
    ])
    // 缺 id / name：给空串，让时间线还能落一个占位行，而不是 undefined 冒到模板里
    expect(normalizeEvent({ t: 'toolStart' })).toEqual([{ t: 'toolStart', id: '', name: '', args: undefined }])
  })

  it('toolEnd：ok 只认严格的 true；result / error 非字符串落成 null', () => {
    expect(normalizeEvent({ t: 'toolEnd', id: 'c1', ok: true, result: '已加', error: null })).toEqual([
      { t: 'toolEnd', id: 'c1', ok: true, result: '已加', error: null },
    ])
    expect(normalizeEvent({ t: 'toolEnd', id: 'c1', ok: 'yes', result: 1, error: { x: 1 } })).toEqual([
      { t: 'toolEnd', id: 'c1', ok: false, result: null, error: null },
    ])
    // 连 id 都没有：给空串（配不上任何 toolStart ⇒ 时间线上被忽略，而不是抛）
    expect(normalizeEvent({ t: 'toolEnd' })).toEqual([{ t: 'toolEnd', id: '', ok: false, result: null, error: null }])
  })

  it('round：非正 / 非数字 / 非有限一律当第 1 轮 —— 轮次只影响分组，不该让整条流报错', () => {
    expect(normalizeEvent({ t: 'round', n: 2 })).toEqual([{ t: 'round', n: 2 }])
    expect(normalizeEvent({ t: 'round', n: 2.7 })).toEqual([{ t: 'round', n: 2 }])
    expect(normalizeEvent({ t: 'round' })).toEqual([{ t: 'round', n: 1 }])
    expect(normalizeEvent({ t: 'round', n: 0 })).toEqual([{ t: 'round', n: 1 }])
    expect(normalizeEvent({ t: 'round', n: '3' })).toEqual([{ t: 'round', n: 1 }])
    expect(normalizeEvent({ t: 'round', n: Number.POSITIVE_INFINITY })).toEqual([{ t: 'round', n: 1 }])
  })

  it('done：三个 reason 原样；不认识的按 stop 收（别把界面卡在"进行中"）', () => {
    expect(normalizeEvent({ t: 'done', reason: 'tool' })).toEqual([{ t: 'done', reason: 'tool' }])
    expect(normalizeEvent({ t: 'done', reason: 'error' })).toEqual([{ t: 'done', reason: 'error' }])
    expect(normalizeEvent({ t: 'done', reason: 'stop' })).toEqual([{ t: 'done', reason: 'stop' }])
    expect(normalizeEvent({ t: 'done', reason: 'canceled' })).toEqual([{ t: 'done', reason: 'stop' }])
    expect(normalizeEvent({ t: 'done' })).toEqual([{ t: 'done', reason: 'stop' }])
  })

  it('error：空原因给一句人话，但这一帧不能吞（吞掉就成了"半句 + 一直转圈"）', () => {
    expect(normalizeEvent({ t: 'error', message: '连接超时' })).toEqual([{ t: 'error', message: '连接超时' }])
    expect(normalizeEvent({ t: 'error', message: '   ' })).toEqual([
      { t: 'error', message: '模型服务报了个错，但没给原因' },
    ])
    expect(normalizeEvent({ t: 'error' })).toEqual([{ t: 'error', message: '模型服务报了个错，但没给原因' }])
  })

  it('旧形状 {delta,done,error}（≤0.8.12）仍能读：错的帧拆成 error + done{reason:error}', () => {
    // 心跳 / 空帧：什么事件都不产生
    expect(normalizeEvent({ delta: '', done: false, error: null })).toEqual([])
    // delta 不是字符串（老桩里见过数字）：当空增量，不把 12 拼进正文
    expect(normalizeEvent({ delta: 12, done: false })).toEqual([])
    expect(normalizeEvent({ delta: '半句', done: false, error: null })).toEqual([{ t: 'text', delta: '半句' }])
    expect(normalizeEvent({ delta: '', done: false, error: '连接失败' })).toEqual([{ t: 'error', message: '连接失败' }])
    expect(normalizeEvent({ delta: '半句', done: true, error: null })).toEqual([
      { t: 'text', delta: '半句' },
      { t: 'done', reason: 'stop' },
    ])
    // 老后端把"错"和"尾"塞在同一帧：拆成两条，于是"只认 done 收尾"在老帧上也成立
    const tail: AiEvent[] = normalizeEvent({ delta: '', done: true, error: '连接失败' })
    expect(tail).toEqual([
      { t: 'error', message: '连接失败' },
      { t: 'done', reason: 'error' },
    ])
    // 老帧走完整条 applyEvent：状态是 error，且不被尾部那条 done 洗白
    const t = tail.reduce<ChatTurn>((acc, ev) => applyEvent(acc, ev), turn({ status: 'streaming' }))
    expect(t).toMatchObject({ status: 'error', error: '连接失败' })
  })

  it('未知 t / 非对象 / 数组一律忽略（不抛）：前端比后端松一档，多出一种事件不该打断整条流', () => {
    expect(normalizeEvent({ t: 'thinking', text: '正在想' })).toEqual([])
    expect(normalizeEvent(null)).toEqual([])
    expect(normalizeEvent(undefined)).toEqual([])
    expect(normalizeEvent('text')).toEqual([])
    expect(normalizeEvent([{ t: 'text', delta: 'x' }])).toEqual([])
  })
})

describe('工具时间线（toolStart / toolEnd / round 的归并点）', () => {
  it('toolStart 起一行 running；toolEnd 靠 id 配对改状态（它本身不带 name）', () => {
    let st: ToolState = applyToolEvent(undefined, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    expect(st.steps).toHaveLength(1)
    expect(st.steps[0]).toMatchObject({ id: 'c1', label: '加一条待办', round: 1, step: 'running', result: null })
    st = applyToolEvent(st, { t: 'toolEnd', id: 'c1', ok: true, result: '已加：交周报', error: null })
    expect(st.steps[0]).toMatchObject({ step: 'ok', result: '已加：交周报' })

    let bad: ToolState = applyToolEvent(undefined, { t: 'toolStart', id: 'c2', name: '不存在的工具', args: {} })
    bad = applyToolEvent(bad, { t: 'toolEnd', id: 'c2', ok: false, result: null, error: '没有这个工具' })
    expect(bad.steps[0]).toMatchObject({ step: 'fail', error: '没有这个工具' })
    // 名字查不到就照实说，不编一个人话名字
    expect(bad.steps[0].label).toBe('调用工具「不存在的工具」')
    expect(toolLabel('')).toBe('调用工具「（没写名字）」')
    // 下划线与点号两种写法都认（P1b 从动作白名单生成工具名时两种都可能出现）
    expect(toolLabel('ledger.add')).toBe('记一笔账')
  })

  it('round：先记下轮次，其后的步骤挂在它下面；缺省就是第 1 轮', () => {
    expect(TOOL_STATE_EMPTY).toEqual({ round: 1, steps: [] })
    let st = applyToolEvent(undefined, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    st = applyToolEvent(st, { t: 'round', n: 2 })
    st = applyToolEvent(st, { t: 'toolStart', id: 'c2', name: 'ledger_add', args: {} })
    expect(st.round).toBe(2)
    expect(st.steps.map((x) => x.round)).toEqual([1, 2])
  })

  it('同 id 重发：toolEnd 结最后一个（最后那个才是这次的结论）；配不上的 end 忽略，不凭空造行', () => {
    let st = applyToolEvent(undefined, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    st = applyToolEvent(st, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    st = applyToolEvent(st, { t: 'toolEnd', id: 'c1', ok: false, result: null, error: '拒收' })
    expect(st.steps.map((x) => x.step)).toEqual(['running', 'fail'])
    const before = st
    expect(applyToolEvent(st, { t: 'toolEnd', id: 'zzz', ok: true, result: 'x', error: null })).toBe(before)
    // 非工具事件从这里过：原样返回，不产生新状态
    expect(applyToolEvent(st, { t: 'text', delta: '好' })).toBe(before)
    expect(applyToolEvent(undefined, { t: 'done', reason: 'stop' })).toEqual(TOOL_STATE_EMPTY)
  })

  it('settleToolSteps：流收尾把还在转的标成失败并给原因（让它一直转是骗人）', () => {
    let st = applyToolEvent(undefined, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    st = settleToolSteps(st)
    expect(st.steps[0]).toMatchObject({ step: 'fail', error: '这一轮结束了，但这一步没拿到结果' })
    // 已经结完的：原样返回同一个对象（不产生新引用）
    expect(settleToolSteps(st)).toBe(st)
    expect(settleToolSteps(undefined)).toEqual(TOOL_STATE_EMPTY)
    // 行上已经有原因（重挂后补进来的状态）就留着，不覆盖成那句通用的话
    const kept: ToolState = {
      round: 1,
      steps: [{ id: 'c9', name: 'todo_add', label: '加一条待办', round: 1, step: 'running', result: null, error: '之前记下的', args: {} }],
    }
    expect(settleToolSteps(kept).steps[0].error).toBe('之前记下的')
    // 混合态：只动还在转的那行，已经结完的行原样留着（不许把"成功"改写）
    const mixed: ToolState = {
      round: 1,
      steps: [
        { id: 'c1', name: 'todo_add', label: '加一条待办', round: 1, step: 'ok', result: '已加', error: null, args: {} },
        { id: 'c2', name: 'ledger_add', label: '记一笔账', round: 1, step: 'running', result: null, error: null, args: {} },
      ],
    }
    const settled = settleToolSteps(mixed)
    expect(settled.steps.map((x) => x.step)).toEqual(['ok', 'fail'])
    expect(settled.steps[0]).toBe(mixed.steps[0])
  })

  it('toolRows：失败给原因、成功给结果、空值给 null；超长截到 80 字加省略号', () => {
    let st = applyToolEvent(undefined, { t: 'toolStart', id: 'c1', name: 'todo_add', args: {} })
    st = applyToolEvent(st, { t: 'toolEnd', id: 'c1', ok: true, result: '已加：交周报', error: null })
    st = applyToolEvent(st, { t: 'toolStart', id: 'c2', name: 'ledger_add', args: {} })
    st = applyToolEvent(st, { t: 'toolEnd', id: 'c2', ok: false, result: null, error: '没有这个工具' })
    const rows = toolRows(st)
    expect(rows.map((r) => r.label)).toEqual(['加一条待办', '记一笔账'])
    expect(rows.map((r) => r.detail)).toEqual(['已加：交周报', '没有这个工具'])

    const long = 'x'.repeat(TOOL_DETAIL_MAX + 20)
    let big = applyToolEvent(undefined, { t: 'toolStart', id: 'c3', name: 'todo_add', args: {} })
    big = applyToolEvent(big, { t: 'toolEnd', id: 'c3', ok: true, result: long, error: null })
    const detail = toolRows(big)[0].detail
    expect(detail).toHaveLength(TOOL_DETAIL_MAX + 1)
    expect(detail?.endsWith('…')).toBe(true)

    // 只有空白的结果 = 没有详情，别画一行空话
    let blank = applyToolEvent(undefined, { t: 'toolStart', id: 'c4', name: 'todo_add', args: {} })
    blank = applyToolEvent(blank, { t: 'toolEnd', id: 'c4', ok: true, result: '   ', error: null })
    expect(toolRows(blank)[0].detail).toBeNull()
    expect(toolRows(undefined)).toEqual([])
  })

  it('toolStart 的参数留在状态里 —— 执行发生在流结束之后，那时已经拿不到那一帧了', () => {
    const st = applyToolEvent(undefined, {
      t: 'toolStart',
      id: 'c1',
      name: 'todo_add',
      args: { text: '交周报', instanceId: 'todo:2' },
    })
    expect(st.steps[0].args).toEqual({ text: '交周报', instanceId: 'todo:2' })
    // 配对的 end 不改参数：它只说结论
    const done = applyToolEvent(st, { t: 'toolEnd', id: 'c1', ok: true, result: '已加', error: null })
    expect(done.steps[0].args).toEqual({ text: '交周报', instanceId: 'todo:2' })
  })
})

// F4c-1：工具执行的结算与回灌（`done{reason:'tool'}` 之后那半）
describe('工具结果的截断与回灌', () => {
  const res = (over: Partial<ToolResult> = {}): ToolResult => ({
    id: 'c1',
    name: 'todo_add',
    ok: true,
    result: '已加：交周报',
    error: null,
    truncated: false,
    ...over,
  })

  it('截断按码点算：8000 以内原样、多一个就截到 8000 并记下"截过"', () => {
    expect(truncateResult('短')).toEqual({ text: '短', truncated: false })
    const exact = 'x'.repeat(TOOL_RESULT_MAX)
    expect(truncateResult(exact)).toEqual({ text: exact, truncated: false })

    const over = 'x'.repeat(TOOL_RESULT_MAX + 1)
    const cut = truncateResult(over)
    expect(cut.truncated).toBe(true)
    expect(cut.text).toHaveLength(TOOL_RESULT_MAX)
  })

  it('emoji 不会被劈成半个 —— 按码点而不是 UTF-16 单元计数', () => {
    // 😀 是 2 个 UTF-16 单元：按 `.length` 截会留下半个（渲染成 ）且字数对不上
    const emoji = '😀'.repeat(TOOL_RESULT_MAX + 5)
    const cut = truncateResult(emoji)
    expect(cut.truncated).toBe(true)
    expect(Array.from(cut.text)).toHaveLength(TOOL_RESULT_MAX)
    expect(cut.text.endsWith('😀')).toBe(true)
  })

  it('回灌一行：成功带产出 / 成功没产出 / 失败带原因 —— 三态不许混成一句话', () => {
    expect(toolResultLine(res())).toBe('调用「加一条待办」：已加：交周报')
    // 写类动作没有产出是常态 ⇒ 直说「成功了」。说成「成功了，但没有输出」会让模型以为没生效、再调一次
    expect(toolResultLine(res({ result: null }))).toBe('调用「加一条待办」：成功了')
    expect(toolResultLine(res({ result: '   ' }))).toBe('调用「加一条待办」：成功了')
    expect(toolResultLine(res({ ok: false, result: null, error: '没写内容' }))).toBe(
      '调用「加一条待办」：失败（没写内容）',
    )
    // 原因缺失时也得有话说，不能吐一句「失败（）」
    expect(toolResultLine(res({ ok: false, result: null, error: null }))).toBe(
      '调用「加一条待办」：失败（原因未知）',
    )
    // 未知工具名落回工具名本身，不编一个人话名字、也不许套娃成「调用「调用工具「x」」」
    expect(toolResultLine(res({ name: 'mcp__weird' }))).toBe('调用「mcp__weird」：已加：交周报')
    expect(toolResultLine(res({ name: '' }))).toBe('调用「（没写名字）」：已加：交周报')
  })

  it('截断过就必须说出来 —— 静默截会让模型以为「就这些」', () => {
    const line = toolResultLine(res({ truncated: true }))
    expect(line).toContain(`只带了前 ${TOOL_RESULT_MAX} 字`)
  })
})

describe('组装请求', () => {
  it('只发说完的：流式占位、出错的整轮、空白内容都不进历史', () => {
    const turns = [
      turn({ role: 'user', content: '第一问' }),
      turn({ role: 'assistant', content: '第一答' }),
      turn({ role: 'user', content: '  ' }),
      turn({ role: 'assistant', content: '', status: 'streaming' }),
      turn({ role: 'assistant', content: '失败', status: 'error', error: 'x' }),
      turn({ role: 'user', content: '第二问' }),
    ]
    expect(outgoingFromTurns(turns)).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ])
  })

  it('只保留最近 N 条 —— 长上下文靠会话，不靠无限塞', () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn({ content: `第 ${i} 条` }))
    const out = outgoingFromTurns(turns, 3)
    expect(out.map((m) => m.content)).toEqual(['第 17 条', '第 18 条', '第 19 条'])
  })

  it('有引用时 system 块在最前（引用块 + 能力说明）；没引用时也有一条 system（只装能力说明）', () => {
    const chips = [choice()]
    const withCtx = buildMessages([turn()], chips, () => '未完成：交周报')
    expect(withCtx[0].role).toBe('system')
    expect(withCtx[0].content).toContain('待办')
    expect(withCtx[0].content).toContain('交周报')
    expect(withCtx[0].content).toContain('@@act') // 第十二笔：能力说明常驻
    expect(withCtx[1]).toEqual({ role: 'user', content: '你好' })
    // 没引用时引用块那半不出现，但能力说明仍在（模型得一直知道能动手）
    const noCtx = buildMessages([turn()], [], () => '')
    expect(noCtx[0].role).toBe('system')
    expect(noCtx[0].content).toContain('@@act')
    expect(noCtx[0].content).not.toContain('用户在版面里引用了')
    expect(noCtx[1]).toEqual({ role: 'user', content: '你好' })
  })

  it('引用块有预算：超了要明说被截断，不能静默变成"就这些"', () => {
    const block = contextBlock([choice()], () => 'x'.repeat(5000))!
    expect(block.length).toBeLessThanOrEqual(2000 + '（引用内容过长，已截断）'.length + 1)
    expect(block).toContain('已截断')
  })

  it('没有可引用内容的卡如实写一句，不替它编内容', () => {
    expect(contextBlock([choice({ label: '时钟' })], () => '')).toContain('没有可引用的文字内容')
    expect(contextBlock([], () => '')).toBeNull()
  })

  /**
   * E2 的 composer 控件行显示「已用 X / 2000」—— 这个数字与 `contextBlock` 的
   * 事后截断必须同源，否则控件是个"看着玩的花架子"（显示没超、其实早截了）。
   * 钉法：不超预算时 usage.used == contextBlock 的真实长度（逐字符核对）。
   */
  it('contextUsage 与 contextBlock 同源：不超预算时两个数字逐字符相等', () => {
    const chips = [choice({ id: 'a', label: '待办' }), choice({ id: 'b', label: '便签' })]
    const u = contextUsage(chips, (c) => (c.id === 'a' ? '交周报' : '周五前发老板'))
    const block = contextBlock(chips, (c) => (c.id === 'a' ? '交周报' : '周五前发老板'))!
    expect(u.used).toBe(block.length)
    expect(u.max).toBe(2000)
    expect(u.cards).toBe(2)
    expect(u.over).toBe(false)
  })

  it('contextUsage：空摘录的卡也占那一份「没有可引用内容」的长度；超预算 over 翻真', () => {
    const u1 = contextUsage([choice({ label: '时钟' })], () => '')
    const b1 = contextBlock([choice({ label: '时钟' })], () => '')!
    expect(u1.used).toBe(b1.length)
    const u2 = contextUsage([choice()], () => 'x'.repeat(5000))
    expect(u2.over, '5000 字远超 2000 预算 ⇒ over').toBe(true)
    expect(u2.cards).toBe(1)
  })
})

describe('摘要正文（三期）', () => {
  const excerpt = (c: CardChoice): string => (c.id === 'sticky' ? '周五前把周报发给老板' : '')

  it('什么都没给 → null（按钮应保持禁用）', () => {
    expect(summaryText([], '   ', excerpt)).toBeNull()
  })

  it('只有引用：正文就是引用块 —— 带头、带卡片正文', () => {
    const out = summaryText([choice({ id: 'sticky', module: 'sticky', label: '便签' })], '', excerpt)!
    expect(out).toContain('用户在版面里引用了下面这些卡片')
    expect(out).toContain('## 便签')
    expect(out).toContain('周五前把周报发给老板')
  })

  it('只有输入：正文就是那段字（去掉首尾空白）', () => {
    expect(summaryText([], '  下周交周报  ', excerpt)).toBe('下周交周报')
  })

  it('两者都有：卡片在前、输入在后 —— 后者往往是对前者的指令', () => {
    const out = summaryText([choice({ id: 'sticky', module: 'sticky', label: '便签' })], '只留待办', excerpt)!
    expect(out.indexOf('## 便签')).toBeLessThan(out.indexOf('只留待办'))
  })

  it('引用块贴着预算时再加输入会超：整段二次封顶并明说截断', () => {
    const long = '账'.repeat(2000)
    const out = summaryText([choice({ id: 'sticky', module: 'sticky' })], long, () => long, 2000)!
    expect(out.length).toBe(2000)
    expect(out.endsWith('（内容过长，已截断）')).toBe(true)
  })

  it('预算在边界内原样返回（不多切一刀）', () => {
    expect(summaryText([], 'abc', excerpt, 10)).toBe('abc')
  })
})

describe('卡片正文摘录（只读用户真写进去的字）', () => {
  it('便签按实例取（第二张读自己那份）', () => {
    expect(excerptFor(choice({ module: 'sticky', id: 'sticky' }), source({ sticky: '第一张' }))).toBe('第一张')
    expect(
      excerptFor(
        choice({ module: 'sticky', id: 'sticky:2' }),
        source({ sticky: '第一张', byInstance: { 'sticky:2': { sticky: '第二张' } } }),
      ),
    ).toBe('第二张')
  })

  it('待办分未完成/已完成；全空时什么都不给', () => {
    const todos = [
      { id: 'a', text: '交周报', done: false },
      { id: 'b', text: '买牛奶', done: true },
    ]
    expect(excerptFor(choice({ module: 'todo' }), source({ todos }))).toBe('未完成：交周报（另有 1 条已完成）')
    // 第二张待办卡读自己那份清单（F-01 阶段 2 第二个字段），不回落第一张
    const second = excerptFor(
      choice({ module: 'todo', id: 'todo:2' }),
      source({ todos, byInstance: { 'todo:2': { todos: [{ id: 'z', text: '写周会纪要', done: false }] } } }),
    )
    expect(second).toBe('未完成：写周会纪要')
    expect(excerptFor(choice({ module: 'todo' }), source({ todos: [{ id: 'b', text: '买牛奶', done: true }] }))).toBe(
      '没有未完成的条目（另有 1 条已完成）',
    )
    expect(excerptFor(choice({ module: 'todo' }), source())).toBe('')
    // 一条都没完成：不画蛇添足写「另有 0 条已完成」
    expect(excerptFor(choice({ module: 'todo' }), source({ todos: [{ id: 'a', text: '交周报', done: false }] }))).toBe(
      '未完成：交周报',
    )
  })

  it('四象限 / 速记 / 记账 / 链接各有自己的形状', () => {
    // `id` 必须显式给成 `matrix`：`choice()` 的默认 id 是 `todo`，配 `module: 'matrix'`
    // 是现实里不存在的组合（实例 id 与模块 id 不等 ⇒ 按"第二实例"取 ⇒ 读 `byInstance['todo']`）。
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix' }),
        source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: false }] }),
      ),
    ).toBe('未完成：季度复盘')
    // 第二张四象限卡读自己那份清单（F-01 阶段 2 合并序第七个字段），不回落第一张
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix:2' }),
        source({
          matrix: [{ id: 'm', text: '第一张的复盘', q: 'plan', done: false }],
          byInstance: { 'matrix:2': { matrix: [{ id: 'z', text: '第二张的复盘', q: 'plan', done: false }] } },
        }),
      ),
    ).toBe('未完成：第二张的复盘')
    // 四象限全做完了 = 没有可引用的未完成项
    expect(
      excerptFor(
        choice({ module: 'matrix', id: 'matrix' }),
        source({ matrix: [{ id: 'm', text: '季度复盘', q: 'plan', done: true }] }),
      ),
    ).toBe('')
    expect(
      excerptFor(
        choice({ module: 'notes', id: 'notes' }),
        source({ notes: [{ id: 'n', title: '周会', body: '三件事', at: 0 }] }),
      ),
    ).toBe('周会：三件事')
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({ ledger: { symbol: '¥', entries: [{ id: 'l', date: '2026-10-28', cents: 1250, category: '餐饮', note: '午饭' }] } }),
      ),
    ).toBe('2026-10-28 餐饮 午饭 12.50¥')
    expect(
      excerptFor(choice({ module: 'links' }), source({ links: [{ label: '文档', href: 'https://x.y' }] })),
    ).toBe('文档 https://x.y')
    // 无标题 / 未分类 / 没设币种：给中性兜底，不出「：」开头的半截行
    expect(
      excerptFor(choice({ module: 'notes', id: 'notes' }), source({ notes: [{ id: 'n', title: '', body: '没有标题', at: 0 }] })),
    ).toBe('无标题：没有标题')
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({ ledger: { symbol: '', entries: [{ id: 'l', date: '2026-10-28', cents: 100, category: '', note: '早饭' }] } }),
      ),
    ).toBe('2026-10-28 未分类 早饭 1.00')
  })

  it('记账按实例取：第二张报自己的条目，符号仍共用顶层那个（§12.48 的口径）', () => {
    const first = { ledger: { symbol: '¥', entries: [{ id: 'l1', date: '2026-10-28', cents: 1250, category: '餐饮', note: '午饭' }] } }
    expect(
      excerptFor(
        choice({ module: 'ledger', id: 'ledger:2' }),
        source({
          ...first,
          byInstance: {
            'ledger:2': { ledger: [{ id: 'l2', date: '2026-10-29', cents: 3900, category: '医疗', note: '体检挂号' }] },
          },
        }),
      ),
    ).toBe('2026-10-29 医疗 体检挂号 39.00¥')
    // 第二张还没记 ⇒ 空串，不拿第一张的条目（口径与前四个字段逐字相同）
    expect(excerptFor(choice({ module: 'ledger', id: 'ledger:2' }), source(first))).toBe('')
  })

  it('倒数日 / 正计时 / 习惯 / 生日 / 抽签', () => {
    // id 要与 module 配对（`choice` 默认给的是 todo）：不配对就等于"第二实例"，读的是切片不是顶层
    expect(
      excerptFor(choice({ module: 'countdown', id: 'countdown' }), source({ countdown: { label: '发版', date: '2026-11-01' } })),
    ).toBe('发版：2026-11-01')
    expect(
      excerptFor(choice({ module: 'elapsed', id: 'elapsed' }), source({ elapsed: { label: '戒烟', date: '2026-01-01' } })),
    ).toBe('戒烟：从 2026-01-01 起')
    // 习惯与哥哥们一样：id 要与 module 配对，不配对（`choice` 默认 id 是 'todo'）等于
    // 声称"第二实例"，读的是切片 —— 那条路在下面的按实例用例里单独钉
    expect(
      excerptFor(choice({ module: 'habit', id: 'habit' }), source({ habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] } })),
    ).toBe('跑步：已打卡 2 天')
    expect(
      excerptFor(choice({ module: 'birthday' }), source({ birthdays: [{ id: 'b', name: '小王', month: 3, day: 5 }] })),
    ).toBe('小王：3 月 5 日')
    expect(excerptFor(choice({ module: 'pick' }), source({ pickList: [{ id: 'p', label: '小红', weight: 1 }] }))).toBe('小红')
  })

  it('倒数日按实例取：第二张报自己的日子，没设日子时不拿第一张的', () => {
    const first = { countdown: { label: '发版', date: '2026-11-01' } }
    expect(
      excerptFor(
        choice({ module: 'countdown', id: 'countdown:2' }),
        source({ ...first, byInstance: { 'countdown:2': { countdown: { label: '体检', date: '2026-12-20' } } } }),
      ),
    ).toBe('体检：2026-12-20')
    // 第二张还没设日子 ⇒ 空串，**不回落顶层**（口径与便签 / 待办逐字相同：回落就是把阶段 1 那个缺陷请回来）
    expect(excerptFor(choice({ module: 'countdown', id: 'countdown:2' }), source(first))).toBe('')
  })

  it('正计时按实例取：第二张报自己的起点，没设起点时不拿第一张的', () => {
    const first = { elapsed: { label: '戒烟', date: '2026-01-01' } }
    expect(
      excerptFor(
        choice({ module: 'elapsed', id: 'elapsed:2' }),
        source({ ...first, byInstance: { 'elapsed:2': { elapsed: { label: '健身', date: '2026-05-01' } } } }),
      ),
    ).toBe('健身：从 2026-05-01 起')
    expect(excerptFor(choice({ module: 'elapsed', id: 'elapsed:2' }), source(first))).toBe('')
  })

  it('习惯按实例取：第二张报自己的名字和天数，没设时不拿第一张的', () => {
    const first = { habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] } }
    expect(
      excerptFor(
        choice({ module: 'habit', id: 'habit:2' }),
        source({ ...first, byInstance: { 'habit:2': { habit: { name: '冥想', days: ['2026-11-01', '2026-11-02', '2026-11-03'] } } } }),
      ),
    ).toBe('冥想：已打卡 3 天')
    // 第二张还没设 ⇒ 空串，**不回落顶层**（口径与哥哥们逐字相同：回落就是把阶段 1 那个缺陷请回来）
    expect(excerptFor(choice({ module: 'habit', id: 'habit:2' }), source(first))).toBe('')
  })

  it('速记按实例取：第二张报自己的那几条，没写时不拿第一张的', () => {
    const first = { notes: [{ id: 'n1', title: '第一张的', body: '顶层那份', at: 1 }] }
    expect(
      excerptFor(
        choice({ module: 'notes', id: 'notes:2' }),
        source({ ...first, byInstance: { 'notes:2': { notes: [{ id: 'n2', title: '第二张的', body: '切片那份', at: 2 }] } } }),
      ),
    ).toBe('第二张的：切片那份')
    // 第二张还没写 ⇒ 空串，不回落顶层（§12.52 习惯同一条口径）
    expect(excerptFor(choice({ module: 'notes', id: 'notes:2' }), source(first))).toBe('')
  })

  it('没写内容 / 不认识的模块一律空串（联网卡与计算卡不喂）', () => {
    expect(excerptFor(choice({ module: 'countdown', id: 'countdown' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'elapsed', id: 'elapsed' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'habit', id: 'habit' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'notes' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'ledger', id: 'ledger' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'birthday' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'pick' }), source())).toBe('')
    expect(excerptFor(choice({ module: 'weather' }), source())).toBe('')
  })

  it('超长正文被截断（每张卡 400 字）', () => {
    const long = excerptFor(choice({ module: 'sticky', id: 'sticky' }), source({ sticky: 'x'.repeat(900) }))
    expect(long.length).toBe(401)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('读全卡（v1.5）：与摘录分开，同一份数据、不同的量', () => {
  it('便签读全文（摘录只到 400 字），且按实例取', () => {
    const long = 'y'.repeat(900)
    expect(fullContentFor(choice({ module: 'sticky', id: 'sticky' }), source({ sticky: long }))).toBe(long)
    expect(
      fullContentFor(
        choice({ module: 'sticky', id: 'sticky:2' }),
        source({ sticky: '第一张', byInstance: { 'sticky:2': { sticky: '第二张' } } }),
      ),
    ).toBe('第二张')
  })

  it('待办逐条列出（含已完成），不是摘录那种「前 8 条未完成」', () => {
    const todos = [
      { id: 'a', text: '交周报', done: false },
      { id: 'b', text: '买牛奶', done: true },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, text: `第 ${i} 条`, done: false })),
    ]
    const full = fullContentFor(choice({ module: 'todo' }), source({ todos }))
    expect(full).toContain('· 交周报')
    expect(full).toContain('✓ 买牛奶')
    expect(full).toContain('· 第 11 条') // 摘录只取前 8 条，全文全都在
    expect(full.split('\n')).toHaveLength(14)
  })

  it('四象限 / 速记 / 记账各有自己的全文形状', () => {
    expect(
      fullContentFor(
        choice({ module: 'matrix', id: 'matrix' }),
        source({
          matrix: [
            { id: 'm', text: '季度复盘', q: 'plan', done: true },
            { id: 'm2', text: '下季度规划', q: 'plan', done: false },
          ],
        }),
      ),
    ).toBe('✓ 季度复盘\n· 下季度规划')
    expect(
      fullContentFor(
        choice({ module: 'notes', id: 'notes' }),
        source({
          notes: [
            { id: 'n1', title: '会议', body: '周一评审', at: 0 },
            { id: 'n2', title: '', body: '无标题正文', at: 1 },
          ],
        }),
      ),
    ).toBe('会议：周一评审\n无标题：无标题正文')
    // 分类缺省写「未分类」；币种缺省不画符号（两个兜底分支都要走到）
    expect(
      fullContentFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({
          ledger: {
            symbol: '¥',
            entries: [
              { id: 'l1', date: '2026-10-28', cents: 1250, category: '餐饮', note: '团建餐' },
              { id: 'l2', date: '2026-10-29', cents: 3900, category: '', note: '' },
            ],
          },
        }),
      ),
    ).toBe('2026-10-28 餐饮 团建餐 12.50¥\n2026-10-29 未分类  39.00¥')
    expect(
      fullContentFor(
        choice({ module: 'ledger', id: 'ledger' }),
        source({ ledger: { symbol: '', entries: [{ id: 'l3', date: '2026-10-30', cents: 500, category: '饮料', note: '' }] } }),
      ),
    ).toBe('2026-10-30 饮料  5.00')
  })

  it('没有专门读面的卡落回摘录（机器采来的内容不喂）', () => {
    expect(fullContentFor(choice({ module: 'weather' }), source())).toBe('')
  })
})

describe('思考档位与附件（E3）', () => {
  it('四档：off 是默认；未知 id 回落默认文案（与 Rust「未知值不加指令」同口径）', () => {
    expect(THINKING_LEVELS.map((l) => l.id)).toEqual(['off', 'low', 'medium', 'high'])
    expect(thinkingLabel('off')).toBe('默认')
    expect(thinkingLabel('high')).toBe('深')
    // 不抛、也不把英文 id 露给用户 —— 回落到「默认」
    expect(thinkingLabel('turbo')).toBe('默认')
  })

  it('attachFile：空文件与二进制拒收，理由里带文件名', () => {
    const empty = attachFile('空.md', '  \n\t ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toContain('空.md')
    const bin = attachFile('图.png', 'PNG\u0000\u0001')
    expect(bin.ok).toBe(false)
    if (!bin.ok) expect(bin.reason).toContain('不像文本文件')
  })

  it('attachFile：CRLF 归一；超长按码点截到 8000 并记下截断', () => {
    const ok = attachFile('a.txt', '一\r\n二')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.file.content).toBe('一\n二')
    const cut = attachFile('长.txt', '字'.repeat(ATTACH_CHARS_MAX + 5))
    expect(cut.ok).toBe(true)
    if (cut.ok) {
      expect(cut.file.truncated).toBe(true)
      expect(cut.file.chars).toBe(ATTACH_CHARS_MAX)
      expect(Array.from(cut.file.content)).toHaveLength(ATTACH_CHARS_MAX)
    }
  })

  it('attachFile：emoji 按码点算，不会被劈成两个半截', () => {
    const ok = attachFile('e.txt', '😀'.repeat(3))
    expect(ok.ok).toBe(true)
    // 3 个 emoji = 3 个码点（不是 6 个 UTF-16 单元）
    if (ok.ok) expect(ok.file.chars).toBe(3)
  })

  it('addFiles：同名不重复挂；个数与合计预算各自守门', () => {
    const dup = addFiles([], [
      { name: 'a.md', text: 'x' },
      { name: 'a.md', text: 'y' },
    ])
    expect(dup.files).toHaveLength(1)
    expect(dup.rejected[0]).toContain('已经挂上了')

    const many = addFiles([], ['1', '2', '3', '4'].map((n) => ({ name: `${n}.md`, text: 'x' })))
    expect(many.files).toHaveLength(ATTACH_MAX_FILES)
    expect(many.rejected.join('')).toContain('一次最多带')

    // 合计上限：两个顶格文件正好用满，第三个小文件也进不来
    const full = '字'.repeat(ATTACH_CHARS_MAX)
    const over = addFiles([], [
      { name: 'A', text: full },
      { name: 'B', text: full },
      { name: 'C', text: '一点点' },
    ])
    expect(over.files).toHaveLength(2)
    expect(over.rejected.join('')).toContain(String(ATTACH_TOTAL_MAX))
  })

  it('addFiles：坏文件（空 / 二进制）的理由原样透传，不悄悄吞掉', () => {
    const r = addFiles([], [
      { name: 'empty.md', text: '   \n' },
      { name: 'bin.png', text: 'x\u0000y' },
    ])
    expect(r.files).toHaveLength(0)
    expect(r.rejected).toHaveLength(2)
    expect(r.rejected[0]).toContain('是空的')
    expect(r.rejected[1]).toContain('不像文本文件')
  })

  it('filesSummary / attachmentLine：没文件不出摘要；截断要说', () => {
    expect(filesSummary([])).toBeNull()
    const one = attachFile('a.md', 'x'.repeat(1234))
    if (!one.ok) throw new Error('夹具应当被接收')
    expect(filesSummary([one.file])).toBe('1 个文件 · 1.2k 字')
    expect(attachmentLine(one.file)).toBe('a.md · 1.2k 字')
    const cut = attachFile('b.md', 'x'.repeat(ATTACH_CHARS_MAX + 1))
    if (!cut.ok) throw new Error('夹具应当被接收')
    expect(filesSummary([cut.file])).toContain('有截断')
    expect(attachmentLine(cut.file)).toContain('已截断')
  })

  it('charsLabel：千位以下报精确值，以上报量级', () => {
    expect(charsLabel(999)).toBe('999 字')
    expect(charsLabel(1000)).toBe('1.0k 字')
    expect(charsLabel(12400)).toBe('12k 字')
  })
})

describe('控件行权限文案（E2 → PR-F1 扩了资料档）', () => {
  it('没有引用就不出这句话；只有卡片时逐字保持 E2 的旧文案', () => {
    expect(permNote(0, 0)).toBeNull()
    expect(permNote(1, 0)).toBe('本次可读 1 张卡的内容（各 ≤400 字）')
    expect(permNote(3, 0)).toBe('本次可读 3 张卡的内容（各 ≤400 字）')
  })

  it('带了资料就把两档上限都写出来 —— 别让人以为资料也按 400 字喂', () => {
    expect(permNote(0, 2)).toBe('本次可读 2 份资料的内容（卡片各 ≤400 字、资料各 ≤1200 字）')
    expect(permNote(1, 1)).toBe('本次可读 1 张卡 + 1 份资料的内容（卡片各 ≤400 字、资料各 ≤1200 字）')
  })
})

describe('历史', () => {
  it('只认 user/assistant，system 与空内容不进气泡', () => {
    const turns = turnsFromHistory([
      { role: 'system', content: '你是助手', ts: 1 },
      { role: 'user', content: '问', ts: 1 },
      { role: 'assistant', content: '  ', ts: 1 },
      { role: 'assistant', content: '答', ts: 1 },
    ])
    expect(turns.map((t) => t.content)).toEqual(['问', '答'])
    expect(turns.every((t) => t.status === 'done')).toBe(true)
  })

  it('助手那半剥掉动作行（第十二笔）；只剩动作行的回复整条不进气泡；用户那半原样', () => {
    const turns = turnsFromHistory([
      { role: 'user', content: '帮我记一笔\n@@act {"type":"todo.add","text":"用户自己打的"}', ts: 1 },
      { role: 'assistant', content: '记好了。\n@@act {"type":"ledger.add","cents":1234,"category":"餐饮"}', ts: 1 },
      { role: 'assistant', content: '@@act {"type":"addCard","moduleId":"todo"}', ts: 1 },
    ])
    // 剥行只从助手那半（用户真打了 @@act 也照原样）；只剩动作行的整条丢 —— 不许留空气泡
    expect(turns.map((t) => t.content)).toEqual([
      '帮我记一笔\n@@act {"type":"todo.add","text":"用户自己打的"}',
      '记好了。',
    ])
  })

  it('时间：今天/昨天只说时分，同年带月日，跨年带年份', () => {
    const now = new Date(2026, 9, 29, 14, 5, 0).getTime()
    const sec = (d: Date): number => Math.floor(d.getTime() / 1000)
    expect(historyWhen(sec(new Date(2026, 9, 29, 9, 3)), now)).toBe('今天 09:03')
    expect(historyWhen(sec(new Date(2026, 9, 28, 23, 59)), now)).toBe('昨天 23:59')
    expect(historyWhen(sec(new Date(2026, 8, 1, 8, 0)), now)).toBe('09-01 08:00')
    expect(historyWhen(sec(new Date(2025, 8, 1, 8, 0)), now)).toBe('2025-09-01')
  })
})

describe('坞该不该出现', () => {
  const base = {
    desktop: true,
    view: 'workbench' as const,
    floats: 0,
    settingsOpen: false,
    templatesOpen: false,
    paletteOpen: false,
    onboardingOpen: false,
  }

  it('桌面工作台、没有浮窗、没有全屏遮罩时才在', () => {
    expect(canShowDock(base)).toBe(true)
    // E1：chat 视图里坞也要在（全高面板）；edit 仍不挡拖拽
    expect(canShowDock({ ...base, view: 'chat' })).toBe(true)
    expect(canShowDock({ ...base, view: 'edit' })).toBe(false)
  })

  it('网页版 / 布局编辑 / 有浮窗 / 任一全屏遮罩 —— 一律不渲染', () => {
    expect(canShowDock({ ...base, desktop: false })).toBe(false)
    expect(canShowDock({ ...base, view: 'edit' })).toBe(false)
    expect(canShowDock({ ...base, floats: 1 })).toBe(false)
    expect(canShowDock({ ...base, settingsOpen: true })).toBe(false)
    expect(canShowDock({ ...base, templatesOpen: true })).toBe(false)
    expect(canShowDock({ ...base, paletteOpen: true })).toBe(false)
    expect(canShowDock({ ...base, onboardingOpen: true })).toBe(false)
  })
})
