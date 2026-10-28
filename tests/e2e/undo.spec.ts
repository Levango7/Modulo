/**
 * F-02 内容级撤销的**真浏览器**整链（2026-10-29）。
 *
 * 射程表里 F-02 那一列一直是空的。不是没人测，而是**每层**都测了、**接缝**没人测：
 * 单测在 `tests/vue/contentHistory.test.ts`（环形栈 / 500ms 合并窗口 / `suppress` 不入栈）
 * 与 `tests/vue/{undoRouting,useUndoRedo}.test.ts`（按时间戳路由、编辑态恒撤版面）里
 * 把决策层钉死了，下面三件事只有端到端问得出来：
 *
 *   ① **输入控件里不抢 Ctrl+Z**（`useGlobalKeys` 里 `isEditableTarget` 早退）。单测喂的是
 *      假事件对象，真键盘 + 真 `activeElement` 这条路径只有真浏览器有 —— 而且"没接住"
 *      不能只看"这一下没反应"（历史栈可能已经被消费掉了），所以第二条用例还要再
 *      **移出焦点按一次**，用它真的撤回了来反证前一下确实让给了浏览器；
 *   ② 删一条待办 → `Ctrl+Z` → `Ctrl+Shift+Z` 是跨五层的：全局键 → 路由 → 内容回填 →
 *      reactive 引用不重挂 → DOM。任何一层改坏，单测都还是绿的；
 *   ③ **撤销之后的落盘**：`contentHistory.apply()` 的整份回填是开着 `suppress` 做的
 *      （避免再次入栈），而落盘是 `cardData.ts` 自己那个 300ms 防抖 watch —— 两个 watch
 *      是分家的。"撤销完**不等**落盘窗口立刻刷新，撤销还在不在"只能端到端问。
 *
 * 产品代码**一行没改**：本笔只补覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
/** `vitest.e2e.setup.ts` 起 preview 后把端口塞进来；本机手动跑时退回 1430 */
const addr = () => process.env.MODULO_URL ?? 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 版面只上一张待办卡：别让出厂版面里其它卡的噪声进来 */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'todo', variant: 'panel', x: 0, y: 0, w: 4, h: 6 }],
}
/** 两条待办：删第一条、撤回来，条数与文本都能回读 */
const CARD = {
  todos: [
    { id: 'a1', text: '甲条目', done: false },
    { id: 'b1', text: '乙条目', done: false },
  ],
}
const SEL = '.cell[data-module="todo"]'

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

/** 读当前待办条目的文本（未完成那一段；本笔不勾完成，done 段恒为空） */
const texts = (page: Page) =>
  page.evaluate((sel) =>
    [...document.querySelectorAll<HTMLElement>(`${sel} ul.list:not(.done) li span`)].map(
      (s) => s.textContent?.trim() ?? '',
    ),
  SEL)

/**
 * 种版面与内容。**用 sessionStorage 打"只种一次"的标记**：`evaluateOnNewDocument`
 * 每次导航都会跑，直接写 localStorage 的话，后面"撤销完立刻刷新"那条量到的会是
 * 重新种回去的初始值，而不是撤销后的落盘值 —— 那条用例就白写了。
 * sessionStorage 是 per-tab 的，所以每条用例的新 page 都会重新种一遍，互相不污染。
 */
async function seed(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(
    (layout, data) => {
      if (sessionStorage.getItem('__undo_seeded')) return
      sessionStorage.setItem('__undo_seeded', '1')
      localStorage.setItem('modulo.template.v1', 'general')
      localStorage.setItem('modulo.layout.v1', layout)
      localStorage.setItem('modulo.carddata.v1', data)
    },
    JSON.stringify(DOC),
    JSON.stringify(CARD),
  )
  await page.goto(addr(), { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector(`${SEL} button.del`, { timeout: 15000 })
  await wait(500)
}

/** 点第一条待办的删除按钮（真点击，焦点随按钮走 —— 这正是撤销路由要判的 activeElement） */
const removeFirst = (page: Page) =>
  page.evaluate((sel) => {
    const b = document.querySelector<HTMLButtonElement>(`${sel} ul.list button.del`)
    b?.click()
    return !!b
  }, SEL)

/** 按热键前先 blur：焦点若留在刚被删掉的那个按钮上，测的就是"焦点在哪"而不是撤销 */
const blur = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body) el.blur?.()
  })

const pressUndo = async (page: Page) => {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
}
const pressRedo = async (page: Page) => {
  await page.keyboard.down('Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('z')
  await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
}

describe.skipIf(skip)('内容级撤销（F-02）：删掉的东西撤得回来', () => {
  it('删一条待办 → Ctrl+Z 回来 → Ctrl+Shift+Z 再删', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
    await seed(page)
    expect(await texts(page), '种进去两条待办').toEqual(['甲条目', '乙条目'])

    expect(await removeFirst(page), '待办卡上应有删除按钮').toBe(true)
    await wait(700) // 过 500ms 合并窗口：这一步要先真的入栈
    expect(await texts(page), '删完只剩一条').toEqual(['乙条目'])

    await blur(page)
    await pressUndo(page)
    await wait(300)
    expect(await texts(page), 'Ctrl+Z 把删掉的待办撤回来').toEqual(['甲条目', '乙条目'])

    await pressRedo(page)
    await wait(300)
    expect(await texts(page), 'Ctrl+Shift+Z 重做那次删除').toEqual(['乙条目'])

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await page.close()
  })

  it('焦点在输入控件里时 Ctrl+Z 让给浏览器：应用不接，历史栈也没被消费', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await seed(page)

    await removeFirst(page)
    await wait(700)
    expect(await texts(page), '前置：已删掉一条').toEqual(['乙条目'])

    // 焦点落进"添加待办"输入框：这里的 Ctrl+Z 是浏览器原生的，应用必须不抢
    const focused = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input.add')
      el?.focus()
      return document.activeElement === el
    })
    expect(focused, '待办卡的添加输入框应能拿到焦点').toBe(true)
    await page.keyboard.type('draft')
    await pressUndo(page)
    await wait(300)
    expect(await texts(page), '输入框里按 Ctrl+Z，应用级撤销不该发生').toEqual(['乙条目'])

    // 反证：移出焦点再按一次，必须还能撤回那次删除 —— 说明上面那一下真被让出去了，
    // 而不是"应用接住了但没生效"。只断言"没反应"是抓不到"历史被吃掉"的。
    await blur(page)
    await pressUndo(page)
    await wait(300)
    expect(await texts(page), '移出焦点后同一条历史还在，撤得回来').toEqual(['甲条目', '乙条目'])
    await page.close()
  })

  it('撤销完不等落盘窗口立刻刷新：撤销仍然在（回填与落盘是两个 watch）', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await seed(page)

    await removeFirst(page)
    await wait(700)
    expect(await texts(page), '前置：已删掉一条').toEqual(['乙条目'])

    await blur(page)
    await pressUndo(page)
    await wait(120) // 故意远小于 cardData 的 300ms 落盘窗口：刷新必须靠卸载时的 flush 兜住
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector(`${SEL} button.del`, { timeout: 15000 })
    await wait(500)

    expect(await texts(page), '撤销后的状态已经落盘（不是只在内存里撤回来了）').toEqual(['甲条目', '乙条目'])
    await page.close()
  })
})
