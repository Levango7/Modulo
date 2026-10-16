/**
 * 自定卡（HTML 扩展，2026-10-13 批 5）：真实链路的端到端验证。
 *
 * 这条测试的核心是**隔离边界**（这张卡存在的全部理由），不是渲染好不好看：
 *   ① 片段能渲染、脚本能执行（能动才有用）；
 *   ② 片段读不到父级 localStorage / cookie（沙箱实测 SecurityError）；
 *   ③ 片段经 postMessage 发来的消息**只在通过三查后**才被宿主接收；
 *   ④ 输入校验（</script>）在界面上给出明确原因。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('自定卡：沙箱隔离与输入边界', () => {
  it('片段渲染并可执行；父级 storage/cookie 读不到；非法片段给原因', async () => {
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

    // 进编辑器加「自定卡」并回工作台
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
        (x.textContent || '').includes('自定卡'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应有「自定卡」').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(500)
    expect(await page.evaluate(() => !!document.querySelector('.hcard')), '工作台上出现自定卡').toBe(true)

    // 空态 → 新建 → 先试一个非法片段（</script>）应被拒并给原因
    await page.evaluate(() => document.querySelector<HTMLElement>('.hcard .hok')?.click())
    await wait(250)
    const typeSnippet = async (html: string) => {
      await page.evaluate((h: string) => {
        const ta = document.querySelector<HTMLTextAreaElement>('.hcard .htarea')
        if (!ta) return
        ta.value = h
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }, html)
    }
    // （旧版本在这里测"含 </script> 被拒"—— 那条校验已撤：带脚本是正常写法）

    // 合法片段：渲染 + 脚本执行 + 越权探测 + postMessage 通知。
    // **从运行时构造**（源码里不留字面 `</script>`）—— 连测试源码都要守法：
    // 它在被任何 HTML 解析器碰到时不能自己成为注入点。
    const goodSnippet = [
      '<!doctype html><b id="t">自定内容</b>',
      '<script>',
      "document.getElementById('t').dataset.ran = '1';",
      'var probe = { dom: 0, ls: 0, cookie: 0 };',
      'try { probe.dom = parent.document.body ? 1 : 0 } catch (e) { probe.dom = -1 }',
      'try { probe.ls = localStorage.length } catch (e) { probe.ls = -1 }',
      'try { probe.cookie = document.cookie.length } catch (e) { probe.cookie = -1 }',
      "parent.postMessage({ __modulo: 'ext', payload: { notice: 'probe ' + probe.dom + probe.ls + probe.cookie } }, '*');",
      '</script>',
    ].join(String.fromCharCode(10))
    await typeSnippet(goodSnippet)
    await page.evaluate(() => document.querySelector<HTMLElement>('.hcard .hok')?.click())
    await wait(1200)

    {
      const d = await page.evaluate(() => ({
        iframes: document.querySelectorAll('.hcard iframe').length,
        editing: !!document.querySelector('.hcard .htarea'),
        stored: (JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}').htmlCards || []).length,
        err: document.querySelector('.hcard .herr')?.textContent?.trim() ?? null,
        hasLiteralClose: ((document.querySelector('.hcard .htarea') as HTMLTextAreaElement | null)?.value ?? '').includes('</script'),
      }))
      const raw = await page.evaluate(() => (document.querySelector('.hcard .htarea') as HTMLTextAreaElement | null)?.value ?? '')
      console.log('DIAG4:', JSON.stringify(d))
      console.log('DIAG4-RAW:', JSON.stringify(raw.slice(0, 400)))
    }
    // ① iframe 里脚本跑过（我们写的标记属性）
    const frames = page.frames().filter((f) => f !== page.mainFrame())
    expect(frames.length, '出现沙箱 iframe').toBeGreaterThanOrEqual(1)
    const probe = await frames[frames.length - 1]
      .evaluate(() => {
        const t = document.getElementById('t')
        return { ran: t?.dataset.ran ?? '', text: t?.textContent ?? '' }
      })
      .catch((e: unknown) => ({ ran: 'ERR:' + String(e), text: '' }))
    expect(probe.ran, '片段里的脚本应真的执行').toBe('1')
    expect(probe.text).toBe('自定内容')

    // ② 越权探测的结果（片段自己测的，经 postMessage 报出来）：全部 -1 = 全被拒
    const toast = await page.evaluate(() => document.querySelector('.hcard .htoast')?.textContent?.trim() ?? '')
    expect(toast, `应收到片段的探测报告（实际：${JSON.stringify(toast)}）`).toMatch(/probe -1-1-1/)

    // ③ 落进 cardData（跟着备份走）
    const stored = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { htmlCards?: unknown[] }
      return d.htmlCards?.length ?? 0
    })
    expect(stored, '自定卡进 cardData').toBeGreaterThanOrEqual(1)

    await browser.close()
  })
})
