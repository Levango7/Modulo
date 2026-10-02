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
  // 预置"已经挑过模板"：否则首启会自动弹选择器，挡住下面这些要真点鼠标的测试。
  // 首启行为本身另有专门一条测试覆盖（"首启：自动弹一次模板选择器"）。
  await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
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

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

const clickTool = (page: Page, label: string) =>
  page.evaluate((t) => {
    ;[...document.querySelectorAll<HTMLElement>('button')].find((e) => (e.textContent || '').trim() === t)?.click()
  }, label)

/** 数行轨数量：行轨是 1fr 会撑满视口，像素高度测不出聚拢效果 */
const rowCount = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('.grid')!).gridTemplateRows.split(' ').length)

/** 从渲染出的网格反算"已用矩形里有多少空格子"（CSS grid 线是 1 基） */
const layoutStats = (page: Page) =>
  page.evaluate(() => {
    /**
     * 终点线不能直接 Number()：GridLayout 写的是 `grid-column: x / span w`，
     * 计算值回来是 'span 5' 这种字符串，Number 得到 NaN，整块统计就静默变成"0 空洞"
     * —— 守卫自己先撒谎，比没有守卫更糟。
     */
    const endLine = (raw: string, start: number) => {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
      const span = /span\s+(\d+)/i.exec(raw)
      return start + (span ? Number(span[1]) : 1)
    }
    const cells = [...document.querySelectorAll<HTMLElement>('.grid .cell')]
      .map((c) => {
        const s = getComputedStyle(c)
        const c1 = Number(s.gridColumnStart)
        const r1 = Number(s.gridRowStart)
        return { c1, c2: endLine(s.gridColumnEnd, c1), r1, r2: endLine(s.gridRowEnd, r1) }
      })
      .filter((c) => Number.isFinite(c.c1) && Number.isFinite(c.r1))
    const cols = Math.max(...cells.map((c) => c.c2)) - 1
    const rows = Math.max(...cells.map((c) => c.r2)) - 1
    const occ = new Set<string>()
    for (const c of cells) for (let r = c.r1; r < c.r2; r++) for (let x = c.c1; x < c.c2; x++) occ.add(`${x},${r}`)
    let holes = 0
    for (let r = 1; r <= rows; r++) for (let x = 1; x <= cols; x++) if (!occ.has(`${x},${r}`)) holes++
    return { cols, rows, holes, cells: cells.length }
  })

/** 首行带（顶边与网格齐平的那些卡）横向覆盖了多大比例 */
const bandCoverage = (page: Page) =>
  page.evaluate(() => {
    const g = document.querySelector('.grid')!.getBoundingClientRect()
    const cells = [...document.querySelectorAll('.grid .cell')].filter(
      (c) => Math.abs(c.getBoundingClientRect().top - g.top) < 4,
    )
    const sum = cells.reduce((s, c) => s + c.getBoundingClientRect().width, 0)
    return Math.round((sum / g.width) * 100) / 100
  })

/**
 * 带指定版面进页面。整理/撑满这两条用它**自己喂一份乱版面**当夹具，
 * 而不是依赖出厂版面的缺陷 —— 出厂版面修成 0 空洞之后，"靠默认的中缝来证明整理有效"
 * 那种断言就永远空转了（这正是这一轮踩到的）。夹具就用旧版那份真实出厂坐标。
 */
async function freshPageWithDoc(width: number, height: number, doc: unknown): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument((d: string) => localStorage.setItem('modulo.layout.v1', d), JSON.stringify(doc))
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await settle(500)
  return page
}

