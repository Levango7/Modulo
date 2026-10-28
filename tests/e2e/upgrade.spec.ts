/**
 * 「老档整包启动」的端到端（2026-10-29）。
 *
 * 这条承诺每个版本都成立，而此前没有任何 E2E 覆盖它：**用户带着上一版的全套数据升上来，
 * 打开还是他自己的东西**。`docs/design/FUNCTIONAL-SPEC.md` 的 F-06（迁移）射程表那一列是
 * `—`，而 `MIGRATIONS` 三张表此刻都是空的 —— 也就是说真机上"迁移"根本不会发生，能坏的
 * 不是迁移步骤，而是**读盘这一路的接缝**：版面 / 卡片内容 / 外观各自有自己的键与清洗层，
 * 任何一处读不出来或清成空，用户看到的就是"升级把数据弄丢了"。
 *
 * 这个文件钉四件事（都不需要改产品代码）：
 *  ① **全套键一起进来**：版面四张卡、便签与待办的内容、明暗与皮肤，启动后逐项在；
 *  ② **刷新之后还在**：读进来之后又被写回去，没有互相踩；
 *  ③ **有老档的用户不该被首启向导打扰**（F-10 2026-10-28 刚加的三步向导，判据是
 *     「没走过 && 版面为空」—— 有版面就走另一条路），也不该多出迁移快照键
 *     （`migrateStorage` 的「没有迁移就不写盘」，桌面壳的 `DATA_KEYS` 边界也靠这条不膨胀）；
 *  ④ **降级不丢数据**：`schemaVersion` 高于当前支持版本时（用户装过更新版又回退），
 *     按当前版本读、给告警、**原数据一条不少**（`parseLayout` 里那条 warning 分支）。
 *
 * 不种 `modulo.schemes.v1`：方案册的形状不在这条的判据里，种了只是噪声。
 * **不用固定睡眠当判据**：所有"等它出来"都靠 `waitForSelector` 等条件（本机被压满时
 * 睡眠会让用例假红，红的是负载不是回归 —— 2026-10-21 那次五个 spec 一起超时的教训）；
 * 条件成立之后只留 ≤500ms 沉降，等的是落盘防抖那类没窗口可等的尾巴，不是等状态就绪。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
const addr = () => process.env.MODULO_URL ?? 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 模拟上一版用户盘上的东西：四张卡 + 便签/待办/速记/倒数日 + 一套外观 */
const LAYOUT = {
  schemaVersion: 1,
  cols: 12,
  items: [
    { id: 'sticky', variant: 'panel', x: 0, y: 0, w: 4, h: 6 },
    { id: 'todo', variant: 'panel', x: 4, y: 0, w: 4, h: 6 },
    { id: 'ledger', variant: 'panel', x: 8, y: 0, w: 4, h: 6 },
    { id: 'countdown', variant: 'panel', x: 0, y: 6, w: 4, h: 4 },
  ],
}
const CARD_DATA = {
  sticky: '升级前写在便签上的话',
  todos: [
    { id: 'u1', text: '升级前的第一条待办', done: false },
    { id: 'u2', text: '升级前的第二条待办', done: false },
  ],
  notes: [{ id: 'un1', title: '升级前的速记', body: '正文', at: 1735689600000 }],
  countdown: { label: '升级前的倒数日', date: '2030-06-01' },
}
const APPEARANCE = { skin: 'ink', mode: 'dark', accent: '#4F46E5' }

const KEYS = {
  layout: 'modulo.layout.v1',
  card: 'modulo.carddata.v1',
  appearance: 'modulo.appearance.v1',
  template: 'modulo.template.v1',
  onboarding: 'modulo.onboarding.v1',
  migrationBackup: 'modulo.migration.backup.v1',
}

let browser: Browser
beforeAll(async () => {
  if (skip) return
  browser = await puppeteer.launch({
    executablePath: EXE!,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
  })
})
afterAll(async () => {
  await browser?.close()
})

/**
 * 种一份"上一版的盘"。**只种一次**（sessionStorage 标记）：后面要刷新，而刷新测的正是
 * "读进来又写回去还对不对"；每次导航都重种的话，量到的是种子而不是产品行为。
 * 老档不写 `modulo.onboarding.v1` —— 0.8.7 那一版根本没有这个键，这正是要测的路径。
 */
