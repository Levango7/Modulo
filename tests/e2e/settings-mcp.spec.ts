/**
 * 设置页 MCP 卡片的**本会话闸门 + 工具清单预览**（J1 执行半的界面那一半）。
 *
 * 补的是哪一格：`useMcpExecution` 的单测（`tests/vue/useMcpExecution.test.ts`）证的是
 * 「命令发得对不对、失败折成什么人话」，桩（`tauri-stub.js` 的 `__STUB_MCP_*__`）证的是
 * 「线上形状对得上」；但「按钮什么时候能点、点完界面变成什么样、桩真被调到」这三件事
 * 只有真页面能证 —— 本仓没有组件测试设施（无 @vue/test-utils / jsdom），所以归 E2E。
 *
 * 桌面形态走 `tauri-stub.js`（实验室组只在桌面出现，MCP 卡片就在那里）。三条命令的
 * 数据由桩的两个开关预置：`__STUB_MCP_TOOLS__`（serverId → 工具清单）与
 * `__STUB_MCP_LIST_FAIL__`（只让某一个服务列工具失败）。
 *
 * 盘上种的是 `modulo.__stubdoc.modulo.mcp.v1`：桌面适配器只读启动时 hydrate 的镜像，
 * 而桩的 `read_doc` 落在 `__stubdoc.` 前缀下（与 `settings-ia.spec.ts` 种记忆同一条路）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath, enterWorkbench } from './chrome'

const EXE = chromePath()
const skip = !EXE

let url = 'http://localhost:1430'
beforeAll(() => {
  url = process.env.MODULO_URL ?? url
})
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')

/** 种一张待办卡（= 非首启，别让向导盖住设置页） */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'todo', variant: 'list', x: 0, y: 0, w: 4, h: 3 }],
}

/** 盘上的 MCP 文档：一个已启用的服务 + 总开关开着 —— 这是"用户配好了，正在用"的样子 */
const MCP = JSON.stringify({
  version: 1,
  gate: true,
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

/** 开一页：注桩（桌面形态）+ 种版面 + 种 MCP 文档，然后走到「设置 → 实验室」 */
async function open(errs: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (src: string, docJson: string, mcpJson: string) => {
      new Function(src)()
      localStorage.setItem('modulo.layout.v1', docJson)
      // 桌面适配器读的是桩的「盘」，前缀见文件头
      localStorage.setItem('modulo.__stubdoc.modulo.mcp.v1', mcpJson)
    },
    STUB_SOURCE,
    JSON.stringify(DOC),
    MCP,
  )
  // 先等 App 真挂上（顶栏那枚设置按钮出现 = 首屏渲染完了），再切视图。
  // 直接用 `gotoWorkbench` 会与 Vue 挂载抢跑：`enterWorkbench` 一发现按钮不在就抛错，
  // 冷启第一页偶发「切不到工作台」（本文件第一次跑就踩到）。等一句再切，判据还是同一条。
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 30000 })
  await enterWorkbench(page)
  await page.click('button.wide[title="外观设置"]')
  await page.waitForSelector('.panel .nav-item', { timeout: 10000 })
  await page.click('.panel .nav-item[data-group="lab"]')
  await page.waitForSelector('[data-mcp="s1"]', { timeout: 10000 })
  return page
}

/**
 * 点一个元素用 `el.click()` 而不是 `page.click()`：设置面板内部自己滚动，
 * 鼠标坐标点容易被滚出视口的部分接走（与 `chrome.ts` 的 `enterWorkbench` 同一条理由）。
 */
const clickEl = (page: Page, sel: string): Promise<void> =>
  page.evaluate((s: string) => {
    const el = document.querySelector<HTMLElement>(s)
    if (!el) throw new Error(`页面上找不到 ${s}`)
    el.click()
  }, sel)

const attr = (page: Page, sel: string, name: string): Promise<string | null> =>
  page.evaluate((s: string, n: string) => document.querySelector(s)?.getAttribute(n) ?? null, sel, name)
const text = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s: string) => (document.querySelector(s)?.textContent ?? '').trim(), sel)
const isDisabled = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((s: string) => (document.querySelector(s) as HTMLButtonElement | null)?.disabled === true, sel)
const has = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((s: string) => !!document.querySelector(s), sel)

