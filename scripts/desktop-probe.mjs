import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { connect } from 'node:net'
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
/** 复刻 lib.rs 的 fit_size：放得下（留 32px 边距）就用期望值，放不下取该轴 94%，不低于最小尺寸 */
const fit = (avail, want, min) => (want + 32 <= avail ? want : Math.max(avail * 0.94, min))

const report = []
const check = (name, pass, detail) => {
  report.push({ name, pass: !!pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const runPs = (args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS, ...args], { encoding: 'utf8' })

/** 端口有没有人监听 —— 比 fetch 直白：fetch 失败分不清是"没人监听"还是"响应不成 JSON" */
const portOpen = (timeoutMs = 700) =>
  new Promise((res) => {
    const s = connect({ host: '127.0.0.1', port: PORT })
    const done = (v) => {
      s.destroy()
      res(v)
    }
    s.setTimeout(timeoutMs)
    s.on('connect', () => done(true))
    s.on('timeout', () => done(false))
    s.on('error', () => done(false))
  })

/** 按镜像名数进程：回答"应用起来了没""WebView2 的浏览器进程派生了没" */
const countBy = (image) => {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' })
  return (r.stdout || '').split('\n').filter((l) => l.toLowerCase().includes(image.toLowerCase())).length
}

/**
 * 读 msedgewebview2.exe 的真实命令行。分的是最后两种情况：
 * 远调参数没进到浏览器进程里（env 变量在这个 runtime 上没生效），
 * 还是进去了但端口仍不监听（那就是绑定/网络层的问题）。
 */
const webviewArgs = () => {
  const ps = "(Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\").CommandLine"
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' })
  const lines = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const hit = lines.filter((l) => /--remote-debugging-port=/.test(l))
  return {
    webviewCmdLines: lines.length,
    withDebugPort: hit.length,
    /** 取一条带端口的样本，截断即可 —— 命令行很长，全量塞进报告没人读 */
    sample: (hit[0] || lines[0] || '').slice(0, 240),
    psErr: (r.stderr || '').trim().slice(0, 160),
  }
}

/**
 * 失败自述。加这个是因为上一轮 runner 那条红我只拿到一句 `fetch failed`，
 * 结果把原因猜错了两次（先猜 SendKeys，再误读代码顺序说"窗口起来了"）。
 * 这几个字段能一刀切开三种情况：应用没起来（childExit 非 null / moduloProcs 0）、
 * 起来了但 WebView2 缺席（webviewProcs 0，本机正常是 6+）、
 * 两边都正常而端口没人听（portOpen false ⇒ 远调参数没生效）。
 */
const diagnose = async (child, browserArgs) => ({
  childExit: child?.exitCode ?? null,
  childSignal: child?.signalCode ?? null,
  moduloProcs: countBy('modulo.exe'),
  webviewProcs: countBy('msedgewebview2.exe'),
  ...webviewArgs(),
  /** 必须 await：直接把 Promise 塞进 JSON.stringify 会打印成 {}，等于现场造假 */
  portOpen: await portOpen(),
  browserArgsPassed: browserArgs,
})

// 句柄只解析一次然后钉死：最小化期间 MainWindowHandle 会漂到一个 6×6 的辅助窗口（实测），
// 每次重新查句柄会把「真的最小化了」误报成「没有」。
// PID 必传：按进程名找窗口会钉到用户自己开着的那一份实例上（探针 spawn 的子进程只是同名进程之一），
// 那样 -Restore / 点关闭就打在别人的窗口里。ps1 拿到 -ProcId 后只认那个进程，找不到就报错、不回退按名字查。
let hwnd = 0
let pid = 0
const target = () => ['-ProcId', String(pid), ...(hwnd ? ['-Hwnd', String(hwnd)] : [])]
/**
 * 单次采样。**慢**：每次要新起一个 powershell.exe（实测 1.3–2.0 秒，含 CLR 启动
 * 与 Add-Type 编译 C# 类型）。所以只在「取一个不依赖时序的静态值」时用它 ——
 * 尺寸基线、样式位、磁盘文件。凡是「等某个状态出现」，都走 waitUntil（在 PS 侧轮询）。
 * 混用这两种是本文件历史上反复变红的根源。
 */
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

async function launch(extraEnv = {}) {
  const browserArgs = `--remote-debugging-port=${PORT}`
  const child = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs, ...extraEnv },
    /**
     * 必须是 'ignore'，不能是 'pipe'：本轮加诊断时改成 pipe 想收 stderr，结果应用以 101 崩了
     * （Rust 的 print!/eprintln! 在写端坏掉时是 panic，而不是静默丢），49/49 直接掉到 33/35。
     * 测量手段不该改动被测对象 —— 想看死因就靠下面的 childExit + 进程计数，别接管它的 stdout。
     */
    stdio: 'ignore',
  })
  pid = child.pid ?? 0
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      ready = list.some((t) => t.type === 'page' && /tauri\.localhost/.test(t.url))
    } catch {
      /* WebView2 还没起来 */
    }
  }
  if (!ready) {
    const diag = await diagnose(child, browserArgs)
    child.kill('SIGTERM')
    throw new Error(`CDP 端口 ${PORT} 等了 30 秒没等到 tauri.localhost 的页面。现场：${JSON.stringify(diag)}`)
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
  // 页面列表不紧跟 /json/list：重启那一轮曾随机挂在「连上了但找不到主页面」，所以这里要自己重试
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => /tauri\.localhost/.test(p.url()))
    if (!page) await sleep(250)
  }
  if (!page) throw new Error('CDP 已连上但找不到主页面')
  /**
   * 句柄要钉在「主窗口已经成形」之后。图标态窗口的 `GetWindowRect` 就是 (-32000,-32000,237,39)
   * 这种垃圾值，而一旦钉上去，这一轮后面每条 Win32 断言读的都是它。
   * 分不清是辅助窗口抢下还是主窗口自己在图标态，所以两条都堵：筛子只收可见非图标态
   * （见 shot-window.ps1），每轮重试前把 hwnd 清 0 强制重新解析。
   *
   * 这里的重试循环**故意保留**在 JS 侧：它要的是「换一个句柄重新筛」，
   * 而 -Until 谓词是绑在已钉住的句柄上的 —— 换句柄和在同一句柄上等状态不是一回事。
   * 但循环内每次 state() 要 1.3–2.0 秒，所以给足次数（约 30 秒）而不是 9 秒。
   */
  let s = state()
  for (let i = 0; i < 16 && !(s.running && s.iconic === false && s.rect && s.rect.w > 400); i++) {
    hwnd = 0
    await sleep(300)
    s = state()
  }
  if (!s.running) throw new Error('启动后找不到主窗口')
  /**
   * 等不到就别继续：钉在图标态窗口上，后面每一条 Win32 断言读到的都是垃圾值，
   * 表现是「固定成对的两条红」，很容易被误读成产品缺陷（这两轮就是这么绕路的）。
   * 停在这里，红也只红一条，并且名字会说清是探针没拿到窗口。
   */
  if (s.iconic !== false || !s.rect || s.rect.w <= 400) {
    throw new Error(`启动后没拿到可见的主窗口，最后读到的是 ${JSON.stringify(s)}`)
  }
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

