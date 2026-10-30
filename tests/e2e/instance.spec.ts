/**
 * F-01 阶段 2：同种卡多实例的**内容**各自独立 —— 便签打通全链（2026-10-28），
 * 待办接着做第二个字段（2026-10-29），倒数日 / 正计时收尾第三、四个字段（2026-10-30）。
 *
 * 阶段 1（#127）只分开了 **id**（第二张是 `sticky:2`），两个实例仍共享同一份内容：
 * 在第二张里打字，第一张跟着变。这一笔把内容也分开，判据抽在 `src/vue/instanceData.ts`
 * （纯判定，单测锁 100）—— 这里钉的是**组件那半**（判定层覆盖不到的地方）：
 *
 *   ① 两张卡能各自输入、互不干扰（这是阶段 1 的缺陷本身）；
 *   ② 刷新之后各自还在（写入落在对的那一份上，不是只在内存里对）；
 *   ③ 存储形状对：第一实例仍写顶层 `sticky` / `todos` / `countdown` / `elapsed`
 *      （**旧档形状逐字不变**），第二实例写 `byInstance['sticky:2']` /
 *      `byInstance['todo:2']` / `byInstance['countdown:2']` / `byInstance['elapsed:2']` ——
 *      这条断言让"到底写没写对地方"有机械证据，而不是只看界面上两个框里的字；
 *   ④ 待办额外一条：**按 id 定点的勾选不连坐**（两张里同名的一条，勾第二张不动第一张）。
 *   ⑤ 倒数日 / 正计时踩到一个 Vue 渲染时序的坑：点「设一个日子」切换编辑态后，不能在
 *      **同一个同步 evaluate** 里就查输入框 —— 重绘在微任务上才刷，查到的是空态那一帧。
 *      这两条用「先点 → 等一帧 → 再填」的两段 evaluate（详见 ARCHITECTURE §12.46）。
 *   ⑥ 记账（第五个字段，2026-10-31）形状多一层：顶层是 `ledger: { symbol, entries }`，
 *      按实例分的只是 **entries（条目）**，`symbol`（币种符号）仍留顶层 —— 它是偏好不是
 *      内容，两张账本共用一种货币（§12.48）。所以这里除了「各自记、刷新还在」，另钉两点：
 *      存储形状里切片**只有条目**（出现 `symbol` 就是写错了）；删一笔也按实例（第二张删掉
 *      唯一一条，第一张那笔还在）。另外记账的「记一笔」按钮在金额非法时是 `:disabled` 的，
 *      填完值不能在同一个同步块里就点 —— 渲染没刷，按钮还是灰的（同 ⑤ 的坑，两段 evaluate）。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('多实例内容（F-01 阶段 2）：两张卡各写各的（便签 / 待办 / 倒数日 / 正计时 / 记账）', () => {
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

  /**
   * 第三个字段：**倒数日**（2026-10-30）。
   *
   * 便签/待办钉的是"一串字 / 一张清单写对地方"，倒数日的形状不一样：一张卡只有**一条**
   * 设置（名字 + 日子），且模板里没有这张卡 —— 两张都从目录加，头一次见都是**空态**。
   * 所以这里钉这条路上特有的两个缝：
   *
   *   ① 空态点「设一个日子」进输入态、保存回到显示态 —— 三态切换读的是**自己那份**，
   *      少传一个 id 就会串到另一张的数据上（空态点开全是别人的名字）；
   *   ② 日子真的写进了对的那一份：两张设不同的日子，`.num`（还有几天）必须各算各的 ——
   *      `days` 是算出来的，不是存进去的原样回显，"显示对了"糊弄不过这条。
   */
  it('第二张倒数日有自己的日子：空态输入、刷新后各自还在，且存储形状对', async () => {
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

    /** 每张倒数日卡显示态的名字 / 大数字（空态和编辑态没这两个元素，给空串） */
    const cards = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.cell[data-module="countdown"]')].map((c) => ({
          label: c.querySelector('.label')?.textContent?.trim() ?? '',
          num: c.querySelector('.num')?.textContent?.trim() ?? '',
          cap: c.querySelector('.cap')?.textContent?.trim() ?? '',
        })),
      )
    const clickBar = (text: string) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
          (e) => (e.textContent || '').trim().includes(t),
        )
        b?.click()
        return !!b
      }, text)

    expect(await cards(), '出厂版面里没有倒数日卡（general 模板不含它）').toHaveLength(0)

    // 从目录加两张倒数日（菜单一.pick 就关，点第二张前要再开一次）
    expect(await clickBar('布局编辑'), '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)
    for (let n = 0; n < 2; n++) {
      await page.evaluate(() => void document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(350)
      // `.t` 里名字后面可能跟着「已在版面」小标（第二张起），所以用 startsWith 而不是 includes
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.querySelector('.t')?.textContent || '').trim().startsWith('倒数日'),
        )
        el?.click()
        return !!el
      })
      expect(added, `目录里应能点出第 ${n + 1} 张「倒数日」`).toBe(true)
      await wait(400)
    }
    await clickBar('保存')
    await wait(600)

    expect(await cards(), '工作台上有两张倒数日卡').toHaveLength(2)

    /**
     * 给第 i 张倒数日设值：空态先点 `.edit` 进输入态，再填名字 + 日子。
     * 两段 evaluate 之间必须等一帧 —— 点完 `editing` 翻 true，Vue 的重渲染是微任务，
     * 在同一个同步块里紧接着查输入框查到的还是空态那一帧（第一次写就栽在这上）。
     * v-model 挂在 input 事件上：只改 value 不派发，Vue 收不到（date 框顺手补一个
     * change，浏览器原生日期选择是 change 落值的，两条都派不会错）。
     */
    const setDay = async (i: number, label: string, date: string) => {
      const opened = await page.evaluate((i) => {
        const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="countdown"]')][i]
        cell?.querySelector<HTMLButtonElement>('.edit')?.click()
        return !!cell?.querySelector('.edit')
      }, i)
      expect(opened, `第 ${i + 1} 张空态应有「设一个日子」`).toBe(true)
      await wait(150)
      await page.evaluate(
        ({ i, label, date }) => {
          const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="countdown"]')][i]
          if (!cell) throw new Error(`找不到第 ${i + 1} 张倒数日卡`)
          const name = cell.querySelector<HTMLInputElement>('input.in[aria-label="倒数日名字"]')
          const day = cell.querySelector<HTMLInputElement>('input.in[type="date"][aria-label="目标日期"]')
          if (!name || !day) throw new Error(`第 ${i + 1} 张没进入编辑态`)
          name.value = label
          name.dispatchEvent(new Event('input', { bubbles: true }))
          day.value = date
          day.dispatchEvent(new Event('input', { bubbles: true }))
          day.dispatchEvent(new Event('change', { bubbles: true }))
          cell.querySelector<HTMLButtonElement>('.acts .primary')?.click()
          return true
        },
        { i, label, date },
      )
    }

    await setDay(0, '元旦', '2027-01-01')
    await wait(150)
    await setDay(1, '项目验收', '2026-12-01')
    await wait(500)

    const now = await cards()
    expect(now[0].label, '第一张是自己的名字').toBe('元旦')
    expect(now[0].cap, '第一张的日子也是自己那天的').toContain('1 月 1 日')
    expect(now[1].label, '第二张是自己的名字（不是跟着第一张变）').toBe('项目验收')
    expect(now[1].cap, '第二张的日子也是自己那天的').toContain('12 月 1 日')
    expect(now[1].num, '两张的「还有几天」各算各的（日子不同，数字必然不同）').not.toBe(now[0].num)

    // 刷新：写入必须落在对的那份上
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(800)
    const reloaded = await cards()
    expect(reloaded[0].label, '刷新后第一张还在').toBe('元旦')
    expect(reloaded[1].label, '刷新后第二张还在，且没被第一张顶掉').toBe('项目验收')

    // 存储形状：第一实例仍写顶层（旧档形状逐字不变），第二实例写 byInstance['countdown:2'].countdown
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    expect(stored.countdown, '第一张写在顶层，逐字是它自己的设置').toEqual({ label: '元旦', date: '2027-01-01' })
    expect(stored.byInstance?.['countdown:2']?.countdown, '第二张写在自己的切片里').toEqual({
      label: '项目验收',
      date: '2026-12-01',
    })

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await browser.close()
  })

  /**
   * 第四个字段：**正计时**（2026-10-30）。
   *
   * 与倒数日同一条判据、同一条写法，单列一条而不是合并：`.num` 的算法不同
   * （「还有几天」 vs 「第几天」），而且它没有「清空」按钮 —— 独立钉一遍「读自己的、
   * 写自己的、刷新还在」这三段，才知道 `writeElapsed` 那半没被 `countdown` 的测试顺手盖住。
   */
  it('第二张正计时有自己的起始日：空态输入、刷新后各自还在，且存储形状对', async () => {
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

    /** 每张正计时卡显示态的名字 / 「第几天」 */
    const cards = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.cell[data-module="elapsed"]')].map((c) => ({
          label: c.querySelector('.label')?.textContent?.trim() ?? '',
          num: c.querySelector('.num')?.textContent?.trim() ?? '',
        })),
      )
    const clickBar = (text: string) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
          (e) => (e.textContent || '').trim().includes(t),
        )
        b?.click()
        return !!b
      }, text)

    expect(await cards(), '出厂版面里没有正计时卡（general 模板不含它）').toHaveLength(0)

    expect(await clickBar('布局编辑'), '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)
    for (let n = 0; n < 2; n++) {
      await page.evaluate(() => void document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(350)
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.querySelector('.t')?.textContent || '').trim().startsWith('正计时'),
        )
        el?.click()
        return !!el
      })
      expect(added, `目录里应能点出第 ${n + 1} 张「正计时」`).toBe(true)
      await wait(400)
    }
    await clickBar('保存')
    await wait(600)

    expect(await cards(), '工作台上有两张正计时卡').toHaveLength(2)

    /** 给第 i 张正计时设值：与倒数日同一条（空态 → 编辑态 → 填名字 + 起始日 → 保存） */
    const setDay = async (i: number, label: string, date: string) => {
      const opened = await page.evaluate((i) => {
        const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="elapsed"]')][i]
        cell?.querySelector<HTMLButtonElement>('.edit')?.click()
        return !!cell?.querySelector('.edit')
      }, i)
      expect(opened, `第 ${i + 1} 张空态应有「设起始日」`).toBe(true)
      await wait(150)
      await page.evaluate(
        ({ i, label, date }) => {
          const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="elapsed"]')][i]
          if (!cell) throw new Error(`找不到第 ${i + 1} 张正计时卡`)
          const name = cell.querySelector<HTMLInputElement>('input.in[aria-label="正计时名字"]')
          const day = cell.querySelector<HTMLInputElement>('input.in[type="date"][aria-label="起始日期"]')
          if (!name || !day) throw new Error(`第 ${i + 1} 张没进入编辑态`)
          name.value = label
          name.dispatchEvent(new Event('input', { bubbles: true }))
          day.value = date
          day.dispatchEvent(new Event('input', { bubbles: true }))
          day.dispatchEvent(new Event('change', { bubbles: true }))
          cell.querySelector<HTMLButtonElement>('.acts .primary')?.click()
          return true
        },
        { i, label, date },
      )
    }

    await setDay(0, '开始戒糖', '2026-10-01')
    await wait(150)
    await setDay(1, '入职', '2026-01-01')
    await wait(500)

    const now = await cards()
    expect(now[0].label, '第一张是自己的名字').toBe('开始戒糖')
    expect(now[1].label, '第二张是自己的名字（不是跟着第一张变）').toBe('入职')
    // 「第几天」是从起始日算出来的：两张起始日不同，数字必然不同
    expect(now[0].num, '第一张是「第 N 天」').toMatch(/^第 \d+ 天$/)
    expect(now[1].num, '两张的「第几天」各算各的').not.toBe(now[0].num)

    // 刷新：写入必须落在对的那份上
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(800)
    const reloaded = await cards()
    expect(reloaded[0].label, '刷新后第一张还在').toBe('开始戒糖')
    expect(reloaded[1].label, '刷新后第二张还在，且没被第一张顶掉').toBe('入职')

    // 存储形状：第一实例仍写顶层，第二实例写 byInstance['elapsed:2'].elapsed
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    expect(stored.elapsed, '第一张写在顶层，逐字是它自己的设置').toEqual({ label: '开始戒糖', date: '2026-10-01' })
    expect(stored.byInstance?.['elapsed:2']?.elapsed, '第二张写在自己的切片里').toEqual({
      label: '入职',
      date: '2026-01-01',
    })

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await browser.close()
  })

  /**
   * 第五个字段：**记账**（2026-10-31）。
   *
   * 与前四个同一条判据，但记账的顶层形状是 `ledger: { symbol, entries }` —— 按实例分的
   * 只是 `entries`，`symbol` 留顶层共用（判据见 §12.48）。所以这条除了「各自记、刷新还在」，
   * 额外钉两点：① 存储形状里切片**只有条目**，出现 `symbol` 就是写错了地方；② 删一笔也
   * 按实例 —— `removeLedger` 的过滤器抄的是读出来的那份清单，读错份就删错份，这条单钉
   * （第二张里删掉唯一一条，第一张那笔还得在）。
   */
  it('第二张记账卡有自己的账：各自记一笔、删除不连坐、刷新后各自还在，且存储形状对', async () => {
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

    /** 每张记账卡的本月总额（`.num`）、笔数行（`.cap` 里「N 笔」）、空态提示（`.hint`） */
    const books = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.cell[data-module="ledger"]')].map((c) => ({
          total: c.querySelector('.num')?.textContent?.trim() ?? '',
          cap: c.querySelector('.cap')?.textContent?.trim() ?? '',
          hint: c.querySelector('.hint')?.textContent?.trim() ?? '',
        })),
      )
    const clickBar = (text: string) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
          (e) => (e.textContent || '').trim().includes(t),
        )
        b?.click()
        return !!b
      }, text)

    expect(await books(), '出厂版面里没有记账卡（general 模板不含它）').toHaveLength(0)

    // 从目录加两张记账（菜单一 pick 就关，点第二张前要再开一次）
    expect(await clickBar('布局编辑'), '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)
    for (let n = 0; n < 2; n++) {
      await page.evaluate(() => void document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(350)
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.querySelector('.t')?.textContent || '').trim().startsWith('记账'),
        )
        el?.click()
        return !!el
      })
      expect(added, `目录里应能点出第 ${n + 1} 张「记账」`).toBe(true)
      await wait(400)
    }
    await clickBar('保存')
    await wait(600)

    expect(await books(), '工作台上有两张记账卡').toHaveLength(2)

    /**
     * 给第 i 张记账卡记一笔：点空态「记一笔」出表单 → 填金额 + 备注 → 点「记一笔」提交。
     * 日期由组件自己取「今天」，所以两笔都落本月，`monthSummary`（monthOffset=0）必看得见。
     * **必须拆成两段**：提交按钮 `:disabled` 绑在金额合法性上，填完值 Vue 要等微任务才重渲染，
     * 同一个同步块里点下去按钮还是灰的（`.click()` 对 disabled 按钮不派发事件）。
     */
    const spend = async (i: number, amount: string, note: string) => {
      const opened = await page.evaluate((i) => {
        const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="ledger"]')][i]
        cell?.querySelector<HTMLButtonElement>('.edit[aria-label="记一笔"]')?.click()
        return !!cell
      }, i)
      expect(opened, `第 ${i + 1} 张空态应有「记一笔」`).toBe(true)
      await wait(150)
      await page.evaluate(
        ({ i, amount, note }) => {
          const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="ledger"]')][i]
          if (!cell) throw new Error(`找不到第 ${i + 1} 张记账卡`)
          const amt = cell.querySelector<HTMLInputElement>('input.in[aria-label="金额"]')
          const nte = cell.querySelector<HTMLInputElement>('input.in[aria-label="备注"]')
          if (!amt || !nte) throw new Error(`第 ${i + 1} 张没进入记账表单`)
          amt.value = amount
          amt.dispatchEvent(new Event('input', { bubbles: true }))
          nte.value = note
          nte.dispatchEvent(new Event('input', { bubbles: true }))
        },
        { i, amount, note },
      )
      await wait(150)
      await page.evaluate((i) => {
        const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="ledger"]')][i]
        cell?.querySelector<HTMLButtonElement>('.acts .primary')?.click()
      }, i)
    }

    await spend(0, '12.50', '第一张的午饭')
    await wait(150)
    await spend(1, '100', '第二张的晚饭')
    await wait(600) // 写盘防抖 300ms，等它落进 localStorage

    const now = await books()
    expect(now[0].total, '第一张只算自己这一笔').toBe('¥12.50')
    expect(now[1].total, '第二张只算自己这一笔（串账时两张都会是 ¥112.50）').toBe('¥100.00')
    expect(now[0].cap, '第一张是一笔').toContain('1 笔')
    expect(now[1].cap, '第二张也是一笔').toContain('1 笔')

    // 刷新：写入必须落在对的那份上
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(800)
    const reloaded = await books()
    expect(reloaded[0].total, '刷新后第一张还在').toBe('¥12.50')
    expect(reloaded[1].total, '刷新后第二张还在，且没被第一张顶掉').toBe('¥100.00')

    // 存储形状：第一实例写顶层 ledger.entries，第二实例写 byInstance['ledger:2'].ledger（只有条目）
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    expect(stored.ledger?.entries?.length, '顶层只多第一张那一笔').toBe(1)
    expect(stored.ledger?.entries?.[0]?.note).toBe('第一张的午饭')
    expect(stored.ledger?.symbol, '币种符号仍在顶层（旧档形状逐字不变）').toBe('¥')
    expect(stored.byInstance?.['ledger:2']?.ledger?.length, '第二张写在自己的切片里').toBe(1)
    expect(stored.byInstance?.['ledger:2']?.ledger?.[0]?.note).toBe('第二张的晚饭')
    expect('symbol' in (stored.byInstance?.['ledger:2'] ?? {}), '切片里不该出现币种符号').toBe(false)

    /**
     * 删除也按实例：删掉第二张唯一那一笔，第一张那笔不能跟着没。
     * `removeLedger` 的过滤器抄的是 `ledgerEntriesOf` 读出来的清单 —— 读错份就删错份。
     */
    const del = await page.evaluate(() => {
      const cell = [...document.querySelectorAll<HTMLElement>('.cell[data-module="ledger"]')][1]
      cell?.querySelector<HTMLButtonElement>('.rows .del')?.click()
      return !!cell
    })
    expect(del, '第二张应有明细行可删').toBe(true)
    await wait(600)
    const afterDel = await books()
    expect(afterDel[1].hint, '第二张回到空态（这个月还没记账）').toContain('这个月还没记账')
    expect(afterDel[0].total, '第一张那笔不受影响').toBe('¥12.50')

    const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.carddata.v1') ?? '{}'))
    expect(stored2.ledger?.entries?.length, '顶层那一笔还在').toBe(1)

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await browser.close()
  })
})
