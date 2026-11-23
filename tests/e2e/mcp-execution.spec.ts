/**
 * J1 执行半「对话坞**真消费** MCP 工具」的 E2E。
 *
 * 补的是哪一格：`mcpTools.ts` 的单测证的是「合并 / 分流 / 人话」这三件事的判定，
 * `useMcpExecution` 的单测证的是「三条命令发得对不对、失败折成什么人话」，
 * 设置页那条 spec（`settings-mcp.spec.ts`）证的是「允许 + 列工具」那半边界面。
 * 但「坞里发一条消息时清单真的跟着请求走了、模型点名的 MCP 工具真的走了 `mcp_call`、
 * 结果真的回喂进第 2 轮」这三件事**只有真页面 + 真 invoke 记账能证** ——
 * 本仓没有组件测试设施（无 @vue/test-utils / jsdom），所以归 E2E。
 *
 * 四条核心链路对应四种**各自会独立坏掉**的语义：
 * 1. 合规路径：种一份盘上配置 → 设置页点「允许本会话使用」→ 回坞发消息 →
 *    请求里带着这个 MCP 工具、时间线出现结果行、第 2 轮带着工具结果回灌续跑。
 *    **同轮两次请求的 `tools` 必须逐字相同**（`turnTools` 那个缓存的唯一理由）。
 * 2. 两类失败**文案必须不同**：`mcp_call` 的 RPC 层失败（进程起不来 / 超时）与
 *    工具自己报的 `isError`（跑了但失败）是两件事，用户该修的东西也不一样。
 * 3. 停止：`toolStart` 已显示、`done{reason:'tool'}` 尚未到达时点停止，
 *    已宣布步骤不执行、不落盘、不再续跑。**工具执行阶段本身没有停止按钮**，
 *    那一段的产品缺口在协调板与架构 facts 行单独记账，这里不冒充覆盖。
 * 4. 未确认的服务**一条命令都不发**：`gather` 只取「已确认且 enabled」的服务，
 *    未确认时连 `mcp_list_tools` 都不许出现（Rust 那道 J4 闸门守的就是这一下）。
 *
 * 桩的形状照 Rust：三条命令的入参/出错文案与 `ai::mcp::client` 逐字一致，
 * 数据由 `__STUB_MCP_TOOLS__` / `__STUB_MCP_CALL__` / `__STUB_MCP_LIST_FAIL__` 预置。
 * 确认记录在桩里**只在内存**（与 Rust `McpState.confirmed` 同生命周期），所以「已允许」
 * 这件事必须在同一次页面生命周期内由设置页真点出来，不能靠种盘。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath, gotoWorkbench } from './chrome'

const EXE = chromePath()
const skip = !EXE

let url = 'http://localhost:1430'
beforeAll(() => {
  url = process.env.MODULO_URL ?? url
})
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')

/** 种一张待办卡（= 非首启，别让向导盖住设置页；坞也需要一点版面内容） */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'todo', variant: 'list', x: 0, y: 0, w: 4, h: 3 }],
}

/**
 * provider **必须**开着 `supportsTools`：J1 的清单合并只在「provider 支持工具调用」时发生
 * （关着的 provider 走 `@@act` 文字约定，请求里连 `tools` 键都不出现）。
 */
const AI = JSON.stringify({
  providers: [
    {
      id: 'p1',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      supportsTools: true,
    },
  ],
})

/** 盘上的 MCP 文档（`modulo.mcp.v1`）：一个已启用的服务 + 总开关开着 */
const mcpDoc = (gate: boolean): string =>
  JSON.stringify({
    version: 1,
    gate,
    servers: [
      {
        id: 's1',
        enabled: true,
        name: 'files',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      },
    ],
  })

/** 这个 MCP 工具名：合法（`^[a-zA-Z0-9_-]{1,64}$`）且不与本地十三条撞名 */
const TOOL = 'echo_tool'

