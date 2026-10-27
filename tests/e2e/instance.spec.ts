/**
 * F-01 阶段 2（2026-10-28）：同种卡多实例的**内容**各自独立 —— 先用便签打通全链。
 *
 * 阶段 1（#127）只分开了 **id**（第二张是 `sticky:2`），两个实例仍共享同一份内容：
 * 在第二张里打字，第一张跟着变。这一笔把内容也分开，判据抽在 `src/vue/instanceData.ts`
 * （纯判定，单测锁 100）—— 这里钉的是**组件那半**（判定层覆盖不到的地方）：
 *
 *   ① 两张便签能各自输入、互不干扰（这是阶段 1 的缺陷本身）；
 *   ② 刷新之后各自还在（写入落在对的那一份上，不是只在内存里对）；
 *   ③ 存储形状对：第一实例仍写顶层 `sticky`（**旧档形状逐字不变**），
 *      第二实例写 `byInstance['sticky:2']` —— 这条断言让"到底写没写对地方"有机械证据，
 *      而不是只看界面上两个框里的字。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('多实例内容（F-01 阶段 2）：两张便签各写各的', () => {
  it('第二张便签有自己的正文，刷新后各自还在，且存储形状对', async () => {
    url = process.env.MODULO_URL ?? url
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
    await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await wait(800)

    // `data-module` 是**模块** id：两张便签都叫 sticky —— 这个选择器本笔一行没改，
    // 它同时证明"多开没有动既有 DOM 契约"（E2E 里其它断言都压在它上面）。
    const pads = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLTextAreaElement>('.cell[data-module="sticky"] textarea')].map((t) => t.value),
      )
    const clickBar = (text: string) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
          (e) => (e.textContent || '').trim().includes(t),
        )
        b?.click()
        return !!b
      }, text)

    expect(await pads(), '出厂版面里有一张便签').toHaveLength(1)

    // 进编辑器，从「全部卡片」目录里再加一张便签（多开之后目录不再过滤已放置的模块）
    expect(await clickBar('布局编辑'), '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)
    const opened = await page.evaluate(() => {
      document.querySelector<HTMLElement>('.add-cat')?.click()
      return !!document.querySelector('.add-cat')
    })
    expect(opened, '编辑器里应有「全部卡片」入口').toBe(true)
    await wait(350)
    // 菜单是点开之后才渲染的：同一个 evaluate 里点完就查，查的是"还没渲染"的那一帧
    const added = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.querySelector('.t')?.textContent || '').includes('便签'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应能再点一张「便签」').toBe(true)
    await wait(400)
    await clickBar('保存')
    await wait(600)

    const two = await pads()
    expect(two, '工作台上有两张便签').toHaveLength(2)

    /** v-model 挂在 input 事件上：只改 value 不派发，Vue 收不到 —— 后面一串断言就都在"其实没输入"的页面上量 */
    const setPad = (i: number, v: string) =>
      page.evaluate(
        ({ i, text }) => {
          const ta = [...document.querySelectorAll<HTMLTextAreaElement>('.cell[data-module="sticky"] textarea')][i]
          if (!ta) throw new Error(`找不到第 ${i + 1} 张便签的输入框`)
          ta.value = text
          ta.dispatchEvent(new Event('input', { bubbles: true }))
        },
        { i, text: v },
      )

    await setPad(0, '第一张写的')
    await wait(120)
    await setPad(1, '第二张写的')
    await wait(500)

    const after = await pads()
    expect(after[0], '第一张是自己的正文').toBe('第一张写的')
    expect(after[1], '第二张是自己的正文（阶段 1 里它会跟着第一张变）').toBe('第二张写的')

    // 刷新：写入必须落在对的那一份上，而不是只在内存里对
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(800)
    const reloaded = await pads()
    expect(reloaded[0], '刷新后第一张还在').toBe('第一张写的')
    expect(reloaded[1], '刷新后第二张还在，且没被第一张顶掉').toBe('第二张写的')

    // 存储形状：第一实例仍写顶层（旧档形状逐字不变），第二实例写 byInstance
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    expect(stored.sticky).toBe('第一张写的')
    expect(stored.byInstance?.['sticky:2']?.sticky).toBe('第二张写的')

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await browser.close()
  })
})
