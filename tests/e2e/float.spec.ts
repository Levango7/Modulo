/**
 * 脱离浮窗（2026-10-13 第一批）：网页构建 + Tauri 桩下的**前端整链**验证。
 *
 * 需要桩的原因：入口按 `isDesktop`（`'__TAURI_INTERNALS__' in window`）显隐、
 * 窗口创建真发生在桌面壳里。桩只模拟 Tauri 核心（invoke / event），让这条链在 CI 里可测：
 *   脱离键存在 → 点击 → invoke('float_card') → floats-changed 广播 →
 *   卡片从工作台投影里消失 → （模拟关浮窗）卡片回到工作台。
 * 真窗口的几何/置顶/持久化由 Rust 单测（floatwin::tests）与桌面真机验收覆盖。
 *
 * 注入姿势：`evaluateOnNewDocument(fn, ...args)` —— 函数体由 puppeteer 序列化、
 * 参数按 JSON 传入；源码字符串**不要**直接当函数塞（含 IIFE 分号的源码会解析失败，实测踩过）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import type { Browser } from 'puppeteer-core'
import { chromePath } from './chrome'

// CI 上没装 Chrome 就整体跳过（与 layout.spec 同一约定）——本地 Windows 有 Chrome 照常跑
const EXE = chromePath()
const skip = !EXE
/**
 * 目标地址由全局 setup 决定：`vitest.e2e.setup.ts` 会以 production 构建起一个**随机端口**的
 * preview 服务并写进 `MODULO_URL`。早先这里硬编码 1430，本机（preview 恰好也 1430）绿、
 * CI 上 "ERR_CONNECTION_REFUSED"（2026-10-13 实际踩到）—— 与 layout.spec 同一口径。
 */
let url = 'http://localhost:1430'
beforeAll(() => {
  url = process.env.MODULO_URL ?? url
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STUB_SOURCE = readFileSync(resolve(__dirname, 'tauri-stub.js'), 'utf8')

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

describe.skipIf(skip)('脱离浮窗：前端整链（Tauri 桩）', () => {
  it('脱离键把卡片请出工作台，关浮窗后卡片回来', async () => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument((src: string) => {
      // 页面内：先装 Tauri 桩，再预置"已挑过模板"
      new Function(src)()
      localStorage.setItem('modulo.template.v1', 'general')
    }, STUB_SOURCE)
    const errs: string[] = []
    page.on('pageerror', (e: unknown) => errs.push('PAGEERROR ' + String((e as Error).message).slice(0, 160)))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await wait(900)

    expect(errs, `页面不该有报错：${errs.join(' | ')}`).toEqual([])
    expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window), '桩已就位（isDesktop 为真）').toBe(true)

    const before = await page.evaluate(() => document.querySelectorAll('.grid .cell').length)
    expect(before, '出厂 5 张').toBe(5)
    expect(await page.evaluate(() => document.querySelectorAll('.cell .detach').length), '每张卡都有脱离键').toBe(before)

    const id = await page.evaluate(() => document.querySelector<HTMLElement>('.cell')!.getAttribute('data-module'))
    await page.evaluate(() => document.querySelector<HTMLElement>('.cell .detach')!.click())
    await wait(500)

    expect(await page.evaluate(() => document.querySelectorAll('.grid .cell').length), '脱离后卡片离开工作台').toBe(before - 1)
    const calls = await page.evaluate(
      () => (window as unknown as { __STUB_CALLS__: { cmd: string; args: Record<string, unknown> }[] }).__STUB_CALLS__,
    )
    const call = calls.find((c) => c.cmd === 'float_card')
    expect(call, '真的调了 float_card').toBeTruthy()
    expect(call!.args.cardId).toBe(id)
    expect(Number(call!.args.defaultW), '窗口宽按形态理想格数换算').toBeGreaterThan(240)

    // 模拟"关浮窗"：Rust 侧 Destroyed 会做同样的事（摘登记 + 广播）
    await page.evaluate((cardId: string) => {
      ;(window as unknown as { __STUB_UNFLOAT__: (id: string) => void }).__STUB_UNFLOAT__(cardId)
    }, id as string)
    await wait(500)
    expect(await page.evaluate(() => document.querySelectorAll('.grid .cell').length), '关浮窗后卡片回工作台').toBe(before)
    await page.close()
  })
})
