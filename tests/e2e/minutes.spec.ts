/**
 * 会议速记的「历史」半边（2026-10-17）：网页构建 + Tauri 桩下的**前端整链**验证。
 *
 * 需要桩的原因（同 float.spec）：历史四件事（列表 / 详情 / 摘要 / 删除）全是
 * `meeting_*` IPC，只有桌面壳有后端。桩预置 `__STUB_MEETINGS__` / `__STUB_TRANSCRIPTS__`
 * （形状与 Rust session_store.rs 的 serde 输出逐字段一致），删除与摘要**原地改桩数据**
 * —— 「列表徽标回读落盘值」这条前端行为才能被真测。
 *
 * 这条链路卡在纯单测做不了的地方：MinutesHistory / MinutesDetail 是真组件，
 * 分组渲染、两步删除、drill-down 替换都长在 DOM 上；引擎侧的纯判定（日界/截断/字数）
 * 已由 tests/vue/meetings.test.ts 钉死，这里不重复。
 *
 * 版面注入：只上 `minutes` 一张卡（`modulo.layout.v1`），别让出厂 5 张卡的噪声
 * 干扰选择器 —— 这张 spec 只关心速记卡自己。
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')

/** 只上 minutes 一张：panel 档（注册表 ideal 4×6） */
const DOC = {
  schemaVersion: 1,
  cols: 12,
  items: [{ id: 'minutes', variant: 'panel', x: 0, y: 0, w: 4, h: 6 }],
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
 * 开一个「桌面形态 + 只放速记卡 + 预置两场会议」的页面。
 * 会议的 createdAt 在**页面内**现算（今天 09:30 / 昨天 04:00）：种子写死日期的话，
 * 过一天跑就全变「更早」，测试会自己过期。
 */
async function freshPage(): Promise<Page> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument((src: string, docJson: string) => {
    new Function(src)()
    localStorage.setItem('modulo.template.v1', 'general')
    localStorage.setItem('modulo.layout.v1', docJson)
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const t1 = dayStart.getTime() + 9.5 * 3_600_000 // 今天 09:30（尚未到也按同日算）
    const t2 = dayStart.getTime() - 20 * 3_600_000 // 昨天 04:00（避开午夜边界）
    ;(window as unknown as { __STUB_MEETINGS__: unknown }).__STUB_MEETINGS__ = [
      { id: 'm1', title: '今天讨论发布计划', createdAt: t1, durationMs: 754_000, hasSummary: false },
      { id: 'm2', title: '昨天休会待补', createdAt: t2, durationMs: 61_000, hasSummary: true },
    ]
    ;(window as unknown as { __STUB_TRANSCRIPTS__: unknown }).__STUB_TRANSCRIPTS__ = {
      m1: {
        id: 'm1', createdAt: t1, durationMs: 754_000, speakerNames: {}, summary: null,
        segments: [
          { startMs: 0, endMs: 2100, text: '今天讨论发布计划', speaker: null },
          { startMs: 2100, endMs: 4300, text: '先过一遍门禁清单', speaker: null },
        ],
      },
      m2: {
        id: 'm2', createdAt: t2, durationMs: 61_000, speakerNames: {}, summary: '要点：改到周四',
        segments: [{ startMs: 0, endMs: 1500, text: '改天再开', speaker: null }],
      },
    }
  }, STUB_SOURCE, JSON.stringify(DOC))
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await wait(900)
  return page
}

const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __STUB_CALLS__: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__ ?? [],
  )

