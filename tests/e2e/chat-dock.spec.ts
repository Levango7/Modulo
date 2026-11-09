/**
 * F-12 二期「底部 AI 对话坞」的 E2E（设计稿 `docs/design/F-12-AI-WIRING.md` §11）。
 *
 * 这一层测的是**只有组件能证**的：坞按条件出场/消失、Ctrl+J 与 Esc 的开合、
 * 流式增量真的拼成一句话、`@` 候选与 chip、停止真的发了 `ai_chat_cancel`、
 * 历史读/删走的是真命令。纯判定（归并/触发词/预算/时间格式）在
 * `tests/vue/aiChat.test.ts`，这里不重复。
 *
 * 桩的形状照 Rust：`ai_chat` 经 Channel 按 index 推 `{delta, done, error}` 帧，
 * 历史落在 `modulo.__stubai.hist`（与配置文档、密钥都分开存）。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, ElementHandle, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE

let url = 'http://localhost:1430'
beforeAll(() => {
  url = process.env.MODULO_URL ?? url
})
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')

/** 版面：一张待办 + 一张便签 —— 非空（不进首启向导），且两张都带可引用的字 */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [
    { id: 'todo', variant: 'list', x: 0, y: 0, w: 4, h: 3 },
    { id: 'sticky', variant: 'note', x: 4, y: 0, w: 4, h: 3 },
  ],
}
const CARD = {
  todos: [{ id: 't1', text: '交周报', done: false }],
  sticky: '周五前把周报发给老板',
}
/**
 * `twins: true` 时额外摆**两张倒数日 + 两张记账 + 两张习惯卡**（各含一个第二实例）：引用块要报的是
 * 被选中的那一张自己的内容。两个实例的字段都取得出，测试才分得开"读对了那张"与"回落成第一张"。
 */
const TWIN_ITEMS = [
  { id: 'countdown', module: 'countdown', variant: 'days', x: 0, y: 3, w: 4, h: 2 },
  { id: 'countdown:2', module: 'countdown', variant: 'days', x: 4, y: 3, w: 4, h: 2 },
  { id: 'ledger', module: 'ledger', variant: 'panel', x: 0, y: 5, w: 4, h: 4 },
  { id: 'ledger:2', module: 'ledger', variant: 'panel', x: 4, y: 5, w: 4, h: 4 },
  { id: 'habit', module: 'habit', variant: 'week', x: 0, y: 9, w: 4, h: 3 },
  { id: 'habit:2', module: 'habit', variant: 'week', x: 4, y: 9, w: 4, h: 3 },
]
const TWIN_CARD = {
  countdown: { label: '发版', date: '2026-11-01' },
  ledger: { symbol: '¥', entries: [{ id: 'l1', date: '2026-10-28', cents: 1250, category: '餐饮', note: '团建餐' }] },
  habit: { name: '跑步', days: ['2026-10-27', '2026-10-28'] },
  byInstance: {
    'countdown:2': { countdown: { label: '体检', date: '2026-12-20' } },
    'ledger:2': { ledger: [{ id: 'l2', date: '2026-10-29', cents: 3900, category: '医疗', note: '体检挂号' }] },
    'habit:2': { habit: { name: '冥想', days: ['2026-11-01', '2026-11-02', '2026-11-03'] } },
  },
}
const AI = {
  providers: [{ id: 'p1', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini' }],
}

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
  ai?: boolean
  history?: unknown[]
  hang?: boolean
  reply?: string
  /** 回复序列（v1.2）：按 ai_chat 调用次数依次取 —— agent 循环要两轮回复（先提议、收到工具结果后收尾） */
  replies?: string[]
  /** 版面上再加两张倒数日 + 两张记账（见 `TWIN_ITEMS`） */
  twins?: boolean
  /** `false` = 网页形态：**不装 stub**（不摆 Tauri 内核 ⇒ isDesktop=false），E1 的
   *  web 占位用例靠它拿到真 web 环境 */
  desktop?: boolean
  /** 宽屏（1600）：左栏常驻的档位（≥1480）。PR-F1 的「资料」节只在栏里，窄窗看不见它 */
  wide?: boolean
  /** 预置定时任务（PR-F2）：原样写进 `modulo.__stubdoc.modulo.cron.v1`（tasks + runs） */
  cron?: { tasks: unknown[]; runs?: unknown[] }
  /** 预置工作流（PR-F3）：原样写进 `modulo.__stubdoc.modulo.workflow.v1`（flows + runs） */
  workflow?: { flows: unknown[]; runs?: unknown[] }
}

/** 开一张桌面形态的页面。`ai: false` = 没配任何模型服务（空态那条路） */
async function open(seed: Seed = {}, errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: seed.wide ? 1600 : 1440, height: 900, deviceScaleFactor: 1 })
  const doc = seed.twins ? { ...DOC, items: [...DOC.items, ...TWIN_ITEMS] } : DOC
  const card = seed.twins ? { ...CARD, ...TWIN_CARD } : CARD
  const desktop = seed.desktop !== false
  await page.evaluateOnNewDocument(
    (src: string, docJson: string, cardJson: string, aiJson: string | null, histJson: string | null, hang: boolean, reply: string | null, cronJson: string | null, installStub: boolean, workflowJson: string | null, repliesJson: string | null) => {
      if (installStub) new Function(src)()
      localStorage.setItem('modulo.layout.v1', docJson)
      localStorage.setItem('modulo.__stubdoc.modulo.carddata.v1', cardJson)
      if (aiJson) localStorage.setItem('modulo.__stubdoc.ai-settings.v1', aiJson)
      // 历史与配置分开存：测试要能断言"历史真的落盘了"，不能与配置混在一格里
      if (histJson) localStorage.setItem('modulo.__stubai.hist', histJson)
      if (hang) (window as unknown as { __STUB_AI_HANG__: boolean }).__STUB_AI_HANG__ = true
      if (reply) (window as unknown as { __STUB_AI_REPLY__: string }).__STUB_AI_REPLY__ = reply
      // 定时任务（PR-F2）：与卡片数据同一条 stub 存储通道（modulo.__stubdoc.<key>）。
      // **守卫必须加**：evaluateOnNewDocument 每次导航都跑，不设防的话 reload 会在
      // 应用落盘之前用种子覆盖刚写下的状态（F-01 阶段 2 那笔踩过同一条）
      if (cronJson && localStorage.getItem('modulo.__stubdoc.modulo.cron.v1') === null) {
        localStorage.setItem('modulo.__stubdoc.modulo.cron.v1', cronJson)
      }
      // 工作流（PR-F3）：同一条通道、同一条守卫（同上：reload 会重跑这段）
      if (workflowJson && localStorage.getItem('modulo.__stubdoc.modulo.workflow.v1') === null) {
        localStorage.setItem('modulo.__stubdoc.modulo.workflow.v1', workflowJson)
      }
      // 回复序列（v1.2 agent 循环）：每次导航重置 —— 游标跟着页面走，不该跨导航累积
      if (repliesJson) (window as unknown as { __STUB_AI_REPLIES__: string[] }).__STUB_AI_REPLIES__ = JSON.parse(repliesJson)
    },
    STUB_SOURCE,
    JSON.stringify(doc),
    JSON.stringify(card),
    seed.ai === false ? null : JSON.stringify(AI),
    seed.history ? JSON.stringify(seed.history) : null,
    seed.hang === true,
    seed.reply ?? null,
    seed.cron ? JSON.stringify({ schemaVersion: 1, tasks: seed.cron.tasks, runs: seed.cron.runs ?? [] }) : null,
    desktop,
    seed.workflow ? JSON.stringify({ schemaVersion: 1, flows: seed.workflow.flows, runs: seed.workflow.runs ?? [] }) : null,
    seed.replies ? JSON.stringify(seed.replies) : null,
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  // web 形态没有坞（AI 后端不在）⇒ 等左栏出现即可
  await page.waitForSelector(desktop ? '[data-chat-bar], [data-chat-panel]' : '[data-mode="chat"]', { timeout: 15000 })
  return page
}

