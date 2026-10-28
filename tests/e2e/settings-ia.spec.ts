/**
 * F-10 设置分组 + 首启向导的 E2E（设计稿 `docs/design/F-10-SETTINGS-IA.md`）。
 *
 * 补的是哪一格：分组表与引导判据都有单测（`tests/vue/settingsNav.test.ts` / `onboarding.test.ts`），
 * 但"七组真点得开、网页版真少两组（桌面 / 实验室）、向导真能跳过且不再弹、关于里真能重播"这四件事
 * 只有组件层能证 —— 本仓没有组件测试设施（无 @vue/test-utils / jsdom），所以归 E2E。
 *
 * 桌面形态走 `tauri-stub.js`（`isDesktop` 由 `__TAURI_INTERNALS__` 决定，桌面组只在那时出现）；
 * 网页形态不注桩。**首启那几条不种 `modulo.template.v1`** —— `firstRun` 的判据是
 * 「版面为空且没挑过模板」，种了模板就等于替用户选过了，向导反而不该弹。
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

/** 种一张待办卡：非首启（版面非空）用；首启那几条不种 */
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

interface OpenOpts {
  /** 桌面形态（注桩） */
  desktop?: boolean
  /** 种一张待办卡（= 非首启）。默认 true */
  seeded?: boolean
  /** 预置一份 `modulo.onboarding.v1`（桌面形态落在 `__stubdoc.` 前缀下） */
  onboarding?: string
}

async function open(opts: OpenOpts = {}, errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (src: string | null, docJson: string | null, onb: string | null) => {
      if (src) new Function(src)()
      if (docJson) localStorage.setItem('modulo.layout.v1', docJson)
      if (onb) localStorage.setItem('modulo.onboarding.v1', onb)
    },
    opts.desktop === false ? null : STUB_SOURCE,
    opts.seeded === false ? null : JSON.stringify(DOC),
    opts.onboarding ?? null,
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
  return page
}

const openSettings = async (page: Page): Promise<void> => {
  await page.click('button.wide[title="外观设置"]')
  await page.waitForSelector('.panel .nav-item', { timeout: 10000 })
}

const navTitles = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('.panel .nav-item')].map((b) => (b.textContent ?? '').trim()))

const clickGroup = async (page: Page, id: string): Promise<void> => {
  await page.click(`.panel .nav-item[data-group="${id}"]`)
  await page.waitForFunction(
    (g: string) => document.querySelector(`.panel .nav-item[data-group="${g}"]`)?.getAttribute('data-active') === 'true',
    { timeout: 10000 },
    id,
  )
}

