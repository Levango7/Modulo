/**
 * 提醒横幅（P0-④ 阶段 1）的可见链路：种子内容 → 启动对一次表 → 横幅出现 →「知道了」收起 →
 * 同一天刷新不再弹。
 *
 * 静默、去重、跨天、闰日这些在单测里穷举（`tests/vue/reminders.test.ts`，注入时钟）；
 * 这里只证一件事：**规则算出来之后真的被人看见**，而且"已提醒过"这条记录跟着刷新活下来
 * （网页版走 localStorage，桌面版的 hydrate 链在 `useReminders.test.ts` 里单独跑）。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('提醒横幅', () => {
  it('今天是倒数日 → 启动就有一条；点「知道了」收起，刷新不再弹', async () => {
    const url = process.env.MODULO_URL ?? 'http://localhost:1430'
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => {
      // ── 把 Date 钉死在本地 10:00（2026-10-25 补）────────────────────────────────
      // 这条用例此前**依赖"跑在白天"**：种子在**每次 document 加载**时用 `new Date()` 重算
      // 「今天」并种成倒数日，而去重集合是按天记的（`useReminders.ts:98`
      // `state.day === localDay(now) ? state.fired : []` —— 跨天即清空）。
      // 于是跨午夜跑到 `reload` 那一步就必红：新的一天 ⇒ 去重集合清空、种子又把倒数日
      // 种成"新今天" ⇒ 横幅照常再弹，而断言要的是「同一天不重复提醒」。
      //
      // 实测（不是设想）：PR #162 的 pull_request run 40144727922 在 **UTC 00:00:02**
      // 执行 reload 时红在这条断言上；同一提交的 push run 午夜前跑完，全绿。
      // **这不是产品缺陷** —— 产品语义就是"每天提醒一次"；是用例把当前时刻吃进了判据。
      //
      // 修法：钉住 Date（10:00 既不在午夜边上，也不落进任何默认静默时段），
      // 让「种子的今天」与「去重的今天」在整条用例里恒等。**判据一条没放宽**：
      // 横幅照样要出现、点「知道了」照样要收起、刷新后照样不许再弹。
      const FIXED = new Date(2026, 9, 24, 10, 0, 0, 0).getTime()
      const RealDate = Date
      // 用 Proxy 而不是"再造一个构造函数再改 prototype"：`prototype` 在类型上是只读的
      // （`vue-tsc` 会拦），而 Proxy 天然继承 `prototype` / `parse` / `UTC`，只覆盖
      // 无参 `new Date()` 与 `Date.now()` 两个入口 —— 带参构造原样透传。
      const Frozen = new Proxy(RealDate, {
        construct: (target, args: unknown[]) =>
          Reflect.construct(target, args.length ? args : [FIXED]),
        apply: () => new RealDate(FIXED).toString(),
        get: (target, prop, receiver) =>
          prop === 'now' ? () => FIXED : Reflect.get(target, prop, receiver),
      })
      ;(window as unknown as { Date: DateConstructor }).Date = Frozen

      localStorage.setItem('modulo.template.v1', 'general')
      const d = new Date()
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      localStorage.setItem('modulo.carddata.v1', JSON.stringify({ countdown: { label: '发布', date: day } }))
      // 静默时段写成 start === end = 关闭（默认 22:00–08:00 会让凌晨跑的本用例必然被压住 ——
      // 第一次跑 verify 正是凌晨，红得是对的，但那是"用例依赖了当前时刻"，不是坏行为）。
      // 不种提醒设置：默认就是"不静默"（start === end）。若以后有人把默认改成夜间静默，
      // 这条用例会在夜里红 —— 那是**应该**红：它说明用例开始依赖当前时刻了。
    })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    // 时钟真的钉住了才算这条修法生效 —— 否则上面整段就是装饰，而后面那条"同一天不重复提醒"
    // 依旧在看运气。判据用 `Date.now() === 构造出来的那个时刻`：冻结生效时两者恒等，
    // 没生效时右边是真实的那一毫秒、左边是现在（除了一毫秒的巧合，必然不等）。
    expect(
      await page.evaluate(() => Date.now() === new Date(2026, 9, 24, 10, 0, 0, 0).getTime()),
      '时钟没钉住（冻结没生效）',
    ).toBe(true)
    // 等横幅出现，而不是"睡 800ms 再看"：机器被别的活压满时固定睡眠会假红
    // （2026-10-21 本机第一次跑 verify 就是这样：其余 4 个 spec 也一起超时）。
    await page.waitForSelector('.reminder-strip', { timeout: 15000 })

    const text = await page.evaluate(() => document.querySelector('.reminder-strip')?.textContent?.trim() ?? '')
    expect(text).toContain('今天是「发布」')
    expect(text).toContain('倒数到站了')

    await page.evaluate(() => document.querySelector<HTMLButtonElement>('.reminder-strip .dismiss')?.click())
    await page.waitForFunction(() => !document.querySelector('.reminder-strip'), { timeout: 5000 })

    // 刷新：「已提醒过」记在盘上（localStorage），同一条不该再弹
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('.grid', { timeout: 15000 })
    await wait(1000)
    expect(await page.evaluate(() => !!document.querySelector('.reminder-strip')), '同一天不重复提醒').toBe(false)
    await browser.close()
  })
})