const click = (page: Page, sel: string): Promise<void> =>
  page.evaluate((s: string) => {
    const el = document.querySelector(s) as HTMLElement | null
    if (!el) throw new Error('找不到 ' + s)
    el.click()
  }, sel)

const text = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)

const exists = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((s: string) => !!document.querySelector(s), sel)

const calls = (page: Page): Promise<{ cmd: string; args: Record<string, unknown> }[]> =>
  page.evaluate(() => (window as unknown as { __STUB_CALLS__?: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__ ?? [])

/** 展开面板并等到输入框拿到焦点（焦点真在 textarea 上，Esc 才会被全局层看到） */
async function expand(page: Page): Promise<void> {
  if (!(await exists(page, '[data-chat-panel]'))) await click(page, '[data-chat-bar]')
  await page.waitForSelector('[data-chat-input]', { timeout: 10000 })
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-chat-input') === true, { timeout: 10000 })
}

/** 发一句：打字 + 回车（Enter 发送、Shift+Enter 换行的约定就在这一下里） */
async function ask(page: Page, q: string): Promise<void> {
  await page.type('[data-chat-input]', q)
  await page.keyboard.press('Enter')
}

describe.skipIf(skip)('F-12 二期：底部对话坞（桌面形态）', () => {
  it('默认收起成一条输入条；点开 → 面板；Esc 收起；Ctrl+J 开合', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    expect(await exists(page, '[data-chat-panel]'), '默认不展开').toBe(false)
    expect(await text(page, '[data-chat-bar]')).toContain('AI')

    await expand(page)
    expect(await exists(page, '[data-chat-bar]'), '展开后收起条让位给面板').toBe(false)

    await page.keyboard.press('Escape')
    await page.waitForSelector('[data-chat-bar]', { timeout: 10000 })
    expect(await exists(page, '[data-chat-panel]'), 'Esc 收起').toBe(false)

    await page.keyboard.down('Control')
    await page.keyboard.press('j')
    await page.keyboard.up('Control')
    await page.waitForSelector('[data-chat-panel]', { timeout: 10000 })
    await page.keyboard.down('Control')
    await page.keyboard.press('j')
    await page.keyboard.up('Control')
    await page.waitForSelector('[data-chat-bar]', { timeout: 10000 })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('没配模型服务：当场说清去哪配，**一条 ai_chat 都不发**', async () => {
    const errs: string[] = []
    const page = await open({ ai: false }, errs)
    await expand(page)
    await ask(page, '你好')
    await page.waitForFunction(() => !!document.querySelector('[data-chat-notice]'), { timeout: 10000 })
    expect(await text(page, '[data-chat-notice]')).toContain('设置 → 实验室')
    expect((await calls(page)).filter((c) => c.cmd === 'ai_chat'), '没配就不该发').toEqual([])
    // 入口能点：点了要真的打开设置（不是一句单纯的文字提示）
    await click(page, '[data-chat-goto-settings]')
    await page.waitForSelector('.panel', { timeout: 10000 })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('发送：两帧增量拼成完整回复；请求带上 provider 与消息；回答落进历史', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    await ask(page, '帮我看看待办')

    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    // 两帧各半句，拼起来才是完整回复 —— 只保最后一帧的实现会在这里红
    expect(await text(page, '[data-role="assistant"]')).toBe('桩回复：收到。')

    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(sent).toHaveLength(1)
    const args = sent[0].args as { providerId: string; messages: { role: string; content: string }[] }
    expect(args.providerId).toBe('p1')
    expect(args.messages.at(-1)).toEqual({ role: 'user', content: '帮我看看待办' })

    // 历史由 Rust 单点落盘：桩里那份就是"盘上的"
    const hist = await page.evaluate(() =>
      (window as unknown as { __STUB_AI_HISTORY__: () => { title: string; messages: unknown[] }[] }).__STUB_AI_HISTORY__(),
    )
    expect(hist.length).toBe(1)
    expect(hist[0].title).toBe('帮我看看待办')

    // 历史面板已搬进左栏（PR-D）：发完之后栏里的清单应该出现这条
    await page.waitForSelector('[data-session]', { timeout: 10000 })
    expect(await text(page, '.rail')).toContain('帮我看看待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('停止：真发 ai_chat_cancel，气泡留下半句并标成「已中止」', async () => {
    const errs: string[] = []
    const page = await open({ hang: true }, errs)
    await expand(page)
    await ask(page, '讲个长故事')
    await page.waitForSelector('[data-chat-stop]', { timeout: 10000 })
    await page.waitForFunction(
      () => (document.querySelector('[data-role="assistant"]')?.textContent ?? '').includes('写到一半'),
      { timeout: 10000 },
    )
    await click(page, '[data-chat-stop]')
    await page.waitForFunction(
      () => document.querySelector('[data-role="assistant"]')?.getAttribute('data-status') === 'error',
      { timeout: 10000 },
    )
    expect(await text(page, '[data-chat-error]')).toContain('已中止')
    expect((await calls(page)).some((c) => c.cmd === 'ai_chat_cancel')).toBe(true)
    // 半句没有被吞掉：用户看到的是"写到这里被停了"，不是一段空白
    expect(await text(page, '[data-role="assistant"]')).toContain('写到一半')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('@卡片：候选 → chip → 请求里的 system 块带上那张卡的真内容', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    await page.type('[data-chat-input]', '@便')
    await page.waitForSelector('[data-chat-picker] [data-pick]', { timeout: 10000 })
    expect(await text(page, '[data-chat-picker]')).toContain('便签')
    await click(page, '[data-pick="sticky"]')
    await page.waitForSelector('[data-chip="sticky"]', { timeout: 10000 })
    // 触发词本身不会留在正文里
    expect(await page.evaluate(() => (document.querySelector('[data-chat-input]') as HTMLTextAreaElement).value)).toBe('')

    await ask(page, '这张便签写的啥')
    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    const messages = (sent[0].args as { messages: { role: string; content: string }[] }).messages
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('便签')
    expect(messages[0].content).toContain('周五前把周报发给老板')
    expect(messages.at(-1)?.content).toBe('这张便签写的啥')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('@第二张卡：chip 带的是实例 id，喂给模型的是它自己的内容（倒数日 / 记账 / 习惯各一条）', async () => {
    const errs: string[] = []
    const page = await open({ twins: true }, errs)
    await expand(page)
    // 倒数日：选第二张
    await page.type('[data-chat-input]', '@倒数')
    await page.waitForSelector('[data-chat-picker] [data-pick="countdown:2"]', { timeout: 10000 })
    // 候选里两张都在，且带序号 —— 只有一张的话，用户根本选不到第二张
    expect(await text(page, '[data-chat-picker]')).toContain('倒数日（2）')
    await click(page, '[data-pick="countdown:2"]')
    await page.waitForSelector('[data-chip="countdown:2"]', { timeout: 10000 })
    // 记账：也选第二张
    await page.type('[data-chat-input]', '@记账')
    await page.waitForSelector('[data-chat-picker] [data-pick="ledger:2"]', { timeout: 10000 })
    await click(page, '[data-pick="ledger:2"]')
    await page.waitForSelector('[data-chip="ledger:2"]', { timeout: 10000 })
    // 习惯：也选第二张（天数不同才能分开"读对了那张"与"回落成第一张"）
    await page.type('[data-chat-input]', '@习惯')
    await page.waitForSelector('[data-chat-picker] [data-pick="habit:2"]', { timeout: 10000 })
    expect(await text(page, '[data-chat-picker]')).toContain('习惯打卡（2）')
    await click(page, '[data-pick="habit:2"]')
    await page.waitForSelector('[data-chip="habit:2"]', { timeout: 10000 })

    await ask(page, '这三张各是什么')
    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    const messages = (sent[0].args as { messages: { role: string; content: string }[] }).messages
    expect(messages[0].content).toContain('体检：2026-12-20')
    expect(messages[0].content).toContain('体检挂号')
    expect(messages[0].content).toContain('冥想：已打卡 3 天')
    expect(messages[0].content, '不许把第一张的内容混进来').not.toContain('发版')
    expect(messages[0].content, '不许把第一张的账混进来').not.toContain('团建餐')
    expect(messages[0].content, '不许把第一张的打卡混进来').not.toContain('跑步')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('历史（左栏）：点开一条恢复气泡；删除要两步，删完列表真的空了', async () => {
    const errs: string[] = []
    const page = await open({
      history: [
        {
          id: 'conv-old',
          title: '上次聊的那件事',
          updatedAt: Math.floor(Date.now() / 1000),
          messages: [
            { role: 'user', content: '上次问的问题', ts: 1 },
            { role: 'assistant', content: '上次给的回答', ts: 1 },
            { role: 'system', content: '拼给模型的上下文', ts: 1 },
          ],
        },
      ],
    }, errs)
    // 历史面板已搬进左栏（PR-D）：清单是栏的，气泡仍是坞的
    await page.waitForSelector('[data-session="conv-old"]', { timeout: 10000 })
    await click(page, '[data-session="conv-old"]')
    await page.waitForFunction(
      () => (document.querySelector('[data-role="assistant"]')?.textContent ?? '').includes('上次给的回答'),
      { timeout: 10000 },
    )
    // system 是拼给模型的，不该出现在界面里
    expect(await text(page, '[data-chat-thread]')).not.toContain('拼给模型的上下文')

    await click(page, '[data-session="conv-old"] [data-chat-session-delete], [data-session="conv-old"] ~ .del, li:has([data-session="conv-old"]) .del')
    // 第一下只是待确认（与会议删稿同一手法），列表还在
    expect(await exists(page, '[data-session="conv-old"]')).toBe(true)
    await click(page, 'li:has([data-session="conv-old"]) .del')
    await page.waitForFunction(() => !document.querySelector('[data-session="conv-old"]'), { timeout: 10000 })
    const hist = await page.evaluate(
      () => (window as unknown as { __STUB_AI_HISTORY__: () => unknown[] }).__STUB_AI_HISTORY__(),
    )
    expect(hist, '盘上那条也要真的删掉').toEqual([])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('布局编辑里不渲染坞（拖卡片时不该被它挡着）', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    expect(await exists(page, '[data-chat-bar]')).toBe(true)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '布局编辑')
      ;(el as HTMLElement).click()
    })
    await page.waitForFunction(() => document.querySelector('[data-chat-bar]') === null, { timeout: 10000 })
    expect(await exists(page, '[data-chat-panel]')).toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('摘要（三期）：引用一张卡 → 走 ai_summarize 的 plain 档，气泡标「不保存」，不发 ai_chat', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    await page.type('[data-chat-input]', '@便')
    await page.waitForSelector('[data-chat-picker] [data-pick]', { timeout: 10000 })
    await click(page, '[data-pick="sticky"]')
    await page.waitForSelector('[data-chip="sticky"]', { timeout: 10000 })

    await click(page, '[data-chat-summarize]')
    await page.waitForSelector('[data-kind="summary"][data-status="done"]', { timeout: 15000 })
    expect(await text(page, '[data-role="assistant"][data-kind="summary"]')).toContain('桩摘要：这三句是要点。')
    expect(await text(page, '[data-chat-summary-tag]')).toContain('不保存')

    const seen = await calls(page)
    expect(seen.filter((c) => c.cmd === 'ai_chat'), '摘要不是对话').toEqual([])
    const sent = seen.filter((c) => c.cmd === 'ai_summarize')
    expect(sent).toHaveLength(1)
    const args = sent[0].args as { providerId: string; text: string; style: string }
    expect(args.providerId).toBe('p1')
    expect(args.style).toBe('plain')
    expect(args.text).toContain('便签')
    expect(args.text).toContain('周五前把周报发给老板')
    // 摘要不落历史：只有 ai_chat 会 upsert history.json
    const hist = await page.evaluate(
      () => (window as unknown as { __STUB_AI_HISTORY__: () => unknown[] }).__STUB_AI_HISTORY__(),
    )
    expect(hist, '摘要不该写历史').toEqual([])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('摘要（三期）：输入框里的一段字也能摘要，正文就是那段字', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    await page.type('[data-chat-input]', '  下周交周报，周五前发老板  ')
    await click(page, '[data-chat-summarize]')
    await page.waitForSelector('[data-kind="summary"][data-status="done"]', { timeout: 15000 })

    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_summarize')
    expect(sent).toHaveLength(1)
    expect((sent[0].args as { text: string }).text).toBe('下周交周报，周五前发老板')
    // 用户看得到自己给的那段字（知道自己摘要的是什么），输入框已清空
    expect(await text(page, '[data-chat-thread]')).toContain('下周交周报，周五前发老板')
    expect(
      await page.evaluate(() => (document.querySelector('[data-chat-input]') as HTMLTextAreaElement).value),
    ).toBe('')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})

/**
 * 聊天任脊柱（改天换地 E1，2026-11-06）：AI 从"底部小坞"升成脊柱级**视图**。
 *
 * 只测三件只有端到端能证的事：① 左栏点「聊天」⇒ 全高面板、画布让位；② 切回
 * 「工作台」⇒ 原样回来（互斥可逆）；③ web 形态（无 AI 后端）⇒ 诚实占位而不是
 * 假输入框。窄窗 12 列由 layout.spec 的三档视口用例钉着（E1 的自适应改动正是
 * 被它抓出来的），这里只补一条 1440 回归。
 */
describe.skipIf(skip)('聊天任脊柱（E1）', () => {
  it('点「聊天」：对话撑满内容列、画布让位；切「工作台」后原样回来', async () => {
    const errs: string[] = []
    const page = await open({}, errs)

    // 工作台态：坞是 46px 底部输入条（不是全高面板）
    await page.waitForSelector('[data-chat-bar]', { timeout: 10000 })
    const barH = await page.evaluate(
      () => Math.round((document.querySelector('[data-chat-bar]') as HTMLElement).getBoundingClientRect().height),
    )
    expect(barH, '工作台态的坞是底部输入条').toBeLessThan(80)

    await click(page, '[data-mode="chat"]')
    await new Promise((r) => setTimeout(r, 600))
    const chatState = await page.evaluate(() => ({
      mode: !!document.querySelector('[data-chat-mode]'),
      panel: !!document.querySelector('[data-chat-panel]'),
      grid: !!document.querySelector('.cell'),
      panelH: Math.round((document.querySelector('[data-chat-panel]') as HTMLElement)?.getBoundingClientRect().height ?? 0),
    }))
    expect(chatState.mode, 'chat 容器在').toBe(true)
    expect(chatState.panel, '全高对话面板在').toBe(true)
    expect(chatState.panelH, '面板撑满内容列（≥600px）').toBeGreaterThan(600)
    expect(chatState.grid, '画布让位').toBe(false)

    // 切回来：画布回来、坞回底部形态（互斥可逆）
    await click(page, '[data-mode="workbench"]')
    await new Promise((r) => setTimeout(r, 600))
    expect(await exists(page, '.cell'), '画布回来了').toBe(true)
    expect(await exists(page, '[data-chat-bar]'), '坞回底部输入条').toBe(true)
    expect(await exists(page, '[data-chat-panel]'), '全高面板收起').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('窄窗（1440）：左栏自动收起、画布拿回全宽（12 列优先不回退）', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    const railHidden = await page.evaluate(() => {
      const rail = document.querySelector('.rail') as HTMLElement | null
      return rail ? getComputedStyle(rail).display === 'none' : null
    })
    expect(railHidden, '1440 视口左栏自动收起').toBe(true)
    const stageW = await page.evaluate(() => {
      const stage = document.querySelector('.stage') as HTMLElement | null
      return Math.round(stage?.getBoundingClientRect().width ?? 0)
    })
    expect(stageW, '舞台拿回全宽（≥1400），栏没偷宽度').toBeGreaterThanOrEqual(1400)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('web 形态：点「聊天」给诚实占位，不摆假输入框', async () => {
    const errs: string[] = []
    // 不装 stub ⇒ isDesktop=false；`open(false)` 的 ai 配置也随之不带
    const page = await open({ desktop: false, ai: false }, errs)
    // 该 spec 的 open() 总是装 stub —— web 形态的判定需要它真的不在位：
    const reallyWeb = await page.evaluate(() => !('__TAURI_INTERNALS__' in window))
    if (!reallyWeb) {
      // 桩在位 ⇒ 这条用例的前提不成立（说明 open 的 desktop 选项没走通），如实失败
      throw new Error('web 形态前提不成立：stub 仍在位')
    }
    await click(page, '[data-mode="chat"]')
    await new Promise((r) => setTimeout(r, 500))
    const state = await page.evaluate(() => ({
      note: !!document.querySelector('[data-chat-web-note]'),
      noteText: document.querySelector('[data-chat-web-note]')?.textContent ?? '',
      fakeInput: !!document.querySelector('[data-chat-panel], [data-chat-bar]'),
    }))
    expect(state.note, '占位面板在').toBe(true)
    expect(state.noteText).toContain('桌面')
    expect(state.noteText).toContain('密钥')
    expect(state.fakeInput, 'web 态没有假的输入框').toBe(false)
    await click(page, '[data-mode="workbench"]')
    await new Promise((r) => setTimeout(r, 500))
    expect(await exists(page, '.cell'), '切回工作台画布在').toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('composer 控件行（E2）：模型名常在；引用一张卡后显示上下文用量与可读卡数', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    // 模型名：配置里唯一的 provider 的名字/型号要说在明处
    await page.waitForSelector('[data-chat-model]', { timeout: 10000 })
    expect(await text(page, '[data-chat-model]')).toContain('gpt-4o-mini')
    // 没引用卡片时不显示上下文/权限两枚（不占地方，不显示空信息）
    expect(await exists(page, '[data-chat-ctx]')).toBe(false)

    // 引用那张待办卡：控件行给出「已用 X / 2000」与「本次可读 1 张卡」
    await page.type('[data-chat-input]', '@')
    await page.waitForSelector('[data-chat-picker] [data-pick]', { timeout: 10000 })
    await click(page, '[data-chat-picker] [data-pick]')
    await new Promise((r) => setTimeout(r, 300))

    const ctx = await text(page, '[data-chat-ctx]')
    expect(ctx, '上下文用量形如「上下文 N/2000」').toMatch(/^上下文 \d+\/2000$/)
    const n = Number(ctx.replace('上下文 ', '').split('/')[0])
    expect(n, '用量是正数（引用块不是空的）').toBeGreaterThan(0)
    expect(await text(page, '[data-chat-perm]')).toContain('本次可读 1 张卡')
    // 与判定层同源（§12.63 的两颗钉子）：用量 = contextBlock 的真实长度，
    // 这里借 chip 的 aria 断言"可读卡数"与实际引用数一致
    expect(await exists(page, '[data-chat-chips] .chip'), '引用 chip 在').toBe(true)
    await click(page, '[data-chat-chips] .chip')
    await new Promise((r) => setTimeout(r, 300))
    expect(await exists(page, '[data-chat-ctx]'), '移除 chip = 收权，控件行收回用量显示').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('思考档位（E3）：默认 off（不改老行为）；选「深」后档位随请求发出去', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    const before = await page.$eval('[data-chat-thinking]', (el) => {
      const s = el as HTMLSelectElement
      return { value: s.value, label: s.options[s.selectedIndex]?.textContent ?? '' }
    })
    expect(before.value, '默认档 = 不加指令（E2 之前的行为逐字不变）').toBe('off')
    expect(before.label).toBe('默认')

    await page.select('[data-chat-thinking]', 'high')
    await ask(page, '在吗')
    await new Promise((r) => setTimeout(r, 600))
    const chat = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(chat, '发了一条').toHaveLength(1)
    expect(chat[0].args.thinking, '档位到 Rust 那一侧').toBe('high')
    // 没挂文件时也发空数组：Rust 那边只有"有/没有附件"两种，不靠字段缺失来猜
    expect(chat[0].args.attachments, '没文件就是空数组').toEqual([])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('添加文件（E3）：正文只走 attachments、不混进消息与历史；chip 点一下即移除', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await expand(page)
    const dir = mkdtempSync(join(tmpdir(), 'modulo-e3-'))
    const file = join(dir, 'e3-note.md')
    writeFileSync(file, '# 周报要点\n- 交付 A\n- 交付 B', 'utf8')

    // 断言时转成 ElementHandle<HTMLInputElement>：`page.$` 只回 ElementHandle<Element>，
// 而 uploadFile 只挂在 HTMLInputElement 那个句柄上（CI 的类型检查抓的正是这一处）
    const input = (await page.waitForSelector('[data-chat-file]', { timeout: 10000 })) as
      | ElementHandle<HTMLInputElement>
      | null
    expect(input, '文件选择框在（藏起来但存在）').toBeTruthy()
    await input!.uploadFile(file)
    await page.waitForSelector('[data-chat-files] .file', { timeout: 10000 })
    expect(await text(page, '[data-chat-files-note]'), '控件行报出挂了几份').toContain('1 个文件')
    expect(await text(page, '[data-chat-files] .file')).toContain('e3-note.md')

    await ask(page, '按这份文件列要点')
    await new Promise((r) => setTimeout(r, 600))
    const chat = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(chat).toHaveLength(1)
    const att = chat[0].args.attachments as { name: string; content: string }[]
    expect(att, '附件一份').toHaveLength(1)
    expect(att[0].name).toBe('e3-note.md')
    expect(att[0].content).toContain('交付 A')

    // 纪律 4：文件正文只走 attachments —— 不进消息体（气泡）、更不进历史
    const msgs = chat[0].args.messages as { role: string; content: string }[]
    expect(msgs.some((m) => m.content.includes('交付 A')), '正文不该混进消息体').toBe(false)
    const hist = await page.evaluate(() => {
      const fn = (window as unknown as { __STUB_AI_HISTORY__: () => { messages: { content: string }[] }[] })
        .__STUB_AI_HISTORY__
      return fn()
    })
    expect(hist[0].messages.some((m) => m.content.includes('交付 A')), '历史里也不该有正文').toBe(false)

    // chip 点一下即移除；控件行的附件摘要随之消失（不显示空信息）
    await click(page, '[data-chat-files] .file')
    await page.waitForFunction(() => !document.querySelector('[data-chat-files]'), { timeout: 5000 })
    expect(await exists(page, '[data-chat-files-note]'), '没文件就不显示摘要').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('资料（PR-F1）：导入 → 左栏列出且**重启还在** → `@` 引用进 system → 两步移除', async () => {
    const errs: string[] = []
    // 资料节在左栏里，而栏只在 ≥1480 的窗口常驻（PR-D 的自适应规则）—— 这条用例必须开宽屏
    const page = await open({ wide: true }, errs)
    await page.waitForSelector('[data-doc-file]', { timeout: 10000 })
    const dir = mkdtempSync(join(tmpdir(), 'modulo-kb-'))
    const file = join(dir, '验收清单.md')
    writeFileSync(file, '# 验收清单\n- 交付 A\n- 交付 B', 'utf8')

    const input = (await page.waitForSelector('[data-doc-file]', { timeout: 10000 })) as
      | ElementHandle<HTMLInputElement>
      | null
    expect(input, '导入按钮背后的文件框在').toBeTruthy()
    await input!.uploadFile(file)
    await page.waitForSelector('[data-doc]', { timeout: 10000 })
    expect(await text(page, '[data-doc]')).toContain('验收清单.md')

    // 点开看到的就是喂给模型的那一段（不是全文的另一种样子）
    await click(page, '[data-doc]')
    await page.waitForSelector('[data-doc-preview]', { timeout: 5000 })
    expect(await text(page, '[data-doc-preview]')).toContain('交付 A')

    // 聊天里 @ 到它：候选里资料排在最前，第一条就是
    await expand(page)
    await page.type('[data-chat-input]', '@')
    await page.waitForSelector('[data-chat-picker] [data-pick]', { timeout: 10000 })
    const labels = await page.$$eval('[data-chat-picker] [data-pick]', (els) =>
      els.map((e) => e.textContent?.trim() ?? ''),
    )
    expect(labels.join(' | '), '候选里有这份资料').toContain('验收清单.md')
    await click(page, '[data-chat-picker] [data-pick]')
    await new Promise((r) => setTimeout(r, 200))
    expect(await text(page, '[data-chat-chips]')).toContain('验收清单.md')
    // 权限行要把资料那一档说出来（卡片 400 / 资料 1200，两个上限不同源）
    expect(await text(page, '[data-chat-perm]')).toContain('1 份资料')

    await ask(page, '按资料列要点')
    await new Promise((r) => setTimeout(r, 600))
    const chat = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(chat).toHaveLength(1)
    const msgs = chat[0].args.messages as { role: string; content: string }[]
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content, '资料正文进了 system 块').toContain('交付 A')

    // ★ 这一条是"资料库"与"一次性附件"的分界：落盘了，reload 之后还在
    //（漏登记 DATA_KEYS 的症状就是这里写着一份、重启后一份都不见）
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('[data-doc]', { timeout: 15000 })
    expect(await text(page, '[data-doc]'), '重启后资料还在').toContain('验收清单.md')

    // 两步移除：第一次只标记，第二次才真删
    //（删按钮是 `[data-doc]` 的**兄弟**不是子节点 —— 选择器按 aria-label 前缀找）
    await click(page, '[aria-label^="移除资料"]')
    await new Promise((r) => setTimeout(r, 200))
    expect(await exists(page, '[data-doc]'), '第一次点击不删').toBe(true)
    await click(page, '[aria-label^="移除资料"]')
    await page.waitForFunction(() => !document.querySelector('[data-doc]'), { timeout: 5000 })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('定时任务（PR-F2）：到点真的跑；错过如实记；停用落盘', async () => {
    const errs: string[] = []
    // 任务时间 = 现在 +1 分钟：对表节奏是 60s，任意一分钟里必有一次 tick 与它相等
    const plus1 = new Date(Date.now() + 60_000)
    const hm = `${String(plus1.getHours()).padStart(2, '0')}:${String(plus1.getMinutes()).padStart(2, '0')}`
    const page = await open(
      {
        wide: true,
        cron: {
          tasks: [
            { id: 'c1', prompt: '把今天的要点写成一句话', time: hm, providerId: 'p1', enabled: true, createdAt: 0 },
            // 早已过点且今天没跑过 ⇒ 第一次对表就该记「错过」，不用等
            { id: 'c2', prompt: '早就过了的点', time: '00:01', providerId: 'p1', enabled: true, createdAt: 0 },
          ],
          runs: [],
        },
      },
      errs,
    )

    // 错过语义先到（同步路径，不等分钟翻转）
    await page.waitForFunction(
      () => document.querySelector('[data-cron-status="c2"]')?.textContent?.includes('错过') ?? false,
      { timeout: 15000, polling: 1000 },
    )
    // 到点执行：跑完的判据是 done 帧（不是 invoke 返回）
    await page.waitForFunction(
      () => document.querySelector('[data-cron-status="c1"]')?.textContent?.includes('跑完') ?? false,
      { timeout: 110_000, polling: 2000 },
    )
    const chat = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    const sent = chat.find((c) => (c.args.messages as { content: string }[] | undefined)?.[0]?.content === '把今天的要点写成一句话')
    expect(sent, '到点真的按任务的提示词发了 ai_chat').toBeTruthy()

    // 展开行看到的是那次对话的结果原文（不是另一种全文的样子）
    await click(page, '[data-cron-task="c1"]')
    await page.waitForSelector('[data-cron-run-preview]', { timeout: 5000 })
    expect(await text(page, '[data-cron-run-preview]')).toContain('桩回复')

    // 停用 + 运行记录都落盘：reload 后还在（漏登记 DATA_KEYS 的症状就是"重启就没了"）
    await click(page, '[data-cron-toggle="c1"]')
    await new Promise((r) => setTimeout(r, 300))
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('[data-cron-status="c1"]', { timeout: 15000 })
    expect(await text(page, '[data-cron-status="c1"]'), '运行记录落盘了').toContain('跑完')
    const off = await page.$eval('[data-cron-task="c1"]', (el) => el.closest('.doc-line')?.classList.contains('off') ?? false)
    expect(off, '停用状态落盘了').toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 150_000)

  it('工作流（PR-F3）：两步真跑；第二步带着第一步的产出；结果与流程都落盘', async () => {
    const errs: string[] = []
    const page = await open(
      {
        wide: true,
        workflow: {
          flows: [
            {
              id: 'w1',
              name: '搜集再归纳',
              steps: [
                { id: 's1', prompt: '先搜一搜这个主题' },
                { id: 's2', prompt: '再归纳成三条' },
              ],
              providerId: 'p1',
              createdAt: 0,
            },
          ],
          runs: [],
        },
      },
      errs,
    )

    // 栏里的「工作流」节（窄窗栏是收起来的 ⇒ 必须 wide）
    await page.waitForSelector('[data-wf-flow="w1"]', { timeout: 15000 })
    expect(await text(page, '[data-wf-status="w1"]')).toContain('等第一次')

    await click(page, '[data-wf-run="w1"]')
    // 跑完的判据是 done 帧（不是 invoke 返回）—— 与定时任务同一口径
    await page.waitForFunction(
      () => document.querySelector('[data-wf-status="w1"]')?.textContent?.includes('跑完') ?? false,
      { timeout: 30000, polling: 500 },
    )

    const chat = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(chat, '两步 = 两次模型调用').toHaveLength(2)
    const first = chat[0].args.messages as { role: string; content: string }[]
    const second = chat[1].args.messages as { role: string; content: string }[]
    expect(first[0].content, '第一步只带自己的提示词').toBe('先搜一搜这个主题')
    expect(second[0].content, '第二步带着自己的提示词').toContain('再归纳成三条')
    expect(second[0].content, '第二步带着第一步的产出（链条靠这个串起来）').toContain('桩回复：收到。')

    // 展开看每一步的结果
    await click(page, '[data-wf-flow="w1"]')
    await page.waitForSelector('[data-wf-step-result="0"]', { timeout: 5000 })
    expect(await text(page, '[data-wf-step-result="0"]')).toContain('桩回复')
    expect(await text(page, '[data-wf-step-result="1"]')).toContain('桩回复')

    // 落盘：reload 后流程与运行记录都还在（漏登记 DATA_KEYS 的症状就是"重启就没了"）
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('[data-wf-status="w1"]', { timeout: 15000 })
    expect(await text(page, '[data-wf-status="w1"]'), '运行记录落盘了').toContain('跑完')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 动手（第十二笔）：动作只是提议 —— 点「照做」才摆卡 / 记待办；坏行说人话；裸动作行不露给用户', async () => {
    const errs: string[] = []
    const reply = [
      '好，我给你摆一张便签，再记一条待办。',
      '@@act {"type":"addCard","moduleId":"sticky"}',
      '@@act {"type":"todo.add","text":"买牛奶"}',
      '@@act {"type":"canvas.clear"}',
    ].join('\n')
    // v1.2 起「照做」会**自动续一轮**（工具结果回喂）—— 用回复序列让续轮收到一句收尾，
    // 否则单句桩会把同一批动作再提议一遍（多出一个残留的「算了」，本用例第二阶段会踩）
    const page = await open({ replies: [reply, '都办好了。'] }, errs)
    await expand(page)
    const before = await page.evaluate(() => document.querySelectorAll('.cell').length)
    await ask(page, '帮我安排一下')

    await page.waitForSelector('[data-ai-acts]', { timeout: 15000 })
    // 正文里没有裸动作行（剥干净），提议块列的是人话
    expect(await text(page, '[data-role="assistant"]'), '裸动作行不该露给用户').not.toContain('@@act')
    expect(await text(page, '[data-ai-act]')).toBe('摆一张「便签」卡')
    expect(await text(page, '[data-ai-acts] ul li:nth-child(2)')).toBe('加一条待办：买牛奶')
    // 不会做的动作如实说（不静默丢）
    expect(await text(page, '[data-ai-act-bad]')).toContain('还不会')
    // 能力说明真的进了 system（模型得知道能动手）
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    const sys = (sent[0].args.messages as { role: string; content: string }[])[0]
    expect(sys.role).toBe('system')
    expect(sys.content).toContain('@@act')
    // 还没点「照做」：版面一动不动（AI 永不直接写）
    expect(await page.evaluate(() => document.querySelectorAll('.cell').length), '没点照做就不该动').toBe(before)

    await click(page, '[data-ai-act-run]')
    await page.waitForSelector('[data-ai-acts-note]', { timeout: 10000 })
    expect(await text(page, '[data-ai-acts-note]')).toContain('Ctrl+Z')
    await page.waitForFunction(
      (n: number) => document.querySelectorAll('.cell').length === n + 1,
      { timeout: 10000 },
      before,
    )
    // 待办真的落盘（走既有写入口；卡内容写入有 300ms 防抖 ⇒ 等条件不猜时间）
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '').includes('买牛奶'),
      { timeout: 10000 },
    )
    // 「算了」那条路：不写任何东西。
    // 序列优先于单句 ⇒ 第二阶段要**同时**清掉序列、再设单句回复（否则这句没人读）
    await page.evaluate((r: string) => {
      const w = window as unknown as { __STUB_AI_REPLY__: string; __STUB_AI_REPLIES__: string[] | null }
      w.__STUB_AI_REPLIES__ = null
      w.__STUB_AI_REPLY__ = r
    }, '@@act {"type":"addCard","moduleId":"clock"}')
    const after = await page.evaluate(() => document.querySelectorAll('.cell').length)
    await ask(page, '再来一张')
    await page.waitForSelector('[data-ai-act-skip]', { timeout: 15000 })
    await click(page, '[data-ai-act-skip]')
    await page.waitForFunction(() => !document.querySelector('[data-ai-act-skip]'), { timeout: 10000 })
    expect(await page.evaluate(() => document.querySelectorAll('.cell').length), '「算了」不该写').toBe(after)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 动手 v1.1（第十三笔）：便签追加不覆盖 / 倒数日设定 / 习惯打卡（幂等）', async () => {
    const errs: string[] = []
    const reply = [
      '好，都记下了。',
      '@@act {"type":"sticky.append","text":"还有一件事：周会纪要"}',
      '@@act {"type":"countdown.set","label":"发版","date":"2026-12-01"}',
      '@@act {"type":"habit.check"}',
      '@@act {"type":"habit.check"}',
    ].join('\n')
    // 同第十二笔：照做后的自动续轮要有单独的收尾句（单句桩会把同一批动作再提议一遍）
    const page = await open({ replies: [reply, '都记下了，没别的了。'] }, errs)
    await expand(page)
    await ask(page, '帮我记几件事')
    await page.waitForSelector('[data-ai-act-run]', { timeout: 15000 })
    expect(await text(page, '[data-ai-acts] ul li:nth-child(1)')).toBe('往便签里加一段：还有一件事：周会纪要')
    expect(await text(page, '[data-ai-acts] ul li:nth-child(2)')).toBe('把倒数日设成「发版 · 2026-12-01」')
    expect(await text(page, '[data-ai-acts] ul li:nth-child(4)')).toBe('给习惯卡打上今天的卡')

    await click(page, '[data-ai-act-run]')
    await page.waitForSelector('[data-ai-acts-note]', { timeout: 10000 })
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    await page.waitForFunction(
      (day: string) => {
        const raw = localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? ''
        return raw.includes('周会纪要') && raw.includes('2026-12-01') && raw.includes(day)
      },
      { timeout: 10000 },
      iso,
    )
    const stored = (await page.evaluate(() =>
      JSON.parse(localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '{}'),
    )) as { sticky?: string; countdown?: { label?: string; date?: string }; habit?: { days?: string[] } }
    // 追加不覆盖：原句还在、新句在后（便签是用户的原文，AI 只往上添）
    expect(stored.sticky).toBe('周五前把周报发给老板\n还有一件事：周会纪要')
    expect(stored.countdown).toMatchObject({ label: '发版', date: '2026-12-01' })
    // 幂等：连发两个 habit.check，今天只算一天
    expect((stored.habit?.days ?? []).filter((d) => d === iso)).toHaveLength(1)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 动手 v1.2（第十四笔）：agent 循环 —— 照做后结果自动回喂、模型接着收尾（全线可见，无第二个人工动作）', async () => {
    const errs: string[] = []
    const replies = [
      '好，我先摆一张便签。\n@@act {"type":"addCard","moduleId":"sticky"}',
      '摆好了，都办完了。',
    ]
    const page = await open({ replies }, errs)
    await expand(page)
    await ask(page, '帮我摆张便签')
    await page.waitForSelector('[data-ai-act-run]', { timeout: 15000 })
    await click(page, '[data-ai-act-run]')

    // 自动续轮：工具结果小条出现 + 第二轮的回复渲染出来（中间没有人再点任何东西）
    await page.waitForSelector('[data-chat-tool-note]', { timeout: 15000 })
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-role="assistant"]')].some((el) =>
          el.textContent?.includes('都办完了'),
        ),
      { timeout: 15000 },
    )
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(sent, '照做之后自动续了一轮 = 两次模型调用').toHaveLength(2)
    const last = sent[1].args.messages as { role: string; content: string }[]
    expect(last.at(-1)?.role, '回喂走的是 user 消息（协议只有三种角色）').toBe('user')
    expect(last.at(-1)?.content).toContain('（工具结果）')
    expect(last.at(-1)?.content).toContain('摆一张「便签」卡：成功')
    // 工具结果不装成用户气泡：用户气泡（.bubble）只有最初那一句
    const bubbles = await page.evaluate(() =>
      [...document.querySelectorAll('[data-role="user"] .bubble')].map((el) => (el as HTMLElement).innerText),
    )
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toContain('帮我摆张便签')
    // 续轮回复里没有新提议 ⇒ 也没有新按钮
    expect(await exists(page, '[data-ai-act-run]'), '都办完了就不该再有提议').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 记忆（第十五笔）：「记住」照做后落盘，且从下一轮起常驻 system 块', async () => {
    const errs: string[] = []
    const replies = [
      '好，我记下。\n@@act {"type":"memory.add","text":"用户偏好四象限"}',
      '记下了。',
    ]
    const page = await open({ replies }, errs)
    await expand(page)
    await ask(page, '记住：我偏好四象限')
    await page.waitForSelector('[data-ai-act-run]', { timeout: 15000 })
    expect(await text(page, '[data-ai-act]')).toBe('记住：用户偏好四象限')
    await click(page, '[data-ai-act-run]')
    await page.waitForSelector('[data-ai-acts-note]', { timeout: 10000 })
    // 落盘（漏登记 DATA_KEYS 的症状是"记得住、重启就忘"）
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.memory.v1') ?? '').includes('用户偏好四象限'),
      { timeout: 10000 },
    )
    // v1.2 的自动续轮（第二次请求）里，system 块已经带着这条记忆 —— 两笔天然衔上
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-role="assistant"]')].some((el) => el.textContent?.includes('记下了')),
      { timeout: 15000 },
    )
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(sent).toHaveLength(2)
    const sys2 = (sent[1].args.messages as { role: string; content: string }[])[0]
    expect(sys2.role).toBe('system')
    expect(sys2.content, '记忆从下一轮起常驻 system 块').toContain('用户偏好四象限')
    expect(sys2.content).toContain('不是当前指令')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 动手 v1.3（第十六笔）：read 类 —— 先看再动（看到的内容回喂给模型，版面一动不动）', async () => {
    const errs: string[] = []
    const replies = [
      '我先看一眼待办卡再说。\n@@act {"type":"context.read","moduleId":"todo"}',
      '看完了：待办里有一条「交周报」，我帮你挂到周五。',
    ]
    const page = await open({ replies }, errs)
    await expand(page)
    const before = await page.evaluate(() => document.querySelectorAll('.cell').length)
    await ask(page, '待办上都有啥？')
    await page.waitForSelector('[data-ai-act-run]', { timeout: 15000 })
    expect(await text(page, '[data-ai-act]')).toBe('看一眼「待办」卡')
    await click(page, '[data-ai-act-run]')

    // 自动续轮：读的产出随结果回喂（第二个请求的最后一条消息带着它）
    await page.waitForSelector('[data-chat-tool-note]', { timeout: 15000 })
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-role="assistant"]')].some((el) => el.textContent?.includes('看完了')),
      { timeout: 15000 },
    )
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    expect(sent, '读之后自动续了一轮 = 两次模型调用').toHaveLength(2)
    const last = sent[1].args.messages as { role: string; content: string }[]
    expect(last.at(-1)?.content).toContain('（工具结果）')
    expect(last.at(-1)?.content).toContain('看一眼「待办」卡：')
    expect(last.at(-1)?.content).toContain('交周报')
    // 只读不写：版面卡数没动，盘上待办条数没动
    expect(await page.evaluate(() => document.querySelectorAll('.cell').length)).toBe(before)
    const stored = (await page.evaluate(() =>
      JSON.parse(localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '{}'),
    )) as { todos?: { text: string }[] }
    expect(stored.todos).toHaveLength(1)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)

  it('AI 动手 v1.4（第十八笔）：多实例定点 —— instanceId 指名写到第二张习惯卡', async () => {
    const errs: string[] = []
    const replies = [
      '给第二张习惯卡打上今天的卡。\n@@act {"type":"habit.check","instanceId":"habit:2"}',
      '打好了。',
    ]
    const page = await open({ twins: true, replies }, errs)
    await expand(page)
    await ask(page, '给第二张习惯卡打卡')
    await page.waitForSelector('[data-ai-act-run]', { timeout: 15000 })
    expect(await text(page, '[data-ai-act]')).toBe('定点「习惯打卡（habit:2）」 · 给习惯卡打上今天的卡')
    await click(page, '[data-ai-act-run]')
    await page.waitForSelector('[data-ai-acts-note]', { timeout: 10000 })
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    await page.waitForFunction(
      (day: string) =>
        ((JSON.parse(localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '{}') as {
          byInstance?: Record<string, { habit?: { days?: string[] } }>
        }).byInstance?.['habit:2']?.habit?.days ?? []).includes(day),
      { timeout: 10000 },
      iso,
    )
    const stored = (await page.evaluate(() =>
      JSON.parse(localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '{}'),
    )) as { habit?: { days?: string[] }; byInstance?: Record<string, { habit?: { name?: string; days?: string[] } }> }
    // 定点：今天打在「冥想」那张上，第一张「跑步」一动不动
    expect(stored.byInstance?.['habit:2']?.habit?.days).toContain(iso)
    expect(stored.byInstance?.['habit:2']?.habit?.name).toBe('冥想')
    expect(stored.habit?.days).not.toContain(iso)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  }, 90_000)
})
