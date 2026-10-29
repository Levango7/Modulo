/**
 * F-01 阶段 2：同种卡多实例的**内容**各自独立 —— 便签打通全链（2026-10-28），
 * 待办接着做第二个字段（2026-10-29）。
 *
 * 阶段 1（#127）只分开了 **id**（第二张是 `sticky:2`），两个实例仍共享同一份内容：
 * 在第二张里打字，第一张跟着变。这一笔把内容也分开，判据抽在 `src/vue/instanceData.ts`
 * （纯判定，单测锁 100）—— 这里钉的是**组件那半**（判定层覆盖不到的地方）：
 *
 *   ① 两张卡能各自输入、互不干扰（这是阶段 1 的缺陷本身）；
 *   ② 刷新之后各自还在（写入落在对的那一份上，不是只在内存里对）；
 *   ③ 存储形状对：第一实例仍写顶层 `sticky` / `todos`（**旧档形状逐字不变**），
 *      第二实例写 `byInstance['sticky:2']` / `byInstance['todo:2']` —— 这条断言让
 *      "到底写没写对地方"有机械证据，而不是只看界面上两个框里的字；
 *   ④ 待办额外一条：**按 id 定点的勾选不连坐**（两张里同名的一条，勾第二张不动第一张）。
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

  /**
   * 第二个字段：**待办**（2026-10-29）。
   *
   * 便签那条钉的是"一个字符串写对地方"，待办多出两条路径 —— 勾选与删除都是**按 id 定点**的，
   * 而 id 只在自己那份清单里唯一。所以这里除了"各自加、各自还在"，还断言：在第二张里勾一条
   * **不会**把第一张里同名的那条也勾上（这条在单测里由 `cardData-actions.test.ts` 守着，
   * 这里补的是"组件真的把两个 id 传到 API 上了"—— 少传一个 id，单测全绿、界面全错）。
   */
  it('第二张待办卡有自己的清单：各自加、勾选不连坐、刷新后各自还在，且存储形状对', async () => {
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

    /** 每张待办卡的**未完成**清单（`.done` 那张已完成列表不算） */
    const lists = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.cell[data-module="todo"]')].map((cell) =>
          [...cell.querySelectorAll<HTMLElement>('ul.list:not(.done) li span')].map((s) => (s.textContent || '').trim()),
        ),
      )
    const clickBar = (text: string) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
          (e) => (e.textContent || '').trim().includes(t),
        )
        b?.click()
        return !!b
      }, text)

    expect(await lists(), '出厂版面里有一张待办卡').toHaveLength(1)

    expect(await clickBar('布局编辑'), '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)
    await page.evaluate(() => void document.querySelector<HTMLElement>('.add-cat')?.click())
    await wait(350)
    // `.t` 里除了名字还可能跟着「已在版面」那个小标（已放置的模块照样能再点一张），
    // 所以用 startsWith：`includes('待办')` 会先撞上目录里的「四象限待办」。
    const added = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.querySelector('.t')?.textContent || '').trim().startsWith('待办'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应能再点一张「待办」').toBe(true)
    await wait(400)
    await clickBar('保存')
    await wait(600)

    expect(await lists(), '工作台上有两张待办卡').toHaveLength(2)

    /** 往第 i 张待办卡里加一条：v-model 挂在 input 事件上，只按键不派发 input 收不到 */
    const addItem = (i: number, text: string) =>
      page.evaluate(
        ({ i, text }) => {
          const input = [...document.querySelectorAll<HTMLInputElement>('.cell[data-module="todo"] input.add')][i]
          if (!input) throw new Error(`找不到第 ${i + 1} 张待办卡的输入框`)
          input.value = text
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        },
        { i, text },
      )

    await addItem(0, '两张都叫这条')
    await wait(150)
    await addItem(1, '两张都叫这条')
    await wait(400)
    await addItem(1, '只有第二张有')
    await wait(500)

    let now = await lists()
    expect(now[0].filter((t) => t === '两张都叫这条'), '第一张里只有它自己加的那条').toHaveLength(1)
    expect(now[0], '第二张的东西不该出现在第一张里').not.toContain('只有第二张有')
    expect(now[1].filter((t) => t === '两张都叫这条'), '第二张里也只有一条（没被写两遍）').toHaveLength(1)
    expect(now[1]).toContain('只有第二张有')

    // 勾掉第二张里那条**同名**的：第一张里同名的那条不能跟着变灰
    const toggled = await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>('.cell[data-module="todo"]')]
      const li = [...(cells[1]?.querySelectorAll<HTMLLIElement>('ul.list:not(.done) li') ?? [])].find((x) =>
        (x.textContent || '').includes('只有第二张有'),
      )
      const box = li?.querySelector<HTMLInputElement>('input[type=checkbox]')
      box?.click()
      return !!box
    })
    expect(toggled, '第二张里应有那条待办的勾选框').toBe(true)
    await wait(400)
    now = await lists()
    expect(now[1], '勾掉的从第二张的未完成清单里消失').not.toContain('只有第二张有')
    expect(now[0], '第一张里同名的那条还在未完成清单里（没被连坐勾掉）').toContain('两张都叫这条')

    // 刷新：写入必须落在对的那份上
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(800)
    const reloaded = await lists()
    expect(reloaded[0], '刷新后第一张的东西还在').toContain('两张都叫这条')
    expect(reloaded[0], '刷新后第二张的东西没跑到第一张里').not.toContain('只有第二张有')
    expect(reloaded[1], '刷新后第二张那条仍在已完成里（所以未完成清单里没有它）').not.toContain('只有第二张有')

    // 存储形状：第一实例仍写顶层，第二实例写 byInstance['todo:2'].todos
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    const mine = (stored.byInstance?.['todo:2']?.todos ?? []) as { text: string; done: boolean }[]
    expect(mine.map((t) => t.text), '第二张的清单里就是它自己那两条').toEqual(['两张都叫这条', '只有第二张有'])
    expect(mine.find((t) => t.text === '只有第二张有')?.done, '勾选状态也落盘了').toBe(true)
    expect(
      (stored.todos as { text: string }[]).map((t) => t.text),
      '顶层（第一实例）不该出现第二张的任何一条',
    ).not.toContain('只有第二张有')

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await browser.close()
  })
})
