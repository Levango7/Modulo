/**
 * 写入防抖**不能丢字**（2026-10-21）：内容改动合并 300ms 再落盘，但"敲完立刻刷新/关窗"
 * 必须把最后一笔写掉。这条用例专打那个边界：输入后**不等待**直接 reload，
 * 靠 `pagehide` 的 flush 兜住；没有那个 flush，这条会稳定地丢字。
 *
 * 只测"立刻刷新"这一条：合并窗口本身（多次改动只写一次）由单测用假定时器穷举。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE

describe.skipIf(skip)('写入防抖：输入后立刻刷新不丢字', () => {
  it('便签输入 → 不等待直接 reload → 文本还在', async () => {
    const url = process.env.MODULO_URL ?? 'http://localhost:1430'
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
    await page.waitForSelector('textarea.pad', { timeout: 15000 })

    const text = '防抖也要留住'
    await page.evaluate((v) => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea.pad')!
      ta.value = v
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)

    // **故意不等** 300ms 防抖窗口：立刻刷新，flush 必须在 unloading 时写盘
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('textarea.pad', { timeout: 15000 })
    const value = await page.evaluate(() => document.querySelector<HTMLTextAreaElement>('textarea.pad')?.value ?? '')
    expect(value).toBe(text)
    await browser.close()
  })
})
