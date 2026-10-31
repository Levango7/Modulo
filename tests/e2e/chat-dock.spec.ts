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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
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
 * `days: true` 时额外摆**两张倒数日**（第一张 + 第二实例）：引用块要报的是被选中的那一张
 * 自己的日子。两个实例的 label / date 都取得出，测试才分得开"读对了那张"和"回落成第一张"。
 */
const DAY_ITEMS = [
  { id: 'countdown', module: 'countdown', variant: 'days', x: 0, y: 3, w: 4, h: 2 },
  { id: 'countdown:2', module: 'countdown', variant: 'days', x: 4, y: 3, w: 4, h: 2 },
]
const DAY_CARD = {
  countdown: { label: '发版', date: '2026-11-01' },
  byInstance: { 'countdown:2': { countdown: { label: '体检', date: '2026-12-20' } } },
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
  /** 版面上再加两张倒数日（见 `DAY_ITEMS`） */
  days?: boolean
}

/** 开一张桌面形态的页面。`ai: false` = 没配任何模型服务（空态那条路） */
async function open(seed: Seed = {}, errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  const doc = seed.days ? { ...DOC, items: [...DOC.items, ...DAY_ITEMS] } : DOC
  const card = seed.days ? { ...CARD, ...DAY_CARD } : CARD
  await page.evaluateOnNewDocument(
    (src: string, docJson: string, cardJson: string, aiJson: string | null, histJson: string | null, hang: boolean, reply: string | null) => {
      new Function(src)()
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
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('[data-chat-bar], [data-chat-panel]', { timeout: 15000 })
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

    await click(page, '[data-chat-history-toggle]')
    await page.waitForSelector('[data-history]', { timeout: 10000 })
    expect(await text(page, '[data-chat-history]')).toContain('帮我看看待办')
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

  it('@第二张倒数日：chip 带的是实例 id，喂给模型的是它自己的日子（不是第一张的）', async () => {
    const errs: string[] = []
    const page = await open({ days: true }, errs)
    await expand(page)
    await page.type('[data-chat-input]', '@倒数')
    await page.waitForSelector('[data-chat-picker] [data-pick="countdown:2"]', { timeout: 10000 })
    // 候选里两张都在，且带序号 —— 只有一张的话，用户根本选不到第二张
    expect(await text(page, '[data-chat-picker]')).toContain('倒数日（2）')
    await click(page, '[data-pick="countdown:2"]')
    await page.waitForSelector('[data-chip="countdown:2"]', { timeout: 10000 })

    await ask(page, '这个日子是什么时候')
    await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 15000 })
    const sent = (await calls(page)).filter((c) => c.cmd === 'ai_chat')
    const messages = (sent[0].args as { messages: { role: string; content: string }[] }).messages
    expect(messages[0].content).toContain('体检：2026-12-20')
    expect(messages[0].content, '不许把第一张的日子混进来').not.toContain('发版')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('历史：点开一条恢复气泡；删除要两步，删完列表真的空了', async () => {
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
    await expand(page)
    await click(page, '[data-chat-history-toggle]')
    await page.waitForSelector('[data-history="conv-old"]', { timeout: 10000 })
    await click(page, '[data-history="conv-old"] .title')
    await page.waitForFunction(
      () => (document.querySelector('[data-role="assistant"]')?.textContent ?? '').includes('上次给的回答'),
      { timeout: 10000 },
    )
    // system 是拼给模型的，不该出现在界面里
    expect(await text(page, '[data-chat-thread]')).not.toContain('拼给模型的上下文')

    await click(page, '[data-chat-history-toggle]')
    await page.waitForSelector('[data-history="conv-old"]', { timeout: 10000 })
    await click(page, '[data-history="conv-old"] [data-chat-history-delete]')
    // 第一下只是待确认（与会议删稿同一手法），列表还在
    expect(await exists(page, '[data-history="conv-old"]')).toBe(true)
    expect(await text(page, '[data-history="conv-old"] [data-chat-history-delete]')).toContain('确定删除')
    await click(page, '[data-history="conv-old"] [data-chat-history-delete]')
    await page.waitForFunction(() => !document.querySelector('[data-history="conv-old"]'), { timeout: 10000 })
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
