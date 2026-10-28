/**
 * F-04 自动备份的「设置面板链」E2E（Spec docs/design/FUNCTIONAL-SPEC.md 的 F-04「未做」项）。
 *
 * 补的正是那一格：`tests/vue/useBackup.test.ts` 已经钉死了旋转 8→7、每日 / 换版 / 无动作
 * 三种启动判定、坏索引逐项校验、DATA_KEYS 漏登记的 hydrate 链、confirmRestore 整份回填 ——
 * 但「设置面板列出并可一键恢复」只到胶水层单测 + 本机手动验证，BackupSection.vue 的模板与
 * **挂载时刷新**（P0-③ 修的那个 bug：刚生成的自动备份曾要手点一次「刷新」才出现）
 * 没有被自动化覆盖。这个文件只证那半条：**在真实浏览器里，模板层与挂载刷新真的发生**。
 *
 * 2026-10-29 再加两条（文件末尾）：**每日**与**版本变化**这两种启动判定此前只有单测 ——
 * 单测测的是 `initAutoBackup` 这个纯判定，而"启动时真的跑了、且只跑一份"取决于 App 的
 * 挂载时机、hydrate 有没有把种下去的索引搬到盘上、界面列表有没有跟上。这两条用**种索引**
 * 逼出两种判定（不用改产品代码、也不用冻时钟）：旧的那份留着、新的一份按判据追加，
 * 并且断言「换版」那条**早退**（不同时补一份每日）—— 早退不写下来，下次有人把
 * `pre-upgrade` 的 `return` 去掉，界面上只是多一行没人看出来的备份。
 *
 * 桌面形态：自动备份整条链要求 `isDesktop`（`'__TAURI_INTERNALS__' in window`），
 * 所以走 `tests/e2e/tauri-stub.js` 的桩（`__TAURI_INTERNALS__` + `read_doc`/`write_doc`
 * 都由会议历史那批 E2E 供上了，本文件不需要扩桩）。桌面形态的「盘」就是桩背后的
 * localStorage：键前缀 `modulo.__stubdoc.` —— 断言数据落盘时读的是它，不是界面。
 *
 * 为什么没有固定睡眠：本机被别的进程压满时睡眠会让用例假红（2026-10-21 跑 reminders
 * 那次，5 个 spec 一起超时，红的是负载不是回归）。一律 waitForSelector /
 * waitForFunction 等条件成立；CI 的数字才是权威证据。
 *
 * 版面只种一张 minutes 卡：模块数、待办数都是断言里要对的事实，噪声版面会让数字对不上。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE

let url = 'http://localhost:1430'
beforeAll(() => {
  url = process.env.MODULO_URL ?? url
})
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')
/** 版本号**不写死**：从 package.json 读。写死时每次切版这条都会红（0.8.5 实测）。 */
const APP_VERSION = (JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { version: string }).version
/** 拼进正则时要把点转义 */
const V_ESC = APP_VERSION.split('.').join('\\.')

/** 只上一张卡：模块数在确认块里要被断言，种死版面才能对得上 */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'minutes', variant: 'panel', x: 0, y: 0, w: 4, h: 6 }],
}

/** 种下去的卡片内容：确认块的事实摘要（几个模块 / 几条待办 / 有没有便签 / 倒数日）逐项可对 */
const CARD_DATA = {
  sticky: '备份时点的便签',
  todos: [{ id: 't1', text: '备份时点的待办', done: false }],
  notes: [{ id: 'n1', title: '备份时点的速记', body: '速记正文', at: 1735689600000 }],
  countdown: { label: '发布会', date: '2030-06-01' },
}