async function seed(page: Page, layout: unknown = LAYOUT): Promise<void> {
  await page.evaluateOnNewDocument(
    (l, c, a, t, k) => {
      if (sessionStorage.getItem('__upg_seeded')) return
      sessionStorage.setItem('__upg_seeded', '1')
      localStorage.setItem(k.layout, l)
      localStorage.setItem(k.card, c)
      localStorage.setItem(k.appearance, a)
      localStorage.setItem(k.template, t)
    },
    JSON.stringify(layout),
    JSON.stringify(CARD_DATA),
    JSON.stringify(APPEARANCE),
    'general',
    KEYS,
  )
  await page.goto(addr(), { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.cell[data-module="sticky"] textarea', { timeout: 15000 })
  await wait(400)
}

const snapshot = (page: Page) =>
  page.evaluate((k) => {
    const el = document.documentElement
    const pads = [...document.querySelectorAll<HTMLTextAreaElement>('.cell[data-module="sticky"] textarea')].map((t) => t.value)
    const todos = [...document.querySelectorAll<HTMLElement>('.cell[data-module="todo"] ul.list:not(.done) li span')].map(
      (s) => s.textContent?.trim() ?? '',
    )
    const cells = [...document.querySelectorAll<HTMLElement>('.cell')].map((c) => c.dataset.module ?? '')
    return {
      cells,
      pads,
      todos,
      theme: el.dataset.theme ?? '',
      skin: el.dataset.skin ?? '',
      onboardingKey: localStorage.getItem(k.onboarding),
      migrationBackupKey: localStorage.getItem(k.migrationBackup),
      storedCard: JSON.parse(localStorage.getItem(k.card) ?? '{}') as { sticky?: string; todos?: { text: string }[] },
    }
  }, KEYS)

describe.skipIf(skip)('老档整包启动：上一版的数据带着升级', () => {
  it('版面 / 内容 / 外观全套读进来，刷新之后一条不少，且不惊动首启向导', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
    await seed(page)

    const first = await snapshot(page)
    expect(first.cells.sort(), '四张卡都在（顺序按版面来，这里只比集合）').toEqual(
      ['countdown', 'ledger', 'sticky', 'todo'].sort(),
    )
    expect(first.pads, '便签正文原样').toEqual(['升级前写在便签上的话'])
    expect(first.todos, '两条待办一条不少').toEqual(['升级前的第一条待办', '升级前的第二条待办'])
    expect(first.theme, '明暗按存储走（dark）').toBe('dark')
    expect(first.skin, '皮肤按存储走（ink）').toBe('ink')

    // ③ 有版面就不是首启：向导不该被写完成态（它压根不该出现），迁移没发生就不该留快照
    expect(await page.$('.onboarding, [class*="onboarding"]'), '有老档的用户不该看到首启向导').toBeNull()
    expect(first.onboardingKey, '没弹向导就不该写它的状态键').toBeNull()
    expect(first.migrationBackupKey, '没有迁移发生，就不该留迁移快照（DATA_KEYS 不膨胀）').toBeNull()

    // ② 刷新：读进来之后又写回去，两件事没有互相踩
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('.cell[data-module="sticky"] textarea', { timeout: 15000 })
    await wait(500)
    const second = await snapshot(page)
    expect(second.cells.sort()).toEqual(['countdown', 'ledger', 'sticky', 'todo'].sort())
    expect(second.pads, '刷新后便签还在').toEqual(['升级前写在便签上的话'])
    expect(second.todos, '刷新后待办还在').toEqual(['升级前的第一条待办', '升级前的第二条待办'])
    expect(second.theme).toBe('dark')
    expect(second.skin).toBe('ink')
    expect(second.storedCard.sticky, '盘上那份也没有被清成空').toBe('升级前写在便签上的话')
    expect(second.storedCard.todos?.length, '盘上待办仍是两条').toBe(2)

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    await page.close()
  })

  it('降级场景：schemaVersion 高于当前支持版本 → 按当前版本读、数据不丢、不白屏', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
    // 用户装过更新版又回退：盘上是 v2 的版面（当前引擎只认到 v1）
    await seed(page, { ...LAYOUT, schemaVersion: 2 })

    const s = await snapshot(page)
    expect(s.cells.sort(), '降级读取：卡还在（不是回退成空版面或示例内容）').toEqual(
      ['countdown', 'ledger', 'sticky', 'todo'].sort(),
    )
    expect(s.pads, '便签正文不丢').toEqual(['升级前写在便签上的话'])
    expect(s.todos.length, '待办条数不丢').toBe(2)
    expect(errs, `降级读取不该抛错（白屏就是这里挂的）：${errs.join(' | ')}`).toEqual([])
    await page.close()
  })
})