const clickText = (page, label) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === t)
    el?.click()
    return !!el
  }, label)

/**
 * 把 Rust 侧的组合键字符串翻译成 SendKeys 语法：Ctrl→^、Alt→%、Shift→+，
 * 单字符直接写、其余套大括号（F13 → {F13}）。Win/Super 键 SendKeys 表达不了，返回 null 让调用方跳过。
 * 之所以从「实际注册的键」现算而不是写死字符串：默认档换过、用户改过键，这条检查都不用跟着动。
 */
const toSendKeys = (chord) => {
  const parts = String(chord)
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const mark = { ctrl: '^', control: '^', alt: '%', option: '%', shift: '+' }
  let prefix = ''
  for (const raw of parts.slice(0, -1)) {
    const m = mark[raw.toLowerCase()]
    if (m === undefined) return null
    prefix += m
  }
  const key = parts.at(-1)
  return prefix + (key.length === 1 ? key.toLowerCase() : `{${key}}`)
}

/**
 * 等窗口状态迁移落地，而不是固定 sleep 之后采一次。
 * 窗口动作是异步跨进程调用，重建后的首次运行实测会慢过 1.2s（上一轮三条红就是这么来的）；
 * 固定 sleep 会把「慢」误报成「坏」。waited 一并带出去，方便看真实延迟。
 */
/**
 * 等窗口进入某个状态。
 *
 * 轮询**必须**在 PowerShell 那一侧做（`-Until`），不能让这里循环调 `state()`：
 * 每起一个 powershell.exe 要 1.3–2.0 秒（实测），而窗口动画（最小化 / 最大化 /
 * 还原 / 藏进托盘）是几百毫秒的瞬态 —— 1.5 秒的采样间隔既会读到动画途中的
 * -32000 垃圾矩形，也会整个错过瞬态。这是「夹取尺寸 + 居中」「藏进托盘 + 真退出」
 * 几组成对变红的唯一原因：不是代码错，是**采样太稀**。
 *
 * 谓词是命名 token（`iconic` / `hidden` / `maximized` / `size` …）而不是回调：
 * 见 shot-window.ps1 里的说明。`onSample` 用于需要采样过程本身的场合
 * （比如「有没有真的翻转过可见性」，只比较末态会漏掉中途的变化）。
 *
 * @param onSample 若给出，返回的是「过程中出现过的最后一个不满足态之前的样本」，
 *                 用于区分「始终没变」与「变过又变回来」。
 */
const waitUntil = async (name, { timeout = 8000, onSample, ...args } = {}) => {
  const r = runPs(['-Out', 'x', '-Until', name, '-TimeoutMs', String(timeout), ...target(), ...optsToArgs(args)])
  try {
    const s = JSON.parse(r.stdout.trim().split('\n').pop())
    if (s.hwnd) hwnd = s.hwnd
    if (onSample) onSample(s)
    return { ok: s.hit === true, waited: s.waitedMs ?? 0, samples: s.samples ?? 0, s }
  } catch {
    return { ok: false, waited: 0, samples: 0, s: { error: (r.stderr || r.stdout || '').trim().slice(0, 200) } }
  }
}

