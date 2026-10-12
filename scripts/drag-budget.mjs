#!/usr/bin/env node
/**
 * drag-budget.mjs —— 拖拽的**计数型**预算门禁。
 *
 * ## 它为什么存在（而不是复用已有的帧率门禁）
 *
 * `tests/e2e/layout.spec.ts:754` 已经有一条 §8 帧率门禁（连拖期间帧距中位数 ≤ 18.2ms）。
 * 它是真的在跑（`it.skipIf(!EXE)`，本机与 CI 都有 Chrome），实测输出：
 *
 *     [拖动帧距实测] frames=101 median=16.7ms p95=16.7ms
 *
 * 但它有两个**结构性**盲区，注定抓不到"成本"这一类回归：
 *
 * 1. **它量的是 60Hz 的节拍，不是成本。** headless 的 rAF 被钉在 60Hz（16.7ms 卡得死死的），
 *    所以这条断言本质上在问"页面还能不能保持 60Hz" —— 只有成本**逼近或超过** 16.7ms 才翻红。
 *    实测背景：一次"每帧全量重排"的退化让主线程从 2.85ms/帧 涨到 8ms/帧（**四倍**），
 *    而这条门禁全程一声不吭。
 * 2. **只看中位数，对尾部无感。** "卡顿感"几乎全是尾部事件（偶发掉帧），中位数天然抹平。
 *
 * 所以这里换一个**与刷新率无关、与机器负载无关**的判据：Blink 自己记的账。
 *
 * ## 判据：每次 pointermove 触发多少次布局 / 样式重算
 *
 * 一次拖拽的**正确**代价是：指针在动，但版面**不该**跟着每帧重排。所以：
 *
 *   · `LayoutCount / move` —— 改前 1.03（= 每帧一次全量重排），改后 0.10（只在跨格时算）。
 *     阈值 0.5：给"栅格离散跨格"留出 5 倍余量，同时**明确禁止**每帧重排。
 *   · `RecalcStyleCount / move` —— 样式重算同理。
 *
 * 这两个数**是确定性的**：同一份产物连跑三轮逐字一致（实测 `Layout` 62/62/62）。
 * 这正是它比帧率适合当红线的原因 —— 数字稳、跨机器一致、不会因为 runner 忙就假红。
 *
 * ## 一个必须记下来的教训：别用"帧率"量"成本"
 *
 * 本脚本的前身试过两条路，都被实测推翻：
 *   · 用 CDP `page.mouse.move(steps)` 发合成输入 + rAF 采帧间隔判"掉帧" —— 不成立：
 *     headless 无 vsync（rAF 全速驱动，p50 量到 4.2ms ≈ 238fps），且 CDP 每次派发一个
 *     协议往返，页面在等回包时是真 idle（CPU 剖析里 `(idle)` 占 36.5%），全是假象。
 *   · 用 CDP CPU Profiler 找热点 —— 不成立：生产构建压缩后前排全是单字母函数名，
 *     且只有 20% 样本落在 JS 上（瓶颈本来就**不在 JS**）。
 * 结论：**输入要在页面内用 rAF 自己派发**（每帧一次 move，贴合真实高刷鼠标），
 * 指标要用 Blink 的计数器（`Performance.getMetrics()`），不要用墙钟帧率。
 *
 * ## 用法
 *   npm run drag:budget              # 门禁：不合预算就 exit 1
 *   npm run drag:budget -- --probe   # 只打印数字，不判定（exit 0）
 *
 * 退出码：0 通过（或没有 Chrome，跳过）；1 超预算。
 */

import { existsSync } from 'node:fs'
import { preview } from 'vite'
import puppeteer from 'puppeteer-core'

const arg = (k, def = null) => {
  const i = process.argv.indexOf('--' + k)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const STEPS = Number(arg('steps', 60))
const PROBE = process.argv.includes('--probe')

/** 预算（每次 pointermove 的**次数上限**）。理由见文件头，数字来自实测的两端。 */
const BUDGET = {
  layoutPerMove: 0.5, // 改前 1.03（每帧重排）· 改后 0.10
  stylePerMove: 3.0, // 改前 ~1.2 · 改后 ~1.2（这一维本来就不是瓶颈，只做兜底）
}

function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p))
}

/**
 * 页面内的拖拽驱动器：**在页面里派发指针事件**，用 rAF 推进 —— 每帧一次 move。
 *
 * 为什么不用 `page.mouse.move`：那条路每次派发一个 CDP 往返，页面在等回包时是真 idle，
 * 会把"成本"稀释掉（剖析里量到 36.5% 假 idle）。真实高刷鼠标不给主线程那些空档。
 */
const DRIVE = async (steps) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
  const pt = (type, x, y, target, buttons) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons,
      }),
    )
  const canvas = document.querySelector('.canvas')
  const cr = canvas.getBoundingClientRect()
  const tag = document.querySelector('.canvas .cell .tag')
  if (!tag) return { error: '找不到拖拽抓手（.canvas .cell .tag）' }
  const tr = tag.getBoundingClientRect()
  const from = { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 }
  const to = { x: cr.x + cr.width * 0.6, y: cr.y + cr.height * 0.45 }

  await frame()
  pt('pointerdown', from.x, from.y, tag, 1)
  pt('pointermove', from.x + 2, from.y + 2, window, 1)
  await frame()
  for (let i = 1; i <= steps; i++) {
    await frame()
    const k = i / steps
    pt('pointermove', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, window, 1)
  }
  await frame()
  pt('pointerup', to.x, to.y, window, 0)
  await frame()
  return { moves: steps }
}

