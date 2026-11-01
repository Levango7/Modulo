/**
 * 聚合视图按实例求和（F-01 阶段 2 收尾，2026-11-01）。
 *
 * 阶段 2 把便签 / 待办 / 倒数日 / 正计时 / 四象限 / 记账 / 习惯都分成了「每张卡各写各的」。
 * 单卡取数（`stickyOf` / `todosOf` / …）有单测锁着；**逐张卡片渲染出来的样子**由
 * `instance.spec.ts` 锁着。这里锁的是第三类读点：**把这块板当整体看**的那些视图 ——
 * 图表卡、热力图、今日聚焦、月度统计。它们以前读顶层那一份（= 第一张卡），
 * 于是第二张卡的内容"界面上看得见、这些视图里算不进"。
 *
 * 判据的写法是关键：**同一份夹具跑两遍**（`twins: false/true`）。
 * 只跑有实例那一遍，把 2 当成期望值，是"拿实现当答案"；两遍的差才是
 * "这些数确实把第二张算进来了"的证据。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
const url = process.env.MODULO_URL ?? 'http://localhost:1430'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const NOW = new Date()
/** 昨天与今天：都落在图表卡的「近 28 天」窗口里，不受月初/月末影响 */
const TODAY = ymd(NOW)
const YESTERDAY = ymd(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1))
const NOW_MS = NOW.getTime()

/** 版面上五张**聚合视图**（它们自己不存数据，只读别的卡） */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [
    { id: 'chart', module: 'chart', variant: 'ledger', x: 0, y: 0, w: 4, h: 4 },
    { id: 'chart:2', module: 'chart', variant: 'habit', x: 4, y: 0, w: 4, h: 4 },
    { id: 'focus', module: 'focus', variant: 'task', x: 8, y: 0, w: 4, h: 3 },
    { id: 'monthstat', module: 'monthstat', variant: 'panel', x: 8, y: 3, w: 4, h: 4 },
    { id: 'heatmap', module: 'heatmap', variant: 'grid', x: 0, y: 4, w: 4, h: 4 },
  ],
}

/**
 * 第一张卡的内容（顶层那一份）。第二张（`byInstance`）在 `twins: true` 时才加：
 * - 记账：第一张 ¥12.50、第二张 ¥39.00 ⇒ 合计应报 ¥51.50
 * - 习惯：第一张打过昨天、第二张打过今天 ⇒ 并集 2 天、连续 2 天
 * - 待办：**已完成的那条只在第二张** ⇒ 只认第一张时"今天完成 / 本月完成"都是 0
 */
const CARD = {
  sticky: '',
  todos: [{ id: 't1', text: '第一张的待办', done: false }],
  notes: [],
  countdown: { label: '', date: '' },
  elapsed: { label: '', date: '' },
  habit: { name: '跑步', days: [YESTERDAY] },
  ledger: { symbol: '¥', entries: [{ id: 'l1', date: TODAY, cents: 1250, category: '餐饮', note: '午饭' }] },
  matrix: [],
}

const TWINS = {
  byInstance: {
    'todo:2': { todos: [{ id: 't9', text: '第二张的待办', done: true, doneAt: NOW_MS }] },
    'habit:2': { habit: { name: '冥想', days: [TODAY] } },
    'ledger:2': { ledger: [{ id: 'l9', date: TODAY, cents: 3900, category: '医疗', note: '挂号' }] },
  },
}

async function open(twins: boolean, errs: string[]) {
  const browser = await puppeteer.launch({
    executablePath: EXE!,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: `F:/tmp/pptr-profile-${Date.now()}-${twins ? 'twins' : 'solo'}`,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
  const card = twins ? { ...CARD, ...TWINS } : CARD
  await page.evaluateOnNewDocument(
    (docJson: string, cardJson: string) => {
      localStorage.setItem('modulo.template.v1', 'general')
      localStorage.setItem('modulo.layout.v1', docJson)
      localStorage.setItem('modulo.carddata.v1', cardJson)
    },
    JSON.stringify(DOC),
    JSON.stringify(card),
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  // 等到图表卡真的渲染出来（它读的正是被聚合的那份数据）
  await page.waitForSelector('.card.chart[data-v="ledger"] .sum', { timeout: 15000 })
  return { browser, page }
}

const text = (page: Awaited<ReturnType<typeof open>>['page'], sel: string): Promise<string> =>
  page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? '', sel)

describe.skipIf(skip)('聚合视图按实例求和：图表 / 热力图 / 今日聚焦 / 月度统计', () => {
  it('只有第一张时：图表报第一张的数（对照组，量的是"聚合前"）', async () => {
    const errs: string[] = []
    const { browser, page } = await open(false, errs)
    try {
      expect(await text(page, '.card.chart[data-v="ledger"] .sum')).toBe('¥12.50')
      expect(await text(page, '.card.chart[data-v="habit"] .sum'), '只有一张卡 ⇒ 报它的名字').toBe('跑步')
      expect(await text(page, '.card.chart[data-v="habit"] .cap')).toContain('打卡 1 / 28 天')
      expect(await text(page, '.card.focus .count')).toBe('今天完成 0 · 还剩 1')
      expect(await text(page, '.card.mstat .cap')).toBe('本月完成 0 · 还欠 1')
      expect(errs).toEqual([])
    } finally {
      await browser.close()
    }
  })

  it('摆上第二张之后：这五处都把它算进来了（差额就是证据）', async () => {
    const errs: string[] = []
    const { browser, page } = await open(true, errs)
    try {
      // 记账图表：两张卡的条目合成总额（币种共用一种，本来就只存顶层那份）
      expect(await text(page, '.card.chart[data-v="ledger"] .sum'), '¥12.50 + ¥39.00').toBe('¥51.50')

      // 习惯图表：两张卡的打卡日取并集 ⇒ 昨天 + 今天 = 2 天；抬头从"跑步"变成张数
      expect(await text(page, '.card.chart[data-v="habit"] .sum')).toBe('2 张习惯卡')
      const habitCap = await text(page, '.card.chart[data-v="habit"] .cap')
      expect(habitCap, '并集 2 天（只认第一张会是 1）').toContain('打卡 2 / 28 天')
      expect(habitCap, '昨天 + 今天 ⇒ 连续 2 天').toContain('连续 2 天')

      // 今日聚焦：第二张里那条已完成的也算"今天完成"
      expect(await text(page, '.card.focus .count'), '只认第一张会是 0 · 还剩 1').toBe('今天完成 1 · 还剩 1')
      expect(await text(page, '.card.focus .task'), '下一件仍是第一张里那条没做的').toBe('第一张的待办')

      // 月度统计：完成的那条在第二张里
      expect(await text(page, '.card.mstat .cap'), '只认第一张会是 0 · 还欠 1').toBe('本月完成 1 · 还欠 1')

      // 热力图：当月打过的天数（并集）。昨天的日子可能落到上个月（月初那一天），
      // 所以期望值按"种下去的日子里有几个落在本月且不晚于今天"现算 —— 判的是并集，不是写死的 2。
      const inMonth = [YESTERDAY, TODAY].filter((d) => d.slice(0, 7) === TODAY.slice(0, 7))
      const expected = new Set(inMonth).size
      const label = await page.evaluate(() => document.querySelector('.card.heat .grid')?.getAttribute('aria-label') ?? '')
      expect(label).toContain(`打卡 ${expected} 天`)

      expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