/** 桩里那个服务的清单：一条工具，`inputSchema` 是对象（不是对象的话合并不进去） */
const MCP_TOOLS = {
  s1: {
    tools: [
      {
        name: TOOL,
        title: '回声',
        description: '把参数原样回给你',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
    ],
  },
}

/**
 * 本地白名单那十三条（`toolSpecs()`，主干 F4c-1 的表 + 第四十一笔的 `todo_done` 与两个批量）—— 断言"合并只加不减"用。
 * **顺序照 `toolSpecs()` 的原序**：合并的契约是"本地原样在前（保序），MCP 随后"，
 * 排过序的期望值会把这条契约测掉。
 */
const LOCAL_TOOLS = [
  'add_card',
  'todo_add',
  'ledger_add',
  'sticky_append',
  'countdown_set',
  'habit_check',
  'memory_add',
  'knowledge_add',
  'skill_add',
  'context_read',
  'todo_done',
  'todo_done_many',
  'habit_check_many',
]

let browser: Browser
beforeAll(async () => {
  if (skip) return
  browser = await puppeteer.launch({
    executablePath: EXE!,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
  })
})
afterAll(async () => {
  await browser?.close()
})

interface Seed {
  /** 总开关（默认开）；关掉那一格由设置页那条 spec 管，这里只为"跳过 gather"留个口子 */
  gate?: boolean
  /** 在设置页真点一下「允许本会话使用」（默认 true） */
  confirm?: boolean
  /** `__STUB_MCP_CALL__`：工具名 → 返回 / `'reject'` */
  call?: Record<string, unknown>
  /** `__STUB_AI_TOOL_LOOP__`：第 1 轮只发 toolStart、`done{tool}` 收尾 */
  loop?: { id: string; name: string; args?: Record<string, unknown> }[]
  /** 发完 toolStart 后挂住，让用例在工具执行前点停止 */
  toolLoopHang?: boolean
  /** 第 2 轮（收尾）的回复正文 */
  reply?: string
}

/**
 * 开一页：注桩（桌面形态）+ 种版面 / provider / MCP 文档 → 设置页点允许 → 回工作台。
 *
 * 为什么允许这一步只能在这一层做：确认态**只在前端内存**（Rust 没有查询命令，重启两端同清），
 * 所以「已允许」不可能靠种盘得到，必须由 `mcp_confirm` 成功来驱动 —— 桩把那条记在
 * `mcpConfirmed`（同样只在内存）。
 */
async function open(seed: Seed = {}, errs: string[] = []): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (
      src: string,
      docJson: string,
      aiJson: string,
      mcpJson: string,
      toolsJson: string,
      callJson: string | null,
      loopJson: string | null,
      toolLoopHang: boolean,
      reply: string,
    ) => {
      new Function(src)()
      // 桌面适配器读的是桩的「盘」（`read_doc` 落在 `__stubdoc.` 前缀下）
      localStorage.setItem('modulo.layout.v1', docJson)
      localStorage.setItem('modulo.__stubdoc.ai-settings.v1', aiJson)
      localStorage.setItem('modulo.__stubdoc.modulo.mcp.v1', mcpJson)
      // 桩的开关必须在桩跑完之后摆（它在 IIFE 尾部把默认值写回 window）
      const w = window as unknown as Record<string, unknown>
      w.__STUB_MCP_TOOLS__ = JSON.parse(toolsJson)
      if (callJson) w.__STUB_MCP_CALL__ = JSON.parse(callJson)
      if (loopJson) w.__STUB_AI_TOOL_LOOP__ = JSON.parse(loopJson)
      w.__STUB_AI_TOOL_LOOP_HANG__ = toolLoopHang
      w.__STUB_AI_REPLY__ = reply
    },
    STUB_SOURCE,
    JSON.stringify(DOC),
    AI,
    mcpDoc(seed.gate !== false),
    JSON.stringify(MCP_TOOLS),
    seed.call ? JSON.stringify(seed.call) : null,
    seed.loop ? JSON.stringify(seed.loop) : null,
    seed.toolLoopHang === true,
    seed.reply ?? '用完了。',
  )
  await gotoWorkbench(page, url)
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })

  if (seed.confirm !== false) {
    await page.click('button.wide[title="外观设置"]')
    await page.waitForSelector('.panel .nav-item', { timeout: 10000 })
    await page.click('.panel .nav-item[data-group="lab"]')
    await page.waitForSelector('[data-mcp="s1"]', { timeout: 10000 })
    // 用 el.click()：设置面板内部自己滚动，鼠标坐标点容易被滚出视口的部分接走
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-mcp="s1"] [data-mcp-confirm]')
      if (!el) throw new Error('找不到「允许本会话使用」')
      el.click()
    })
    await page.waitForFunction(
      () =>
        document.querySelector('[data-mcp-confirm-state]')?.getAttribute('data-mcp-confirm-state') === 'on',
      { timeout: 10000 },
    )
    // Esc 关面板：确认态在前端内存里，关面板不会把它清掉（Rust 侧也是本会话有效）
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.panel .nav-item'), { timeout: 10000 })
  }

  await page.waitForSelector('[data-chat-bar], [data-chat-panel]', { timeout: 15000 })
  return page
}

