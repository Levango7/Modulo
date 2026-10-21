/**
 * 速达卡（2026-10-13 批 4）：真实链路的端到端验证。
 *
 * 锁两件事（都是"这张卡敢让人点下去"的前提）：
 *   ① **输入端的形状边界**：裸命令名（`explorer.exe` 这类）被拒并说明原因 ——
 *      不把"打开"变成"执行任意命令"；
 *   ② **网页版如实降级**：点了只列不打开（写明"网页版不能打开本机程序"），
 *      不静默、不假装成功。
 * 真打开由 Rust 单测（shape_ok / describe_code）与桌面真机验收覆盖。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('速达卡：输入边界与网页版降级', () => {
  it('加卡 → 裸命令名被拒 → 合法路径进名单 → 网页版点击只列不打开', async () => {
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

    // 进编辑器加「速达」并回工作台
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
    })
    await wait(500)
    await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
    await wait(300)
    const added = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.textContent || '').includes('速达'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应有「速达」').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(500)
    expect(await page.evaluate(() => !!document.querySelector('.lcard')), '工作台上出现速达卡').toBe(true)

    // 打开添加 → 填裸命令名 → 应被拒且写明边界
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.lcard button')].find((x) =>
        (x.textContent || '').includes('添加'),
      )
      el?.click()
    })
    await wait(200)
    const submitWith = async (value: string) => {
      await page.evaluate((v: string) => {
        const input = document.querySelector<HTMLInputElement>('.lcard .ladd .linput')
        if (!input) return
        input.value = v
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector<HTMLButtonElement>('.lcard .lok')?.click()
      }, value)
      await wait(250)
    }
    await submitWith('explorer.exe')
    const rejected = await page.evaluate(() => document.querySelector('.lcard .lerr')?.textContent?.trim() ?? '')
    expect(rejected, '裸命令名应被拒且写明边界').toContain('只收 http(s) 链接或绝对路径')

    // 换合法路径 → 进名单（落进 cardData，跟着备份走）
    await submitWith('C:\\Windows\\System32\\notepad.exe')
    // 写入有 ≤300ms 防抖（cardData 的 schedule）：**等条件**，不按固定 sleep 猜。
    await page.waitForFunction(
      () =>
        (JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { launch?: { target: string }[] }).launch?.some(
          (x) => x.target === 'C:\\Windows\\System32\\notepad.exe',
        ) ?? false,
      { timeout: 5000 },
    )
    const after = await page.evaluate(() => {
      const stored = (JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as {
        launch?: { target: string; label: string }[]
      }).launch ?? []
      return { stored, items: document.querySelectorAll('.lcard .litem').length }
    })
    expect(after.stored.map((x) => x.target), '速达名单落进 cardData').toContain('C:\\Windows\\System32\\notepad.exe')
    expect(after.items, '卡上出现条目').toBeGreaterThanOrEqual(1)

    // 网页版点击：只列不打开，写明原因
    await page.evaluate(() => document.querySelector<HTMLElement>('.lcard .litem')?.click())
    await wait(300)
    const notice = await page.evaluate(() => document.querySelector('.lcard .lfoot .lerr')?.textContent?.trim() ?? '')
    expect(notice, '网页版点击应如实说明').toContain('网页版不能打开本机程序')

    await browser.close()
  })
})
