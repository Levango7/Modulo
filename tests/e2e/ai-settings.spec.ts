/**
 * F-12 一期「设置 → 实验室 → AI 模型服务」的 E2E（设计稿 `docs/design/F-12-AI-WIRING.md`）。
 *
 * 这一格补的是**只有组件层能证**的那几条：表单真的展开、错地址当场红字且一个 IPC 都不发、
 * 保存后列表与状态、探测结果落在行内、密钥存完输入框清空且文档里没有明文、删除的两步确认
 * 与**命令顺序**（先删密钥再删配置）。纯判定（地址表 / 文档清洗 / 增删改）在
 * `tests/vue/aiSettings.test.ts` 里，这里不重复。
 *
 * 桌面形态走 `tauri-stub.js`：`isDesktop` 由 `__TAURI_INTERNALS__` 决定，「实验室」组只在那时出现。
 * 桩把配置文档落在 `modulo.__stubdoc.ai-settings.v1`、把密钥另存 `modulo.__stubai.key.<id>`
 * —— **分开存**才能断言"密钥确实没进配置文档"。探测结果由 `window.__STUB_AI_READY__` 控制。
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

/** 只上一张待办卡：版面非空（不进首启向导），且不引入与 AI 无关的卡片噪声 */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'todo', variant: 'list', x: 0, y: 0, w: 4, h: 3 }],
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

/** 开一个桌面形态的页面，并停在「设置 → 实验室」 */
async function openLab(errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (src: string, docJson: string) => {
      new Function(src)()
      localStorage.setItem('modulo.layout.v1', docJson)
    },
    STUB_SOURCE,
    JSON.stringify(DOC),
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
  await click(page, 'button.wide[title="外观设置"]')
  await page.waitForSelector('.panel .nav-item[data-group="lab"]', { timeout: 10000 })
  await click(page, '.panel .nav-item[data-group="lab"]')
  await page.waitForSelector('[data-ai-empty], [data-provider]', { timeout: 10000 })
  return page
}

const click = (page: Page, sel: string): Promise<void> =>
  page.evaluate((s: string) => {
    const el = document.querySelector(s) as HTMLElement | null
    if (!el) throw new Error('找不到 ' + s)
    el.click()
  }, sel)

const setValue = async (page: Page, sel: string, value: string): Promise<void> => {
  await page.evaluate(
    (s: string, v: string) => {
      const el = document.querySelector(s) as HTMLInputElement | null
      if (!el) throw new Error('找不到 ' + s)
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    sel,
    value,
  )
}

const text = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)

const attr = (page: Page, sel: string, name: string): Promise<string | null> =>
  page.evaluate((s: string, n: string) => document.querySelector(s)?.getAttribute(n) ?? null, sel, name)

