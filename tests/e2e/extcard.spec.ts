/**
 * 原生卡（扩展路线第三层，2026-10-27）：真实链路的端到端验证。
 *
 * 一条用例走完整生命周期，每一步都是这条特性的一个承诺：
 *   ① 管理卡里粘贴卡包 JSON → 导入成功、进 cardData（跟备份走）；
 *   ② 装好的卡成为**一等公民**：模块库/目录菜单里出现它的标题（manifest 的 title/group 生效）；
 *   ③ 上版后 iframe 渲染入口 HTML、**脚本真的执行**（沙箱里能动才有用）；
 *   ④ **桥**三个承诺：setState 写进 extState（落盘）、getState 读回、
 *      白名单外的请求没有回声（不会把错误当应答）—— 这条要求卡包声明
 *      `permissions: ['state']`；「没声明会怎样」由第二条用例单独钉；
 *   ⑤ 刷新后状态还在（extState 持久化）、版面还在（ext 段随注册表重建）；
 *   ⑥ 卸载后版面上的实例按引擎「未知模块」口径退场（已收起 / 刷新清除），状态一并清。
 *
 * 另四条钉权限声明面与扫描面：
 *   ⑦ 未声明 permissions 的卡包：桥给**显式拒绝**并指回 manifest —— 与白名单外的
 *      静默是两件事（那是防枚举探测，这是给卡包作者的话术）；
 *   ⑧ 网页形态下扫描入口按 isDesktop **隐藏**（同浮窗入口的约定）+ 一句降级说明 ——
 *      桌面态那半（invoke → 落袋循环 → 摘要）的钉子在 tests/vue/extcardScan.test.ts
 *      与 cargo 单测 scan_cards_dir：E2E 跑桌面态须注 Tauri 桩，与本仓安全钩的
 *      动态执行禁令冲突，注不进来。
 *   ⑨ 只声明 `notify`（不声明 `state`）的卡包：notify 放行并 ok 应答、state 照拒 ——
 *      权限声明面**按方法逐条**，不是「声明一个就全开」；应答 ok 不断言系统通知真
 *      投递（网页形态投递层按 §12.16 静默降级，「坏了不反噬」是设计取舍）。
 *   ⑩ 声明 `state` + `notify` **两项全有**的卡包：徽章按声明逐项列成「状态 + 通知」
 *      （钉逐权限展示，防哪天塌成一枚笼统徽章）、`getState` 与 `notify` 两法皆放行 ——
 *      与 ⑨ 互补成声明面四方块（空集 / 单 notify / 双声明）。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 两条新用例的公共台阶：开浏览器 → 放「原生卡」管理卡 → 保存回工作台。
 * 与第一条用例完全同一条路径，只是抽出来省得抄三遍。
 */
async function openManager(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    executablePath: EXE!,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
    userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
  await page.goto(process.env.MODULO_URL ?? url, { waitUntil: 'networkidle2', timeout: 30000 })
  await wait(800)
  await enterLayout(page)
  await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
  await wait(300)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
      (x.textContent || '').includes('原生卡'),
    )
    el?.click()
  })
  await wait(400)
  await saveLayout(page)
  await wait(500)
  return { browser, page }
}

async function enterLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
      (e) => (e.textContent || '').trim() === '布局编辑',
    )
    b?.click()
  })
  await wait(500)
}

async function saveLayout(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
      (e) => (e.textContent || '').includes('保存'),
    )
    b?.click()
  })
}