const fmt = (v, w = 10) => String(v).padStart(w)

async function main() {
  const exe = chromePath()
  if (!exe) {
    // 与 E2E 的 `it.skipIf(!EXE)` 同一套约定：没有浏览器就跳过，不是失败。
    // 假红比没门禁更糟 —— 人只会学会忽略它。
    console.log('拖拽预算门禁：找不到 Chrome，跳过（设 CHROME_PATH 或装 Chrome）')
    return
  }
  if (!existsSync('dist/index.html')) {
    console.error('拖拽预算门禁：没有 dist/ —— 先跑 `npm run build`（本脚本只 preview，不替你构建）')
    process.exit(1)
  }

  const server = await preview({ preview: { port: 0, host: '127.0.0.1', logLevel: 'warn' } })
  const addr = server.httpServer.address()
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })

  try {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    // 与 E2E 同一套预置：否则首启的模板选择器会挡住画布
    await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 600))

    const entered = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '布局编辑')
      el?.click()
      return !!el
    })
    if (!entered) throw new Error('顶栏找不到「布局编辑」')
    await new Promise((r) => setTimeout(r, 600))

    const client = await page.createCDPSession()
    await client.send('Performance.enable')
    const snap = async () => {
      const { metrics } = await client.send('Performance.getMetrics')
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
    }

    // 先跑一次**热身**并丢掉：首次拖拽要付 JIT 与懒加载的钱，计进预算会误伤。
    const warm = await page.evaluate(DRIVE, STEPS)
    if (warm.error) throw new Error(warm.error)

    const before = await snap()
    const drive = await page.evaluate(DRIVE, STEPS)
    if (drive.error) throw new Error(drive.error)
    const after = await snap()

    const delta = (k) => (after[k] ?? 0) - (before[k] ?? 0)
    const moves = drive.moves
    const layoutPerMove = delta('LayoutCount') / moves
    const stylePerMove = delta('RecalcStyleCount') / moves

    console.log(`\n拖拽预算门禁 · 1440×900 · ${moves} 次 pointermove · ${exe.split(/[\\/]/).pop()}\n`)
    console.log('  指标                        实测      预算     每次 move')
    const row = (name, got, budget, per) =>
      console.log(
        `  ${name.padEnd(24)} ${fmt(got, 6)} ${fmt(budget, 9)} ${fmt(per.toFixed(3), 12)}`,
      )
    row('布局次数 LayoutCount', delta('LayoutCount'), `≤ ${BUDGET.layoutPerMove}`, layoutPerMove)
    row('样式重算 RecalcStyleCount', delta('RecalcStyleCount'), `≤ ${BUDGET.stylePerMove}`, stylePerMove)
    console.log(
      `\n  参考：脚本时长 ${delta('ScriptDuration').toFixed(3)}s · 主线程 ${delta('TaskDuration').toFixed(3)}s` +
        ` · 布局耗时 ${(delta('LayoutDuration') * 1000).toFixed(1)}ms · 样式耗时 ${(delta('RecalcStyleDuration') * 1000).toFixed(1)}ms`,
    )

    const fails = []
    // 拖拽真的发生了吗 —— 没发生的话"没超预算"是句空话（门禁自己失效比产品退化更糟）
    if (moves < STEPS) fails.push(`只派发了 ${moves} 次 pointermove（期望 ${STEPS}）—— 拖拽没跑起来，本次结论无效`)
    if (layoutPerMove > BUDGET.layoutPerMove)
      fails.push(
        `每次 move 布局 ${layoutPerMove.toFixed(3)} 次，超预算 ${BUDGET.layoutPerMove}\n` +
          `      拖拽时版面不该每帧重排。最常见的成因：把**布局属性**（left/top/width/height/margin）\n` +
          `      绑到了跟随指针的响应式值上 —— 那条路每帧都会 InvalidateLayout。\n` +
          `      改用 transform（只走合成，不碰布局，帧内可合并）。`,
      )
    if (stylePerMove > BUDGET.stylePerMove)
      fails.push(`每次 move 样式重算 ${stylePerMove.toFixed(3)} 次，超预算 ${BUDGET.stylePerMove}`)

    if (PROBE) {
      console.log('\n（--probe：只打印，不判定）\n')
      return
    }
    if (fails.length) {
      console.error(`\n✗ 拖拽预算超了：\n  · ${fails.join('\n  · ')}\n`)
      process.exit(1)
    }
    console.log('\n✓ 拖拽预算内（版面没有跟着每帧重排）\n')
  } finally {
    await browser.close()
    await server.httpServer.close()
  }
}

main().catch((e) => {
  console.error('拖拽预算门禁跑不起来：', e.message)
  process.exit(1)
})
