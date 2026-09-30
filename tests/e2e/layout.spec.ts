import { existsSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

let browser: Browser
let url: string

function chromePath(): string | undefined {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p as string))
}

const EXE = chromePath()

async function freshPage(width: number, height: number): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 500))
  return page
}

const snapshot = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cell')]
      .map((c) => {
        const s = getComputedStyle(c)
        return `${c.getAttribute('aria-label')?.slice(0, 2)}@${s.gridColumnStart}/${s.gridRowStart}`
      })
      .sort()
      .join(' | '),
  )

async function enterEditor(page: Page) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '布局编辑')?.click()
  })
  await new Promise((r) => setTimeout(r, 500))
}

const skip = !EXE
beforeAll(async () => {
  if (!EXE) return
  url = process.env.MODULO_URL ?? 'http://localhost:1430'
  browser = await puppeteer.launch({ executablePath: EXE as string, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
})
afterAll(async () => {
  if (!EXE) return
  await browser?.close()
})

it.skipIf(skip)('三档视口：不溢出、不裁字、列数符合断点表', async () => {
  const cases = [
    { w: 1440, cols: 12 },
    { w: 720, cols: 4 },
    { w: 390, cols: 1 },
  ]
  for (const c of cases) {
    const page = await freshPage(c.w, 900)
    const m = await page.evaluate(() => {
      const grid = document.querySelector('.grid')
      const texts = [...document.querySelectorAll('.cell *')].filter(
        (e) => e.children.length === 0 && (e.textContent || '').trim(),
      )
      return {
        cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        clipped: texts.filter((e) => e.scrollWidth - e.clientWidth > 2).length,
        minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
      }
    })
    expect(m.cols, `${c.w}px 列数`).toBe(c.cols)
    expect(m.hScroll, `${c.w}px 横向溢出`).toBe(false)
    expect(m.clipped, `${c.w}px 文字被裁`).toBe(0)
    expect(m.minFont, `${c.w}px 最小字号`).toBeGreaterThanOrEqual(11)
    await page.close()
  }
})

it.skipIf(skip)('编辑器键盘可达：格子可聚焦且方向键生效（x-hub 实测为 0 个）', async () => {
  const page = await freshPage(1440, 900)
  await enterEditor(page)
  expect(await page.evaluate(() => document.querySelectorAll('.cell[tabindex="0"]').length)).toBeGreaterThan(0)
  await page.evaluate(() => document.querySelector<HTMLElement>('.cell')?.focus())
  const before = await snapshot(page)
  await page.keyboard.press('ArrowRight')
  await new Promise((r) => setTimeout(r, 300))
  expect(await snapshot(page)).not.toBe(before)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 300))
  expect(await snapshot(page)).toBe(before)
  await page.close()
})

it.skipIf(skip)('框选 → 成组拖拽 → Ctrl+Z 整体回退', async () => {
  const page = await freshPage(1440, 900)
  await enterEditor(page)
  const box = await page.evaluate(() => {
    const q = document.querySelector('.canvas')!.getBoundingClientRect()
    return { x: q.x, y: q.y, w: q.width, h: q.height }
  })
  await page.mouse.move(box.x + 4, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.6, box.y + 4, { steps: 6 })
  await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.55, { steps: 6 })
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 300))
  const selected = await page.evaluate(() => document.querySelectorAll('.cell.selected').length)
  expect(selected).toBeGreaterThan(1)

  const anchor = await page.evaluate(() => {
    const q = document.querySelector('.cell.selected')!.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + 10 }
  })
  const before = await snapshot(page)
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(anchor.x + 60, anchor.y + 110, { steps: 8 })
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 300))
  expect(await snapshot(page)).not.toBe(before)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 300))
  expect(await snapshot(page)).toBe(before)
  await page.close()
})

it.skipIf(skip)('整理：聚拢空洞且不报错，可一步撤销', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  /** 行轨是 1fr 会撑满视口，像素高度测不出聚拢效果，改数行轨数量 */
  const rowCount = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.grid')!).gridTemplateRows.split(' ').length)
  const before = await rowCount()
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '整理')?.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  const after = await rowCount()
  expect(after).toBeLessThan(before)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 400))
  expect(await rowCount()).toBe(before)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('撑满：首行带铺满整行宽度，可一步撤销', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  /** 首行带的覆盖宽度占比（不是右边缘 —— 空洞可能在中间） */
  const bandCoverage = () =>
    page.evaluate(() => {
      const g = document.querySelector('.grid')!.getBoundingClientRect()
      const cells = [...document.querySelectorAll('.grid .cell')].filter(
        (c) => Math.abs(c.getBoundingClientRect().top - g.top) < 4,
      )
      const sum = cells.reduce((s, c) => s + c.getBoundingClientRect().width, 0)
      return Math.round((sum / g.width) * 100) / 100
    })
  const before = await bandCoverage()
  expect(before).toBeLessThan(0.8)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '撑满')?.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  expect(await bandCoverage()).toBeGreaterThan(0.97)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 400))
  expect(await bandCoverage()).toBe(before)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('窄屏编辑器自动切堆叠模式，不给出挤成一团的画布', async () => {
  const page = await freshPage(390, 844)
  await enterEditor(page)
  const m = await page.evaluate(() => ({ canvas: !!document.querySelector('.canvas'), stack: !!document.querySelector('.stack') }))
  expect(m.canvas).toBe(false)
  expect(m.stack).toBe(true)
  await page.close()
})

it.skipIf(skip)('拖拽与缩放全程无 console 报错', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  await enterEditor(page)
  const grip = await page.evaluate(() => {
    const q = document.querySelectorAll('.cell')[0].getBoundingClientRect()
    const g = document.querySelector('.cell .grip')!.getBoundingClientRect()
    return { x: g.x + 4, y: g.y + 4, w: q.width }
  })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x + 80, grip.y + 60, { steps: 8 })
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 400))
  expect(errs).toEqual([])
  await page.close()
})