const groupText = (page: Page): Promise<string> =>
  page.evaluate(() => ((document.querySelector('.panel .group') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim())

const has = (page: Page, sel: string): Promise<boolean> => page.evaluate((s: string) => !!document.querySelector(s), sel)

/** 桌面形态的盘：桩把 `write_doc` 落到这个前缀 */
const disk = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((k: string) => localStorage.getItem('modulo.__stubdoc.' + k), key)

describe.skipIf(skip)('F-10 设置分组（桌面形态）', () => {
  it('侧栏七组按固定顺序排列，逐个点开都渲染出该组的内容', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await openSettings(page)

    expect(await navTitles(page)).toEqual(['外观', '版面与方案', '数据', '提醒', '桌面', '实验室', '关于'])

    // 外观：三张皮肤卡
    await clickGroup(page, 'appearance')
    expect(await page.evaluate(() => document.querySelectorAll('.panel .skin').length)).toBe(3)
    expect(await groupText(page)).toContain('强调色')

    // 版面与方案：模板入口 + 方案册
    await clickGroup(page, 'layout')
    expect(await has(page, '.panel [data-open-templates]')).toBe(true)
    expect(await groupText(page)).toContain('版面模板')

    // 数据：备份 + 同步 + 数据目录
    await clickGroup(page, 'data')
    const data = await groupText(page)
    expect(data).toContain('多端同步')
    expect(await has(page, '.panel .auto')).toBe(true)

    // 提醒：三个时间输入
    await clickGroup(page, 'reminders')
    expect(await page.evaluate(() => document.querySelectorAll('.panel .group input[type="time"]').length)).toBe(3)

    // 桌面：托盘开关 + 快捷键（桩给了两条）
    await clickGroup(page, 'desktop')
    expect(await groupText(page)).toContain('收进托盘')
    expect(await page.evaluate(() => document.querySelectorAll('.panel .keys li').length)).toBe(2)

    // 实验室（F-12）：AI 模型服务的配置入口 —— 空态那句要真渲染出来
    await clickGroup(page, 'lab')
    expect(await groupText(page)).toContain('AI 模型服务')
    expect(await has(page, '.panel [data-ai-empty], .panel [data-provider]')).toBe(true)

    // 关于：版本 + 重播引导
    await clickGroup(page, 'about')
    expect(await has(page, '.panel [data-replay-onboarding]')).toBe(true)
    expect(await groupText(page)).toContain('首启引导')

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('Esc 关面板；「挑一种排法」先关设置再开模板选择器（两个遮罩不叠）', async () => {
    const errs: string[] = []
    const page = await open({}, errs)
    await openSettings(page)

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.panel .nav-item'), { timeout: 10000 })

    await openSettings(page)
    await clickGroup(page, 'layout')
    await page.click('.panel [data-open-templates]')
    await page.waitForFunction(
      () => !!document.querySelector('.scrim') && !document.querySelector('.panel .nav-item'),
      { timeout: 10000 },
    )
    // 模板选择器自己那套标记：至少能看到模板名
    expect(await page.evaluate(() => (document.body.innerText ?? '').includes('通用'))).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})

describe.skipIf(skip)('F-10 设置分组（网页形态）', () => {
  it('网页版五组：没有「桌面」与「实验室」，其余顺序不变', async () => {
    const errs: string[] = []
    const page = await open({ desktop: false }, errs)
    await openSettings(page)

    const titles = await navTitles(page)
    expect(titles).toEqual(['外观', '版面与方案', '数据', '提醒', '关于'])
    expect(titles).not.toContain('桌面')
    // 也不该有那两个按钮（藏起来 ≠ 没渲染）—— 网页版没有 Rust 出口，也没有凭据库
    expect(await has(page, '.panel .nav-item[data-group="desktop"]')).toBe(false)
    expect(await has(page, '.panel .nav-item[data-group="lab"]')).toBe(false)
    expect(titles).not.toContain('实验室')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})

describe.skipIf(skip)('F-10 首启向导（桌面形态）', () => {
  it('真首启弹向导：选版面 → 选外观 → 开始用，落盘 done 且版面真的换了', async () => {
    const errs: string[] = []
    const page = await open({ seeded: false }, errs)
    await page.waitForSelector('.wizard', { timeout: 15000 })
    expect(await page.evaluate(() => (document.querySelector('.wizard')?.textContent ?? ''))).toContain('第 1 步 / 共 3 步')

    // 第 1 步：挑「专注」那张（不点任何门也能过，但点了就要真生效）
    await page.click('.wizard .tpl[data-tpl="focus"]')
    await page.click('.wizard [data-next="layout"]')

    // 第 2 步：换皮肤
    await page.waitForSelector('.wizard .skin', { timeout: 10000 })
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.wizard .skin')].find((b) => (b.textContent ?? '').includes('墨纸'))
      ;(btn as HTMLElement).click()
    })
    await page.click('.wizard [data-next="look"]')

    // 第 3 步：三条事实 + 开始用
    await page.waitForSelector('.wizard .facts li', { timeout: 10000 })
    expect(await page.evaluate(() => document.querySelectorAll('.wizard .facts li').length)).toBeGreaterThanOrEqual(3)
    await page.click('.wizard [data-next="ready"]')
    await page.waitForFunction(() => !document.querySelector('.wizard'), { timeout: 10000 })

    // 落盘：done=true / skipped=false
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.onboarding.v1') ?? '').includes('"done":true'),
      { timeout: 15000 },
    )
    const saved = JSON.parse((await disk(page, 'modulo.onboarding.v1')) ?? '{}') as { done?: boolean; skipped?: boolean }
    expect(saved).toMatchObject({ done: true, skipped: false })

    // 版面真的换了：模板记录落进数据目录（桌面形态走 write_doc，见 disk() 的注释）
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.template.v1') ?? '') === 'focus',
      { timeout: 15000 },
    )
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('跳过也落盘（done + skipped），而且**只靠这个标记**就不再弹 —— 引导不许变成 nag', async () => {
    const errs: string[] = []
    // 网页形态：盘就是普通 localStorage，才能把"版面清空"也一起控住，
    // 从而单独证明"不再弹"是 done 起的效，而不是"版面非空，firstRun 顺带变假了"。
    const page = await open({ desktop: false, seeded: false }, errs)
    await page.waitForSelector('.wizard', { timeout: 15000 })

    await page.click('.wizard [data-skip]')
    await page.waitForFunction(() => !document.querySelector('.wizard'), { timeout: 10000 })
    const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('modulo.onboarding.v1'))) ?? '{}') as {
      done?: boolean
      skipped?: boolean
    }
    expect(saved).toMatchObject({ done: true, skipped: true })

    // 再让它"像真首启"：清空版面与模板记录后再刷 —— 只有 done 能挡住这次
    await page.evaluateOnNewDocument(() => {
      localStorage.removeItem('modulo.layout.v1')
      localStorage.removeItem('modulo.template.v1')
    })
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
    await new Promise((r) => setTimeout(r, 400))
    expect(await has(page, '.wizard'), '看过了就不该再弹（哪怕版面又被清空）').toBe(false)

    // 反样本：把那个标记也删掉 —— 同一个页面、同一个空版面，向导必须回来。
    // 没有这一半，"不弹"也可能只是因为 firstRun 恰好是假。
    await page.evaluateOnNewDocument(() => {
      localStorage.removeItem('modulo.layout.v1')
      localStorage.removeItem('modulo.template.v1')
      localStorage.removeItem('modulo.onboarding.v1')
    })
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('.wizard', { timeout: 15000 })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('老用户（版面非空 / 挑过模板）一次都不弹', async () => {
    const errs: string[] = []
    const page = await open({ seeded: true, onboarding: '{"done":false,"skipped":false,"at":null}' }, errs)
    await new Promise((r) => setTimeout(r, 400))
    expect(await has(page, '.wizard')).toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('「设置 → 关于 → 重新播放首启引导」立刻再开，且盘上 done 放回 false', async () => {
    const errs: string[] = []
    // 老用户 + 已经看过引导：默认不弹，但可以手动重播
    const page = await open(
      { seeded: true, onboarding: '{"done":true,"skipped":true,"at":1761600000000}' },
      errs,
    )
    await openSettings(page)
    await clickGroup(page, 'about')
    const about = await groupText(page)
    expect(about, '关于组要说清这台机器上的引导状态').toContain('跳过过')

    await page.click('.panel [data-replay-onboarding]')
    await page.waitForSelector('.wizard', { timeout: 10000 })
    expect(await page.evaluate(() => (document.querySelector('.wizard')?.textContent ?? ''))).toContain('第 1 步 / 共 3 步')
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.onboarding.v1') ?? '').includes('"done":false'),
      { timeout: 15000 },
    )
    expect(JSON.parse((await disk(page, 'modulo.onboarding.v1')) ?? '{}')).toMatchObject({ done: false, skipped: true })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
