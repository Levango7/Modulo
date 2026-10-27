/**
 * 多端同步（WebDAV）的设置面板链 E2E —— 桌面形态，"网盘"由 `tauri-stub.js` 里的桩充当。
 *
 * 补的是哪一格：判据在引擎（`sync.ts`，42 条单测）、传输在 Rust（`webdav.rs`，9 条单测 +
 * CI 编译）、胶水在 `useSync`（69 条单测）—— 但**用户在设置页里真点得到吗**此前只由本机手点
 * 验证过一次。这里把整条界面链在真实浏览器里跑一遍：填地址 → 测试连接 → 立即同步 →
 * 冲突确认 / 取消 → 历史副本列表与恢复 → 环形轮转 → 记住口令 → 自动同步的节拍。
 *
 * 桩的形状照 Rust 抄（8 条命令 + `humanize_status` 的文案），因为这几条用例断言的正是
 * 用户会看到的那句话。**远端文件是手写的 JSON，不用 `buildBundle` 生成** —— 让被测代码
 * 自己造夹具，包格式漂移就永远测不出来（这里的夹具只要求"能被 `parseBundle` 读懂"）。
 *
 * 为什么不是真网络：渲染层的 fetch 被 CSP 固定清单挡死（同步必须由 Rust 发请求），所以浏览器
 * 能验的是"界面 + 胶水 + 裁决 + 盘上结果"这一段；第一次真连坚果云仍然只能由人来（§12.26）。
 *
 * 版面只种一张待办卡：本机内容与远端内容要在盘上可比，噪声版面会让指纹对不上。
 * 没有固定睡眠 —— 本机被别的进程压满时睡眠会让用例假红（2026-10-21 那次成片超时的教训），
 * 一律等条件成立。
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

const ENDPOINT = 'https://dav.example.com/dav/modulo/'
const USER = 'me'
const PW = 'pw-netdisk'
/** 设备标识写死：段戳里的 dev 要能在断言里对上 */
const LOCAL_DEV = 'this-pc'
/** 比任何真实时刻都新：用来把"本机这一段更新"钉成事实，而不是靠时钟快慢 */
const LOCAL_NEW = 8_000_000_000_000
const REMOTE_NEWER = 9_000_000_000_000
/** 1970 年 —— 无论本机记没记过戳，远端这一段都算"很旧" */
const REMOTE_OLDER = 1_000

const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'todo', variant: 'compact', x: 0, y: 0, w: 4, h: 3 }],
}

/** 本机这一份（种进 localStorage，桌面启动时搬进数据根） */
const CARD_LOCAL = { sticky: '本机便签', todos: [{ id: 't1', text: '本机的待办', done: false }] }
/** 网盘上那一台设备推上去的一份 */
const CARD_REMOTE = { sticky: '网盘便签', todos: [{ id: 't1', text: '网盘上的待办', done: false }] }
/** 历史副本里的一份 */
const CARD_OLD = { sticky: '历史便签', todos: [{ id: 't1', text: '历史里的待办', done: false }] }

/** 段戳：四段都记成"本机刚写的"，于是裁决只由内容指纹与 at 决定，不受启动顺序影响 */
const localStamps = () => {
  const out: Record<string, unknown> = {}
  for (const s of ['layout', 'schemes', 'cardData', 'settings']) {
    out[s] = { at: LOCAL_NEW, dev: LOCAL_DEV, hash: `local-${s}` }
  }
  return out
}

const syncStateJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    endpoint: ENDPOINT,
    user: USER,
    deviceId: LOCAL_DEV,
    remember: false,
    auto: false,
    lastSyncAt: null,
    stamps: localStamps(),
    ...over,
  })

interface Slot {
  at: number
  dev: string
  hash: string
  body?: unknown
}

/**
 * 远端包：手写 JSON，字段只保证"能被本程序的 `parseBundle` 读懂"。
 * 故意不复用引擎的 `buildBundle` —— 夹具与产码同源，格式漂移就没人管了。
 */
const bundleJson = (sections: Record<string, Slot>, deviceId = 'other-pc', createdAt = 1_700_000_000_000) =>
  JSON.stringify({ kind: 'modulo.sync', version: 1, deviceId, createdAt, sections })