const exists = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((s: string) => !!document.querySelector(s), sel)

const text = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)

const calls = (page: Page): Promise<{ cmd: string; args: Record<string, unknown> }[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __STUB_CALLS__?: { cmd: string; args: Record<string, unknown> }[] })
        .__STUB_CALLS__ ?? [],
  )

/** 展开坞并等输入框真的拿到焦点（要发消息就必须走这一下） */
async function expand(page: Page): Promise<void> {
  if (!(await exists(page, '[data-chat-panel]'))) {
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-chat-bar]')
      if (!el) throw new Error('找不到收起状态的坞')
      el.click()
    })
  }
  await page.waitForSelector('[data-chat-input]', { timeout: 10000 })
  await page.waitForFunction(
    () => document.activeElement?.hasAttribute('data-chat-input') === true,
    { timeout: 10000 },
  )
}

const ask = async (page: Page, q: string): Promise<void> => {
  await page.type('[data-chat-input]', q)
  await page.keyboard.press('Enter')
}

/** 某一次 `ai_chat` 下发的工具名（顺序保留：清单必须与 `toolSpecs` 一样是"本地在前"） */
const toolNamesOf = (c: { args: Record<string, unknown> }): string[] =>
  Array.isArray(c.args.tools) ? (c.args.tools as { name?: string }[]).map((t) => String(t?.name ?? '')) : []

const chatCalls = (page: Page) => calls(page).then((all) => all.filter((c) => c.cmd === 'ai_chat'))