describe.skipIf(skip)('会议速记历史：前端整链（Tauri 桩）', () => {
  it('列表：分组渲染、时长与徽标如实；网页桩数据不为空时不给空态', async () => {
    const page = await freshPage()
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push(String((e as Error).message).slice(0, 160)))

    expect(await page.evaluate(() => document.querySelectorAll('.mhist').length), '历史区在').toBe(1)
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('.mhist .gl')].map((e) => e.textContent!.trim()),
    )
    expect(groups, '两组：今天 + 昨天').toEqual(['今天', '昨天'])

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.mhist .mi')].map((e) => ({
        title: e.querySelector('.t')!.textContent!.trim(),
        dur: e.querySelector('.dur')!.textContent!.trim(),
        badge: !!e.querySelector('.badge'),
        at: e.querySelector('.at')!.textContent!.trim(),
      })),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].title).toBe('今天讨论发布计划')
    expect(rows[0].dur).toBe('12:34') // 754s = 12m34s
    expect(rows[0].badge).toBe(false)
    expect(rows[0].at.startsWith('今天')).toBe(true)
    expect(rows[1].title).toBe('昨天休会待补')
    expect(rows[1].dur).toBe('01:01') // 61s，不足 1 小时走 mm:ss（formatDuration 口径）
    expect(rows[1].badge).toBe(true) // hasSummary 的如实挂徽标
    expect(rows[1].at.startsWith('昨天')).toBe(true)

    expect(await page.evaluate(() => document.querySelector('.mhist .hint[data-tone]')), '无错误提示').toBeNull()
    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
  })

  it('详情：点开即取转写；已有摘要就只展示、不再摆「重新生成」；返回回列表', async () => {
    const page = await freshPage()
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.mhist .mi')].find((e) =>
        e.textContent!.includes('昨天休会待补'),
      )
      el!.click()
    })
    await wait(400)

    expect(await page.evaluate(() => document.querySelectorAll('.mdetail').length), '详情替换了列表').toBe(1)
    expect(
      await page.evaluate(() => document.querySelector('.mdetail .t')!.textContent!.trim()),
      '详情头沿用列表标题',
    ).toBe('昨天休会待补')
    const meta = await page.evaluate(() => document.querySelector('.mdetail .meta')!.textContent!.replace(/\s+/g, ' '))
    expect(meta).toContain('1:01')
    expect(meta).toContain('4 字') // 「改天再开」去空白 4 字
    expect(meta).toContain('1 句')
    expect(
      await page.evaluate(() => document.querySelector('.mdetail .summary')!.textContent!),
      '已存摘要直接展示',
    ).toContain('要点：改到周四')
    expect(await page.evaluate(() => document.querySelector('.mdetail .sbtn')), '有摘要就没有生成按钮').toBeNull()
    const segs = await page.evaluate(() => [...document.querySelectorAll('.mdetail .log li .tx')].map((e) => e.textContent!.trim()))
    expect(segs, '转写全文在').toEqual(['改天再开'])

    await page.evaluate(() => (document.querySelector('.mdetail .back') as HTMLElement).click())
    await wait(300)
    expect(await page.evaluate(() => document.querySelectorAll('.mhist').length), '返回后列表回来').toBe(1)
  })

  it('摘要生成 + 删除两步确认：真的调了命令、列表回读落盘值', async () => {
    const page = await freshPage()
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.mhist .mi')].find((e) =>
        e.textContent!.includes('今天讨论发布计划'),
      )
      el!.click()
    })
    await wait(400)

    // —— 摘要：没有存过 → 按钮在；点了真调 meeting_summarize，回填展示并通知列表 ——
    expect(await page.evaluate(() => document.querySelector('.mdetail .sbtn')), '未摘要有生成按钮').not.toBeNull()
    await page.evaluate(() => (document.querySelector('.mdetail .sbtn') as HTMLElement).click())
    await wait(500)
    expect(
      await page.evaluate(() => document.querySelector('.mdetail .summary')!.textContent!),
      '返回的摘要展示出来',
    ).toContain('桩摘要：m1')
    const cs = await calls(page)
    expect(cs.some((c) => c.cmd === 'meeting_summarize' && c.args.id === 'm1'), '真调了 summarize').toBe(true)

    // 回列表：徽标要回读落盘值（桩原地改了 hasSummary）—— 这条不回读的话，徽标永远是旧的
    await page.evaluate(() => (document.querySelector('.mdetail .back') as HTMLElement).click())
    await wait(400)
    const badge1 = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.mhist .mi')].find((e) => e.textContent!.includes('今天讨论发布计划'))
      return el ? !!el.querySelector('.badge') : null
    })
    expect(badge1, 'm1 摘要徽标经 reload 回读到位').toBe(true)

    // 重进 m1 走删除：第一下武装、第二下真发；成功后回列表且那条消失
    await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.mhist .mi')].find((e) =>
        e.textContent!.includes('今天讨论发布计划'),
      )
      el!.click()
    })
    await wait(400)
    expect(
      await page.evaluate(() => (document.querySelector('.mdetail .del') as HTMLElement).textContent!.trim()),
      '第一下只武装',
    ).toBe('删除')
    await page.evaluate(() => (document.querySelector('.mdetail .del') as HTMLElement).click())
    expect(
      await page.evaluate(() => (document.querySelector('.mdetail .del') as HTMLElement).textContent!.trim()),
      '武装态文案',
    ).toContain('确认删除')
    await page.evaluate(() => (document.querySelector('.mdetail .del') as HTMLElement).click())
    await wait(500)

    expect(await page.evaluate(() => document.querySelectorAll('.mdetail').length), '详情退场').toBe(0)
    expect(await page.evaluate(() => document.querySelectorAll('.mhist').length), '列表回来').toBe(1)
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('.mhist .mi .t')].map((e) => e.textContent!.trim()),
    )
    expect(titles, 'm1 已消失，m2 还在').toEqual(['昨天休会待补'])
    expect((await calls(page)).some((c) => c.cmd === 'meeting_delete' && c.args.id === 'm1'), '真调了 delete').toBe(true)
    const badge2 = await page.evaluate(() => !!document.querySelector('.mhist .mi .badge'))
    expect(badge2, 'm2 的摘要徽标仍在').toBe(true)
  })
})