const calls = (page: Page): Promise<{ cmd: string; args: Record<string, unknown> }[]> =>
  page.evaluate(() => (window as unknown as { __STUB_CALLS__?: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__ ?? [])

/** 存进「数据目录」的那份配置文档（桩的前缀） */
const savedDoc = (page: Page): Promise<string | null> =>
  page.evaluate(() => localStorage.getItem('modulo.__stubdoc.ai-settings.v1'))

/** 走一遍「添加 → 填 → 保存」，返回页面停在列表 */
async function addProvider(page: Page, baseUrl: string, model = 'gpt-4o-mini'): Promise<void> {
  await click(page, '[data-ai-add]')
  await page.waitForSelector('[data-ai-form]', { timeout: 10000 })
  await setValue(page, '[data-ai-url]', baseUrl)
  await setValue(page, '[data-ai-model]', model)
  await click(page, '[data-ai-save]')
}

describe.skipIf(skip)('F-12 AI 模型服务（桌面形态）', () => {
  it('空态 → 添加表单；错地址当场红字且**一个 IPC 都不发**；改对才落盘', async () => {
    const errs: string[] = []
    const page = await openLab(errs)
    expect(await page.evaluate(() => !!document.querySelector('[data-ai-empty]'))).toBe(true)
    expect(await text(page, '[data-ai-empty]')).toContain('还没有模型服务')

    await click(page, '[data-ai-add]')
    await page.waitForSelector('[data-ai-form]', { timeout: 10000 })
    await setValue(page, '[data-ai-url]', 'http://ai.example.com')
    await setValue(page, '[data-ai-model]', 'gpt-4o-mini')
    await click(page, '[data-ai-save]')
    await page.waitForFunction(() => !!document.querySelector('[data-ai-form-error]'), { timeout: 15000 })
    expect(await text(page, '[data-ai-form-error]')).toContain('明文 http 只允许本机地址')

    // 判据在表单里就断了：既没有写盘，也没有探测（"当场红字"不是靠后端兜的）。
    // 只看**这份配置文档**的 write_doc —— 启动时版面/同步/自动备份各自会写一次，那些与本条无关
    const cs = await calls(page)
    const wrote = (list: typeof cs) => list.filter((c) => c.cmd === 'write_doc' && c.args.name === 'ai-settings.v1')
    expect(wrote(cs), '错地址不该写盘').toEqual([])
    expect(cs.filter((c) => c.cmd === 'ai_providers'), '错地址不该发探测').toEqual([])

    // 改对：表单关闭、列表出现一条
    await setValue(page, '[data-ai-url]', 'https://api.example.com/v1')
    await click(page, '[data-ai-save]')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })
    expect(await page.evaluate(() => !!document.querySelector('[data-ai-form]')), '保存后表单收起').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('保存后是「未测试」；配置落在数据目录，**reload 后还在**（DATA_KEYS 登记的真钉子）', async () => {
    const errs: string[] = []
    const page = await openLab(errs)
    await addProvider(page, 'https://api.example.com/v1')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })
    await page.waitForFunction(() => !!localStorage.getItem('modulo.__stubdoc.ai-settings.v1'), { timeout: 10000 })

    expect(await attr(page, '[data-provider]', 'data-provider')).toBeTruthy()
    expect(await attr(page, '[data-status]', 'data-status')).toBe('untested')
    expect(await text(page, '[data-provider-host]')).toBe('api.example.com')
    const doc = JSON.parse((await savedDoc(page)) ?? '{}') as { providers?: { baseUrl?: string; model?: string }[] }
    expect(doc.providers?.[0]).toMatchObject({ baseUrl: 'https://api.example.com/v1', model: 'gpt-4o-mini' })

    // reload：漏登记 DATA_KEYS 的症状就是"这里写着一条、重启后一条都不见了"
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
    await click(page, 'button.wide[title="外观设置"]')
    await page.waitForSelector('.panel .nav-item[data-group="lab"]', { timeout: 10000 })
    await click(page, '.panel .nav-item[data-group="lab"]')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })
    expect(await text(page, '[data-provider-host]')).toBe('api.example.com')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('点「测试连接」：探测通 → 可用；探测不通 → 连不上（状态不落盘，重启回未测试）', async () => {
    const errs: string[] = []
    const page = await openLab(errs)
    await addProvider(page, 'https://api.example.com/v1')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })

    await page.evaluate(() => ((window as unknown as { __STUB_AI_READY__: boolean }).__STUB_AI_READY__ = true))
    await click(page, '[data-ai-test]')
    await page.waitForFunction(() => document.querySelector('[data-status]')?.getAttribute('data-status') === 'ready', {
      timeout: 10000,
    })
    expect(await text(page, '[data-status]')).toContain('可用')

    await page.evaluate(() => ((window as unknown as { __STUB_AI_READY__: boolean }).__STUB_AI_READY__ = false))
    await click(page, '[data-ai-test]')
    await page.waitForFunction(() => document.querySelector('[data-status]')?.getAttribute('data-status') === 'down', {
      timeout: 10000,
    })
    expect(await text(page, '[data-status]')).toContain('连不上')
    expect(await calls(page)).toEqual(expect.arrayContaining([expect.objectContaining({ cmd: 'ai_providers' })]))
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('密钥：存完输入框清空、显示「已配置」；**配置文档与 localStorage 里都没有明文**；清除后回落未配置', async () => {
    const errs: string[] = []
    const page = await openLab(errs)
    await addProvider(page, 'https://api.example.com/v1')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })
    const id = (await attr(page, '[data-provider]', 'data-provider'))!
    const SECRET = 'sk-e2e-should-not-leak'

    await click(page, '[data-ai-key-open]')
    await page.waitForSelector('[data-ai-key]', { timeout: 10000 })
    await setValue(page, '[data-ai-key]', SECRET)
    await click(page, '[data-ai-key-save]')
    await page.waitForFunction(() => (document.querySelector('[data-key-state]')?.textContent ?? '').includes('已配置'), {
      timeout: 10000,
    })

    // 存完这条密钥的输入框**收起**（口令不回显）；再打开时是空的
    expect(await page.evaluate(() => !!document.querySelector('[data-ai-key]')), '存完输入框收起').toBe(false)
    await click(page, '[data-ai-key-open]')
    await page.waitForSelector('[data-ai-key]', { timeout: 10000 })
    expect(await page.evaluate(() => (document.querySelector('[data-ai-key]') as HTMLInputElement).value)).toBe('')
    await click(page, '[data-ai-key-open]')
    expect((await calls(page)).some((c) => c.cmd === 'ai_set_key' && c.args.providerId === id)).toBe(true)

    // 配置文档里没有明文 —— 这是 AC-09 那条的唯一机器钉子
    expect(await savedDoc(page)).not.toContain(SECRET)
    const leak = await page.evaluate((secret: string) => {
      const hits: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? ''
        if (k.startsWith('modulo.__stubai.key.')) continue // 凭据库（等价于 Windows 凭据管理器）
        if ((localStorage.getItem(k) ?? '').includes(secret)) hits.push(k)
      }
      return hits
    }, SECRET)
    expect(leak, '除凭据库那一格，任何存储里都不该有密钥明文').toEqual([])

    // 清除 → 回落「未配置」
    await click(page, '[data-ai-key-clear]')
    await page.waitForFunction(() => (document.querySelector('[data-key-state]')?.textContent ?? '').includes('未配置'), {
      timeout: 10000,
    })
    expect((await calls(page)).some((c) => c.cmd === 'ai_delete_key' && c.args.providerId === id)).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('删除要两步；**密钥删不掉就把这条留着**（别留凭据库孤儿）', async () => {
    const errs: string[] = []
    const page = await openLab(errs)
    await addProvider(page, 'https://api.example.com/v1')
    await page.waitForSelector('[data-provider]', { timeout: 10000 })
    const id = (await attr(page, '[data-provider]', 'data-provider'))!

    await click(page, '[data-ai-key-open]')
    await page.waitForSelector('[data-ai-key]', { timeout: 10000 })
    await setValue(page, '[data-ai-key]', 'sk-e2e-delete-me')
    await click(page, '[data-ai-key-save]')
    await page.waitForFunction(() => (document.querySelector('[data-key-state]')?.textContent ?? '').includes('已配置'), {
      timeout: 10000,
    })

    // 第一次点只是把按钮变成「确认删除」，条目还在
    await click(page, '[data-ai-delete]')
    expect(await text(page, '[data-ai-delete]')).toContain('确认删除')
    expect(await page.evaluate(() => !!document.querySelector('[data-provider]'))).toBe(true)

    // 凭据库拒绝（被锁 / 拒绝访问）：**配置必须留着**，并明说哪一步没成。
    // 这条才是「先删密钥再改文档」真正的后果 —— 顺序本身在 IPC 记账里量不准
    // （`write_doc` 走串行队列，永远排在同步的 invoke 之后），变异过：颠倒顺序那条断言照样绿。
    await page.evaluate(() => ((window as unknown as { __STUB_AI_DELETE_KEY_FAIL__: boolean }).__STUB_AI_DELETE_KEY_FAIL__ = true))
    await click(page, '[data-ai-delete]')
    await page.waitForFunction(
      () => (document.querySelector('[data-ai-notice]')?.textContent ?? '').includes('密钥没能从系统凭据库删掉'),
      { timeout: 15000 },
    )
    expect(await page.evaluate(() => !!document.querySelector('[data-provider]')), '删不掉密钥就不许删配置').toBe(true)
    expect(await savedDoc(page), '盘上那份也还在').toContain('https://api.example.com/v1')

    // 恢复后重来：两次点击删干净，密钥与配置一起没了
    await page.evaluate(() => ((window as unknown as { __STUB_AI_DELETE_KEY_FAIL__: boolean }).__STUB_AI_DELETE_KEY_FAIL__ = false))
    await click(page, '[data-ai-delete]')
    await click(page, '[data-ai-delete]')
    await page.waitForFunction(() => !document.querySelector('[data-provider]'), { timeout: 10000 })
    expect(await page.evaluate(() => !!document.querySelector('[data-ai-empty]'))).toBe(true)
    expect(await page.evaluate((k: string) => localStorage.getItem('modulo.__stubai.key.' + k), id)).toBeNull()
    expect(await savedDoc(page)).toBe(JSON.stringify({ providers: [] }))
    expect((await calls(page)).some((c) => c.cmd === 'ai_delete_key' && c.args.providerId === id)).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
