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

it.skipIf(skip)('外观设置页：换皮肤会持久化，换强调色会写进 --accent，Esc 可关', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const skinAttr = () => page.evaluate(() => document.documentElement.dataset.skin)
  const clickText = (t: string) =>
    page.evaluate((label) => {
      const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === label)
      el?.click()
      return !!el
    }, t)

  expect(await skinAttr()).toBe('ink')
  expect(await clickText('外观')).toBe(true)
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => !!document.querySelector('[role=dialog]'))).toBe(true)

  expect(
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-skin-option=candy]')
      el?.click()
      return !!el
    }),
  ).toBe(true)
  await new Promise((r) => setTimeout(r, 200))
  expect(await skinAttr()).toBe('candy')

  await page.evaluate(() => {
    ;[...document.querySelectorAll<HTMLElement>('.swatch')].find((e) => e.getAttribute('title') === '靛蓝')?.click()
  })
  await new Promise((r) => setTimeout(r, 200))
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),
  ).toBe('#5b5bf5')

  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 400))
  expect(await skinAttr()).toBe('candy')
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),
  ).toBe('#5b5bf5')

  await clickText('外观')
  await new Promise((r) => setTimeout(r, 200))
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))
  expect(await page.evaluate(() => !!document.querySelector('[role=dialog]'))).toBe(false)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('键盘补完：空格选入、移动后焦点不丢、删除后焦点落到最近卡片', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  await enterEditor(page)
  const label = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.slice(0, 2) ?? null)
  const selectedCount = () => page.evaluate(() => document.querySelectorAll('.cell.selected').length)

  await page.evaluate(() => document.querySelector<HTMLElement>('.cell')?.focus())
  expect(await label()).toBeTruthy()
  await page.keyboard.press('Space')
  await new Promise((r) => setTimeout(r, 250))
  expect(await selectedCount()).toBe(1)
  await page.keyboard.press('Space')
  await new Promise((r) => setTimeout(r, 250))
  expect(await selectedCount()).toBe(0)

  const focused = await label()
  await page.keyboard.press('ArrowRight')
  await new Promise((r) => setTimeout(r, 250))
  expect(await label()).toBe(focused)

  const cellsBefore = await page.evaluate(() => document.querySelectorAll('.cell').length)
  await page.keyboard.press('Delete')
  await new Promise((r) => setTimeout(r, 350))
  expect(await page.evaluate(() => document.querySelectorAll('.cell').length)).toBe(cellsBefore - 1)
  expect(await page.evaluate(() => document.activeElement?.classList.contains('cell'))).toBe(true)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('设置面板焦点陷阱：Tab 不跑出去，关闭后焦点回到触发按钮', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))
  const activeRole = () => page.evaluate(() => document.activeElement?.getAttribute('role') ?? null)

  // 必须用真实点击：程序化 .click() 不会把焦点给按钮，陷阱记录的"上一个焦点"就还是 body
  await page.click('button[title="外观设置"]')
  await new Promise((r) => setTimeout(r, 300))
  expect(await activeRole()).toBe('dialog')

  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    expect(await inDialog(), `第 ${i + 1} 次 Tab 后焦点跑出面板`).toBe(true)
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('Shift')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Shift')
    expect(await inDialog(), `第 ${i + 1} 次 Shift+Tab 后焦点跑出面板`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => !!document.querySelector('[role=dialog]'))).toBe(false)
  expect(
    await page.evaluate(() => (document.activeElement?.textContent || '').trim()),
  ).toBe('外观')
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('版面方案：另存为 → 改版面 → 应用旧方案可回到原坐标，改名与删除生效', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const snap = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.grid .cell')]
        .map((c) => {
          const s = getComputedStyle(c)
          return `${c.getAttribute('aria-label')?.slice(0, 2)}@${s.gridColumnStart}/${s.gridRowStart}`
        })
        .sort()
        .join(' '),
    )
  const press = (label: string) =>
    page.evaluate((text) => {
      const el = [...document.querySelectorAll<HTMLElement>('button')].find((e) => (e.textContent || '').trim() === text)
      el?.click()
      return !!el
    }, label)

  await page.click('button[title="外观设置"]')
  await new Promise((r) => setTimeout(r, 300))
  await page.type('input[placeholder="方案名称"]', '方案甲')
  expect(await press('另存为')).toBe(true)
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => (localStorage.getItem('modulo.schemes.v1') || '').includes('方案甲'))).toBe(true)

  const original = await snap()
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))
  await press('撑满')
  await new Promise((r) => setTimeout(r, 400))
  expect(await snap()).not.toBe(original)

  await page.click('button[title="外观设置"]')
  await new Promise((r) => setTimeout(r, 300))
  await page.type('input[placeholder="方案名称"]', '方案乙')
  await press('另存为')
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => document.querySelectorAll('.schemes li').length)).toBe(2)

  const applied = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.schemes li')].find((l) => l.textContent?.includes('方案甲'))
    const btn = [...li!.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent || '').trim() === '应用')
    btn?.click()
    return !!btn
  })
  expect(applied).toBe(true)
  await new Promise((r) => setTimeout(r, 400))
  expect(await snap()).toBe(original)

  const renamed = await page.evaluate(() => {
    const li = [...document.querySelectorAll('.schemes li')].find((l) => l.textContent?.includes('方案乙'))
    ;[...li!.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent || '').trim() === '改名')?.click()
    return true
  })
  expect(renamed).toBe(true)
  await new Promise((r) => setTimeout(r, 200))
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('.schemes li input')!
    input.value = '改过的名字'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await press('存')
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => !![...document.querySelectorAll('.schemes li')].find((l) => l.textContent?.includes('改过的名字')))).toBe(true)

  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.schemes li')][0]
    ;[...li.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent || '').trim() === '删除')?.click()
  })
  await new Promise((r) => setTimeout(r, 300))
  expect(await page.evaluate(() => document.querySelectorAll('.schemes li').length)).toBe(1)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('收紧：按内容降低过高的卡片且不裁切内容，可一步撤销', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const probe = () =>
    page.evaluate(() => {
      const cell = document.querySelector<HTMLElement>('.grid .cell[data-module="todo"]')!
      const body = cell.querySelector<HTMLElement>('.card-body')!
      const span = Number(/span\s+(\d+)/i.exec(cell.style.gridRow)?.[1] ?? 0)
      const kids = [...body.children] as HTMLElement[]
      const rects = kids.map((k) => k.getBoundingClientRect())
      const need = rects.length ? Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)) : 0
      return { span, overflow: Math.round(body.scrollHeight - body.clientHeight), need: Math.round(need) }
    })

  const before = await probe()
  expect(before.span).toBeGreaterThanOrEqual(5)
  await page.evaluate(() => {
    ;[...document.querySelectorAll<HTMLElement>('button')].find((e) => (e.textContent || '').trim() === '收紧')?.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  const after = await probe()
  expect(after.span).toBeLessThan(before.span)
  expect(after.overflow).toBeLessThanOrEqual(2)
  expect(after.need).toBeGreaterThan(0)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await new Promise((r) => setTimeout(r, 400))
  expect((await probe()).span).toBe(before.span)
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
