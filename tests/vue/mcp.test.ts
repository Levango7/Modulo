/**
 * `mcp.ts` 判定层 + `useMcp.ts` 胶水层（PR-F4a）。
 *
 * 判据全部是「不开浏览器也能断言」的那种：字段闸门、参数切分、盘上数据的容错、
 * 增删改的纯变换。真正连 server 的那半在 Rust（F4c），这里**不测**、也不假装测。
 *
 * 两条夹具纪律（与 `useCron.test.ts` 同源）：
 * - 种子必须在 `createMcp` **之前**写进 storage（构造时就读档，事后写它看不见）；
 * - 判定层与胶水层分开断言：前者不碰 storage，后者只钉「落盘 / 读档」这一件事。
 */
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../src/vue/store'
import {
  addServer,
  formatCommand,
  joinArgs,
  MCP_DOC_KEY,
  MCP_MAX,
  nextId,
  parseServers,
  removeServer,
  serializeServers,
  splitArgs,
  toggleServer,
  updateServer,
  validateDraft,
  type McpServer,
} from '../../src/vue/mcp'
import { createMcp } from '../../src/vue/useMcp'

const draft = (over: Partial<{ name: string; command: string; args: string }> = {}) => ({
  name: '文件',
  command: 'npx',
  args: '-y @modelcontextprotocol/server-filesystem',
  ...over,
})

const server = (over: Partial<McpServer> = {}): McpServer => ({
  id: 's1',
  name: '文件',
  command: 'npx',
  args: ['-y', 'server-filesystem'],
  enabled: true,
  ...over,
})

describe('splitArgs：不经过 shell 的 argv 切分', () => {
  it('空串与纯空白切出空数组', () => {
    expect(splitArgs('')).toEqual({ ok: true, args: [] })
    expect(splitArgs('   \t ')).toEqual({ ok: true, args: [] })
  })

  it('连续空白不会切出空参数', () => {
    expect(splitArgs('  -y   x  ')).toEqual({ ok: true, args: ['-y', 'x'] })
  })

  it('双引号包住带空格的参数', () => {
    expect(splitArgs('--root "C:\\My Docs" --safe')).toEqual({
      ok: true,
      args: ['--root', 'C:\\My Docs', '--safe'],
    })
  })

  it('空引号是一个合法的空参数（不是空数组）', () => {
    expect(splitArgs('""')).toEqual({ ok: true, args: [''] })
  })

  it('引号没配对时如实报错，不猜用户想切到哪里', () => {
    const r = splitArgs('--root "C:\\My Docs')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('双引号')
  })
})

describe('joinArgs：splitArgs 的真逆函数（B1 的根因）', () => {
  it('带空格 / 空参数都能往返：splitArgs(joinArgs(a)) 与原 argv 逐项相等', () => {
    const cases: string[][] = [
      ['--root', 'C:\\My Docs'],
      ['-y', '@modelcontextprotocol/server-filesystem'],
      ['', '--flag'],
      ['a\tb', 'c'],
    ]
    for (const argv of cases) {
      const back = splitArgs(joinArgs(argv))
      expect(back.ok, JSON.stringify(argv)).toBe(true)
      if (back.ok) expect(back.args).toEqual(argv)
    }
  })

  it('【B1 回归】「编辑 → 不改任何字段 → 保存」后 argv 一字不变', () => {
    // 这正是 QA 复现出来的路径：openEdit 的初值 = joinArgs(args)，保存时再过一遍闸门
    const original = ['--root', 'C:\\My Docs', '--safe']
    const line = joinArgs(original)
    expect(line).toBe('--root "C:\\My Docs" --safe')
    const checked = validateDraft({ name: '文件', command: 'npx', args: line })
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.value.args).toEqual(original)
  })
})