interface AutoMeta {
  slot: number
  at: string
  reason: string
  app: string
  version: number
  bytes: number
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

interface Seed {
  cardData?: string
  autoIndex?: string
}

/**
 * 开一个「桌面形态 + 只放速记卡 + 预置卡片内容」的页面。
 *
 * 种子走**普通 localStorage 键**（`modulo.carddata.v1` 等）：桌面启动时 hydrateData
 * 对每个 DATA_KEY 先读 `read_doc`（桩 → `modulo.__stubdoc.<key>`），读不到才回落普通键
 * 并搬过去 —— 这正是桌面壳早期的真实迁移路径，种子种在普通键上等于连它一起验了。
 *
 * 等 `外观设置` 按钮出现才算就绪：App 的 onMounted（含 `backup.initAutoBackup()`）
 * 在挂载那一个任务里同步跑完，任何能观察到按钮的回调都必然排在它后面。
 */
async function freshPage(seed: Seed = {}, errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(
    (src: string, docJson: string, cardJson: string | null, indexJson: string | null) => {
      new Function(src)()
      localStorage.setItem('modulo.template.v1', 'general')
      localStorage.setItem('modulo.layout.v1', docJson)
      if (cardJson) localStorage.setItem('modulo.carddata.v1', cardJson)
      if (indexJson) localStorage.setItem('modulo.autobackup.index.v1', indexJson)
    },
    STUB_SOURCE,
    JSON.stringify(DOC),
    seed.cardData ?? null,
    seed.autoIndex ?? null,
  )
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
  return page
}

/** 桌面形态的「盘」：桩把 read_doc/write_doc 都落到这个前缀的 localStorage 上 */
const disk = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((k: string) => localStorage.getItem('modulo.__stubdoc.' + k), key)

const readIndex = async (page: Page): Promise<AutoMeta[]> =>
  JSON.parse((await disk(page, 'modulo.autobackup.index.v1')) ?? '[]') as AutoMeta[]

/** 启动基线是 App.onMounted 里写的：等它落到盘上再开面板，否则断言的是「开得比启动快」 */
const waitStartupBaseline = (page: Page) =>
  page.waitForFunction(() => localStorage.getItem('modulo.__stubdoc.modulo.autobackup.index.v1') !== null, {
    timeout: 15000,
  })

/**
 * 等盘上的自动备份索引长到 n 条。启动补哪一份是在 App.onMounted 里发生的 ——
 * 等条件成立再断言，否则断言的是"开得比启动快"（本机负载下这种假绿/假红都出现过）。
 */
const waitIndexLen = (page: Page, n: number) =>
  page.waitForFunction(
    (want: number) => {
      const raw = localStorage.getItem('modulo.__stubdoc.modulo.autobackup.index.v1')
      if (!raw) return false
      try {
        return (JSON.parse(raw) as unknown[]).length === want
      } catch {
        return false
      }
    },
    { timeout: 15000 },
    n,
  )

async function openSettings(page: Page): Promise<void> {
  await page.click('button.wide[title="外观设置"]')
  await page.waitForSelector('.panel .auto', { timeout: 10000 })
}

const listItems = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.auto-list li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )

const notices = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('ul.notices li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )

/** 确认块里那几段话（事实摘要 + 来历 + 警告），归一化空白后拼接 */
const confirmText = (page: Page): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.confirm p')]
      .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
      .join(' / '),
  )

const clickText = (page: Page, root: string, text: string): Promise<void> =>
  page.evaluate((rootSel: string, t: string) => {
    const btn = [...document.querySelectorAll(`${rootSel} button`)].find((b) => (b.textContent ?? '').includes(t))
    if (!btn) throw new Error(`找不到按钮「${t}」`)
    ;(btn as HTMLElement).click()
  }, root, text)

/** 点自动备份列表第 i 条的「恢复这份」 */
const restoreNth = (page: Page, i: number): Promise<void> =>
  page.evaluate((idx: number) => {
    const li = document.querySelectorAll('.auto-list li')[idx]
    if (!li) throw new Error(`自动备份列表没有第 ${idx + 1} 条`)
    ;(li.querySelector('button') as HTMLElement).click()
  }, i)

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __STUB_CALLS__: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__ ?? [],
  )

