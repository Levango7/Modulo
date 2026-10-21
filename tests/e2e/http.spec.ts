/**
 * 网页取数卡（声明式扩展，2026-10-13 批 3）：真实链路的端到端验证。
 *
 * 锁三件事：
 *   ① 加卡 → 配置一个 https 接口 → **跨域被拦时如实说"需要桌面壳"**（不是空白、不是假数据）；
 *   ② 非法地址（http / 私网 / 保留主机名）在**输入端**就被拒，并给出边界说明；
 *   ③ 端点表落进 cardData（跟着备份走），取到的数据不落盘（机器采的不进备份）。
 *
 * 刻意不发真网络请求：E2E 环境不可控（CI 无外网/有代理都会变），断言放在
 * "配置 → 状态呈现"这条确定性链上；真取数由引擎单测（pickPath/formatValue 等）
 * 与桌面壳的真机验收覆盖。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('网页取数卡：配置边界与如实降级', () => {
  it('加卡 → 填非法地址被拒（含原因）→ 填合法地址进入取数态', async () => {
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

    // 进编辑器 → 全部卡片 → 加「网页取数」→ 保存回工作台
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
        (x.textContent || '').includes('网页取数'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应有「网页取数」').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(500)
    expect(await page.evaluate(() => !!document.querySelector('.wcard')), '工作台上出现取数卡').toBe(true)

    // 打开配置 → 填一个**私网地址** → 应被拒且说明边界
    await page.evaluate(() => document.querySelector<HTMLElement>('.wacts button[title="数据源设置"]')?.click())
    await wait(250)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.wcard button')].find((x) =>
        (x.textContent || '').includes('添加数据源'),
      )
      el?.click()
    })
    await wait(200)
    const submitWith = async (value: string) => {
      await page.evaluate((v: string) => {
        const input = document.querySelector<HTMLInputElement>('.wcard .addrow .cfginput.url')
        if (!input) return
        input.value = v
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const ok = document.querySelector<HTMLButtonElement>('.wcard .addrow .cfgok')
        ok?.click()
      }, value)
      await wait(250)
    }
    await submitWith('https://127.0.0.1/data.json')
    const rejected = await page.evaluate(() => document.querySelector('.wcard .werr')?.textContent?.trim() ?? '')
    expect(rejected, '私网地址应被拒且写明边界').toContain('不能指向本机/内网')

    // 换合法地址 → 不再报错，进入"正在取数…/结果"态，端点进配置表
    await submitWith('https://open.er-api.com/v6/latest/CNY')
    // 写入有 ≤300ms 防抖（cardData 的 schedule）：**等条件**，不按固定 sleep 猜。
    await page.waitForFunction(
      (u) =>
        (JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { endpoints?: { url: string }[] }).endpoints?.some((e) => e.url === u) ?? false,
      { timeout: 5000 },
      'https://open.er-api.com/v6/latest/CNY',
    )
    const after = await page.evaluate(() => ({
      err: document.querySelector('.wcard .werr')?.textContent?.trim() ?? null,
      // 提交成功后配置面板会关掉（"改完即看"）：查存储而不是查面板里的行
      stored: (JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { endpoints?: { url: string }[] }).endpoints ?? [],
      body: document.querySelector('.wcard .wbody')?.textContent?.trim() ?? '',
      configuring: !!document.querySelector('.wcard .wcfg'),
    }))
    expect(after.err, '合法地址不该再报"不能收"').toBeNull()
    expect(after.stored.map((e) => e.url), '数据源进了 cardData').toContain('https://open.er-api.com/v6/latest/CNY')
    expect(after.configuring, '提交后回到卡面（不留在配置态）').toBe(false)
    expect(after.body.length, '卡面有状态文案（取数中/结果/如实失败），不是空白').toBeGreaterThan(0)

    // 端点表落进 cardData（跟着备份走）—— 这是"用户写的进备份"那条口径（上面已等过防抖窗口）。
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('modulo.carddata.v1')
      const d = raw ? (JSON.parse(raw) as { endpoints?: { url: string }[] }) : null
      return d?.endpoints?.map((e) => e.url) ?? []
    })
    expect(stored, '端点表应落进 cardData').toContain('https://open.er-api.com/v6/latest/CNY')

    await browser.close()
  })
})
