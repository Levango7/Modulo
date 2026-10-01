import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

/**
 * 桌面壳真机自检。
 *
 * 不用 SetCursorPos 模拟鼠标：那会抢走用户真实的指针和焦点，点错地方赔不起。
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
// 每次重新查句柄会把「真的最小化了」误报成「没有」。
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

async function launch() {
  const child = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (list.some((t) => t.type === 'page' && /tauri\.localhost/.test(t.url))) break
    } catch {
      /* WebView2 还没起来 */
    }
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
  const page = (await browser.pages()).find((p) => /tauri\.localhost/.test(p.url()))
  if (!page) throw new Error('CDP 已连上但找不到主页面')
  // 趁窗口还是正常尺寸把句柄钉死，后面最小化/隐藏时再查就不可靠了
  if (!state().running) throw new Error('启动后找不到主窗口')
  return { child, browser, page }
}

const stop = async ({ child, browser }) => {
  await browser?.disconnect().catch(() => {})
  if (child && child.exitCode === null) child.kill('SIGTERM')
  for (let i = 0; i < 20 && child.exitCode === null; i++) await sleep(150)
  hwnd = 0
}

/** 卡片内容里可观察的签名：勾选状态。用来证明重启后数据是从磁盘读回来的。 */
const todoSignature = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.card input[type="checkbox"]')].map((i) => (i.checked ? 1 : 0)).join(''))

const clickIn = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return false
    el.click()
    return true
  }, sel)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let app = null