const CONFIRM = '[data-mcp="s1"] [data-mcp-confirm]'
const CONFIRM_STATE = '[data-mcp="s1"] [data-mcp-confirm-state]'
const TOOLS = '[data-mcp="s1"] [data-mcp-tools]'

/** 允许 s1 并等到状态真的转 on（后面几条用例都以「已允许」为起点） */
async function confirmS1(page: Page): Promise<void> {
  await clickEl(page, CONFIRM)
  await page.waitForFunction(
    () => document.querySelector('[data-mcp-confirm-state]')?.getAttribute('data-mcp-confirm-state') === 'on',
    { timeout: 10000 },
  )
}

describe.skipIf(skip)('设置页 MCP：本会话允许 + 工具清单预览（J1 执行半）', () => {
  it('刚打开：服务在、状态是「未允许」、确认能点、列工具点不了（要先允许）', async () => {
    const errs: string[] = []
    const page = await open(errs)

    expect(await text(page, '[data-mcp="s1"] [data-mcp-name]'), '种下的服务要真的渲染出来').toBe('files')
    expect(await attr(page, CONFIRM_STATE, 'data-mcp-confirm-state')).toBe('off')
    expect(await text(page, CONFIRM_STATE)).toBe('本会话未允许')

    expect(await isDisabled(page, CONFIRM), '总开关开着 + 服务已启用 ⇒ 确认能点').toBe(false)
    // 未确认就去列工具，Rust 闸门会当场拒 —— 所以按钮先按死，title 说清要补哪一步
    expect(await isDisabled(page, TOOLS), '未确认时列不了工具').toBe(true)
    expect(await attr(page, TOOLS, 'title')).toBe('先允许本会话使用，再列工具')

    expect(await has(page, '[data-mcp-tool-list]'), '还没点过，不该有清单').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('点「允许」：真发了 mcp_confirm，状态转 on、按钮变「已允许（本会话）」并禁用，列工具放开', async () => {
    const errs: string[] = []
    const page = await open(errs)

    await clickEl(page, CONFIRM)
    await page.waitForFunction(
      () => document.querySelector('[data-mcp-confirm-state]')?.getAttribute('data-mcp-confirm-state') === 'on',
      { timeout: 10000 },
    )

    expect(await text(page, CONFIRM_STATE)).toBe('本会话已允许')
    expect(await text(page, CONFIRM), '确认过之后按钮文案要改成既成事实').toContain('已允许（本会话）')
    expect(await isDisabled(page, CONFIRM), '已允许就没有「再点一次」的语义；也没有撤销（Rust 无此命令）').toBe(true)
    expect(await isDisabled(page, TOOLS), '允许之后才轮到列工具').toBe(false)

    // 桩记下的确认：证明确实走了 `mcp_confirm`，而不只是界面自己点亮了一个 span
    expect(
      await page.evaluate(() =>
        (window as unknown as { __STUB_MCP_CONFIRMED__: () => string[] }).__STUB_MCP_CONFIRMED__(),
      ),
    ).toEqual(['s1'])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('点「列出工具」：桩给两条，清单里就是这两条', async () => {
    const errs: string[] = []
    const page = await open(errs)
    await page.evaluate(() => {
      ;(window as unknown as { __STUB_MCP_TOOLS__: unknown }).__STUB_MCP_TOOLS__ = {
        s1: { tools: [{ name: 'read_file' }, { name: 'list_directory' }] },
      }
    })

    await clickEl(page, CONFIRM)
    await page.waitForFunction(
      () => document.querySelector('[data-mcp-tools]:not([disabled])') !== null,
      { timeout: 10000 },
    )

    await clickEl(page, TOOLS)
    await page.waitForSelector('[data-mcp="s1"] [data-mcp-tool-list]', { timeout: 10000 })
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('[data-mcp="s1"] [data-mcp-tool]')].map((el) => (el.textContent ?? '').trim()),
    )
    expect(names).toEqual(['read_file', 'list_directory'])
    expect(await has(page, '[data-mcp-tool-error]'), '成功时不该同时画一个错误').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('列工具失败：把桩那句话原样显示出来，不留半份清单', async () => {
    const errs: string[] = []
    const page = await open(errs)
    // 只让 s1 失败（`mcp_list_tools` 会 reject）—— 不要在点过成功之后再设，执行层会走缓存
    await page.evaluate(() => {
      ;(window as unknown as { __STUB_MCP_LIST_FAIL__: string | null }).__STUB_MCP_LIST_FAIL__ = 's1'
    })

    await clickEl(page, CONFIRM)
    await page.waitForFunction(
      () => document.querySelector('[data-mcp-tools]:not([disabled])') !== null,
      { timeout: 10000 },
    )
    await clickEl(page, TOOLS)
    await page.waitForSelector('[data-mcp="s1"] [data-mcp-tool-error]', { timeout: 10000 })

    // 失败原因照 Rust 那句走（桩逐字照抄），界面不自己编一句更好听的
    expect(await text(page, '[data-mcp-tool-error]')).toContain('列工具失败：stub 按配置拒绝')
    expect(await has(page, '[data-mcp-tool-list]'), '失败时不能留一份看起来成功的清单').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('总开关关掉：两个按钮都按死、既有那句 note 仍在（配置不隐藏，只是不执行）', async () => {
    const errs: string[] = []
    const page = await open(errs)

    await clickEl(page, '[data-mcp-gate]')
    await page.waitForSelector('[data-mcp-gate-off-note]', { timeout: 10000 })

    expect(await isDisabled(page, CONFIRM), '总开关关着，连允许这一步都发不出去').toBe(true)
    expect(await isDisabled(page, TOOLS), '总开关关着更列不了工具').toBe(true)
    expect(await attr(page, CONFIRM, 'title')).toBe('总开关关着，开了才能连')
    expect(await attr(page, TOOLS, 'title')).toBe('总开关关着，开了才能连')
    // 列表还在（用户要能看见自己配过什么），状态也还是"未允许"
    expect(await has(page, '[data-mcp="s1"]')).toBe(true)
    expect(await attr(page, CONFIRM_STATE, 'data-mcp-confirm-state')).toBe('off')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('改了命令再保存：确认态清回 off —— 同一个 id 背后已经是另一个进程', async () => {
    const errs: string[] = []
    const page = await open(errs)
    await confirmS1(page)

    await clickEl(page, '[data-mcp="s1"] [data-mcp-edit]')
    await page.waitForSelector('[data-mcp-form-command]', { timeout: 10000 })
    // 走原生 setter + input 事件：v-model 听的是 `input`，绕开坐标点击与面板内滚动
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[data-mcp-form-command]')
      if (!el) throw new Error('编辑表单没打开')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'node')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await clickEl(page, '[data-mcp-save]')
    await page.waitForFunction(() => !document.querySelector('[data-mcp-form]'), { timeout: 10000 })

    // 用户允许的是"那条命令"，不是"那个 id"：换命令必须重新允许
    expect(await attr(page, CONFIRM_STATE, 'data-mcp-confirm-state')).toBe('off')
    expect(await isDisabled(page, TOOLS), '确认被清了，列工具也要回到不可点').toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('只打开编辑、原样保存：确认态**不清** —— 清了就把用户刚做的确认抹掉了', async () => {
    const errs: string[] = []
    const page = await open(errs)
    await confirmS1(page)

    await clickEl(page, '[data-mcp="s1"] [data-mcp-edit]')
    await page.waitForSelector('[data-mcp-save]', { timeout: 10000 })
    await clickEl(page, '[data-mcp-save]')
    await page.waitForFunction(() => !document.querySelector('[data-mcp-form]'), { timeout: 10000 })

    expect(await attr(page, CONFIRM_STATE, 'data-mcp-confirm-state'), '什么都没改就没理由清').toBe('on')
    expect(await isDisabled(page, TOOLS)).toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('停用一个已确认的服务：确认态清回 off（停用的东西不该留着放行）', async () => {
    const errs: string[] = []
    const page = await open(errs)
    await confirmS1(page)

    await clickEl(page, '[data-mcp="s1"] [data-mcp-toggle]')
    await page.waitForFunction(
      () => document.querySelector('[data-mcp="s1"] [data-mcp-state]')?.getAttribute('data-mcp-state') === 'off',
      { timeout: 10000 },
    )

    expect(await attr(page, CONFIRM_STATE, 'data-mcp-confirm-state')).toBe('off')
    expect(await isDisabled(page, CONFIRM), '停用的服务连允许都发不出去').toBe(true)
    expect(await isDisabled(page, TOOLS)).toBe(true)
    expect(await attr(page, CONFIRM, 'title')).toBe('这条服务已停用，先启用它')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
