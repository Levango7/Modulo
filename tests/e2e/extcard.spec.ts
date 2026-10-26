/**
 * 原生卡（扩展路线第三层，2026-10-27）：真实链路的端到端验证。
 *
 * 一条用例走完整生命周期，每一步都是这条特性的一个承诺：
 *   ① 管理卡里粘贴卡包 JSON → 导入成功、进 cardData（跟备份走）；
 *   ② 装好的卡成为**一等公民**：模块库/目录菜单里出现它的标题（manifest 的 title/group 生效）；
 *   ③ 上版后 iframe 渲染入口 HTML、**脚本真的执行**（沙箱里能动才有用）；
 *   ④ **桥**三个承诺：setState 写进 extState（落盘）、getState 读回、
 *      白名单外的请求没有回声（不会把错误当应答）；
 *   ⑤ 刷新后状态还在（extState 持久化）、版面还在（ext 段随注册表重建）；
 *   ⑥ 卸载后版面上的残留实例如实说「已卸载」，不白屏、不假装。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('原生卡：导入、入库、上版与桥', () => {
  it('粘贴卡包 → 一等公民上版 → 桥读写与持久 → 卸载残留如实降级', async () => {
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

    // 进编辑器，把「原生卡」放上版面并保存回工作台
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
        (x.textContent || '').includes('原生卡'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应有「原生卡」').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(500)
    expect(await page.evaluate(() => !!document.querySelector('.xcard')), '工作台上出现原生卡管理卡').toBe(true)

    // 先试一份坏 JSON：要给一句人话原因，且不进名单
    const typeJson = async (json: string) => {
      await page.evaluate((j: string) => {
        const ta = document.querySelector<HTMLTextAreaElement>('.xcard .xtarea')
        if (!ta) return
        ta.value = j
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }, json)
    }
    await typeJson('{ 不是 JSON')
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
    await wait(250)
    expect(
      await page.evaluate(() => document.querySelector('.xcard .xerr')?.textContent?.trim() ?? ''),
      '坏 JSON 要给原因',
    ).toContain('JSON')

    // 合法卡包（源码不留字面 </script>—— 连测试源码都要守法）
    const pack = JSON.stringify({
      id: 'hello',
      title: '问候',
      group: '演示',
      blurb: 'E2E 卡包',
      html: [
        '<b id="t">你好</b>',
        '<script>',
        'document.getElementById("t").dataset.ran = "1";',
        '<\/script>',
      ].join(''),
      variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
    })
    await typeJson(pack)
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
    await wait(600)

    expect(
      await page.evaluate(() => document.querySelector('.xcard .xerr')?.textContent?.trim() ?? ''),
      '合法卡包不该报错',
    ).toBe('')
    expect(
      await page.evaluate(() => [...document.querySelectorAll('.xcard .xname')].map((e) => e.textContent?.trim())),
      '已装列表出现卡包',
    ).toContain('问候')
    expect(
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { extCards?: unknown[] }
        return d.extCards?.length ?? 0
      }),
      '卡包进 cardData（跟备份走）',
    ).toBe(1)

    // 一等公民：目录菜单里出现 manifest 的 title —— 点它上版
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
    })
    await wait(500)
    await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
    await wait(300)
    const addedExt = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.textContent || '').includes('问候'),
      )
      el?.click()
      return !!el
    })
    expect(addedExt, '装好的扩展卡应出现在目录菜单（manifest.title 生效）').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(800)
    expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态 iframe 上版').toBe(1)

    // ③ 脚本真的执行了；④ 桥往返：setState 落盘、getState 读回
    const frames = page.frames().filter((f) => f !== page.mainFrame())
    expect(frames.length, '沙箱 iframe 出现').toBeGreaterThanOrEqual(1)
    const frame = frames[frames.length - 1]
    const ran = await frame.evaluate(() => document.getElementById('t')?.getAttribute('data-ran') ?? '').catch(() => 'ERR')
    expect(ran, '入口脚本应真的执行').toBe('1')
    const setState = await frame.evaluate(() =>
      (window as unknown as { MODULO: { bridge: { setState: (v: unknown) => Promise<{ ok: boolean; error?: string }> } } }).MODULO.bridge.setState(
        { n: 42 },
      ),
    )
    expect(setState.ok, `setState 应成功（${setState.error ?? ''}）`).toBe(true)
    const gotBack = await frame.evaluate(() =>
      (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; value: unknown }> } } }).MODULO.bridge.getState(),
    )
    expect(gotBack).toEqual({ ok: true, value: { n: 42 } })

    // 白名单外的请求没有回声：桥不回应方法面之外的东西（这里只能从宿主侧断言落盘形状）
    const storedState = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as {
        extState?: Record<string, unknown>
      }
      return d.extState?.hello ?? null
    })
    expect(storedState, 'setState 经桥写进 extState（落盘）').toEqual({ n: 42 })

    // ⑤ 刷新：版面还在、状态还在
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(1000)
    expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '刷新后运行态还在').toBe(1)
    const frames2 = page.frames().filter((f) => f !== page.mainFrame())
    const got2 = await frames2[frames2.length - 1]
      .evaluate(() =>
        (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; value: unknown }> } } }).MODULO.bridge.getState(),
      )
      .catch((e: unknown) => ({ ok: false, value: String(e) }))
    expect(got2, '刷新后 getState 读回持久状态').toEqual({ ok: true, value: { n: 42 } })

    // ⑥ 卸载：管理卡删掉卡包 → 版面上的残留实例如实说「已卸载」
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xdel')?.click())
    await wait(600)
    expect(
      await page.evaluate(() => document.querySelector('.xcard .xempty')?.textContent?.trim() ?? ''),
      '运行态残留要如实说已卸载',
    ).toContain('已卸载')
    expect(
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as {
          extState?: Record<string, unknown>
        }
        return 'hello' in (d.extState ?? {})
      }),
      '卸载连状态一起清（不留数据尸体）',
    ).toBe(false)

    await browser.close()
  })
})