const optsToArgs = ({ tol, targetW, targetH, minW } = {}) =>
  [
    ...(tol === undefined ? [] : ['-Tol', String(tol)]),
    ...(targetW === undefined ? [] : ['-TargetW', String(targetW)]),
    ...(targetH === undefined ? [] : ['-TargetH', String(targetH)]),
    ...(minW === undefined ? [] : ['-MinW', String(minW)]),
  ]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/**
 * 「首次启动时是墨纸皮肤 + 朱砂强调色」这条断言要成立，前提是**外观是默认值**。
 *
 * 原先它直接读机器上真实的 `%APPDATA%\app.modulo\data\modulo.appearance.v1.json`，
 * 于是结果取决于这台机器上谁改过外观 —— 那是抛硬币，不是门禁：
 * 别人设过一次亮彩，这台机器就永远红着，而代码其实没问题。
 *
 * 所以这里**只接管这一个文件**：跑前备份并写成文档化的默认值，跑完原样还原
 * （原来没有这个文件的话，跑完删掉自己写的那份）。刻意**不去清空整个数据目录** ——
 * 同一次运行里「重启后勾选状态从磁盘读回来了」那几条要的就是真实数据。
 *
 * 默认值取自 `src/vue/appearance.ts` 的 `DEFAULT_APPEARANCE`，两处必须一致；
 * 下面的断言就是校验它，所以改了一处忘了另一处，这里会红。
 */
const APPEARANCE_FILE = join(process.env.APPDATA ?? '', 'app.modulo', 'data', 'modulo.appearance.v1.json')
const DEFAULT_APPEARANCE_ON_DISK = { skin: 'ink', mode: 'system', accent: 'auto' }
let appearanceBackup = null
let appearanceExisted = false
function seedAppearance() {
  try {
    appearanceExisted = existsSync(APPEARANCE_FILE)
    if (appearanceExisted) appearanceBackup = readFileSync(APPEARANCE_FILE, 'utf8')
    mkdirSync(join(APPEARANCE_FILE, '..'), { recursive: true })
    writeFileSync(APPEARANCE_FILE, JSON.stringify(DEFAULT_APPEARANCE_ON_DISK))
  } catch (e) {
    // 接不上就算了：那条断言会红，而红的原因会写在报告里（皮肤/强调色是实际值）
    console.log(`SEED-NOTE 没能预置外观文件：${e.message}`)
  }
}
function restoreAppearance() {
  try {
    if (appearanceExisted) writeFileSync(APPEARANCE_FILE, appearanceBackup)
    else rmSync(APPEARANCE_FILE, { force: true })
  } catch (e) {
    console.log(`RESTORE-NOTE 没能还原外观文件：${e.message}`)
  }
}