/** 2026-10-03 之前的出厂版面：clock/todo 之间空 4 列，y7、y8 两整行全空 */
const SLOPPY_DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [
    { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3 },
    { id: 'todo', variant: 'list', x: 8, y: 0, w: 4, h: 6 },
    { id: 'sticky', variant: 'note', x: 0, y: 3, w: 2, h: 3 },
    { id: 'notes', variant: 'overview', x: 2, y: 3, w: 4, h: 4 },
    { id: 'recent', variant: 'bar', x: 0, y: 9, w: 12, h: 2 },
  ],
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

    /** 固定行高模型：行轨是 px，卡片高度 = span*rowPx + (span-1)*gap；不再被 1fr 拉伸 */
    const rows = await page.evaluate(() => {
      const grid = document.querySelector('.grid')!
      const track = parseFloat(getComputedStyle(grid).gridTemplateRows.split(' ')[0])
      const cells = [...document.querySelectorAll<HTMLElement>('.grid .cell')]
      const spans = cells.map((el) => {
        const span = Number(/span\s+(\d+)/i.exec(el.style.gridRow)?.[1] ?? 0)
        return Math.abs(el.getBoundingClientRect().height - (span * track + (span - 1) * 16))
      })
      const stage = document.querySelector('.stage')!
      return {
        trackPx: track,
        maxErr: Math.max(...spans),
        scrollable: stage.scrollHeight > stage.clientHeight + 1,
      }
    })
    expect(Number.isFinite(rows.trackPx), '行轨应为固定 px').toBe(true)
    expect(rows.trackPx).toBeGreaterThanOrEqual(48)
    expect(rows.maxErr, '卡片高度应等于 span 个固定行 + 间距').toBeLessThanOrEqual(1.5)
    if (c.w === 390) expect(rows.scrollable, '窄屏内容超出时应由页面滚动承接').toBe(true)
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
  /**
   * 拖得远一点：起步版面现在排得是满的，落点只要还压着别的卡，`moveMany` 就会整组拒绝
   * （这是设计行为 —— 成组移动不做"挤开"，所以必须一路拖到内容下方那片真空区）。
   */
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  await page.mouse.move(anchor.x + 40, anchor.y + 520, { steps: 12 })
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

