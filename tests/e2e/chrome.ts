import { existsSync } from 'node:fs'
import type { Page } from 'puppeteer-core'

/**
 * 跨平台找本机 Chrome（E2E 共用）。CI 上 Chromium 在 `/usr/bin/google-chrome`，
 * 本机在 Program Files —— 早先这段逻辑只长在 `layout.spec.ts` 里，新写的 E2E 文件
 * 直接抄了 Windows 路径，CI 上就是 "Browser was not found"（2026-10-13 实际踩到）。
 * 抽出来共用：新加的 E2E 一律从这里取路径并 `it.skipIf(!EXE)`。
 */
export function chromePath(): string | undefined {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p as string))
}

/**
 * 切到「工作台」视图（F-15 P0）。
 *
 * 为什么要有它：P0 把冷启动默认视图从 workbench 改成了 chat —— 这是**产品行为变更**，
 * 不是测试环境变化。所有「打开即版面」的用例因此必须**显式声明前提**，
 * 而不是把断言口径改成"要么 chat 要么 workbench"（那等于把默认值变化掩盖掉）。
 *
 * 入口有两处，顺序不能反：
 * ① 左栏 `[data-mode="workbench"]` —— 正常宽度下它在；
 * ② 顶栏 `.seg` 里那枚「工作台」—— 视口窄到 `RAIL_MIN_VIEWPORT` 以下时左栏被 `v-show` 藏起来。
 *
 * 用 `el.click()` 而不是 `page.click()`：模板选择器之类的浮层盖在上面时，
 * 鼠标坐标点会被浮层接走；`el.click()` 直接派发到目标，前提是"视图可切"而不是"此刻没人挡着"。
 */
export async function enterWorkbench(page: Page): Promise<void> {
  const where = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('button[data-mode="workbench"]')
    if (rail && rail.offsetParent !== null) {
      rail.click()
      return 'rail'
    }
    const top = [...document.querySelectorAll<HTMLElement>('.bar button')].find(
      (e) => (e.textContent || '').trim() === '工作台',
    )
    top?.click()
    return top ? 'bar' : ''
  })
  if (!where) throw new Error('切不到工作台：左栏 [data-mode="workbench"] 与顶栏「工作台」都不在')
  // 视图是内存态（不落盘），所以等的是"这枚按钮变成当前态"，而不是等某个 DOM 出现
  await page.waitForFunction(
    () => {
      const rail = document.querySelector<HTMLElement>('button[data-mode="workbench"]')
      if (rail && rail.offsetParent !== null) return rail.getAttribute('data-active') === 'true'
      const top = [...document.querySelectorAll('.bar .seg button')].find(
        (e) => (e.textContent || '').trim() === '工作台',
      )
      return top?.getAttribute('data-active') === 'true'
    },
    { timeout: 15000 },
  )
}

/** goto 一个干净页面并**显式**切到工作台。老用例的"打开即版面"前提由这一句承载。 */
export async function gotoWorkbench(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await enterWorkbench(page)
}