const slot = (at: number, hash: string, body?: unknown): Slot => ({ at, dev: 'other-pc', hash, body })

/** 四段齐全的远端包（用来做"本机更新 → 直接推上去"的对照） */
const fullRemote = (at: number, hashPrefix: string) =>
  bundleJson({
    layout: slot(at, `${hashPrefix}-layout`),
    schemes: slot(at, `${hashPrefix}-schemes`),
    cardData: slot(at, `${hashPrefix}-card`, CARD_REMOTE),
    settings: slot(at, `${hashPrefix}-settings`),
  })

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
  /** 网盘上已有的文件：文件名 → 内容 */
  files?: Record<string, string>
  /** `modulo.sync.v1`（本机设置 + 段戳），不种就是用默认值 */
  sync?: string
  /** 桩的配置：口令、要不要让下一次 list / 条件写失败 */
  cfg?: Record<string, unknown>
  /** 凭据库里预置一条（= 上一轮勾过「记住口令」） */
  cred?: boolean
}

/**
 * 开一个「桌面形态 + 一张待办卡 + 指定网盘内容」的页面。
 *
 * 本机数据种在**普通 localStorage 键**上：桌面启动时 hydrate 先读 `read_doc`，读不到才回落
 * 普通键并搬过去 —— 顺带把那条迁移链一起验了。网盘用另一个前缀（`__stubdav.`），
 * 两个前缀混了就没法断言"远端有没有被动过"。
 */
async function freshPage(seed: Seed = {}, errs?: string[]): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await seedInto(page, seed)
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await installHelpers(page)
  await page.waitForSelector('button.wide[title="外观设置"]', { timeout: 15000 })
  return page
}

/** 种盘与种数据都走同一段脚本：reload 后还要能重新装上页面助手 */
async function seedInto(page: Page, seed: Seed): Promise<void> {
  await page.evaluateOnNewDocument(
    (src: string, docJson: string, cardJson: string, stateJson: string | null, cfgJson: string, filesJson: string, cred: boolean) => {
      new Function(src)()
      // 自动同步的节拍读 `document.hidden`；headless 里这一位不由人控制，测试要它就在前台
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      localStorage.setItem('modulo.template.v1', 'general')
      localStorage.setItem('modulo.layout.v1', docJson)
      localStorage.setItem('modulo.carddata.v1', cardJson)
      if (stateJson) localStorage.setItem('modulo.sync.v1', stateJson)
      localStorage.setItem('modulo.__stubdav.cfg', cfgJson)
      if (cred) {
        localStorage.setItem(
          'modulo.__stubdav.cred',
          JSON.stringify({ endpoint: JSON.parse(cfgJson).endpoint ?? '', user: 'me', password: 'pw-netdisk' }),
        )
      }
      for (const [name, body] of Object.entries(JSON.parse(filesJson) as Record<string, string>)) {
        // 只补没种过的：reload 时不能把上一轮同步写上去的产物又盖回初始值
        if (localStorage.getItem('modulo.__stubdav.file.' + name) === null) {
          localStorage.setItem('modulo.__stubdav.file.' + name, body)
          localStorage.setItem('modulo.__stubdav.etag.' + name, '"r0"')
        }
      }
    },
    STUB_SOURCE,
    JSON.stringify(DOC),
    JSON.stringify(CARD_LOCAL),
    seed.sync ?? null,
    JSON.stringify({ password: PW, ...(seed.cfg ?? {}) }),
    JSON.stringify(seed.files ?? {}),
    seed.cred === true,
  )
}

/** 页面里挂一个"取多端同步那一节"的工具：面板里还有备份 / 版本等节，全局选择器会撞 */
async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __SEC__?: () => Element | undefined }
    w.__SEC__ = () =>
      [...document.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent ?? '').includes('多端同步'))
  })
}

