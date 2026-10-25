/**
 * 模块库搜索（F-09，2026-10-26）：真实链路的端到端验证。
 *
 * 判定层 `src/vue/moduleFilter.ts` 有 10 条单测，但**组件层在本仓没有测试设施**
 * （没有 @vue/test-utils / jsdom）—— "输入框真接上了、过滤真生效、Esc 真能退"这三件事
 * 只有在这里能被钉住。
 *
 * 锁三件事：
 *   ① 输入即缩小范围，且**命中的是模块**（形态照旧全显示 —— 只留命中的那条形态会让人
 *      以为这张卡只有一种尺寸）；
 *   ② 无命中给**空态**，而不是"列表没变"让人以为搜坏了；
 *   ③ Esc 一层一层退：先收目录，再清搜索词。焦点在输入框里也要能退 ——
 *      `appKeyIntent` 对 Escape 不走 `isEditableTarget` 那道放行（`keyboard.ts` 的文件头规矩
 *      是"输入框里的按键一律放行"，而 Esc 是这条规矩的**有意例外**，否则编辑器里改着
 *      内容按 Esc 什么都退不掉）。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('模块库搜索：输入即缩小范围，无命中给空态，Esc 清词', () => {
  it('过滤 → 形态照旧全显示 → 空态 → Esc 恢复全量', async () => {
    url = process.env.MODULO_URL ?? url
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await wait(800)

    // 进编辑器（找不到按钮就抛 —— 静默失败会让后面一串断言在浏览态上瞎量）
    const entered = await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
      return !!b
    })
    expect(entered, '顶栏上应有「布局编辑」').toBe(true)
    await wait(500)

    const itemCount = () => page.evaluate(() => document.querySelectorAll('.lib-item').length)
    /** 某个模块条目下形态 chip 的条数（没找到该条目返回 -1） */
    const chipsOf = (title: string) =>
      page.evaluate((t) => {
        const item = [...document.querySelectorAll<HTMLElement>('.lib-item')].find((i) =>
          (i.querySelector('.lib-title')?.textContent || '').includes(t),
        )
        return item ? item.querySelectorAll('.chip').length : -1
      }, title)
    // v-model 挂在 input 事件上：直接改 value 不派发事件 Vue 收不到，
    // 那样后面所有断言都在"其实没搜"的页面上量 —— 与本项目反复踩过的静默失败同一族。
    const setQuery = (v: string) =>
      page.evaluate((s) => {
        const el = document.querySelector<HTMLInputElement>('.lib-search')
        if (!el) throw new Error('模块库里找不到搜索框 .lib-search')
        el.value = s
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, v)

    const baseline = await itemCount()
    expect(baseline, '模块库应有条目（注册表没加载出来时为 0）').toBeGreaterThan(10)

    // ① 输入即缩小范围：拿「时间」这个分组名 —— 命中范围里包含分组是刻意的
    await setQuery('时间')
    await wait(300)
    const narrowed = await itemCount()
    expect(narrowed, '「时间」应缩小范围（它是分组名，也算命中）').toBeGreaterThan(0)
    expect(narrowed).toBeLessThan(baseline)

    // ② 命中的是模块：形态照旧全显示（拿缩小后第一条的标题去全量里比对 chip 数）
    const firstTitle = await page.evaluate(
      () => document.querySelector('.lib-item .lib-title')?.textContent?.trim() ?? '',
    )
    expect(firstTitle, '过滤后应至少有一条').not.toBe('')
    const chipsFiltered = await chipsOf(firstTitle)
    await setQuery('')
    await wait(300)
    const chipsFull = await chipsOf(firstTitle)
    expect(chipsFiltered, `「${firstTitle}」过滤后形态数应与全量一致`).toBe(chipsFull)

    // ③ 无命中给空态
    await setQuery('zzz一定不存在的模块')
    await wait(300)
    expect(await itemCount(), '无命中应一条不剩').toBe(0)
    const muted = await page.evaluate(() =>
      [...document.querySelectorAll('.lib p')].map((e) => (e.textContent || '').trim()),
    )
    expect(
      muted.some((t) => t.includes('没有匹配')),
      `无命中要给出空态说明（实测到的是 ${JSON.stringify(muted)}）`,
    ).toBe(true)

    // ④ Esc 清词：焦点在输入框里也要能退
    await setQuery('时间')
    await wait(250)
    expect(await itemCount()).toBeLessThan(baseline)
    await page.focus('.lib-search')
    await page.keyboard.press('Escape')
    await wait(300)
    const afterEsc = await page.evaluate(
      () => document.querySelector<HTMLInputElement>('.lib-search')?.value ?? '',
    )
    expect(afterEsc, 'Esc 应清掉搜索词').toBe('')
    expect(await itemCount(), 'Esc 之后应恢复全量').toBe(baseline)

    await browser.close()
  })
})