describe('validateDraft：同一道字段闸门', () => {
  it('名字去空白后为空 → 拒收并说清怎么办', () => {
    const r = validateDraft(draft({ name: '   ' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('起个名字')
  })

  it('名字上限按码点：40 过、41 拒', () => {
    expect(validateDraft(draft({ name: '字'.repeat(40) })).ok).toBe(true)
    const r = validateDraft(draft({ name: '字'.repeat(41) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('40')
  })

  it('命令为空 / 含换行都拒收（换行会让一条命令变成两条）', () => {
    expect(validateDraft(draft({ command: '  ' })).ok).toBe(false)
    const r = validateDraft(draft({ command: 'npx\r\nwhoami' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('换行')
  })

  it('命令上限 260 码点', () => {
    expect(validateDraft(draft({ command: 'c'.repeat(260) })).ok).toBe(true)
    expect(validateDraft(draft({ command: 'c'.repeat(261) })).ok).toBe(false)
  })

  it('参数个数上限 12 个：12 过、13 拒', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `a${i}`).join(' ')
    expect(validateDraft(draft({ args: twelve })).ok).toBe(true)
    const thirteen = Array.from({ length: 13 }, (_, i) => `a${i}`).join(' ')
    const r = validateDraft(draft({ args: thirteen }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('12')
  })

  it('单个参数上限 260 码点，报错带序号', () => {
    const r = validateDraft(draft({ args: `ok ${'x'.repeat(261)}` }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('第 2 个参数')
  })

  it('通过时给出已 trim 的三格（argv 是数组，不是那行文本）', () => {
    const r = validateDraft(draft({ name: '  文件  ', command: '  npx  ' }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name).toBe('文件')
      expect(r.value.command).toBe('npx')
      expect(r.value.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem'])
    }
  })

  it('全角空格不会被当分隔符 —— 明说换半角，不静默吞成一个畸形参数', () => {
    const r = validateDraft(draft({ args: '-y\u3000server-filesystem' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('全角空格')
  })

  it('名字也拒收换行（文件头写的是"换行与 NUL 一律拒收"，不能只覆盖命令和参数）', () => {
    const r = validateDraft(draft({ name: 'a\nb' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('换行')
  })

  it('命令适用同一套字符判据：引号与全角空格都拒收（与参数对称，别一格拦一格放）', () => {
    const quote = validateDraft(draft({ command: 'np"x' }))
    expect(quote.ok).toBe(false)
    if (!quote.ok) expect(quote.error).toContain('双引号')
    const wide = validateDraft(draft({ command: 'np\u3000x' }))
    expect(wide.ok).toBe(false)
    if (!wide.ok) expect(wide.error).toContain('全角空格')
  })
})

describe('addServer / nextId：上限与 id 复用', () => {
  it('nextId 取最小空位，删掉中间一条再加会补回去', () => {
    const list = [server({ id: 's1' }), server({ id: 's2' }), server({ id: 's3' })]
    expect(nextId(list)).toBe('s4')
    expect(nextId(removeServer(list, 's2'))).toBe('s2')
  })

  it('新增默认启用，id 由 nextId 分配', () => {
    const r = addServer([], draft())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.list).toHaveLength(1)
      expect(r.list[0]!.id).toBe('s1')
      expect(r.list[0]!.enabled).toBe(true)
    }
  })

  it('满 8 个后拒收，且错误文案说清是上限', () => {
    const full = Array.from({ length: MCP_MAX }, (_, i) => server({ id: `s${i + 1}` }))
    const r = addServer(full, draft())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(MCP_MAX))
  })

  it('拒收时不改入参（纯函数，不做就地修改）', () => {
    const list = [server()]
    const before = JSON.stringify(list)
    addServer(list, draft({ name: '' }))
    expect(JSON.stringify(list)).toBe(before)
  })
})

describe('updateServer / removeServer / toggleServer：纯变换', () => {
  it('update 改三格但不动 id 与启用状态', () => {
    const list = [server({ enabled: false })]
    const r = updateServer(list, 's1', draft({ name: '改过的', args: '--a --b' }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.list[0]).toMatchObject({ id: 's1', name: '改过的', args: ['--a', '--b'], enabled: false })
    }
  })

  it('update 校验不过时返回错误且不改列表', () => {
    const list = [server()]
    const r = updateServer(list, 's1', draft({ command: '' }))
    expect(r.ok).toBe(false)
    expect(list[0]!.command).toBe('npx')
  })

  it('update 打到不存在的 id 上要如实报错，不能"保存成功但什么都没存"', () => {
    const r = updateServer([server()], 's9', draft())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不在了')
  })

  it('remove / toggle 遇到未知 id 原样返回（幂等）', () => {
    const list = [server()]
    expect(removeServer(list, 'nope')).toHaveLength(1)
    expect(toggleServer(list, 'nope', false)[0]!.enabled).toBe(true)
  })

  it('toggle 设成同一个值时不产生变化', () => {
    const list = [server({ enabled: true })]
    expect(toggleServer(list, 's1', true)[0]!.enabled).toBe(true)
    expect(toggleServer(list, 's1', false)[0]!.enabled).toBe(false)
  })
})

describe('parseServers：盘上的数据不可信', () => {
  it('null / 空串 / 坏 JSON / 非数组对象都回空列表，不抛', () => {
    expect(parseServers(null)).toEqual([])
    expect(parseServers('')).toEqual([])
    expect(parseServers('{oops')).toEqual([])
    expect(parseServers('{"version":1}')).toEqual([])
  })

  it('容忍裸数组与带 version 的对象两种历史形态', () => {
    const one = [server()]
    expect(parseServers(JSON.stringify(one))).toHaveLength(1)
    expect(parseServers(serializeServers(one))).toHaveLength(1)
  })

  it('坏条目逐条丢弃，好的留下（一条坏的不能带走其他服务）', () => {
    const raw = JSON.stringify({
      version: 1,
      servers: [
        server({ id: 's1' }),
        'not-an-object',
        { id: 's3', name: '缺命令' },
        { id: 's4', name: '参数不是数组', command: 'npx', args: 'x' },
        { id: 's5', name: '参数里有非字符串', command: 'npx', args: ['ok', 1] },
        server({ id: 's6', name: '好的' }),
      ],
    })
    const got = parseServers(raw)
    expect(got.map((s) => s.name)).toEqual(['文件', '好的'])
  })

  it('盘上的名字也要过同一道闸门（41 码点整条丢弃，不截断）', () => {
    const raw = JSON.stringify([server({ name: '字'.repeat(41) })])
    expect(parseServers(raw)).toEqual([])
  })

  it('盘上的参数带双引号 → 整条丢弃（没有转义语法，表示不了就别假装能表示）', () => {
    const raw = JSON.stringify([server({ args: ['--q', 'say "hi"'] })])
    expect(parseServers(raw)).toEqual([])
  })

  it('enabled 缺失按 false（不替用户把没确认过的东西打开）；true 才为 true', () => {
    const raw = JSON.stringify([
      { id: 's1', name: 'a', command: 'npx', args: [] },
      { id: 's2', name: 'b', command: 'npx', args: [], enabled: true },
    ])
    expect(parseServers(raw).map((s) => s.enabled)).toEqual([false, true])
  })

  it('id 形状不对或重复时重新分配，不照抄', () => {
    const raw = JSON.stringify([
      server({ id: 'x9' }),
      server({ id: 's1', name: '重了' }),
      server({ id: 's1', name: '又重了' }),
    ])
    const ids = parseServers(raw).map((s) => s.id)
    expect(ids).toEqual(['s1', 's2', 's3'])
  })

  it('超过 8 条只留前 8 条', () => {
    const raw = JSON.stringify(
      Array.from({ length: 12 }, (_, i) => server({ id: `s${i + 1}`, name: `n${i + 1}` })),
    )
    expect(parseServers(raw)).toHaveLength(MCP_MAX)
  })

  it('serialize → parse 往返一致（含带空格的参数）', () => {
    const list = [server({ args: ['--root', 'C:\\My Docs'] }), server({ id: 's2', enabled: false })]
    expect(parseServers(serializeServers(list))).toEqual(list)
  })
})

describe('formatCommand：只给界面看', () => {
  it('带空格的参数重新包引号，粘回去还是同一个 argv', () => {
    const line = formatCommand({ command: 'npx', args: ['--root', 'C:\\My Docs'] })
    expect(line).toBe('npx --root "C:\\My Docs"')
    const back = splitArgs(line)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.args).toEqual(['npx', '--root', 'C:\\My Docs'])
  })
})

describe('useMcp：落盘与读档', () => {
  it('构造时读档（种子必须在 createMcp 之前写）', () => {
    const storage = memoryStorage()
    storage.set(MCP_DOC_KEY, serializeServers([server({ name: '种下的' })]))
    const mcp = createMcp(storage)
    expect(mcp.servers.value.map((s) => s.name)).toEqual(['种下的'])
  })

  it('add 成功即落盘，读回来是同一个列表', () => {
    const storage = memoryStorage()
    const mcp = createMcp(storage)
    expect(mcp.add(draft())).toBeNull()
    const raw = storage.get(MCP_DOC_KEY)
    expect(raw).toBeTruthy()
    expect(parseServers(raw).map((s) => s.name)).toEqual(['文件'])
  })

  it('add 失败返回要念给用户的那句话，且不落盘', () => {
    const storage = memoryStorage()
    const mcp = createMcp(storage)
    const err = mcp.add(draft({ name: '' }))
    expect(err).toContain('起个名字')
    expect(storage.get(MCP_DOC_KEY)).toBeNull()
  })

  it('update / toggle / remove 都会落盘', () => {
    const storage = memoryStorage()
    const mcp = createMcp(storage)
    mcp.add(draft())
    expect(mcp.update('s1', draft({ name: '改名了' }))).toBeNull()
    expect(parseServers(storage.get(MCP_DOC_KEY))[0]!.name).toBe('改名了')
    mcp.toggle('s1', false)
    expect(parseServers(storage.get(MCP_DOC_KEY))[0]!.enabled).toBe(false)
    mcp.remove('s1')
    expect(parseServers(storage.get(MCP_DOC_KEY))).toEqual([])
  })
})