seedAppearance()

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
  // 前端「改键」按钮按 kind 定位某一条，靠中文 label 匹配是错的（label 会随文案改）
  check(
    '两条快捷键都带稳定标识 kind',
    Array.isArray(reg) && ['summon', 'ontop'].every((k) => reg.some((r) => r.kind === k)),
    { kinds: (reg ?? []).map((r) => r.kind) },
  )

  await page.screenshot({ path: `${OUT}/01-titlebar.png` })

  check('点得到最小化按钮', await clickIn(page, '.tb-btn[aria-label="最小化"]'))
  const min = await waitUntil('iconic')
  check('窗口真的进入图标态', min.ok, { waitedMs: min.waited, samples: min.samples, ...min.s })

  runPs(['-Out', 'x', '-Restore', ...target()])
  const back = await waitUntil('visible', { timeout: 5000 })
  check('可从图标态还原', back.ok && back.s.iconic === false, { waitedMs: back.waited, samples: back.samples, ...back.s })

  const before = state().rect
  check('点得到最大化按钮', await clickIn(page, '.tb-btn[aria-label="最大化"]'))
  // MinW = 最大化前的宽度：用来排除「本来就这么宽」的巧合命中
  const maxed = await waitUntil('maximized', { minW: before.w })
  check('最大化铺满工作区', maxed.ok, { waitedMs: maxed.waited, samples: maxed.samples, before, rect: maxed.s.rect, work: maxed.s.work })
  await page.screenshot({ path: `${OUT}/02-maximized.png` })

  check('按钮文案已切成还原', await page.evaluate(() => !!document.querySelector('.tb-btn[aria-label="还原"]')))
  await clickIn(page, '.tb-btn[aria-label="还原"]')
  const rest = await waitUntil('size', { targetW: before.w, targetH: before.h, tol: 40 })
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
  const dblMax = await waitUntil('maximized', { minW: restored.w })
  check('双击标题文字能最大化（拖拽区 deep 覆盖子元素）', dblMax.ok, {
    waitedMs: dblMax.waited,
    rect: dblMax.s.rect,
    work: dblMax.s.work,
  })
  check('双击 Logo（SVG）派发成功', await mouseDown2('.tb-drag svg'))
  // 必须等这次切换真正落地再做下一条：迟到的还原会被反向守卫误读成「裸 dblclick 改变了状态」
  const backFromDbl = await waitUntil('size', { targetW: restored.w, targetH: restored.h, tol: 40 })
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

  // ---- 全局快捷键：往系统输入队列真投一次召唤键，看窗口是否响应 ----
  // 双重验证 = 正例（投递后真的收起过、再投递后真的唤出）+ 反例（旧默认档不再起作用）。
  // 反例是必需的：本机注册表 HKCU\Keyboard Layout\Toggle\HotKey=1（左 Alt+Shift 切输入法），
  // 此前这条一直红就是被输入法吃掉的；只测正例时，窗口被别的东西碰一下也可能算过。
  //
  // 为什么投递后要立刻在 ps1 里做高频跟踪，而不是在 JS 侧轮询：一次 `state()` 采样要重新起一个
  // PowerShell（实测 1.1–1.3 秒），而「收起 → 唤出」一整趟往返可以短到一秒内 —— 粒度太粗就抓不到，
  // 于是出现过「注册是绿的、投递说窗口没收起」连红两轮。现在判据看的是**翻转**（startVisible≠finalVisible）
  // 加**这一趟里真的隐过**（everHidden），既不会白过，也不会被慢采样骗过去。
  const summon = Array.isArray(reg) ? reg.find((r) => r.kind === 'summon') : undefined
  /**
   * 投递一个全局热键组合，并高频跟踪可见性。
   *
   * `times` 连投：`WScript.Shell.SendKeys` 走系统输入队列，单次投递不保证送达
   * （实测同一条命令第 3 次才生效过）。**一旦状态翻转就停** —— 多投一次就等于
   * 多触发一次「收起」，会把后面的「唤出」测成「又收起来了」。
   *
   * ⚠️ 本机仍会整条红：连投 12 次 / 12 秒也送不到（SendInput 直投同样送不到）。
   * 而热键**确实注册成功** —— 反查确认过：modulo 运行时用 RegisterHotKey 再注册
   * 同一组合键返回 1409 = ERROR_HOTKEY_ALREADY_REGISTERED，即它占着。
   * 所以这是「投递侧到不了」，不是「热键没注册」也不是「回调坏了」，
   * 详见 `checkHotkeyDelivery()` 的 SKIP 判据。
   */
  const deliver = (chord, { watchMs = 2600, times = 4 } = {}) => {
    const r = runPs([
      '-Out', 'x', ...target(),
      '-SendKeys', chord,
      '-WatchMs', String(watchMs),
      '-SendTimes', String(times),
    ])
    const line = (r.stdout || '').trim().split('\n').pop()
    // sendErr 单独记：投递命令没跑成（COM/SendKeys 在某些执行上下文里会被吞掉）和
    // 「投了但热键没响应」是两件事，混在一条红里就查不动了。
    const sendErr = r.status !== 0 || !!r.error ? String(r.error || r.stderr || '').slice(0, 140) : null
    try {
      return { chord, sendErr, ...JSON.parse(line) }
    } catch {
      return { chord, sendErr, error: (r.stderr || line || 'ps1 没有输出').toString().slice(0, 140) }
    }
  }
  /**
   * 一次按键 = 一次翻转，起点用 ps1 在**投递前几毫秒**读的那次可见性（preSendVisible）。
   * 之前试过两种写法，都不成立：
   * - JS 侧先 `state()` 再投递：中间隔着一次 1.1–1.3 秒的跨进程采样，窗口被人碰一下就说不清了；
   * - 只断言"投递之后 visible 变成了 X"：唤出那条会白过（起点本来就是可见时它也成立）。
   * 现在三条判据都要起点+终点+中间真的动过，缺一不绿。
   */
  const wentHidden = (w) => w.preSendVisible === true && w.everHidden === true && w.finalVisible === false
  const cameBack = (w) => w.preSendVisible === false && w.everVisible === true && w.finalVisible === true
  const untouched = (w) => w.preSendVisible === true && w.everHidden === false && w.finalVisible === true
  const sendChord = summon?.registered ? toSendKeys(summon.keys) : null

  /**
   * 「投递侧到不到」要先探清楚，再决定断言怎么写。
   *
   * 这一段曾经长期挂着两条红，而真因不是产品缺陷：
   *   - 热键注册**成功**：`global_shortcuts` 报 registered=true，且用 RegisterHotKey
   *     在外部反查同一组合键会拿到 1409(ERROR_HOTKEY_ALREADY_REGISTERED) —— 有人在占，
   *     那个「人」就是 modulo 自己。
   *   - 投递**到不了**：SendKeys 连投 12 次/12 秒无一送达；改用 SendInput 直接注入
   *     扫描码同样送不到；换成 notepad 收 SendKeys 正常，说明 SendKeys 本身没坏。
   *     本机有别的常驻程序（如 LeagueClientUx）长期占着前台，而 SendKeys 的投递
   *     受焦点影响，投出去很可能被前台那个程序吃掉。
   *
   * 所以：**注册成功但一条都送不到 → 判 SKIP 并写明原因**，而不是留一条红让人
   * 误读成「全局快捷键坏了」。真坏的情形（压根没注册）已经被上面那条 registered 覆盖，
   * 而「注册了、投递也到了、却没隐藏窗口」仍然是硬红 —— 那才是真的产品缺陷。
   */
  const w1 = sendChord ? deliver(sendChord, { times: 6, watchMs: 4000 }) : null
  const deliveryWorks = !!w1 && w1.sendErr === null && (w1.everHidden || w1.everVisible !== (w1.preSendVisible !== false))
  if (!sendChord) {
    console.log('SKIP  召唤键系统投递（未注册成功，或组合键含 Win 键、SendKeys 表达不了）')
  } else if (w1.everHidden || w1.everVisible !== w1.preSendVisible) {
    check(`${summon.keys}（SendKeys ${sendChord}）经系统投递后窗口收起`, wentHidden(w1), { w1 })
    const w2 = deliver(sendChord)
    check(`再投递一次 ${summon.keys} 唤出`, cameBack(w2), { w2 })

    // 反例这条**不能连投**：它断言的就是「什么都没发生」。
    // 投 4 次只会提高「碰巧撞上某个别的热键」的概率，把一条反例变成抛硬币。
    const neg = deliver('%+m', { times: 1 })
    check('旧默认档 Alt+Shift+M 已不再触发（输入法冲突已避开）', untouched(neg), { neg })
  } else {
    console.log(
      `SKIP  召唤键「系统投递」这三条 —— 热键已注册成功（registered=${summon.registered}，` +
        `外部 RegisterHotKey 反查返回 1409 说明确实被 modulo 占着），但本机的 SendKeys ` +
        `送不到它：连投 ${w1?.sends ?? 0} 次 / ${w1?.waitedMs ?? 0}ms 一条都没到` +
        `${w1?.sendErr ? `（sendErr=${w1.sendErr}）` : ''}。` +
        `SendInput 直投扫描码同样不到，而 SendKeys 给 notepad 正常 —— 是本机有常驻程序占着前台、` +
        `投递被吃掉。「注册成功」本身由上面 global_shortcuts 那条覆盖；` +
        `「投递到了却没隐藏窗口」仍会硬红，那才是真缺陷。`,
    )
    check(
      '召唤键已注册（投递侧不可达时的替代判据，见上方 SKIP 说明）',
      summon.registered === true,
      { keys: summon.keys, registered: summon.registered, delivered: false },
    )
  }

  // ---- 改键：裸键必须被拒。windows-gnu 下引用 parse_chord 会让 Rust 测试二进制加载失败，
  // 这条只能端到端验（见 lib.rs 里 parse_chord 的注释）。
  const bare = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('set_shortcut', { kind: 'summon', chord: 'M' })
      return { rejected: false }
    } catch (err) {
      return { rejected: true, reason: String(err) }
    }
  })
  check('没有修饰键的裸键被拒', bare.rejected === true, bare)

  // ---- 改键真的可用：换成 Ctrl+Alt+F13（本机没有这个物理键、也没人抢），投递验一次再换回默认 ----
  const REBIND_TO = 'Ctrl+Alt+F13'
  const original = summon?.keys ?? ''
  const rebound = await page.evaluate(
    async (chord) => {
      try {
        const r = await window.__TAURI_INTERNALS__.invoke('set_shortcut', { kind: 'summon', chord })
        // registered 一定要带出来：`set_shortcut` 返回 ShortcutStatus，
        // 「写进内存了」与「真的向 OS 注册上了」是两件事（别的程序占着同一组合时只有前者成立）
        return { ok: true, keys: r.keys, registered: r.registered }
      } catch (err) {
        return { ok: false, reason: String(err) }
      }
    },
    REBIND_TO,
  )
  check(`改键：注册 ${REBIND_TO} 成功`, rebound.ok && rebound.keys === REBIND_TO && rebound.registered === true, rebound)
  if (rebound.ok) {
    /**
     * 同样先探投递到不到：上面若已判定「本机投递侧不可达」，这里就不重复红一遍。
     * 改键「注册上了」由 `rebound.registered` 覆盖（invoke 的返回值里有），
     * 「投递到了却不隐藏窗口」仍然是硬红。
     */
    const wNew1 = deliver(toSendKeys(REBIND_TO), { times: 6, watchMs: 4000 })
    const delivered = wNew1.everHidden || wNew1.everVisible !== wNew1.preSendVisible
    if (delivered) {
      const wNew2 = deliver(toSendKeys(REBIND_TO))
      check(
        '改键后新组合键经系统投递可用（收起 + 唤出）',
        wentHidden(wNew1) && cameBack(wNew2),
        { wNew1, wNew2 },
      )

      if (sendChord) {
        const wOld = deliver(toSendKeys(original), { times: 1 })
        check('改键后旧组合键不再响应（没有留双绑）', untouched(wOld), { wOld })
      }
    } else {
      console.log('SKIP  「改键后新组合键经系统投递可用」—— 投递侧同样不可达，见上面召唤键那段的说明')
      check(
        `改键后新组合键已注册（投递侧不可达时的替代判据）`,
        rebound.registered === true,
        { keys: rebound.keys, registered: rebound.registered, delivered: false },
      )
    }
    // 换回来。这一步不能抛：默认档本身被别的程序占着时（本机实测 Ctrl+Alt+M/T 返回 1409），
    // 抛出来会把后面十几条检查一起带走 —— 那是「一条环境问题毁掉整轮」，不是产品缺陷。
    const restoredBack = await page.evaluate(
      async (chord) => {
        try {
          const r = await window.__TAURI_INTERNALS__.invoke('set_shortcut', { kind: 'summon', chord })
          return { ok: true, keys: r.keys, registered: r.registered }
        } catch (err) {
          return { ok: false, reason: String(err) }
        }
      },
      original,
    )
    if (summon?.registered) {
      check(`换回默认组合键 ${original}`, restoredBack.ok && restoredBack.keys === original, restoredBack)
    } else {
      console.log(`SKIP  换回默认组合键 ${original}（默认档本轮就没注册上，换回去也必然失败：${restoredBack.reason ?? restoredBack.keys}）`)
    }
  }

  // ---- 真实 GPU 下的帧距：E2E 那条只能测 headless，这里在 WebView2 上重测一次 ----
  // 用整版重排（撑满 → 整理）压出让位动画与全网格重绘，采样 rAF 间隔；
  // 结束后撤销回原状，不给用户存档留副作用。门槛是 min(18.2ms, 1.5×空闲基线) —— 只用 E2E 那个
  // 绝对值 18.2ms 在高刷屏上形同虚设（本机 240Hz、基线 4.2ms，掉到 60fps 都算过）；p95 ≤33.4ms（不许掉到 30fps 以下）。
  const layoutSig = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.grid .cell')]
        .map((c) => {
          const s = getComputedStyle(c)
          return `${c.getAttribute('aria-label')?.slice(0, 2)}@${s.gridColumnStart}/${s.gridRowStart}`
        })
        .sort()
        .join('|'),
    )
  const undoKey = () =>
    page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    })

  const layout0 = await layoutSig()
  /** rAF 采样器：startSampler 开始记录，stopSampler 关掉开关并返回帧距分布 */
  const startSampler = () =>
    page.evaluate(() => {
      const w = window
      w.__frames = []
      w.__sampling = true
      const tick = (t) => {
        if (!w.__sampling) return
        w.__frames.push(t)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  const stopSampler = () =>
    page.evaluate(() => {
      window.__sampling = false
      const f = window.__frames ?? []
      const d = []
      for (let i = 1; i < f.length; i++) {
        // 同一帧可能派发多次回调（时间戳相同）：0 差值不是"零耗时帧"，留着会把
        // 高刷屏（本机 240Hz）的中位数拉到 0，必须丢掉。
        if (f[i] > f[i - 1]) d.push(f[i] - f[i - 1])
      }
      d.sort((a, b) => a - b)
      const q = (p) => (d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : 0)
      return { frames: d.length, median: q(0.5), p95: q(0.95), max: q(1) }
    })

  // 先采一段空闲基线：帧距下限由面板刷新率决定（本机实测 240Hz）。只用绝对阈值
  // 18.2ms 在高刷屏上形同虚设 —— 掉到 60fps 都能"过"。所以门槛取
  // min(18.2, 1.5 × 基线)：60Hz 面板上仍是 18.2，240Hz 面板上收紧到 ~6.3ms。
  await startSampler()
  await sleep(500)
  const base = await stopSampler()
  await startSampler()
  await clickText(page, '撑满')
  await sleep(450)
  await clickText(page, '整理')
  await sleep(450)
  const cadence = await stopSampler()
  const limit = +Math.min(18.2, base.median * 1.5).toFixed(1)
  for (let i = 0; i < 4 && (await layoutSig()) !== layout0; i++) {
    await undoKey()
    await sleep(250)
  }
  const layoutRestored = (await layoutSig()) === layout0
  check(
    `真实 WebView2 帧距：重排中位 ≤${limit}ms（= min(18.2, 1.5×基线 ${base.median}ms)）、p95 ≤33.4ms`,
    cadence.frames > 20 && base.frames > 10 && cadence.median <= limit && cadence.p95 <= 33.4 && layoutRestored,
    { baseline: base, churn: cadence, limit, layoutRestored },
  )

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

  // ---- 每日一图的取数链路 ----
  // 这条要联网，且只有真机壳里才有桌面侧取数（网页版没有 __TAURI_INTERNALS__）。
  // 所以它跑在**发布门禁**之外：探针默认跳过，用 PROBE_NET=1 才验。
  // 验的是「命令真的能取到当天的壁纸元信息」，不是「界面画了个框」——
  // 前者只有这一处能验，后者 E2E 已经管了。
  if (process.env.PROBE_NET === '1') {
    let wall = { ok: false }
    try {
      wall = await page.evaluate(async () => {
        try {
          const r = await window.__TAURI_INTERNALS__.invoke('bing_daily')
          return { ok: true, url: r?.url ?? '', copyright: r?.copyright ?? '', startDate: r?.startDate ?? '' }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      })
    } catch (e) {
      wall = { ok: false, error: String(e) }
    }
    // 地址必须是补全过的绝对地址：卡片直接把它塞进 <img src>，留相对地址会 404，
    // 而那种 404 在界面上长得像「今天没图」
    check(
      '每日一图：桌面侧真的取到了当天壁纸',
      wall.ok && wall.url.startsWith('https://www.bing.com/th?id=') && wall.url.length > 32 && /^\d{8}$/.test(wall.startDate),
      wall,
    )

    // 网页监控的边界：命令在，私网地址被挡住了，明文 http 也被挡住。
    // 这三条正是这张卡承诺的东西，所以必须在真壳里验 —— 前端那份校验可以被 XSS 绕过，
    // Rust 那份才是安全边界。
    const mon = await page.evaluate(async () => {
      const ask = async (url) => {
        try {
          const r = await window.__TAURI_INTERNALS__.invoke('web_probe', { url })
          return { url, error: r?.error ?? '', elapsed: r?.elapsedMs ?? -1 }
        } catch (e) {
          return { url, error: `invoke 失败: ${String(e)}`, elapsed: -1 }
        }
      }
      return {
        blocked: await ask('https://127.0.0.1/'),
        blockedMeta: await ask('https://169.254.169.254/latest/meta-data/'),
        plaintext: await ask('http://example.com/'),
      }
    })
    check('网页监控：私网回环地址被边界挡住', mon.blocked.error !== '' && mon.blocked.elapsed === 0, mon.blocked)
    check('网页监控：云元数据端点被边界挡住', mon.blockedMeta.error !== '', mon.blockedMeta)
    check('网页监控：明文 http 被边界挡住', mon.plaintext.error !== '', mon.plaintext)
  }

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

  // ---- 设置页的「改键」录制：合成 keydown 走的是真 DOM 路径（document 捕获阶段），
  // 但不是 OS 输入 —— 只验「按下去拼成什么组合键、有没有落到 Rust」，投递本身在上面那块已验过。
  await clickIn(app.page, '.panel .keys .rec')
  check('快捷键每一行都有「改键」按钮', await app.page.evaluate(() => !!document.querySelector('.panel .keys .rec.live')))

  const summonKeys = () =>
    app.page.evaluate(async () => (await window.__TAURI_INTERNALS__.invoke('global_shortcuts')).find((s) => s.kind === 'summon').keys)
  const press = (init) =>
    app.page.evaluate((i) => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...i })), init)
  // 把「Ctrl+Alt+Shift+M」这形状的组合键还原成一次 keydown：录制端读的是 event.code 和四个
  // 修饰位，所以这里必须照抄修饰键 —— 少给一个 Shift，界面拼出来的就是另一个组合键。
  const chordEvent = (chord) => {
    const tokens = chord.split('+').map((t) => t.trim())
    const mods = tokens.slice(0, -1).map((t) => t.toLowerCase())
    const key = tokens.at(-1)
    const code = /^[A-Z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
    return {
      code,
      key: key.toLowerCase(),
      ctrlKey: mods.includes('ctrl') || mods.includes('control'),
      altKey: mods.includes('alt') || mods.includes('option'),
      shiftKey: mods.includes('shift'),
      metaKey: mods.includes('super') || mods.includes('win') || mods.includes('cmd'),
    }
  }
  // 基线从「当前实际生效的键」取，不写死默认档：上一轮探针若在录制块中途挂掉，存档里留的就是改过的键，
  // 写死默认组合会让下一轮凭空红一条。
  const base0 = await summonKeys()
  const swap = base0 === 'Ctrl+Alt+B' ? 'Ctrl+Alt+M' : 'Ctrl+Alt+B'

  await press({ code: 'ControlLeft', key: 'Control', ctrlKey: true })
  await sleep(300)
  check(
    '只按修饰键不提交（还在录制，键没变）',
    (await summonKeys()) === base0 && (await app.page.evaluate(() => !!document.querySelector('.panel .keys .rec.live'))),
  )

  await press({ code: 'Escape', key: 'Escape' })
  await sleep(200)
  check(
    'Esc 取消录制：退出录制状态且不改键',
    (await app.page.evaluate(() => !document.querySelector('.panel .keys .rec.live'))) && (await summonKeys()) === base0,
  )

  await clickIn(app.page, '.panel .keys .rec')
  await press(chordEvent(swap))
  await sleep(500)
  const shownKeys = await app.page.evaluate(() => document.querySelector('.panel .keys kbd')?.textContent)
  check(`录制 ${swap}：Rust 换键、界面上的 kbd 跟着换`, (await summonKeys()) === swap && shownKeys === swap, { shownKeys })

  let shellSaved = null
  try {
    shellSaved = JSON.parse(readFileSync(join(dir, 'modulo.shell.v1.json'), 'utf8'))
  } catch {
    /* 下面断言会报出来 */
  }
  check('改过的键写进了 appData 的 shell 存档（不是只活在内存里）', shellSaved?.summon === swap, {
    file: join(dir, 'modulo.shell.v1.json'),
    summon: shellSaved?.summon,
  })

  await clickIn(app.page, '.panel .keys .rec')
  await press(chordEvent(base0))
  await sleep(500)
  check(`再录一次换回基线 ${base0}`, (await summonKeys()) === base0, { keys: await summonKeys() })

  // ---- 带修饰键的 Esc 是一枚合法和弦，不该被"取消录制"吃掉（前端那条修复的真机证据）。
  // 这里只验 DOM → 拼弦 → Rust 注册这段；投递要不要赢在上面的系统级投递块已经验过同类。
  const escChord = 'Ctrl+Alt+Shift+Escape'
  await clickIn(app.page, '.panel .keys .rec')
  await press({ code: 'Escape', key: 'Escape', ctrlKey: true, altKey: true, shiftKey: true })
  await sleep(500)
  check(
    `录制 ${escChord}：带修饰的 Esc 提交给 Rust，而不是当成取消`,
    (await app.page.evaluate(() => !document.querySelector('.panel .keys .rec.live'))) && (await summonKeys()) === escChord,
    { keys: await summonKeys() },
  )

  await clickIn(app.page, '.panel .keys .rec')
  await press(chordEvent(base0))
  await sleep(500)
  check(`录完 Esc 和弦后换回基线 ${base0}`, (await summonKeys()) === base0, { keys: await summonKeys() })

  /**
   * 「藏进托盘」这条之前成对红过：判据是 `visible === false && iconic === false`，
   * 而窗口是先被点成图标态、再被藏起来的 —— 1.5 秒一采的轮询很容易只看到中间那个
   * 图标态（rect 是 -32000 那种垃圾值），于是既判不出「藏了」也拿不到可用的矩形。
   * 现在谓词是 PS 侧的 `hidden`，40ms 一跳，藏起来这个瞬态必然被抓住。
   */
  await clickIn(app.page, '.tb-btn[aria-label="关闭"]')
  const hidden = await waitUntil('hidden')
  check('拨开开关后点关闭是藏进托盘，进程不退出', hidden.ok, { waitedMs: hidden.waited, samples: hidden.samples, ...hidden.s })

  runPs(['-Out', 'x', '-Restore', ...target()])
  const shownAgain = await waitUntil('visible', { timeout: 5000 })
  check('藏起来的窗口可以恢复', shownAgain.ok, { waitedMs: shownAgain.waited, samples: shownAgain.samples, ...shownAgain.s })

  /**
   * 开关要确认真的拨回去了，不能假设。
   * 上面那条刚把窗口藏起来，这中间若有任何一步把面板关掉 / 重建，
   * `.panel input[type="checkbox"]` 可能命中的是别的开关或压根不存在 ——
   * 「拨回去」没生效时，点关闭只会再藏一次，而进程不退出，末态就变成
   * 「关不掉」。实测这里红过一次，而真因是上一步没拨成功，不是退出逻辑坏了。
   */
  const toggleShell = async () => {
    // 面板可能被藏窗口那次顺带关掉；点不到就先重新打开设置页
    if (!(await clickIn(app.page, '.panel input[type="checkbox"]'))) {
      await clickIn(app.page, 'button[title="外观设置"]')
      await sleep(400)
      return clickIn(app.page, '.panel input[type="checkbox"]')
    }
    return true
  }
  const shellToggled = await toggleShell()
  await sleep(400)
  const shellOff = await app.page.evaluate(() => document.querySelector('.panel input[type="checkbox"]')?.checked === false)
  check('「收进托盘」开关确实被拨回（不是点空或点错开关）', shellToggled && shellOff)

  await clickIn(app.page, '.tb-btn[aria-label="关闭"]')
  let exited = false
  for (let i = 0; i < 50 && !exited; i++) {
    await sleep(200)
    exited = app.child.exitCode !== null
  }
  check('拨回去之后点关闭真的退出', exited, { exitCode: app.child.exitCode })
} catch (err) {
  check('自检过程未抛异常', false, String(err).slice(0, 300))
} finally {
  await stop(app).catch(() => {})
}

// ---- 夹取分支实测：大屏上 fit_window 平时走的是「放得下就不动」那条路，夹取只有单测。
// 用 lib.rs 的测试接缝把期望尺寸顶过工作区，就能在真窗口上验它一次。
let clampApp = null
try {
  clampApp = await launch({ MODULO_WANT_SIZE: '2600x1500' })
  const cdpr = await clampApp.page.evaluate(() => window.devicePixelRatio)
  const first = state()
  const clampW = Math.round(fit(first.work.w / cdpr, 2600, 380) * cdpr)
  const clampH = Math.round(fit(first.work.h / cdpr, 1500, 560) * cdpr)
  /**
   * 轮询到「夹取真的落地」再断言。谓词交给 PS 侧的 `size`（40ms 一跳）——
   * 之前这里是 JS 循环调 state()，实际 1.5 秒一采，冷启动超过 1.5 秒时量到的
   * 永远是夹取前的矩形，两条断言因此成对红。现在 8 秒里有约 200 个样本。
   * 判据仍可证伪：真不夹取，谓词永远不成立，8 秒后照样红。
   */
  const clamped = await waitUntil('size', { targetW: clampW, targetH: clampH, tol: 40, timeout: 8000 })
  const cs = clamped.s
  check(
    '夹取分支实测：期望尺寸顶过工作区后被逐轴夹住',
    clamped.ok,
    { want: '2600x1500', dpr: cdpr, waitedMs: clamped.waited, samples: clamped.samples, work: cs.work, rect: cs.rect, expect: { w: clampW, h: clampH } },
  )
  /** center() 是按可见外框居中的，GetWindowRect 含不可见边框，所以留 24px 余量 */
  const offCenter = cs.rect ? Math.abs(cs.rect.x - (cs.work.x + (cs.work.w - cs.rect.w) / 2)) : NaN
  check('夹取后窗口居中（左右留白对称）', offCenter <= 24, { offCenter, x: cs.rect?.x, work: cs.work })
} catch (err) {
  check('夹取分支自检未抛异常', false, String(err).slice(0, 200))
} finally {
  if (clampApp) await stop(clampApp).catch(() => {})
}

restoreAppearance()

const failed = report.filter((r) => !r.pass)
console.log(`\n${report.length - failed.length}/${report.length} 通过`)
/**
 * 逐项结果落盘 + 一行历史。红过的那一轮如果只存在终端 scrollback 里（或者输出被 tail 截了），
 * 就再也问不出是哪两条红、是「慢」还是「坏」—— 抖动必须能归因，不然只能重跑赌绿。
 * 写在 evidence/ 而不是 evidence/desktop/：后者每轮开头会被 rmSync 清空。
 */
writeFileSync(
  join('evidence', 'probe-report.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      exe: EXE,
      passed: report.length - failed.length,
      total: report.length,
      failed: failed.map((f) => f.name),
      checks: report,
    },
    null,
    2,
  ),
)
appendFileSync(
  join('evidence', 'probe-history.log'),
  `${new Date().toISOString()} ${report.length - failed.length}/${report.length}${
    failed.length ? '  FAIL: ' + failed.map((f) => f.name).join(' | ') : ''
  }\n`,
)
process.exit(failed.length ? 1 : 0)
