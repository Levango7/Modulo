/**
 * 命令面板（Ctrl+K，2026-10-13 批 2）：真实链路的端到端验证。
 *
 * 这条测的是"设计承诺"而不是像素：
 *   ① 空查询 = 能力目录（按 scope 分区呈现全部命令）；
 *   ② 输入过滤走同一张命令表（搜「收紧」必须能搜到"收紧卡片高度"）；
 *   ③ **执行经命令总线**：文档真变、且 Ctrl+Z **一步**回到执行前（一条命令 = 一步历史）；
 *   ④ 卡片域并行可搜（搜「待办」能定位卡片）；
 *   ⑤ Esc 关闭；面板开着时焦点在输入里、Ctrl+Z 交还输入框（不被抢）。
 *
 * 表驱动的不变量（文案齐全 / undoable 全表复原 / 绑定同源）在 `tests/vue/commands.test.ts`。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'

const EXE = chromePath()
const skip = !EXE
let url = 'http://localhost:1430'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(skip)('命令面板：一入口三件事（命令 / 卡片 / 内容）', () => {
  it('Ctrl+K 唤出、过滤、执行、一步撤销、Esc 关闭', async () => {
    url = process.env.MODULO_URL ?? url
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
    await page.evaluateOnNewDocument(() => localStorage.setItem('modulo.template.v1', 'general'))
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    await wait(800)

    const openPalette = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyK')
      await page.keyboard.up('Control')
      await wait(350)
    }

    // ① 唤出 + 空查询 = 能力目录（按 scope 分区）
    await openPalette()
    expect(await page.evaluate(() => !!document.querySelector('.palette')), 'Ctrl+K 打开面板').toBe(true)
    const groups = await page.evaluate(() => [...document.querySelectorAll('.palette .p-gh')].map((e) => e.textContent))
    expect(groups.length, '空查询按 scope 分区').toBeGreaterThanOrEqual(5)
    expect(groups).toContain('版面')
    expect(groups).toContain('卡片')

    // ② 过滤：搜「收紧」应命中"收紧卡片高度"（它只在工作台可用，此刻应当可用）
    await page.type('.p-input input', '收紧')
    await wait(300)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.palette .row')].map((r) => ({
        title: r.querySelector('.r-title')?.textContent ?? '',
        off: r.classList.contains('off'),
      })),
    )
    expect(rows.some((r) => r.title.includes('收紧卡片高度')), `搜「收紧」结果：${JSON.stringify(rows)}`).toBe(true)

    // ③ 执行经总线：先制造一处可整理的版面（编辑态里挪一张卡再保存）
    await page.keyboard.press('Escape')
    await wait(200)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find(
        (e) => (e.textContent || '').trim() === '布局编辑',
      )
      b?.click()
    })
    await wait(500)
    await page.evaluate(() => (document.querySelectorAll('.canvas .cell')[0] as HTMLElement)?.focus())
    await page.keyboard.press('ArrowDown')
    await wait(400)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.bar button')].find((e) =>
        (e.textContent || '').includes('保存'),
      )
      b?.click()
    })
    await wait(400)

    const before = await page.evaluate(() => localStorage.getItem('modulo.layout.v1'))
    await openPalette()
    await page.type('.p-input input', '整理')
    await wait(250)
    await page.keyboard.press('Enter')
    await wait(500)
    const after = await page.evaluate(() => localStorage.getItem('modulo.layout.v1'))
    expect(after, '「整理」经命令总线真的改了文档').not.toBe(before)

    // ④ 一步撤销：先关面板（焦点在输入框时 Ctrl+Z 属于输入框），再按
    await page.keyboard.press('Escape')
    await wait(250)
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyZ')
    await page.keyboard.up('Control')
    await wait(400)
    expect(await page.evaluate(() => localStorage.getItem('modulo.layout.v1')), 'Ctrl+Z 一步复原（一条命令=一步历史）').toBe(before)

    // ⑤ 卡片域：搜「待办」至少能定位到待办卡
    await openPalette()
    await page.type('.p-input input', '待办')
    await wait(300)
    const cardGroup = await page.evaluate(() => [...document.querySelectorAll('.palette .p-gh')].map((e) => e.textContent))
    expect(cardGroup, '搜「待办」应有卡片域结果').toContain('卡片')
    expect(await page.evaluate(() => !document.querySelector('.palette')), '面板还开着').toBe(false)
    await page.keyboard.press('Escape')
    await wait(200)
    expect(await page.evaluate(() => !!document.querySelector('.palette')), 'Esc 关闭').toBe(false)

    await browser.close()
  })
})
