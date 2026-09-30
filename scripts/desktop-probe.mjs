import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

/**
 * 桌面壳真机自检。
 *
 * 不用 SetCursorPos 模拟鼠标：那会抢走用户真实的鼠标和焦点，点错地方谁也赔不起。
 * 改成给 WebView2 开远调端口，用 CDP 在页面里点真实的 DOM 按钮，再从 Win32 侧读窗口状态 ——
 * 走的是同一条代码路径，但不碰物理输入设备。
 *
 * 只用 page.evaluate，不用 addScriptTag：应用有 default-src 'self' 的 CSP，注入 <script> 会被拦，
 * 而 Runtime.evaluate 不受页面 CSP 约束。
 */
const PORT = Number(process.env.PROBE_PORT ?? 9223)
const EXE = resolve(process.env.MODULO_EXE ?? 'src-tauri/target/release/modulo.exe')
const OUT = 'evidence/desktop'
const PS = 'scripts/shot-window.ps1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = []
const check = (name, pass, detail) => {
  report.push({ name, pass: !!pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const runPs = (args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { encoding: 'utf8' })

// 句柄只解析一次然后钉死：最小化期间 MainWindowHandle 会漂到一个 6×6 的辅助窗口（实测），
// 每次重新查找会把「真的最小化了」读成「没有」。
let hwnd = 0
const withHwnd = () => (hwnd ? ['-Hwnd', String(hwnd)] : [])
const state = () => {
  const r = runPs(['-Out', 'x', '-State', ...withHwnd()])
  try {
    const s = JSON.parse(r.stdout.trim().split('\n').pop())
    if (s.hwnd) hwnd = s.hwnd
    return s
  } catch {
    return { error: (r.stderr || r.stdout || '').trim().slice(0, 200) }
  }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const child = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: 'ignore',
})

let browser
try {
  let url = null
  for (let i = 0; i < 60 && !url; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      url = list.find((t) => t.type === 'page' && /tauri\.localhost/.test(t.url))?.webSocketDebuggerUrl
    } catch {
      /* WebView2 还没起来 */
    }
  }
  if (!url) throw new Error('拿不到 WebView2 的远调端点')

  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
  const page = (await browser.pages()).find((p) => /tauri\.localhost/.test(p.url()))
  if (!page) throw new Error('CDP 已连上但找不到主页面')

  const s0 = state()
  check('窗口已启动且未最小化', s0.running && !s0.iconic && s0.visible, s0)

  const dom = await page.evaluate(() => ({
    tauri: '__TAURI_INTERNALS__' in window,
    titlebar: !!document.querySelector('.titlebar'),
    dragRegion: !!document.querySelector('.titlebar [data-tauri-drag-region]'),
    buttons: [...document.querySelectorAll('.titlebar .tb-btn')].map((b) => b.getAttribute('aria-label')),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    skin: document.documentElement.dataset.skin,
    pageError: window.__moduloPageError ?? null,
  }))
  check('跑在桌面壳里', dom.tauri, dom)
  check('自制标题栏已渲染（拖拽区 + 三个按钮）', dom.titlebar && dom.dragRegion && dom.buttons.length === 3, {
    dragRegion: dom.dragRegion,
    buttons: dom.buttons,
  })
  check('ink 皮肤 + 朱砂强调色', dom.skin === 'ink' && dom.accent === '#c93c16', { skin: dom.skin, accent: dom.accent })

  const reg = await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke('global_shortcuts'))
  check('全局快捷键注册成功', Array.isArray(reg) && reg.length === 2 && reg.every((r) => r.registered), reg)

  await page.screenshot({ path: `${OUT}/01-titlebar.png` })

  const click = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return false
      el.click()
      return true
    }, sel)

  check('点得到最小化按钮', await click('.tb-btn[aria-label="最小化"]'))
  await sleep(900)
  const sMin = state()
  check('窗口真的进入图标态', sMin.iconic === true, sMin)

  runPs(['-Out', 'x', '-Restore', ...withHwnd()])
  await sleep(900)
  const sBack = state()
  check('可从图标态还原', sBack.iconic === false && sBack.visible === true, sBack)

  const before = state().rect
  check('点得到最大化按钮', await click('.tb-btn[aria-label="最大化"]'))
  await sleep(1200)
  const maxed = state()
  // 最大化后 GetWindowRect 会把 Win10+ 那圈透明边框也算进去，比工作区略大，所以给 40px 容差
  check(
    '最大化铺满工作区',
    maxed.rect && Math.abs(maxed.rect.w - maxed.work.w) <= 40 && Math.abs(maxed.rect.h - maxed.work.h) <= 40 && maxed.rect.w > before.w,
    { before, rect: maxed.rect, work: maxed.work },
  )
  await page.screenshot({ path: `${OUT}/02-maximized.png` })

  check('按钮文案已切成还原', await page.evaluate(() => !!document.querySelector('.tb-btn[aria-label="还原"]')))
  await click('.tb-btn[aria-label="还原"]')
  await sleep(1200)
  const restored = state().rect
  check('还原回到原尺寸', restored && Math.abs(restored.w - before.w) < 40, { before, restored })

  // 无边框后还能不能拉伸：tao 只用 NCCALCSIZE 吃掉非客户区，不摘 WS_THICKFRAME(0x40000)，样式位应当还在
  const st = state().style
  check('窗口仍带 WS_THICKFRAME，边缘可拉伸', (st & 0x40000) !== 0, { style: `0x${st.toString(16)}` })

  // 「收进托盘」这条路径最值得测：它靠 CloseRequested 里 prevent_close，
  // 写错的两种后果分别是「点关闭程序不退出」和「窗口再也找不回来」。
  await click('button[title="外观设置"]')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/05-settings-desktop.png` })
  await click('.panel input[type="checkbox"]')
  await sleep(400)
  const toggled = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo.shell.v1') ?? '{}').hideOnClose === true)
  check('设置页里有「收进托盘」开关且能拨动', toggled)

  await click('.tb-btn[aria-label="关闭"]')
  await sleep(900)
  const hidden = state()
  check('拨开开关后点关闭是藏进托盘，进程不退出', hidden.running && hidden.visible === false && hidden.iconic === false, hidden)

  runPs(['-Out', 'x', '-Restore', ...withHwnd()])
  await sleep(900)
  check('藏起来的窗口可以恢复', state().visible === true)

  await click('.panel input[type="checkbox"]')
  await sleep(400)
  await click('.tb-btn[aria-label="关闭"]')
  let exited = false
  for (let i = 0; i < 25 && !exited; i++) {
    await sleep(200)
    exited = child.exitCode !== null
  }
  check('拨回去之后点关闭真的退出', exited, { exitCode: child.exitCode })
} catch (err) {
  check('自检过程未抛异常', false, String(err).slice(0, 300))
} finally {
  await browser?.disconnect().catch(() => {})
  if (child.exitCode === null) child.kill('SIGTERM')
}

const failed = report.filter((r) => !r.pass)
console.log(`\n${report.length - failed.length}/${report.length} 通过`)
process.exit(failed.length ? 1 : 0)
