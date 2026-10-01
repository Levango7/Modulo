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
// PID 必传：按进程名找窗口会钉到用户自己开着的那一份实例上（探针 spawn 的子进程只是同名进程之一），
// 那样 -Restore / 点关闭就打在别人的窗口里。ps1 拿到 -ProcId 后只认那个进程，找不到就报错、不回退按名字查。
let hwnd = 0
let pid = 0
const target = () => ['-ProcId', String(pid), ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]
const state = () => {
  const r = runPs(['-Out', 'x', '-State', ...target()])
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
  pid = child.pid ?? 0
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
  // 页面列表不紧跟 /json/list：重启那一轮曾随机挂在「连上了但找不到主页面」，所以这里要自己重试
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => /tauri\.localhost/.test(p.url()))
    if (!page) await sleep(250)
  }
  if (!page) throw new Error('CDP 已连上但找不到主页面')
  // 趁窗口还是正常尺寸把句柄钉死，后面最小化/隐藏时再查就不可靠了
  if (!state().running) throw new Error('启动后找不到主窗口')
  return { child, browser, page }
}

const stop = async ({ child, browser }) => {
  await browser?.disconnect().catch(() => {})
  if (child && child.exitCode === null) child.kill('SIGTERM')
  for (let i = 0; i < 20 && child.exitCode === null; i++) await sleep(150)
  // 进程退出不等于调试端口立刻释放：不等干净的话下一次 launch 会连上前一个还没死透的端点，
  // 拿到的页面列表是旧的 —— 重启检查就会随机报「找不到主页面」
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`)
      await sleep(250)
    } catch {
      break
    }
  }
  hwnd = 0
  pid = 0
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

/**
 * 等窗口状态迁移落地，而不是固定 sleep 之后采一次。
 * 窗口动作是异步跨进程调用，重建后的首次运行实测会慢过 1.2s（上一轮三条红就是这么来的）；
 * 固定 sleep 会把「慢」误报成「坏」。waited 一并带出去，方便看真实延迟。
 */
const waitUntil = async (pred, { timeout = 8000, step = 150 } = {}) => {
  const t0 = Date.now()
  let s = state()
  while (!pred(s) && Date.now() - t0 < timeout) {
    await sleep(step)
    s = state()
  }
  return { ok: pred(s), waited: Date.now() - t0, s }
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let app = null
try {
  app = await launch()
  const { page, child } = app

  const s0 = state()
  check('窗口已启动且未最小化', s0.running && !s0.iconic && s0.visible, s0)

  // ---- 启动尺寸：1280×800 是逻辑像素，DPI 换算后必须真的落在窗口上；工作区放不下时
  // lib 侧 fit_window 会逐轴夹到该轴的 94%（下限 380×560），这里复刻同一条公式。
  // rect/work 是物理像素：shot-window.ps1 开头调过 SetProcessDPIAware()。
  // 容差取 40：GetWindowRect 含 Win10+ 那圈不可见调边框（150% 下实测 w+22 / h+13），
  // 而 tao 保证的是「可见外框 = 逻辑尺寸 × dpr」。这条能抓住真正的错法 —— 若建窗按物理
  // 像素走，150% 下会拿到 1280 物理（=853 逻辑），差 600 多像素，立刻红。夹取分支需要小屏
  // 才触发，本机触发不了，那部分由 fit_size 的三条单测守着。
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const fit = (avail, want, min) => (want + 32 <= avail ? want : Math.max(avail * 0.94, min))
  const wantW = Math.round(fit(s0.work.w / dpr, 1280, 380) * dpr)
  const wantH = Math.round(fit(s0.work.h / dpr, 800, 560) * dpr)
  check(
    '启动尺寸 = 1280×800 逻辑档经 DPI 换算（放不下则按工作区夹取）',
    !!s0.rect && Math.abs(s0.rect.w - wantW) <= 40 && Math.abs(s0.rect.h - wantH) <= 40,
    { dpr, rect: s0.rect, work: s0.work, expect: { w: wantW, h: wantH } },
  )

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
  const min = await waitUntil((s) => s.iconic === true)
  check('窗口真的进入图标态', min.ok, { waitedMs: min.waited, ...min.s })

  runPs(['-Out', 'x', '-Restore', ...target()])
  const back = await waitUntil((s) => s.iconic === false && s.visible === true)
  check('可从图标态还原', back.ok, { waitedMs: back.waited, ...back.s })

  const before = state().rect
  check('点得到最大化按钮', await clickIn(page, '.tb-btn[aria-label="最大化"]'))
  const isMax = (s) => !!s.rect && Math.abs(s.rect.w - s.work.w) <= 40 && Math.abs(s.rect.h - s.work.h) <= 40 && s.rect.w > before.w
  const maxed = await waitUntil(isMax)
  check('最大化铺满工作区', maxed.ok, { waitedMs: maxed.waited, before, rect: maxed.s.rect, work: maxed.s.work })
  await page.screenshot({ path: `${OUT}/02-maximized.png` })

  check('按钮文案已切成还原', await page.evaluate(() => !!document.querySelector('.tb-btn[aria-label="还原"]')))
  await clickIn(page, '.tb-btn[aria-label="还原"]')
  const rest = await waitUntil((s) => !!s.rect && Math.abs(s.rect.w - before.w) < 40)
  const restored = rest.s.rect
  check('还原回到原尺寸', rest.ok, { waitedMs: rest.waited, before, restored })

  // 无边框后还能不能拉伸：tao 只用 NCCALCSIZE 吃掉非客户区，不摘 WS_THICKFRAME(0x40000)，样式位应当还在
  const st = state().style
  check('窗口仍带 WS_THICKFRAME，边缘可拉伸', (st & 0x40000) !== 0, { style: `0x${st.toString(16)}` })

  // ---- 双击拖拽区最大化：走 Tauri 注入的 drag.js（mousedown detail===2 → internal_toggle_maximize）----
  // 单击拖动（detail=1）测不了：它会真的进 start_dragging 的原生模态循环，事件是合成的、循环等不到真按键抬起。
  // 想退一步把 invoke 换成记录器也不行 —— __TAURI_INTERNALS__ 和它的 invoke 都是不可配置+不可写（Tauri 防页面篡改），
  // 实测 TypeError: Cannot redefine property。好在判「点在哪算拖拽区」的 isDragRegion 与双击共用，
  // 下面两条双击断言过了，就等于证明标题文字和 Logo 都落在拖拽区里 —— 拖动能不能真的移动窗口则留给人工确认。
  // 不派 mousedown detail=1：那条会进 start_dragging 的原生模态拖动循环，合成事件撑不起来。
  const mouseDown2 = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return false
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 2 }))
      return true
    }, sel)

  check('标题文字上双击的 mousedown 派发成功', await mouseDown2('.tb-drag .tb-title'))
  const dblMax = await waitUntil((s) => !!s.rect && Math.abs(s.rect.w - s.work.w) <= 40)
  check('双击标题文字能最大化（拖拽区 deep 覆盖子元素）', dblMax.ok, {
    waitedMs: dblMax.waited,
    rect: dblMax.s.rect,
    work: dblMax.s.work,
  })
  check('双击 Logo（SVG）派发成功', await mouseDown2('.tb-drag svg'))
  // 必须等这次切换真正落地再做下一条：迟到的还原会被反向守卫误读成「裸 dblclick 改变了状态」
  const backFromDbl = await waitUntil((s) => !!s.rect && Math.abs(s.rect.w - restored.w) < 40)
  check('双击 Logo 切回原尺寸（SVG 虽不是 HTMLElement，也在 deep 拖拽区里）', backFromDbl.ok, {
    waitedMs: backFromDbl.waited,
    restored,
    rect: backFromDbl.s.rect,
  })

  // 反向守卫：自己不要再接 dblclick —— 原生已经在第二次 mousedown 切过一次，再接一次会互相抵消
  await page.evaluate(() =>
    document.querySelector('.tb-drag').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })),
  )
  await sleep(900)
  check('分派裸 dblclick 不改变窗口状态（没有第二处处理者）', Math.abs(state().rect.w - restored.w) < 40)

  // ---- 全局快捷键：往系统输入队列真投一次 Alt+Shift+M，看窗口是否响应 ----
  const regOk = Array.isArray(reg) && reg.length === 2 && reg.every((r) => r.registered)
  if (regOk) {
    const visBefore = state().visible
    runPs(['-Out', 'x', '-SendKeys', '%+m'])
    let hid = false
    for (let i = 0; i < 12 && !hid; i++) {
      await sleep(250)
      hid = state().visible === false
    }
    check('Alt+Shift+M 经系统投递后窗口收起', visBefore === true && hid, { visBefore, hid })
    runPs(['-Out', 'x', '-SendKeys', '%+m'])
    let shown = false
    for (let i = 0; i < 12 && !shown; i++) {
      await sleep(250)
      shown = state().visible === true
    }
    check('再按一次 Alt+Shift+M 窗口回来', shown)
  } else {
    console.log('SKIP  Alt+Shift+M 系统投递（注册未成功，先修上面的注册检查）')
  }

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
  const hidden = await waitUntil((s) => s.running && s.visible === false && s.iconic === false)
  check('拨开开关后点关闭是藏进托盘，进程不退出', hidden.ok, { waitedMs: hidden.waited, ...hidden.s })

  runPs(['-Out', 'x', '-Restore', ...target()])
  const shownAgain = await waitUntil((s) => s.visible === true)
  check('藏起来的窗口可以恢复', shownAgain.ok, { waitedMs: shownAgain.waited, ...shownAgain.s })

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