describe.skipIf(skip)('F-04 自动备份：设置面板链（Tauri 桩，桌面形态）', () => {
  it('首次启动没有任何备份 → 自动建一份手动基线；打开设置面板不用点「刷新列表」就能看到', async () => {
    const errs: string[] = []
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA) }, errs)

    await waitStartupBaseline(page)
    const idx0 = await readIndex(page)
    expect(idx0, '没有备份时启动只建一份').toHaveLength(1)
    expect(idx0[0].reason, '启动建的是手动基线').toBe('manual')
    expect(idx0[0].app, '基线记下当时的应用版本').toBe(APP_VERSION)

    await openSettings(page)
    // 全程没有点过「刷新列表」。P0-③ 修的就是"面板不在挂载时刷新"：旧行为下这里
    // 只有空态文字，waitForSelector 会超时变红 —— 这条断言钉的就是那个修复。
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    const items = await listItems(page)
    expect(items, '挂载即刷新：面板一开就有').toHaveLength(1)
    expect(items[0], '列出时间 / 触发原因 / 大小 / 应用版本').toMatch(new RegExp(`手动\\s*·\\s*\\d+ KB\\s*·\\s*Modulo ${V_ESC}`))
    expect(
      await page.evaluate(() => !!document.querySelector('.auto-list')),
      '渲染的是列表而不是「还没有自动备份」空态',
    ).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('点「立即备份」→ 列表多一份手动备份，索引与槽都经 IPC 落到盘上', async () => {
    const errs: string[] = []
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA) }, errs)
    await waitStartupBaseline(page)
    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    expect(await listItems(page)).toHaveLength(1)

    await clickText(page, '.auto', '立即备份')
    await page.waitForFunction(() => document.querySelectorAll('.auto-list li').length === 2, { timeout: 10000 })

    const items = await listItems(page)
    expect(items, '立即备份后列表多一条').toHaveLength(2)
    for (const t of items) expect(t, '每条都带原因 / 大小 / 版本').toMatch(new RegExp(`手动\\s*·\\s*\\d+ KB\\s*·\\s*Modulo ${V_ESC}`))

    const idx = await readIndex(page)
    expect(idx.map((m) => m.reason), '两份都是手动触发').toEqual(['manual', 'manual'])
    expect(idx.map((m) => m.slot).sort(), '环形槽从空位开始分配').toEqual([0, 1])
    for (const slot of [0, 1]) {
      const raw = await disk(page, `modulo.autobackup.slot.${slot}.v1`)
      expect(raw, `槽 ${slot} 有内容`).not.toBeNull()
      expect(JSON.parse(raw ?? '{}') as { kind?: string; app?: string }).toMatchObject({
        kind: 'modulo.backup',
        app: APP_VERSION,
      })
    }
    // 写经过了 Tauri IPC（write_doc），不只是改了内存镜像 —— 重启读不读得到取决于这一步
    const cs = await calls(page)
    expect(cs.some((c) => c.cmd === 'write_doc' && c.args.name === 'modulo.autobackup.index.v1')).toBe(true)
    expect(cs.some((c) => c.cmd === 'write_doc' && c.args.name === 'modulo.autobackup.slot.1.v1')).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('改过数据后「恢复这份」：确认块摆事实 → 确认后数据回到备份时点，且恢复前自动留了现场', async () => {
    const errs: string[] = []
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA) }, errs)
    await waitStartupBaseline(page)
    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    await clickText(page, '.auto', '立即备份')
    await page.waitForFunction(() => document.querySelectorAll('.auto-list li').length === 2, { timeout: 10000 })

    // —— 备份之后数据被改过。桌面形态的盘就是桩的 localStorage，改"盘"再 reload，
    //    App 重新 hydrate 出来的就是改过的状态（普通键在 reload 时会被重新种成旧值，
    //    但 read_doc 读到的 stubdoc 优先，旧种子被正确忽略）。
    const MODIFIED = JSON.stringify({ ...CARD_DATA, todos: [{ id: 't1', text: '改过的待办', done: false }] })
    await page.evaluate((cardJson: string) => {
      localStorage.setItem('modulo.__stubdoc.modulo.carddata.v1', cardJson)
    }, MODIFIED)
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })

    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    expect(await listItems(page), 'reload 后备份列表还在（索引落在盘上）').toHaveLength(2)

    await restoreNth(page, 0)
    await page.waitForSelector('.confirm', { timeout: 10000 })
    // 覆盖之前先把包里有什么摆出来：每个数字都要和种下去的数据对得上
    const facts = await confirmText(page)
    expect(facts).toContain('1 个模块')
    expect(facts).toContain('1 条待办')
    expect(facts).toContain('1 条速记')
    expect(facts).toContain('有便签正文')
    expect(facts).toContain('设过倒数日')
    expect(facts).toContain('0 套版面方案')
    expect(facts, '来历：哪一版导出的').toContain(`Modulo ${APP_VERSION}`)
    expect(facts, '来历：备份格式版本').toContain('备份格式 v2')

    await clickText(page, '.confirm', '确认恢复')
    await page.waitForFunction(
      () => [...document.querySelectorAll('ul.notices li')].some((li) => (li.textContent ?? '').includes('已恢复')),
      { timeout: 10000 },
    )
    const ns = await notices(page)
    expect(ns.join(' / ')).toContain('已恢复')
    expect(ns.join(' / ')).toContain('1 条待办')
    expect(await page.evaluate(() => !!document.querySelector('.confirm')), '确认块退场').toBe(false)

    // —— 数据真的回到备份时点：读盘，不读界面 ——
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1')
        if (!raw) return false
        try {
          return (JSON.parse(raw) as { todos: { text: string }[] }).todos[0]?.text === '备份时点的待办'
        } catch {
          return false
        }
      },
      { timeout: 10000 },
    )
    const after = JSON.parse((await disk(page, 'modulo.carddata.v1')) ?? '{}') as { todos: { text: string }[] }
    expect(after.todos[0].text, '恢复后是备份时点的待办，不是改过的那个').toBe('备份时点的待办')

    // —— 恢复前自动留了一份现场（pre-restore）：存的是恢复前的改过状态，不是备份状态 ——
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem('modulo.__stubdoc.modulo.autobackup.index.v1')
        if (!raw) return false
        try {
          const idx = JSON.parse(raw) as { reason: string }[]
          return idx.length === 3 && idx.some((m) => m.reason === 'pre-restore')
        } catch {
          return false
        }
      },
      { timeout: 10000 },
    )
    const idx = await readIndex(page)
    expect(idx, '基线 + 手动 + 恢复前现场').toHaveLength(3)
    // 持久化索引是**插入顺序**（push 先后），"哪份最新"要按 at 比出来 ——
    // 界面列表那一份才是 refreshAuto 按 at 排过的（下面 items[0] 断言的就是它）。
    const byAt = [...idx].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    expect(byAt[0].reason, '按时间算，最新一份是恢复前留的').toBe('pre-restore')
    const pre = byAt.find((m) => m.reason === 'pre-restore')!
    const preRaw = JSON.parse((await disk(page, `modulo.autobackup.slot.${pre.slot}.v1`)) ?? '{}') as {
      cardData: { todos: { text: string }[] }
    }
    expect(preRaw.cardData.todos[0].text, 'pre-restore 存的是恢复前的现场（改过的待办）').toBe('改过的待办')

    const items = await listItems(page)
    expect(items, '恢复后列表三条').toHaveLength(3)
    expect(items[0], '最新一条标「恢复前」').toMatch(/恢复前/)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('「恢复这份」后点取消：确认块消失、提示如实，盘上数据与备份列表都没动', async () => {
    const errs: string[] = []
    const cardData = JSON.stringify({ ...CARD_DATA, todos: [{ id: 't1', text: '取消路径的待办', done: false }] })
    const page = await freshPage({ cardData }, errs)
    await waitStartupBaseline(page)
    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })

    await restoreNth(page, 0)
    await page.waitForSelector('.confirm', { timeout: 10000 })
    const facts = await confirmText(page)
    expect(facts, '取消前确认块同样把事实摆出来').toContain('1 个模块')
    expect(facts).toContain('1 条待办')

    const cardBefore = await disk(page, 'modulo.carddata.v1')
    const idxBefore = await readIndex(page)

    await clickText(page, '.confirm', '取消')
    await page.waitForFunction(() => !document.querySelector('.confirm'), { timeout: 10000 })
    const ns = await notices(page)
    expect(ns.join(' / '), '取消要说清"没有改动任何东西"').toContain('已取消，没有改动任何东西')

    expect(await disk(page, 'modulo.carddata.v1'), '取消不碰数据').toBe(cardBefore)
    expect(await readIndex(page), '取消不偷偷留 pre-restore 现场').toEqual(idxBefore)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('索引里有一条但槽读不出来：明确提示、不进确认块、什么都不改', async () => {
    const errs: string[] = []
    // 种一条"索引在、槽不在"的记录（槽被清理过）：slot 5 从不写内容。
    // at 取当前时刻、版本与当前一致：启动判定应当是"不动作"，列表里只有这一条。
    const seeded = JSON.stringify([
      { slot: 5, at: new Date().toISOString(), reason: 'daily', app: APP_VERSION, version: 2, bytes: 2048 },
    ])
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA), autoIndex: seeded }, errs)

    await openSettings(page)
    const items = await listItems(page)
    expect(items, '已有 24h 内的同版本备份 → 启动不新建').toHaveLength(1)
    expect(items[0], '索引里的记录如实列出').toMatch(new RegExp(`每日\\s*·\\s*2 KB\\s*·\\s*Modulo ${V_ESC}`))

    const cardBefore = await disk(page, 'modulo.carddata.v1')
    const idxBefore = await readIndex(page)

    await restoreNth(page, 0)
    await page.waitForFunction(
      () => [...document.querySelectorAll('ul.notices li')].some((li) => (li.textContent ?? '').includes('读不出来')),
      { timeout: 10000 },
    )
    const ns = await notices(page)
    expect(ns.join(' / ')).toContain('自动备份槽 5 读不出来')
    expect(ns.join(' / ')).toContain('没有改动任何东西')
    expect(await page.evaluate(() => !!document.querySelector('.confirm')), '读不出来就不进确认块').toBe(false)
    expect(await disk(page, 'modulo.carddata.v1'), '数据没动').toBe(cardBefore)
    expect(await readIndex(page), '索引没动').toEqual(idxBefore)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('最近一份超过 24 小时 → 启动补一份「每日」；旧的留着，槽往后排而不是覆盖', async () => {
    const errs: string[] = []
    const ago25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const seeded = JSON.stringify([
      { slot: 0, at: ago25h, reason: 'daily', app: APP_VERSION, version: 2, bytes: 2048 },
    ])
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA), autoIndex: seeded }, errs)

    await waitStartupBaseline(page)
    await waitIndexLen(page, 2)

    const idx = await readIndex(page)
    expect(idx, '旧的一份 + 这次启动补的一份').toHaveLength(2)
    expect(idx.filter((m) => m.reason === 'daily'), '两份都是每日：旧的本来就是，新的是这次补的').toHaveLength(2)
    expect(idx.map((m) => m.slot).sort((a, b) => a - b), '槽 0 已占 → 新的落到槽 1（环形没满时不覆盖最老的）').toEqual([0, 1])
    const byAt = [...idx].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    expect(Date.parse(byAt[0].at), '新的一份晚于 25 小时前那份').toBeGreaterThan(Date.parse(ago25h))
    // 槽内容也真的写了，不是只改了索引
    const raw = await disk(page, `modulo.autobackup.slot.${byAt[0].slot}.v1`)
    expect(JSON.parse(raw ?? '{}') as { kind?: string; app?: string }).toMatchObject({
      kind: 'modulo.backup',
      app: APP_VERSION,
    })

    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    const items = await listItems(page)
    expect(items, '界面两条').toHaveLength(2)
    expect(items[0], '最新一条标「每日」').toMatch(/每日/)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('盘上都是上一个版本留的备份 → 启动补一份「版本变化」，且不再同时补一份「每日」（早退）', async () => {
    const errs: string[] = []
    // 两个条件**同时**成立：超过 24 小时 + 版本不是当前版本。两条都该触发，
    // 但 `initAutoBackup` 里 pre-upgrade 先判并 return —— 这份"只补一份"就是那个 return 的钉子。
    const ago25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const seeded = JSON.stringify([
      { slot: 2, at: ago25h, reason: 'daily', app: '0.0.1', version: 2, bytes: 2048 },
    ])
    const page = await freshPage({ cardData: JSON.stringify(CARD_DATA), autoIndex: seeded }, errs)

    await waitStartupBaseline(page)
    await waitIndexLen(page, 2)

    const idx = await readIndex(page)
    // 早退的机械证据：只多一份。把 pre-upgrade 那个 return 去掉就会变成 3 份。
    expect(idx, '只补一份 —— 换版判定早退，没有再叠一份每日').toHaveLength(2)
    expect(idx.filter((m) => m.reason === 'daily'), '上一个版本留下的每日那份原样留着').toHaveLength(1)
    const byAt = [...idx].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    expect(byAt[0].reason, '最新一份是换版留的').toBe('pre-upgrade')
    expect(byAt[0].app, '记的是当前版本').toBe(APP_VERSION)
    expect(idx.map((m) => m.slot).sort((a, b) => a - b), '槽 2 已占 → 新的落到槽 0').toEqual([0, 2])

    await openSettings(page)
    await page.waitForSelector('.auto-list li', { timeout: 10000 })
    const items = await listItems(page)
    expect(items, '界面两条').toHaveLength(2)
    expect(items[0], '最新一条标「版本变化」').toMatch(/版本变化/)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