describe.skipIf(skip)('对话坞消费 MCP 工具（J1 执行半）', () => {
  it('合规路径：清单跟着请求走 → 模型点名 → 真发 mcp_call → 结果回喂续第 2 轮（同轮 tools 逐字相同）', async () => {
    const errs: string[] = []
    const page = await open(
      {
        // 第 1 轮：只发 toolStart（已提供的工具 Rust 不代跑），`done{tool}` 收尾
        loop: [{ id: 'call-1', name: TOOL, args: { text: '你好' } }],
        // 这一条参数的落点：断言 `mcp_call` 的入参真的带着模型给的 args
        call: { [TOOL]: { text: '回声：你好' } },
        reply: '用完了。',
      },
      errs,
    )
    await expand(page)
    await ask(page, '用一下回声工具')

    // 时间线：那一行**结了**（永远转下去是骗人）。成功态由 `toolEnd{ok:true}` 驱动
    await page.waitForSelector('[data-tool-steps]', { timeout: 15000 })
    await page.waitForFunction(
      () => document.querySelector('[data-tool-step]')?.getAttribute('data-tool-step') === 'ok',
      { timeout: 15000 },
    )
    // 结果行画的是 `mcpResultLine` 那句人话（不是"成功"两个字了事）
    expect(await text(page, '[data-tool-step] .detail')).toBe(`${TOOL}：回声：你好`)

    // 真的走了 `mcp_call`：服务 id 是 s1、工具名是它、args 是模型给的那个对象
    const seen = await calls(page)
    const called = seen.filter((c) => c.cmd === 'mcp_call')
    expect(called, '一次调用 = 一条 mcp_call').toHaveLength(1)
    expect(called[0].args).toMatchObject({ serverId: 's1', tool: TOOL, args: { text: '你好' } })

    // 续跑：第 2 次 ai_chat，round 是 2，且工具结果以 user 消息回灌
    await page.waitForFunction(
      () => Number((window as unknown as { __STUB_AI_CALL_N__?: number }).__STUB_AI_CALL_N__ ?? 0) >= 2,
      { timeout: 15000 },
    )
    const chats = await chatCalls(page)
    expect(chats, '两轮 = 两次模型调用').toHaveLength(2)

    // ★ 清单：本地十三条**原样在前**（保序）+ 这个 MCP 工具随后（只加不减、不重排）
    const round1 = toolNamesOf(chats[0])
    expect(round1).toEqual([...LOCAL_TOOLS, TOOL])

    // ★ 同一轮内第 1 轮与第 2 轮下发的 `tools` **逐字相同**。
    // 每次 `streamTurn` 现算一遍的实现会在这里红 —— 续跑轮少一个工具，模型就会以为它丢了。
    expect(JSON.stringify(chats[1].args.tools), '同轮两次请求的工具清单必须逐字相同').toBe(
      JSON.stringify(chats[0].args.tools),
    )
    expect(chats[1].args.round, '续跑用的是第 2 轮').toBe(2)

    // 清单只算一次：第 2 轮复用的是本轮缓存，没有再拉一遍清单（拉一遍就要再起一个子进程）
    expect(seen.filter((c) => c.cmd === 'mcp_list_tools'), '一轮只拉一次清单').toHaveLength(1)

    // 回灌：第 2 轮的消息里多了一条 user（那条带着标记的工具结果）
    const roles = await page.evaluate(
      () => (window as unknown as { __STUB_AI_LAST_ROLES__?: string[] }).__STUB_AI_LAST_ROLES__ ?? [],
    )
    expect(roles.filter((r) => r === 'user')).toHaveLength(2)
    expect(await exists(page, '[data-chat-tool-note]'), '工具结果渲染成小条（不是用户气泡）').toBe(true)

    // 第 2 轮收尾：等的是**最后那条**助手气泡（第 1 轮那条正文是空的 —— 它只有工具行），
    // 所以按 `querySelector` 取第一条会一直看着第 1 轮那个旧的 done。
    await page.waitForFunction(
      () => {
        const all = [...document.querySelectorAll('[data-role="assistant"]')]
        return all.length >= 2 && all[all.length - 1]?.getAttribute('data-status') === 'done'
      },
      { timeout: 15000 },
    )
    const bubbles = await page.$$eval('[data-role="assistant"]', (els) =>
      els.map((e) => e.textContent ?? ''),
    )
    expect(bubbles.at(-1)).toContain('用完了。')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('连不上（RPC 层失败）：失败行说的是「调用失败」，与工具自己报的失败不是同一句', async () => {
    const errs: string[] = []
    const page = await open(
      {
        loop: [{ id: 'call-1', name: TOOL, args: {} }],
        // 字符串 'reject' = RPC 层失败（子进程起不来 / 超时）
        call: { [TOOL]: 'reject' },
      },
      errs,
    )
    await expand(page)
    await ask(page, '用一下回声工具')

    await page.waitForFunction(
      () => document.querySelector('[data-tool-step]')?.getAttribute('data-tool-step') === 'fail',
      { timeout: 15000 },
    )
    const detail = await text(page, '[data-tool-step] .detail')
    // 桩照 Rust `humanize` 那句抄：`调用「x」失败：…`。用户据此知道该去查自己的 server
    expect(detail).toContain(`调用「${TOOL}」失败`)
    expect(detail).toContain('stub 按配置拒绝')
    // ★ 与「工具跑了但失败」的文案形状（`名：失败（原因）`）分开 —— 混成一句就分不清该修哪头
    expect(detail, 'RPC 失败不该套用工具失败那句').not.toContain('失败（')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('工具跑了但失败（isError）：失败行是「名：失败（原因）」，与连不上那句不同', async () => {
    const errs: string[] = []
    const page = await open(
      {
        loop: [{ id: 'call-1', name: TOOL, args: {} }],
        call: { [TOOL]: { text: 'boom', isError: true } },
      },
      errs,
    )
    await expand(page)
    await ask(page, '用一下回声工具')

    await page.waitForFunction(
      () => document.querySelector('[data-tool-step]')?.getAttribute('data-tool-step') === 'fail',
      { timeout: 15000 },
    )
    // `mcpResultLine` 的失败形状：工具名 + 「失败（原因）」
    expect(await text(page, '[data-tool-step] .detail')).toBe(`${TOOL}：失败（boom）`)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('工具执行前按停止：已宣布的步骤不执行、不落盘、不再续跑', async () => {
    const errs: string[] = []
    const page = await open(
      {
        loop: [
          { id: 'call-1', name: TOOL, args: { text: '停止后不该调' } },
          { id: 'call-2', name: 'todo_add', args: { text: '停止后不该写' } },
        ],
        toolLoopHang: true,
      },
      errs,
    )
    await expand(page)
    await ask(page, '先调回声工具，再加一条待办')

    await page.waitForSelector('[data-tool-step="running"]', { timeout: 15000 })
    await page.waitForSelector('[data-chat-stop]', { timeout: 10000 })
    await page.click('[data-chat-stop]')
    await page.waitForSelector('[data-role="assistant"][data-status="error"]', { timeout: 15000 })

    const steps = await page.$$eval('[data-tool-step]', (els) =>
      els.map((e) => e.getAttribute('data-tool-step')),
    )
    expect(steps).toEqual(['fail', 'fail'])

    const seen = await calls(page)
    expect(seen.filter((c) => c.cmd === 'mcp_call'), '停止后 MCP 工具不许再执行').toEqual([])
    expect(seen.filter((c) => c.cmd === 'ai_chat_cancel')).toHaveLength(1)
    expect(seen.filter((c) => c.cmd === 'ai_chat'), '停止后不再回灌续跑').toHaveLength(1)
    expect(
      await page.evaluate(() =>
        (localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '').includes('停止后不该写'),
      ),
      '停止后的本地工具不许落盘',
    ).toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('未确认的服务不进行清单：请求里没有它的工具，mcp_list_tools 一次都没被调用', async () => {
    const errs: string[] = []
    // 盘上有服务、总开关也开着，但**没点允许** —— `gather` 必须一条都不拉
    const page = await open({ confirm: false }, errs)
    await expand(page)
    await ask(page, '你好')

    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })

    const seen = await calls(page)
    expect(
      seen.filter((c) => c.cmd === 'mcp_list_tools'),
      '未确认就去列工具，Rust 那道 J4 闸门也会拒 —— 前端不该先起一个子进程',
    ).toEqual([])

    const chats = seen.filter((c) => c.cmd === 'ai_chat')
    expect(chats).toHaveLength(1)
    const names = toolNamesOf(chats[0])
    expect(names, '清单里只有本地十三条').toEqual(LOCAL_TOOLS)
    expect(names).not.toContain(TOOL)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('总开关关着：即使已允许，也不 gather、不列工具（清单退回本地十三条）', async () => {
    const errs: string[] = []
    // 注意：这条**不能**在设置页点允许（总开关关着时那个按钮是死的），所以用 gate:false
    const page = await open({ gate: false, confirm: false }, errs)
    await expand(page)
    await ask(page, '你好')

    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    const seen = await calls(page)
    expect(seen.filter((c) => c.cmd === 'mcp_list_tools')).toEqual([])
    const chats = seen.filter((c) => c.cmd === 'ai_chat')
    expect(toolNamesOf(chats[0])).toEqual(LOCAL_TOOLS)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('某个服务的清单没拉下来：**照常说给用户**（notice），别的照旧、请求照发', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    // 只让 s1 的 list_tools 失败。要在发消息之前摆 —— 发完就晚了（一轮只 gather 一次）
    await page.evaluate(() => {
      ;(window as unknown as { __STUB_MCP_LIST_FAIL__: string | null }).__STUB_MCP_LIST_FAIL__ = 's1'
    })
    await expand(page)
    await ask(page, '你好')

    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    // 「没拿全」是用户该知道的事：他只看到清单少了东西、却不知道为什么，是最糟的一档
    const note = await text(page, '[data-chat-notice]')
    expect(note, '服务的失败要折成一句人话').toContain('「files」的工具没有列出来')
    expect(note).toContain('列工具失败：stub 按配置拒绝')

    // 一个服务挂了不拖垮整批：请求照发，清单就是本地十三条（这个服务的工具一条都没有）
    const chats = await chatCalls(page)
    expect(chats).toHaveLength(1)
    expect(toolNamesOf(chats[0])).toEqual(LOCAL_TOOLS)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
