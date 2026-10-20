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