const openSettings = async (page: Page): Promise<void> => {
  await page.click('button.wide[title="外观设置"]')
  // F-10 之后设置分六组：多端同步在「数据」组里，面板只渲染当前组
  await page.waitForSelector('.panel .nav-item[data-group="data"]', { timeout: 15000 })
  await page.click('.panel .nav-item[data-group="data"]')
  await page.waitForFunction(
    () => !!document.querySelector('section input[autocomplete="username"]'),
    { timeout: 15000 },
  )
  await installHelpers(page)
}

/** 填字段：input 事件喂 v-model，change 事件喂 `@change="saveFields"` */
const setField = (page: Page, which: 'endpoint' | 'user' | 'password', value: string): Promise<unknown> =>
  page.evaluate((w: string, v: string) => {
    const sel = w === 'endpoint' ? 'input[type="url"]' : w === 'user' ? 'input[autocomplete="username"]' : 'input[type="password"]'
    const el = (window as any).__SEC__()!.querySelector(sel) as HTMLInputElement
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, which, value)

const clickIn = (page: Page, text: string): Promise<unknown> =>
  page.evaluate((t: string) => {
    const sec = (window as any).__SEC__()!
    const btn = [...sec.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(t)) as HTMLButtonElement | undefined
    if (!btn) throw new Error(`多端同步那一节里没有按钮「${t}」`)
    btn.click()
  }, text)

const checkRemember = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const box = (window as any).__SEC__()!.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.click()
  })

const statusLine = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const el = (window as any).__SEC__()!.querySelector('p.status')
    return el ? `${(el as HTMLElement).className}|${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}` : null
  })

const notices = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const ul = (window as any).__SEC__()!.querySelector('ul.notices')
    return ul ? [...ul.querySelectorAll('li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim()) : []
  })

const hasConfirm = (page: Page): Promise<boolean> =>
  page.evaluate(() => !!((window as any).__SEC__()!.querySelector('.confirm')))

const confirmRows = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as any).__SEC__()!.querySelectorAll('.confirm li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim()))

/** 确认块的第一句：live 那一条说"这几段网盘上更新"，history 那一条点名是哪份副本 */
const confirmLead = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = (window as any).__SEC__()!.querySelectorAll('.confirm p')[0]
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })

const confirmSummary = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = (window as any).__SEC__()!.querySelector('.confirm p.muted.small')
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })

const historyCodes = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as any).__SEC__()!.querySelectorAll('.history-list li code')].map((c) => (c.textContent ?? '').trim()))

const pwPlaceholder = (page: Page): Promise<string> =>
  page.evaluate(() => ((window as any).__SEC__()!.querySelector('input[type="password"]') as HTMLInputElement).placeholder)

/** 远端盘 */
const davNames = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).__STUB_DAV_NAMES__() as string[])
const davRead = (page: Page, name: string): Promise<string | null> =>
  page.evaluate((n: string) => localStorage.getItem('modulo.__stubdav.file.' + n), name)
const davCfgPatch = (page: Page, patch: Record<string, unknown>): Promise<unknown> =>
  page.evaluate((p: Record<string, unknown>) => (window as any).__STUB_DAV_CFG__(p), patch)

/** 本机数据根（桩里就是 `read_doc`/`write_doc` 背后那份） */
const disk = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((k: string) => localStorage.getItem('modulo.__stubdoc.' + k), key)

const waitForDiskCard = (page: Page, text: string) =>
  page.waitForFunction(
    (t: string) => {
      const raw = localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1')
      return !!raw && raw.includes(t)
    },
    { timeout: 15000 },
    text,
  )

const waitForStatus = (page: Page, re: string) =>
  page.waitForFunction(
    (src: string) => {
      const sec = [...document.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent ?? '').includes('多端同步'))
      const el = sec?.querySelector('p.status')
      return !!el && new RegExp(src).test(el.textContent ?? '')
    },
    { timeout: 15000 },
    re,
  )