it.skipIf(skip)('整理：把喂进去的乱版面聚回 0 空洞，可一步撤销', async () => {
  const page = await freshPageWithDoc(1440, 900, SLOPPY_DOC)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))

  const before = await layoutStats(page)
  expect(before.holes, '夹具本身就该带空洞（就是旧版出厂那份）').toBeGreaterThan(20)
  const rowsBefore = await rowCount(page)

  await clickTool(page, '整理')
  await settle()
  const after = await layoutStats(page)
  /**
   * 整理只负责"往上+往左聚拢"，消不掉横向中缝（那是撑满的活，§10.5 记着这条边界），
   * 所以这里断言的是"空洞变少、总行数变小、且没有制造新的重叠"，不是 0 空洞。
   */
  expect(after.holes, '整理应收掉一部分空洞').toBeLessThan(before.holes)
  expect(after.rows, '整理不该把版面变高').toBeLessThan(before.rows)
  expect(await rowCount(page)).toBeLessThan(rowsBefore)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await settle()
  expect(await layoutStats(page), '一步撤销应回到乱版面').toEqual(before)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('撑满：首行带从缺角铺到满行，可一步撤销', async () => {
  const page = await freshPageWithDoc(1440, 900, SLOPPY_DOC)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))

  const before = await bandCoverage(page)
  expect(before, '夹具的首行带该有明显中缝').toBeLessThan(0.8)

  await clickTool(page, '撑满')
  await settle()
  expect(await bandCoverage(page)).toBeGreaterThan(0.97)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await settle()
  expect(await bandCoverage(page)).toBe(before)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('出厂版面：首行带铺满且整屏不留空洞', async () => {
  const page = await freshPage(1440, 900)
  const stats = await layoutStats(page)
  expect(stats.cells).toBe(5)
  expect(stats.holes, '起步版面不留空洞').toBe(0)
  expect(await bandCoverage(page), '起步版面首行带应铺满').toBeGreaterThan(0.97)
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
  /**
   * 用乱版面当底座，而不是在出厂版面上按「撑满」指望它变 —— 旧写法又一次是在
   * 蹭"出厂排得松"的红利：起步版面一旦已经铺满，撑满就是恒等操作，这条断言会静默失效。
   */
  const page = await freshPageWithDoc(1440, 900, SLOPPY_DOC)
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
  await press('整理')
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

  /** 收紧只改 span、整理才把空行合掉：两个动作正交，组合起来才减少总行数 */
  const rowsBefore = await rowCount(page)
  await clickTool(page, '收紧')
  await settle(300)
  await clickTool(page, '整理')
  await settle()
  expect(await rowCount(page)).toBeLessThan(rowsBefore)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('紧凑：一键等于收紧+整理，两步可分别撤销', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const before = await rowCount(page)
  await clickTool(page, '紧凑')
  await settle(500)
  const after = await rowCount(page)
  expect(after).toBeLessThan(before)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await settle(300)
  const mid = await rowCount(page)
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await settle(300)
  // 两步历史：第一次撤销退回整理（行数可能不变），第二次必须回到起点
  expect(mid).toBeGreaterThanOrEqual(after)
  expect(await rowCount(page)).toBe(before)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('版面模板：点一张卡片就换版面，Esc 关闭不动，可一步撤销', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const general = await snapshot(page)

  await clickTool(page, '版面模板')
  await settle()
  expect(await page.evaluate(() => document.querySelectorAll('.picker .card').length), '模板卡片数量').toBeGreaterThanOrEqual(4)
  /** 每张卡都得画出迷你示意 —— 选择器靠形状说话，没图的卡片等于没写文案 */
  expect(
    await page.evaluate(() => [...document.querySelectorAll('.picker .mini')].every((m) => m.children.length > 0)),
    '每张模板卡都要有迷你示意',
  ).toBe(true)

  await page.keyboard.press('Escape')
  await settle()
  expect(await page.evaluate(() => !!document.querySelector('.picker')), 'Esc 应关掉选择器').toBe(false)
  expect(await snapshot(page), '只是关掉选择器，版面一格都不该动').toBe(general)

  await clickTool(page, '版面模板')
  await settle()
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll<HTMLElement>('.picker .card')].find((b) => b.textContent?.includes('极简专注'))
    btn?.click()
  })
  await settle()
  expect(await snapshot(page), '换成「极简专注」后版面应该不同').not.toBe(general)
  expect(await page.evaluate(() => document.querySelectorAll('.grid .cell').length), '极简专注只 3 张卡').toBe(3)
  expect(await page.evaluate(() => !!document.querySelector('.picker')), '选完要收掉').toBe(false)

  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await settle()
  expect(await snapshot(page), '换模板可一步撤销').toBe(general)
  expect(errs).toEqual([])
  await page.close()
})

it.skipIf(skip)('首启：自动弹一次模板选择器，挑过之后刷新就不再拦', async () => {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await settle(700)
  expect(await page.evaluate(() => !!document.querySelector('.picker[role="dialog"]')), '没有存档时首启应自动出选择器').toBe(true)

  await page.evaluate(() => {
    ;[...document.querySelectorAll<HTMLElement>('.picker .card')].find((b) => b.textContent?.includes('通用'))?.click()
  })
  await settle(600)
  await page.reload({ waitUntil: 'networkidle2' })
  await settle(700)
  expect(await page.evaluate(() => !!document.querySelector('.picker')), '挑过一次就不该再拦第二次').toBe(false)
  await ctx.close()
})