try {
  app = await launch()
  const { page, child } = app

  const s0 = state()
  check('窗口已启动且未最小化', s0.running && !s0.iconic && s0.visible, s0)

  const dom = await page.evaluate(() => ({
    tauri: '__TAURI_INTERNALS__' in window,
    titlebar: !!document.querySelector('.titlebar'),
    dragRegion: !!document.querySelector('.titlebar [data-tauri-drag-region]'),
    buttons: [...document.querySelectorAll('.titlebar .tb-btn')].map((b) => b.getAttribute('aria-label')),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    skin: document.documentElement.dataset.skin,
  }))
  check('跑在桌面壳里', dom.tauri, dom)
  check('自制标题栏已渲染（拖拽区 + 三个按钮）', dom.titlebar && dom.dragRegion && dom.buttons.length === 3, {
    dragRegion: dom.dragRegion,
    buttons: dom.buttons,
  })
  check('ink 皮肤 + 朱砂强调色', dom.skin === 'ink' && dom.accent === '#c93c16', { skin: dom.skin, accent: dom.accent })

  const reg = await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke('global_shortcuts'))
  check(
    '全局快捷键注册成功',
    Array.isArray(reg) && reg.length === 2 && reg.every((r) => r.registered),
    reg,
  )

  await page.screenshot({ path: `${OUT}/01-titlebar.png` })

  check('点得到最小化按钮', await clickIn(page, '.tb-btn[aria-label="最小化"]'))
  await sleep(900)
  const sMin = state()
  check('窗口真的进入图标态', sMin.iconic === true, sMin)

  runPs(['-Out', 'x', '-Restore', ...withHwnd()])
  await sleep(900)
  const sBack = state()
  check('可从图标态还原', sBack.iconic === false && sBack.visible === true, sBack)

  const before = state().rect
  check('点得到最大化按钮', await clickIn(page, '.tb-btn[aria-label="最大化"]'))
  await sleep(1200)
  const maxed = state()
  check(
    '最大化铺满工作区',
    maxed.rect && Math.abs(maxed.rect.w - maxed.work.w) <= 40 && Math.abs(maxed.rect.h - maxed.work.h) <= 40 && maxed.rect.w > before.w,
    { before, rect: maxed.rect, work: maxed.work },
  )
  await page.screenshot({ path: `${OUT}/02-maximized.png` })

  check('按钮文案已切成还原', await page.evaluate(() => !!document.querySelector('.tb-btn[aria-label="还原"]')))
  await clickIn(page, '.tb-btn[aria-label="还原"]')
  await sleep(1200)
  const restored = state().rect
  check('还原回到原尺寸', restored && Math.abs(restored.w - before.w) < 40, { before, restored })

  // 无边框后还能不能拉伸：tao 只用 NCCALCSIZE 吃掉非客户区，不摘 WS_THICKFRAME(0x40000)，样式位应当还在
  const st = state().style
  check('窗口仍带 WS_THICKFRAME，边缘可拉伸', (st & 0x40000) !== 0, { style: `0x${st.toString(16)}` })

  // ---- 数据落地：改一处 → 磁盘上真的有文件 → 重启后读回来 ----
  const dir = await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke('data_dir'))
  const cardFile = join(dir, 'modulo.carddata.v1.json')

  const sig0 = await todoSignature(page)
  check('点得到待办的第一个复选框', await clickIn(page, '.card input[type="checkbox"]'))
  await sleep(400)
  const sig1 = await todoSignature(page)
  check('勾选确实改变了界面状态', sig0 !== sig1, { before: sig0, after: sig1 })

  await sleep(400)
  let onDisk = null
  try {
    onDisk = JSON.parse(readFileSync(cardFile, 'utf8'))
  } catch {
    /* 下面断言会报出来 */
  }
  check('卡片内容已写成 appData 下的独立 JSON', !!onDisk && Array.isArray(onDisk.todos), { file: cardFile })

  // 不比对"第几个"，比对不变量：界面上勾了多少个，磁盘上就该有多少个 done
  const domChecked = await page.evaluate(() => [...document.querySelectorAll('.card input[type="checkbox"]')].filter((i) => i.checked).length)
  const doneOnDisk = (onDisk?.todos ?? []).filter((t) => t.done).length
  check('磁盘上的完成数与界面勾选数一致', !!onDisk && doneOnDisk === domChecked, { domChecked, doneOnDisk })

  await stop(app)
  app = await launch()
  await sleep(1200)
  const sig2 = await todoSignature(app.page)
  check('重启后勾选状态从磁盘读回来了', sig2 === sig1, { expected: sig1, afterRestart: sig2 })

  // ---- 托盘与关闭行为 ----
  await clickIn(app.page, 'button[title="外观设置"]')
  await sleep(400)
  await app.page.screenshot({ path: `${OUT}/05-settings-desktop.png` })
  check('设置页里有「收进托盘」开关', await clickIn(app.page, '.panel input[type="checkbox"]'))
  await sleep(400)
  const shellOn = await app.page.evaluate(() => document.querySelector('.panel input[type="checkbox"]')?.checked === true)
  check('开关能拨动', shellOn)

  await clickIn(app.page, '.tb-btn[aria-label="关闭"]')
  await sleep(900)
  const hidden = state()
  check('拨开开关后点关闭是藏进托盘，进程不退出', hidden.running && hidden.visible === false && hidden.iconic === false, hidden)

  runPs(['-Out', 'x', '-Restore', ...withHwnd()])
  await sleep(900)
  check('藏起来的窗口可以恢复', state().visible === true)

  await clickIn(app.page, '.panel input[type="checkbox"]')
  await sleep(400)
  await clickIn(app.page, '.tb-btn[aria-label="关闭"]')
  let exited = false
  for (let i = 0; i < 25 && !exited; i++) {
    await sleep(200)
    exited = app.child.exitCode !== null
  }
  check('拨回去之后点关闭真的退出', exited, { exitCode: app.child.exitCode })
} catch (err) {
  check('自检过程未抛异常', false, String(err).slice(0, 300))
} finally {
  await stop(app).catch(() => {})
}

const failed = report.filter((r) => !r.pass)
console.log(`\n${report.length - failed.length}/${report.length} 通过`)
process.exit(failed.length ? 1 : 0)