async function typeJson(page: Page, json: string): Promise<void> {
  await page.evaluate((j: string) => {
    const ta = document.querySelector<HTMLTextAreaElement>('.xcard .xtarea')
    if (!ta) return
    ta.value = j
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, json)
}

describe.skipIf(skip)('原生卡：导入、入库、上版与桥', () => {
  it('粘贴卡包 → 一等公民上版 → 桥读写与持久 → 卸载残留如实降级', async () => {
    url = process.env.MODULO_URL ?? url
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await wait(800)

    // 进编辑器，把「原生卡」放上版面并保存回工作台
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
    })
    await wait(500)
    await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
    await wait(300)
    const added = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.textContent || '').includes('原生卡'),
      )
      el?.click()
      return !!el
    })
    expect(added, '目录里应有「原生卡」').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(500)
    expect(await page.evaluate(() => !!document.querySelector('.xcard')), '工作台上出现原生卡管理卡').toBe(true)

    // 先试一份坏 JSON：要给一句人话原因，且不进名单
    const typeJson = async (json: string) => {
      await page.evaluate((j: string) => {
        const ta = document.querySelector<HTMLTextAreaElement>('.xcard .xtarea')
        if (!ta) return
        ta.value = j
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }, json)
    }
    await typeJson('{ 不是 JSON')
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
    await wait(250)
    expect(
      await page.evaluate(() => document.querySelector('.xcard .xerr')?.textContent?.trim() ?? ''),
      '坏 JSON 要给原因',
    ).toContain('JSON')

    // 合法卡包（源码不留字面 </script>—— 连测试源码都要守法）。声明 permissions：
    // 这条用例要真的写状态，没声明的桥行为在下面那条用例里钉
    const pack = JSON.stringify({
      id: 'hello',
      title: '问候',
      group: '演示',
      blurb: 'E2E 卡包',
      permissions: ['state'],
      html: [
        '<b id="t">你好</b>',
        '<script>',
        'document.getElementById("t").dataset.ran = "1";',
        '<\/script>',
      ].join(''),
      variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
    })
    await typeJson(pack)
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
    await wait(600)

    expect(
      await page.evaluate(() => document.querySelector('.xcard .xerr')?.textContent?.trim() ?? ''),
      '合法卡包不该报错',
    ).toBe('')
    expect(
      await page.evaluate(() => [...document.querySelectorAll('.xcard .xname')].map((e) => e.textContent?.trim())),
      '已装列表出现卡包',
    ).toContain('问候')
    expect(
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as { extCards?: unknown[] }
        return d.extCards?.length ?? 0
      }),
      '卡包进 cardData（跟备份走）',
    ).toBe(1)

    // 一等公民：目录菜单里出现 manifest 的 title —— 点它上版
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
    })
    await wait(500)
    await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
    await wait(300)
    const addedExt = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
        (x.textContent || '').includes('问候'),
      )
      el?.click()
      return !!el
    })
    expect(addedExt, '装好的扩展卡应出现在目录菜单（manifest.title 生效）').toBe(true)
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(800)
    expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态 iframe 上版').toBe(1)

    // ③ 脚本真的执行了；④ 桥往返：setState 落盘、getState 读回
    const frames = page.frames().filter((f) => f !== page.mainFrame())
    expect(frames.length, '沙箱 iframe 出现').toBeGreaterThanOrEqual(1)
    const frame = frames[frames.length - 1]
    const ran = await frame.evaluate(() => document.getElementById('t')?.getAttribute('data-ran') ?? '').catch(() => 'ERR')
    expect(ran, '入口脚本应真的执行').toBe('1')
    const setState = await frame.evaluate(() =>
      (window as unknown as { MODULO: { bridge: { setState: (v: unknown) => Promise<{ ok: boolean; error?: string }> } } }).MODULO.bridge.setState(
        { n: 42 },
      ),
    )
    expect(setState.ok, `setState 应成功（${setState.error ?? ''}）`).toBe(true)
    const gotBack = await frame.evaluate(() =>
      (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; value: unknown }> } } }).MODULO.bridge.getState(),
    )
    expect(gotBack).toEqual({ ok: true, value: { n: 42 } })

    // 白名单外的请求没有回声：桥不回应方法面之外的东西（这里只能从宿主侧断言落盘形状）
    // cardData 写盘有 300ms 合并窗口 —— setState 的应答是即时的，落盘要等一拍
    await wait(600)
    const storedState = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as {
        extState?: Record<string, unknown>
      }
      return d.extState?.hello ?? null
    })
    expect(storedState, 'setState 经桥写进 extState（落盘）').toEqual({ n: 42 })

    // ⑤ 刷新：版面还在、状态还在
    await page.reload({ waitUntil: 'networkidle2' })
    await wait(1000)
    expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '刷新后运行态还在').toBe(1)
    const frames2 = page.frames().filter((f) => f !== page.mainFrame())
    const got2 = await frames2[frames2.length - 1]
      .evaluate(() =>
        (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; value: unknown }> } } }).MODULO.bridge.getState(),
      )
      .catch((e: unknown) => ({ ok: false, value: String(e) }))
    expect(got2, '刷新后 getState 读回持久状态').toEqual({ ok: true, value: { n: 42 } })

    // ⑥ 卸载：卡包删掉 → 版面上的实例按引擎「未知模块」的既有口径退场
    //（当场进「已收起」清单，刷新后被 parseLayout 清除并留告警）—— 不白屏、不假装还在
    await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xdel')?.click())
    await wait(600)
    expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态实例随之退场').toBe(0)
    expect(
      await page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('modulo.carddata.v1') || '{}') as {
          extState?: Record<string, unknown>
        }
        return 'hello' in (d.extState ?? {})
      }),
      '卸载连状态一起清（不留数据尸体）',
    ).toBe(false)

    await browser.close()
  })

  it('未声明权限：桥回显式拒绝并指回 manifest（不静默）', async () => {
    const { browser, page } = await openManager()
    try {
      // 这份卡包**不写 permissions**（老卡包的形状）：渲染照旧，但桥被 default-deny
      const pack = JSON.stringify({
        id: 'quiet',
        title: '静默卡',
        group: '演示',
        blurb: '未声明权限的卡包',
        html: '<b id="t">不声明</b>',
        variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
      })
      await typeJson(page, pack)
      await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
      await wait(600)
      expect(
        await page.evaluate(() => document.querySelector('.xcard .xperm')?.textContent?.trim() ?? ''),
        '管理卡上要有「未声明权限」徽章',
      ).toBe('未声明权限')

      // 上板成运行态：渲染不受 permissions 影响（老卡包兼容就靠这条）
      await enterLayout(page)
      await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(300)
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.textContent || '').includes('静默卡'),
        )
        el?.click()
        return !!el
      })
      expect(added, '未声明权限的卡包照常上版').toBe(true)
      await wait(400)
      await saveLayout(page)
      await wait(800)
      expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态 iframe 照常渲染').toBe(1)

      // 桥的应答：显式拒绝 + 指回 manifest（resolve 而非 reject —— 应答即话术）
      const frames = page.frames().filter((f) => f !== page.mainFrame())
      const frame = frames[frames.length - 1]
      const denied = await frame.evaluate(() =>
        (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; error?: string }> } } }).MODULO.bridge.getState(),
      )
      expect(denied.ok, '未声明权限：getState 该被拒').toBe(false)
      expect(denied.error ?? '', '拒绝原因要点回 manifest').toContain('未声明权限')
      expect(denied.error ?? '', '拒绝原因要说出路（去 permissions 声明）').toContain('permissions')
    } finally {
      await browser.close()
    }
  })

  it('网页形态：扫描入口按 isDesktop 隐藏，一句人话指路（桌面路径由单测 + 真机兜底）', async () => {
    const { browser, page } = await openManager()
    try {
      // 网页形态（无 __TAURI_INTERNALS__）：扫描按钮按 isDesktop **隐藏**（同浮窗入口的约定），
      // 取而代之一句降级说明。桌面形态那半（invoke → 落袋循环 → 摘要）的钉子：
      // 落袋循环在 `tests/vue/extcardScan.test.ts`，Rust 侧 scan_cards_dir 在 cargo 单测 ——
      // E2E 要跑桌面态须往页面里注 Tauri 桩，与本仓安全钩的动态执行禁令冲突，跑不了。
      const scanBtn = await page.evaluate(() => {
        const b = [...document.querySelectorAll<HTMLButtonElement>('.xcard .xrowbtn button')].find((e) =>
          (e.textContent || '').includes('扫描 cards 目录'),
        )
        return !!b
      })
      expect(scanBtn, '网页形态不该有扫描入口（点不动的死按钮不如没有）').toBe(false)
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll('.xcard .xtip')].some((e) => (e.textContent || '').includes('扫描是桌面壳的功能')),
        ),
        '要有降级说明，告诉网页用户这功能在哪',
      ).toBe(true)
    } finally {
      await browser.close()
    }
  })

  it('只声明 notify：桥放行并 ok 应答，state 照拒（声明面按方法逐条）', async () => {
    const { browser, page } = await openManager()
    try {
      // 这份卡包**只声明 notify**：徽章「通知」，上版渲染照旧（声明只管桥，不管渲染）
      const pack = JSON.stringify({
        id: 'notifier',
        title: '通知卡',
        group: '演示',
        blurb: '声明了 notify 权限',
        html: '<b id="t">通知</b>',
        permissions: ['notify'],
        variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
      })
      await typeJson(page, pack)
      await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
      await wait(600)
      expect(
        await page.evaluate(() => document.querySelector('.xcard .xperm')?.textContent?.trim() ?? ''),
        '徽章按声明显示「通知」',
      ).toBe('通知')

      // 上板成运行态
      await enterLayout(page)
      await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(300)
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.textContent || '').includes('通知卡'),
        )
        el?.click()
        return !!el
      })
      expect(added, '声明 notify 的卡包照常上版').toBe(true)
      await wait(400)
      await saveLayout(page)
      await wait(800)
      expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态 iframe 照常渲染').toBe(1)

      const frames = page.frames().filter((f) => f !== page.mainFrame())
      const frame = frames[frames.length - 1]
      // notify 放行 + ok 应答。**不断言系统通知真投递**：网页形态下投递层按 §12.16
      // 静默降级（无插件 / 非桌面）；桥应答 ok:true 不反映投递成败 —— 与 notify.ts
      // 「坏了不反噬」同一条设计取舍，不把宿主投递状态漏给卡包。
      const sent = await frame.evaluate(() =>
        (window as unknown as {
          MODULO: { bridge: { notify: (t: string) => Promise<{ ok: boolean; value: unknown }> } }
        }).MODULO.bridge.notify('你好'),
      )
      expect(sent.ok, '声明了 notify：桥放行并应答 ok').toBe(true)
      expect(sent.value, 'notify 的应答值是 null（它不是数据回读）').toBeNull()

      // 同一份卡包没声明 state：getState 仍被拒 —— 声明面是**按方法逐条**的，
      // 「声明一个就全开」正是两层分离要防的形状（§12.37）。
      const denied = await frame.evaluate(() =>
        (window as unknown as { MODULO: { bridge: { getState: () => Promise<{ ok: boolean; error?: string }> } } }).MODULO.bridge.getState(),
      )
      expect(denied.ok, '未声明 state：getState 照拒').toBe(false)
      expect(denied.error ?? '', '拒绝原因依旧指回 manifest').toContain('未声明权限')
    } finally {
      await browser.close()
    }
  })

  it('双声明：徽章逐权限列「状态 + 通知」，两法皆放行', async () => {
    const { browser, page } = await openManager()
    try {
      // 这份卡包**两项都声明**：徽章该把两项逐个列出来（`permLabel` 的逐权限 join），
      // 而不是塌成一枚笼统徽章 —— `ExtPermission` 是封闭双值联合，映射穷尽，这条
      // 是把「穷尽」本身钉住：将来加第三种令牌或改坏映射，这里第一个红。
      const pack = JSON.stringify({
        id: 'dual',
        title: '双声明卡',
        group: '演示',
        blurb: 'state 与 notify 都声明',
        html: '<b id="t">双</b>',
        permissions: ['state', 'notify'],
        variants: [{ id: 'std', name: '标准', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
      })
      await typeJson(page, pack)
      await page.evaluate(() => document.querySelector<HTMLElement>('.xcard .xok')?.click())
      await wait(600)
      expect(
        await page.evaluate(() => document.querySelector('.xcard .xperm')?.textContent?.trim() ?? ''),
        '徽章逐权限列出两项，不是一枚笼统徽章',
      ).toBe('状态 + 通知')

      // 上板成运行态
      await enterLayout(page)
      await page.evaluate(() => document.querySelector<HTMLElement>('.add-cat')?.click())
      await wait(300)
      const added = await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>('.add-menu [role=menuitem]')].find((x) =>
          (x.textContent || '').includes('双声明卡'),
        )
        el?.click()
        return !!el
      })
      expect(added, '双声明卡包照常上版').toBe(true)
      await wait(400)
      await saveLayout(page)
      await wait(800)
      expect(await page.evaluate(() => document.querySelectorAll('.xframe').length), '运行态 iframe 照常渲染').toBe(1)

      const frames = page.frames().filter((f) => f !== page.mainFrame())
      const frame = frames[frames.length - 1]
      // 两法皆放行：声明面按方法逐条，这份卡包两项都声明 ⇒ 两项都开（与 ⑨「只声明
      // notify 则 state 照拒」互补，合成声明面的四方块：空集 / 单 notify / 双声明）
      const read = await frame.evaluate(() =>
        (window as unknown as {
          MODULO: { bridge: { getState: () => Promise<{ ok: boolean; value: unknown }> } }
        }).MODULO.bridge.getState(),
      )
      expect(read.ok, '声明了 state：getState 放行').toBe(true)

      const sent = await frame.evaluate(() =>
        (window as unknown as {
          MODULO: { bridge: { notify: (t: string) => Promise<{ ok: boolean; value: unknown }> } }
        }).MODULO.bridge.notify('你好'),
      )
      expect(sent.ok, '声明了 notify：notify 放行并应答 ok').toBe(true)
      // 投递成败仍不断言 —— 同 ⑨ 的取舍（§12.16 「坏了不反噬」）
    } finally {
      await browser.close()
    }
  })
})