const calls = (page: Page): Promise<{ cmd: string; args: Record<string, unknown> }[]> =>
  page.evaluate(
    () => (window as unknown as { __STUB_CALLS__: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__ ?? [],
  )

/** 把「填好端点 + 用户名 + 口令」这一段前置动作做完（每条用例都要，写成一个函数免得各写一遍） */
async function configure(page: Page): Promise<void> {
  await openSettings(page)
  await setField(page, 'endpoint', ENDPOINT)
  await setField(page, 'user', USER)
  await setField(page, 'password', PW)
}

/** 远端更新、本机也有的那份夹具：cardData 一段以网盘为准，其余三段本机新 */
const DOWNLOAD_FIXTURE: Seed = {
  sync: syncStateJson(),
  files: {
    'live.json': bundleJson({
      layout: slot(REMOTE_OLDER, 'remote-layout'),
      schemes: slot(REMOTE_OLDER, 'remote-schemes'),
      cardData: slot(REMOTE_NEWER, 'remote-card', CARD_REMOTE),
      settings: slot(REMOTE_OLDER, 'remote-settings'),
    }),
  },
}

/** 本机四段都比远端新（内容也不同）：这次没有要抉择的下载，直接推 */
const UPLOAD_FIXTURE: Seed = {
  sync: syncStateJson(),
  files: { 'live.json': fullRemote(REMOTE_OLDER, 'remote') },
}

describe.skipIf(skip)('多端同步：设置面板链（Tauri 桩 + 网盘桩，桌面形态）', () => {
  it('填好地址点「测试连接」：命令真的发到桌面壳，状态行说清可达', async () => {
    const errs: string[] = []
    const page = await freshPage({}, errs)
    await configure(page)

    await clickIn(page, '测试连接')
    await waitForStatus(page, '网盘可达')
    expect((await statusLine(page)) ?? '').toContain('完成')
    const cs = await calls(page)
    expect(cs.some((c) => c.cmd === 'webdav_probe' && c.args.endpoint === ENDPOINT)).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('口令不对：状态行照 Rust 的文案报错，不粉饰成"没同步"', async () => {
    const errs: string[] = []
    const page = await freshPage({}, errs)
    await configure(page)
    await setField(page, 'password', '错的口令')
    await clickIn(page, '测试连接')
    await waitForStatus(page, '401')
    expect((await statusLine(page)) ?? '').toContain('网盘说口令不对或没有权限（401）')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('网盘是空的 →「立即同步」把本机这几段整份推上去，且不产生历史副本', async () => {
    const errs: string[] = []
    const page = await freshPage({ sync: syncStateJson() }, errs)
    await configure(page)

    await clickIn(page, '立即同步')
    await waitForStatus(page, '首次同步')
    const names = await davNames(page)
    expect(names).toEqual(['live.json'])
    const pushed = JSON.parse((await davRead(page, 'live.json')) ?? '{}') as {
      kind: string
      version: number
      deviceId: string
      sections: Record<string, { at: number; dev: string; body?: { todos?: { text: string }[] } }>
    }
    expect(pushed.kind).toBe('modulo.sync')
    expect(pushed.deviceId, '包里的设备标识就是本机那一个').toBe(LOCAL_DEV)
    expect(Object.keys(pushed.sections).sort()).toEqual(['cardData', 'layout', 'schemes', 'settings'])
    expect(pushed.sections.cardData.body?.todos?.[0]?.text).toBe('本机的待办')
    expect(pushed.sections.layout.at, '段戳用本机写入的时刻，不是"现在"').toBe(LOCAL_NEW)
    // 上次同步的时刻要落到本机盘上（重启后"满 15 分钟才跑"靠它）
    await page.waitForFunction(() => (localStorage.getItem('modulo.__stubdoc.modulo.sync.v1') ?? '').includes('lastSyncAt'), {
      timeout: 15000,
    })
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('本机更新 → 不问、直接推，但覆盖前先在网盘留一份历史副本', async () => {
    const errs: string[] = []
    const page = await freshPage(UPLOAD_FIXTURE, errs)
    await configure(page)
    const liveBefore = await davRead(page, 'live.json')

    await clickIn(page, '立即同步')
    await waitForStatus(page, '推 4 段')
    expect(await hasConfirm(page), '没有要下载的段就不该弹确认').toBe(false)
    const line = (await statusLine(page)) ?? ''
    expect(line).toContain('覆盖前留了一份历史副本')
    const names = await davNames(page)
    const copies = names.filter((n) => /^sync-\d+\.json$/.test(n))
    expect(copies, '正好一份现场').toHaveLength(1)
    expect(JSON.parse((await davRead(page, copies[0])) ?? '{}'), '历史副本是被洗掉的那一版').toMatchObject({
      deviceId: 'other-pc',
    })
    expect(await davRead(page, 'live.json'), 'live 换成了本机这一份').not.toBe(liveBefore)
    expect((await davRead(page, 'live.json')) ?? '').toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('网盘上有一段更新 → 先摆事实再问；确认前本机与网盘都没动', async () => {
    const errs: string[] = []
    const page = await freshPage(DOWNLOAD_FIXTURE, errs)
    await configure(page)
    const liveBefore = await davRead(page, 'live.json')

    await clickIn(page, '立即同步')
    await waitForStatus(page, '以网盘为准')
    expect(await hasConfirm(page)).toBe(true)
    expect((await statusLine(page)) ?? '').toContain('cardData')
    const rows = await confirmRows(page)
    expect(rows, '四段各说一条，用户看得见谁覆盖谁').toHaveLength(4)
    expect(rows.join(' / ')).toContain('远端更新')
    expect(await confirmSummary(page)).toContain('cardData（远端更新')
    // 还没确认 ⇒ 两边都不该动
    expect(await disk(page, 'modulo.carddata.v1')).toContain('本机的待办')
    expect(await davRead(page, 'live.json')).toBe(liveBefore)
    expect(await davNames(page), '没确认就不该产生历史副本').toEqual(['live.json'])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('确认「以网盘为准」：本机内容真的换掉，合并结果再推回网盘', async () => {
    const errs: string[] = []
    const page = await freshPage(DOWNLOAD_FIXTURE, errs)
    await configure(page)
    await clickIn(page, '立即同步')
    await waitForStatus(page, '以网盘为准')

    await clickIn(page, '确认以网盘为准')
    await waitForDiskCard(page, '网盘上的待办')
    await waitForStatus(page, '网盘已更新')
    expect(await hasConfirm(page), '确认完确认块退场').toBe(false)
    const live = JSON.parse((await davRead(page, 'live.json')) ?? '{}') as {
      sections: Record<string, { dev: string; body?: { sticky?: string } }>
    }
    expect(live.sections.cardData.body?.sticky, '网盘上那段也换成了拉下来再合并的结果').toBe('网盘便签')
    expect(live.sections.layout.dev, '推回去时用的是本机标识').toBe(LOCAL_DEV)
    expect((await notices(page)).join(' / ')).toContain('本机已更新')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('点取消：一句话说明"什么都没动"，本机与网盘都保持原样', async () => {
    const errs: string[] = []
    const page = await freshPage(DOWNLOAD_FIXTURE, errs)
    await configure(page)
    await clickIn(page, '立即同步')
    await waitForStatus(page, '以网盘为准')
    const liveBefore = await davRead(page, 'live.json')

    await clickIn(page, '取消')
    await waitForStatus(page, '已取消')
    expect((await statusLine(page)) ?? '').toContain('本机与网盘都没有改动')
    expect(await hasConfirm(page)).toBe(false)
    expect(await davRead(page, 'live.json')).toBe(liveBefore)
    expect(await disk(page, 'modulo.carddata.v1')).toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('别的设备抢先写了（412）：说清"本机已更新但没推上去"，而不是混成网盘报错', async () => {
    const errs: string[] = []
    const page = await freshPage(DOWNLOAD_FIXTURE, errs)
    await configure(page)
    await clickIn(page, '立即同步')
    await waitForStatus(page, '以网盘为准')
    const liveBefore = await davRead(page, 'live.json')
    // 下一次条件写撞 412：真环境里这一撞发生在 GET 与 PUT 之间，测试只能安排它
    await davCfgPatch(page, { conflictPuts: 1 })

    await clickIn(page, '确认以网盘为准')
    await waitForStatus(page, '412')
    const line = (await statusLine(page)) ?? ''
    expect(line).toContain('本机已更新')
    expect(line).toContain('这次没推上去')
    // 落地走的是防抖写入，等它真的到盘上再断言（不等会把"还没刷盘"读成"没落地"）
    await waitForDiskCard(page, '网盘上的待办')
    expect(await disk(page, 'modulo.carddata.v1'), '本机这一半确实落了').toContain('网盘上的待办')
    expect(await davRead(page, 'live.json'), '网盘那一份没被这次写动').toBe(liveBefore)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('网盘上那份读不懂 ≠ 网盘是空的：报错、原样不动、绝不走"首次同步"覆盖', async () => {
    const errs: string[] = []
    const page = await freshPage({ sync: syncStateJson(), files: { 'live.json': '{"sections": {' } }, errs)
    await configure(page)

    await clickIn(page, '立即同步')
    await waitForStatus(page, '读不懂')
    expect((await statusLine(page)) ?? '').toContain('没有改动任何东西')
    expect(await davRead(page, 'live.json'), '坏包还是那个坏包，等下一次成功的同步来覆盖它').toBe('{"sections": {')
    expect(await davNames(page)).toEqual(['live.json'])
    expect(await disk(page, 'modulo.carddata.v1')).toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('历史副本列表只认 sync-<毫秒>.json；网盘上别的文件不列、不动', async () => {
    const errs: string[] = []
    const page = await freshPage(
      {
        sync: syncStateJson(),
        files: {
          'live.json': fullRemote(REMOTE_OLDER, 'remote'),
          'sync-1735689600000.json': bundleJson({ cardData: slot(1_735_689_600_000, 'old-card', CARD_OLD) }),
          'sync-1700000000000.json': bundleJson({ settings: slot(1_700_000_000_000, 'older-set') }),
          'notes.txt': '网盘上顺带存的别的文件',
        },
      },
      errs,
    )
    await configure(page)

    await clickIn(page, '刷新列表')
    await page.waitForFunction(() => document.querySelectorAll('.history-list li').length === 2, { timeout: 15000 })
    expect(await historyCodes(page)).toEqual(['sync-1735689600000.json', 'sync-1700000000000.json'])
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])

    await page.evaluate(() => (window as any).__STUB_DAV_NAMES__())
    const names = await davNames(page)
    expect(names).toContain('notes.txt')
  })

  it('从历史副本恢复：先摆出"用哪一版覆盖哪几段"，确认后才落本机', async () => {
    const errs: string[] = []
    const page = await freshPage(
      {
        sync: syncStateJson(),
        files: {
          'live.json': fullRemote(REMOTE_OLDER, 'remote'),
          'sync-1735689600000.json': bundleJson({ cardData: slot(1_735_689_600_000, 'old-card', CARD_OLD) }),
        },
      },
      errs,
    )
    await configure(page)
    await clickIn(page, '刷新列表')
    await page.waitForFunction(() => document.querySelectorAll('.history-list li').length === 1, { timeout: 15000 })

    await clickIn(page, '恢复这份')
    await page.waitForFunction(() => !!document.querySelector('.confirm'), { timeout: 15000 })
    expect(await confirmLead(page)).toContain('sync-1735689600000.json')
    expect((await statusLine(page)) ?? '').toContain('覆盖本机的 1 段（确认后才落）')
    expect(await disk(page, 'modulo.carddata.v1')).toContain('本机的待办')

    await clickIn(page, '确认用这一版覆盖')
    await waitForDiskCard(page, '历史里的待办')
    await waitForStatus(page, '网盘已更新')
    const live = JSON.parse((await davRead(page, 'live.json')) ?? '{}') as {
      sections: Record<string, { body?: { sticky?: string } }>
    }
    expect(live.sections.cardData.body?.sticky).toBe('历史便签')
    const names = await davNames(page)
    expect(names.filter((n) => /^sync-\d+\.json$/.test(n)), '恢复前也把当时那份留成了现场').toContain('sync-1735689600000.json')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('轮转：第 8 份历史副本进来时挤掉最旧的，且只动认识的文件', async () => {
    const errs: string[] = []
    const files: Record<string, string> = {
      'live.json': fullRemote(REMOTE_OLDER, 'remote'),
      'notes.txt': '不认识的文件',
    }
    for (let i = 0; i < 7; i++) files[`sync-${1_000 + i * 1_000}.json`] = bundleJson({ cardData: slot(1_000 + i * 1_000, `h${i}`) })
    const page = await freshPage({ sync: syncStateJson(), files }, errs)
    await configure(page)

    await clickIn(page, '立即同步')
    await waitForStatus(page, '推 4 段')
    const copies = (await davNames(page)).filter((n) => /^sync-\d+\.json$/.test(n))
    expect(copies, '8 份挤成 7 份').toHaveLength(7)
    expect(copies, '最旧的被挤掉').not.toContain('sync-1000.json')
    expect(copies, '其余 6 份按原名留着').toEqual(
      expect.arrayContaining(['sync-2000.json', 'sync-3000.json', 'sync-7000.json']),
    )
    expect(await davRead(page, 'notes.txt'), '不认识的文件一律不动').toBe('不认识的文件')
    expect(await davRead(page, 'live.json')).toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('轮转失败只算一条提示：同步本身已经成功，网盘上多了几个旧副本而已', async () => {
    const errs: string[] = []
    const page = await freshPage({ ...UPLOAD_FIXTURE, cfg: { listFails: 1 } }, errs)
    await configure(page)

    await clickIn(page, '立即同步')
    await waitForStatus(page, '推 4 段')
    expect((await notices(page)).join(' / ')).toContain('历史副本轮转失败（不影响数据）')
    expect((await statusLine(page)) ?? '').toContain('同步完成')
    expect(await davRead(page, 'live.json')).toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('勾「记住口令」：口令只进凭据库，本机数据键里一个明文字节都没有', async () => {
    const errs: string[] = []
    const page = await freshPage({ sync: syncStateJson() }, errs)
    await configure(page)

    await checkRemember(page)
    await page.waitForFunction(() => (window as any).__STUB_DAV_CRED__() !== null, { timeout: 15000 })
    expect(await pwPlaceholder(page)).toContain('已保存在系统凭据库')
    const leaked = await page.evaluate((needle: string) => {
      const hits: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? ''
        // __stubdav. 整个前缀都是「网盘 + 系统凭据库」那一边（本来就该存口令），
        // 这条断言要管的是本程序自己写的每一份数据
        if (k.startsWith('modulo.__stubdav.')) continue
        if ((localStorage.getItem(k) ?? '').includes(needle)) hits.push(k)
      }
      return hits
    }, PW)
    expect(leaked, `口令不该出现在任何本机存储里：${leaked.join(' / ')}`).toEqual([])
    const cs = await calls(page)
    expect(cs.some((c) => c.cmd === 'sync_cred_set' && c.args.password === PW)).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('重启后口令框是空的也能同步：口令由桌面壳解析，渲染层拿到的是 null', async () => {
    const errs: string[] = []
    const page = await freshPage({ sync: syncStateJson({ remember: true }), cred: true }, errs)
    await openSettings(page)
    await setField(page, 'endpoint', ENDPOINT)
    await setField(page, 'user', USER)
    expect(await pwPlaceholder(page), 'init() 查过凭据库，占位文案要说清"留空即用它"').toContain('已保存在系统凭据库')
    await page.reload({ waitUntil: 'networkidle2' })
    await installHelpers(page)
    await openSettings(page)
    // reload 后 init() 是在本节 onMounted 里**重跑**的：`hasStored.value = await credStatus`
    // 是异步一跳，而 syncNow 的前置门 `!password.value && !hasStored.value` 是同步读。
    // 点早了会被门挡下（状态行变「先输入一次口令…」），白等 15 秒超时 —— 这条测试
    // 2026-10-28 在 master 首跑上连红两次就是踩在这里（面板挂载与 credStatus resolve 的
    // 先后会被调度噪声翻面）。占位文案是 hasStored 的镜像（见上面那条断言），等它翻回来
    // 再点，等于"用户看到凭据库可用之后才动手"，顺序就此钉死。
    await page.waitForFunction(
      () =>
        ((window as any).__SEC__()!.querySelector('input[type="password"]') as HTMLInputElement).placeholder.includes(
          '已保存在系统凭据库',
        ),
      { timeout: 15000 },
    )
    const pwValue = await page.evaluate(() => ((window as any).__SEC__()!.querySelector('input[type="password"]') as HTMLInputElement).value)
    expect(pwValue, 'reload 后渲染层手里没有口令').toBe('')

    await clickIn(page, '立即同步')
    await waitForStatus(page, '首次同步')
    const cs = await calls(page)
    const gets = cs.filter((c) => c.cmd === 'webdav_get' || c.cmd === 'webdav_put')
    expect(gets.length, '确实发过读写').toBeGreaterThan(0)
    expect(gets.every((c) => c.args.password === null || c.args.password === undefined)).toBe(true)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('自动同步：节拍自己弹出确认块，但绝不替用户按确认', async () => {
    const errs: string[] = []
    const page = await freshPage(
      { ...DOWNLOAD_FIXTURE, sync: syncStateJson({ auto: true, remember: true, lastSyncAt: 1 }), cred: true },
      errs,
    )
    await openSettings(page)
    // 应用挂载那一拍已经跑过：那时设置面板还没挂载、`init()` 没查过凭据库，手上确实没口令。
    // 「后台失败不打红」这条纪律管的就是这一次：状态行是灰的，只在提示里留一句为什么没跑。
    expect((await notices(page)).join(' / ')).toContain('自动同步没跑：先输入一次口令')
    expect((await statusLine(page)) ?? '', '后台那一拍不该把状态行打成红的').not.toContain('error|')

    // 现在口令在凭据库里查到了（init() 已跑），用"窗口回到前台"这一次触发节拍
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForFunction(() => !!document.querySelector('.confirm'), { timeout: 15000 })
    expect(await confirmRows(page), '自动同步弹的是同一种确认').toHaveLength(4)
    await page.waitForFunction(
      () => (localStorage.getItem('modulo.__stubdoc.modulo.carddata.v1') ?? '').includes('本机的待办'),
      { timeout: 3000 },
    )
    expect(await disk(page, 'modulo.carddata.v1'), '等一拍，本机内容仍然没被自动应用').toContain('本机的待办')
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('自动同步连不上网盘：不打红、不弹错误块，只留一条"自动同步没成"', async () => {
    const errs: string[] = []
    const page = await freshPage(
      {
        ...UPLOAD_FIXTURE,
        sync: syncStateJson({ auto: true, remember: true, lastSyncAt: 1 }),
        cred: true,
        cfg: { unreachable: true },
      },
      errs,
    )
    await openSettings(page)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForFunction(
      () => {
        const sec = [...document.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent ?? '').includes('多端同步'))
        return !!sec?.querySelector('ul.notices li')
      },
      { timeout: 15000 },
    )
    expect((await notices(page)).join(' / ')).toContain('自动同步没成：连不上网盘')
    expect((await statusLine(page)) ?? '').not.toContain('error|')
    expect(await hasConfirm(page), '连不上网盘不该弹确认').toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('网页版（没有桌面壳）：整节收起来，只留一句"桌面版可用"', async () => {
    const errs: string[] = []
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    if (errs) page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('modulo.template.v1', 'general')
    })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await page.click('button.wide[title="外观设置"]')
    // F-10 之后设置分六组（网页版五组）：多端同步在「数据」组里，先进那一组再看
    await page.waitForSelector('.panel .nav-item[data-group="data"]', { timeout: 15000 })
    await page.click('.panel .nav-item[data-group="data"]')
    await page.waitForFunction(
      () => [...document.querySelectorAll('section')].some((s) => (s.querySelector('h3')?.textContent ?? '').includes('多端同步')),
      { timeout: 15000 },
    )
    expect(
      await page.evaluate(() => {
        const sec = [...document.querySelectorAll('section')].find((s) => (s.querySelector('h3')?.textContent ?? '').includes('多端同步'))
        return (sec?.textContent ?? '').includes('网页版没有同步通道')
      }),
      '网页版要说清为什么这里不能同步',
    ).toBe(true)
    expect(await page.evaluate(() => !!document.querySelector('input[autocomplete="username"]'))).toBe(false)
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })
})