it.skipIf(skip)('拖动帧率实测：连拖期间的帧距中位数 ≤ 18.2ms（§8 第 3 条，不许估）', async () => {
  const page = await freshPage(1440, 900)
  await enterEditor(page)
  /** rAF 采样器：记录每一帧的时间戳，拖动结束后算帧距分布。中位数比平均值抗抖。 */
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] }
    w.__frames = []
    const tick = (t: number) => {
      w.__frames.push(t)
      if (w.__frames.length < 400) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const anchor = await page.evaluate(() => {
    const q = document.querySelector('.cell')!.getBoundingClientRect()
    return { x: q.x + q.width / 2, y: q.y + 10 }
  })
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.down()
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(anchor.x + (i % 2 ? 90 : -90), anchor.y + i * 4, { steps: 2 })
  }
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 300))

  const s = await page.evaluate(() => {
    const f = (window as unknown as { __frames: number[] }).__frames
    const d: number[] = []
    for (let i = 1; i < f.length; i++) {
      // 同一帧派发多次回调时时间戳会重复，0 差值不是真帧距，丢掉（高刷屏上尤其关键）
      if (f[i] > f[i - 1]) d.push(f[i] - f[i - 1])
    }
    d.sort((a, b) => a - b)
    const q = (p: number) => d[Math.min(d.length - 1, Math.floor(d.length * p))]
    return { frames: d.length, median: q(0.5), p95: q(0.95) }
  })
  /** headless 的 rAF 节奏本身就未必稳，样本太少时这条断言没有意义，先要求采到足够帧 */
  console.log(`[拖动帧距实测] frames=${s.frames} median=${s.median.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms`)
  expect(s.frames, 'rAF 采样帧数').toBeGreaterThan(40)
  expect(s.median, `帧距中位数 ${s.median.toFixed(1)}ms（p95 ${s.p95.toFixed(1)}ms）`).toBeLessThanOrEqual(18.2)
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

it.skipIf(skip)('方案册：新建空白可撤销，键盘与拖拽都能排序并跨重启保留', async () => {
  const page = await freshPage(1440, 900)
  const errs: string[] = []
  page.on('pageerror', (e: unknown) => errs.push(String(e)))
  const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms))
  const press = (label: string) =>
    page.evaluate((text) => {
      const el = [...document.querySelectorAll<HTMLElement>('button')].find((e) => (e.textContent || '').trim() === text)
      el?.click()
      return !!el
    }, label)
  const names = () =>
    page.evaluate(() => [...document.querySelectorAll('.schemes li strong')].map((s) => s.textContent?.trim()))
  const cellCount = () => page.evaluate(() => document.querySelectorAll('.grid .cell').length)

  await page.click('button[title="外观设置"]')
  await wait()
  await page.type('input[placeholder="方案名称"]', '甲')
  expect(await press('另存为')).toBe(true)
  await wait()
  await page.type('input[placeholder="方案名称"]', '从零')
  expect(await press('新建空白')).toBe(true)
  await wait(400)

  expect(await names()).toEqual(['从零', '甲'])
  expect(await cellCount()).toBe(0)
  expect(await page.evaluate(() => !!document.querySelector('.stage .empty'))).toBe(true)

  // 新建空白会顺手清空工作台，必须能一步退回来。
  // 先关面板：焦点还在「方案名称」输入框里时 Ctrl+Z 会按设计让给原生文本编辑。
  await page.keyboard.press('Escape')
  await wait(200)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyZ')
  await page.keyboard.up('Control')
  await wait(400)
  expect(await cellCount()).toBeGreaterThan(0)

  await page.click('button[title="外观设置"]')
  await wait()
  await page.focus('.schemes li')
  await page.keyboard.down('Alt')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Alt')
  await wait(400)
  expect(await names()).toEqual(['甲', '从零'])

  // HTML5 拖放：处理器只认组件内部记的 id，所以合成 DragEvent 就够
  await page.evaluate(() => {
    const items = document.querySelectorAll<HTMLElement>('.schemes li')
    const dt = new DataTransfer()
    items[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    items[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
    items[1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
  })
  await wait(400)
  expect(await names()).toEqual(['从零', '甲'])

  await page.reload({ waitUntil: 'networkidle2' })
  await wait(500)
  await page.click('button[title="外观设置"]')
  await wait()
  expect(await names()).toEqual(['从零', '甲'])
  expect(errs).toEqual([])
  await page.close()
})
