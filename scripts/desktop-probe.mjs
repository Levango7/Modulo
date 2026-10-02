import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
/** 复刻 lib.rs 的 fit_size：放得下（留 32px 边距）就用期望值，放不下取该轴 94%，不低于最小尺寸 */
const fit = (avail, want, min) => (want + 32 <= avail ? want : Math.max(avail * 0.94, min))

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

async function launch(extraEnv = {}) {
  const child = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`, ...extraEnv },
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
  /**
   * 句柄要钉在「主窗口已经成形」之后。图标态窗口的 `GetWindowRect` 就是 (-32000,-32000,237,39)
   * 这种垃圾值，而一旦钉上去，这一轮后面每条 Win32 断言读的都是它 —— 轮询等多久都不会自己变对
   * （实测「夹取尺寸 + 居中」两条因此成对红，四轮里中了两次）。
   * 分不清是辅助窗口抢下还是主窗口自己在图标态，所以两条都堵：筛子只收可见非图标态
   * （见 shot-window.ps1），这里每轮重试前把 hwnd 清 0 强制重新解析，等不到就抛。
   */
  let s = state()
  for (let i = 0; i < 30 && !(s.running && s.iconic === false && s.rect && s.rect.w > 400); i++) {
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
    throw new Error(`启动后 9 秒内没拿到可见的主窗口，最后读到的是 ${JSON.stringify(s)}`)
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
  const deliver = (chord, watchMs = 2600) => {
    const r = runPs(['-Out', 'x', ...target(), '-SendKeys', chord, '-WatchMs', String(watchMs)])
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
  if (sendChord) {
    const w1 = deliver(sendChord)
    check(`${summon.keys}（SendKeys ${sendChord}）经系统投递后窗口收起`, wentHidden(w1), { w1 })
    const w2 = deliver(sendChord)
    check(`再投递一次 ${summon.keys} 唤出`, cameBack(w2), { w2 })

    const neg = deliver('%+m')
    check('旧默认档 Alt+Shift+M 已不再触发（输入法冲突已避开）', untouched(neg), { neg })
  } else {
    console.log('SKIP  召唤键系统投递（未注册成功，或组合键含 Win 键、SendKeys 表达不了）')
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
        return { ok: true, keys: r.keys }
      } catch (err) {
        return { ok: false, reason: String(err) }
      }
    },
    REBIND_TO,
  )
  check(`改键：注册 ${REBIND_TO} 成功`, rebound.ok && rebound.keys === REBIND_TO, rebound)
  if (rebound.ok) {
    const keys = toSendKeys(REBIND_TO)
    const preNew = state().visible
    const wNew1 = deliver(keys)
    const wNew2 = deliver(keys)
    check(
      '改键后新组合键经系统投递可用（收起 + 唤出）',
      wentHidden(wNew1, preNew) && cameBack(wNew2),
      { preNew, wNew1, wNew2 },
    )

    if (sendChord) {
      const wOld = deliver(toSendKeys(original))
      check('改键后旧组合键不再响应（没有留双绑）', untouched(wOld), { wOld })
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
   * 轮询到「夹取真的落地」再断言。原来这里是一次固定 sleep(1500) + 单次采样，
   * 于是连着两轮 45/47 都是这两条同时红 —— `fit_window` 的 set_size + center() 是跨进程异步调用，
   * 上一轮实例刚退出时冷启动会超过 1.5 秒，量到的是夹取前的矩形。这是把「慢」报成「坏」，
   * 而这条正是前面已经修过六遍的那个模式，我在这个新增块里又写了一遍。
   * 判据仍然可证伪：真不夹取，谓词永远不成立，8 秒后照样红。
   */
  const clamped = await waitUntil(
    (s) => !!s.rect && Math.abs(s.rect.w - clampW) <= 40 && Math.abs(s.rect.h - clampH) <= 40,
    { timeout: 8000 },
  )
  const cs = clamped.s
  check(
    '夹取分支实测：期望尺寸顶过工作区后被逐轴夹住',
    clamped.ok,
    { want: '2600x1500', dpr: cdpr, waitedMs: clamped.waited, work: cs.work, rect: cs.rect, expect: { w: clampW, h: clampH } },
  )
  /** center() 是按可见外框居中的，GetWindowRect 含不可见边框，所以留 24px 余量 */
  const offCenter = cs.rect ? Math.abs(cs.rect.x - (cs.work.x + (cs.work.w - cs.rect.w) / 2)) : NaN
  check('夹取后窗口居中（左右留白对称）', offCenter <= 24, { offCenter, x: cs.rect?.x, work: cs.work })
} catch (err) {
  check('夹取分支自检未抛异常', false, String(err).slice(0, 200))
} finally {
  if (clampApp) await stop(clampApp).catch(() => {})
}

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
