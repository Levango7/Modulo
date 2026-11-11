/**
 * F-15 P0：**冷启动默认视图**的钉子（2026-11-12）。
 *
 * P0 把产品从「带聊天功能的看板」改成「对话为主轴的 agent 应用」——最外显的一笔就是
 * `view` 的初值从 `workbench` 变成了 `chat`。这是一个**没人拦就会悄悄改回去**的默认值：
 *   · 改回去不会有单测红（`view` 是内存态，没有落盘存档可断言）；
 *   · 老 E2E 也不会红 —— 它们的前提已经被逐条改成"显式先切工作台"（见 `chrome.ts`）。
 * 所以这里单独钉三条：
 *   ① 冷启动就是 chat，右栏产物里能看到版面；
 *   ② 切回工作台，右栏让位、版面回到主区（默认值变了，工作台本身没坏）；
 *   ③ 桌面形态下右栏宽度/视图从存档读回（`DATA_KEYS` 登记的钉子：漏登记 = 拖完重启回到 420）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const launch = (): Promise<Browser> =>
  puppeteer.launch({
    executablePath: EXE!,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
  })

/** 网页形态：没有 Tauri，chat 视图给的是诚实占位；产物面板两边都在 */
const openWeb = async (): Promise<{ browser: Browser; page: Page }> => {
  const browser = await launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
  await page.goto(process.env.MODULO_URL ?? 'http://localhost:1430', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  })
  await wait(600)
  return { browser, page }
}

const count = (page: Page, sel: string): Promise<number> =>
  page.evaluate((s) => document.querySelectorAll(s).length, sel)

describe.skipIf(skip)('F-15 P0：对话是主轴', () => {
  it('冷启动就是 chat 视图，右栏产物里看得到版面', async () => {
    const { browser, page } = await openWeb()
    try {
      // ① 主轴是对话：`data-chat-mode` 那一行在，工作台的主区不在
      expect(await count(page, '[data-chat-mode]'), '冷启动就是 chat 视图').toBe(1)
      expect(await count(page, '.stage > .grid'), '工作台主区不该同时在场').toBe(0)

      // ② 右栏在场，且默认是「版面」这一格 —— 产物不是可选项，是主轴的另一半
      expect(await count(page, '[data-artifact-panel]'), '右栏产物面板默认展开').toBe(1)
      expect(
        await page.$eval('[data-artifact-panel]', (el) => el.getAttribute('data-view')),
        '默认看版面',
      ).toBe('layout')
      expect(await count(page, '[data-artifact-body] .grid .cell'), '右栏里画的是同一份版面').toBe(5)

      // ③ 顶栏那枚开关是「已展开」态（折叠之后没有它就回不来）
      expect(
        await page.$eval('[data-toggle-artifact]', (el) => el.getAttribute('aria-pressed')),
        '产物开关反映真实状态',
      ).toBe('true')
    } finally {
      await browser.close()
    }
  })

  it('切回工作台：右栏让位、版面回到主区（默认值变了，工作台没坏）', async () => {
    const { browser, page } = await openWeb()
    try {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-mode="workbench"]')?.click())
      await page.waitForFunction(
        () => document.querySelector('button[data-mode="workbench"]')?.getAttribute('data-active') === 'true',
        { timeout: 10000 },
      )
      await wait(300)
      expect(await count(page, '[data-chat-mode]'), '对话那一行退场').toBe(0)
      expect(await count(page, '[data-artifact-panel]'), '右栏只在 chat 视图里').toBe(0)
      expect(await count(page, '.stage > .grid .cell'), '版面回到主区，还是 5 张').toBe(5)
    } finally {
      await browser.close()
    }
  })

  it('桌面形态：右栏宽度与视图从存档读回（DATA_KEYS 登记的钉子）', async () => {
    const browser = await launch()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      await page.evaluateOnNewDocument(
        (src: string, art: string) => {
          // 先装桩（让 `isDesktop` 为真、存储走 `DATA_KEYS` 那条通道），再写种子
          new Function(src)()
          localStorage.setItem('modulo.template.v1', 'general')
          localStorage.setItem('modulo.__stubdoc.modulo.artifactpanel.v1', art)
        },
        STUB_SOURCE,
        JSON.stringify({ width: 600, collapsed: false, view: 'stack' }),
      )
      await page.goto(process.env.MODULO_URL ?? 'http://localhost:1430', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })
      await page.waitForSelector('[data-artifact-panel]', { timeout: 15000 })
      await wait(600)

      const width = await page.$eval('[data-artifact-panel]', (el) => Math.round(el.getBoundingClientRect().width))
      expect(width, '宽度读回 600（漏登记 DATA_KEYS 会退回 420）').toBe(600)
      expect(
        await page.$eval('[data-artifact-panel]', (el) => el.getAttribute('data-view')),
        '视图读回堆叠',
      ).toBe('stack')
    } finally {
      await browser.close()
    }
  })
})
