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
  /** 版面上再加两张倒数日 + 两张记账（见 `TWIN_ITEMS`） */
  twins?: boolean
  /** `false` = 网页形态：**不装 stub**（不摆 Tauri 内核 ⇒ isDesktop=false），E1 的
   *  web 占位用例靠它拿到真 web 环境 */
  desktop?: boolean
  /** 宽屏（1600）：左栏常驻的档位（≥1480）。PR-F1 的「资料」节只在栏里，窄窗看不见它 */
  wide?: boolean
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
    (src: string, docJson: string, cardJson: string, aiJson: string | null, histJson: string | null, hang: boolean, reply: string | null, installStub: boolean) => {
      if (installStub) new Function(src)()
      localStorage.setItem('modulo.layout.v1', docJson)
      localStorage.setItem('modulo.__stubdoc.modulo.carddata.v1', cardJson)
      if (aiJson) localStorage.setItem('modulo.__stubdoc.ai-settings.v1', aiJson)
      // 历史与配置分开存：测试要能断言"历史真的落盘了"，不能与配置混在一格里
      if (histJson) localStorage.setItem('modulo.__stubai.hist', histJson)
      if (hang) (window as unknown as { __STUB_AI_HANG__: boolean }).__STUB_AI_HANG__ = true
      if (reply) (window as unknown as { __STUB_AI_REPLY__: string }).__STUB_AI_REPLY__ = reply
    },
    STUB_SOURCE,
    JSON.stringify(doc),
    JSON.stringify(card),
    seed.ai === false ? null : JSON.stringify(AI),
    seed.history ? JSON.stringify(seed.history) : null,
    seed.hang === true,
    seed.reply ?? null,
    desktop,
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
})
