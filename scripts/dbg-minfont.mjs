import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const URL = process.env.MODULO_URL || 'http://127.0.0.1:1430'
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p))

const ALL_MODULE_IDS = [
  'clock','sticky','todo','notes','recent','weather','calendar','progress',
  'worldclock','meeting','countdown','dtools','elapsed','habit','birthday','focus','monthstat',
  'calc','unitconv','colorconv','textstat','randomnum','baseconv','pick',
  'fx','air','repo','hn','moon','ledger',
  'stopwatch','timer','interval','breath',
  'heatmap','links','fixed','duty',
]

const doc = { schemaVersion: 1, cols: 12, items: ALL_MODULE_IDS.map((id) => ({ id, x: 0, y: 0 })) }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
  headless: 'new',
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await page.evaluateOnNewDocument((d) => {
  localStorage.setItem('modulo.layout.v1', d)
  localStorage.setItem('modulo.template.v1', 'general')
}, JSON.stringify(doc))
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 })
await new Promise((r) => setTimeout(r, 800))

const report = await page.evaluate(() => {
  const out = []
  for (const e of document.querySelectorAll('.cell *')) {
    if (e.children.length > 0 || !e.textContent || !e.textContent.trim()) continue
    const fs = parseFloat(getComputedStyle(e).fontSize)
    if (fs < 11) {
      // 找到所属卡片 id
      let card = e.closest('.cell')
      let cardTitle = card ? card.querySelector('.label, .titlebar, .lab, [class*="label"]')?.textContent?.trim() : null
      out.push({
        fontSize: Number(fs.toFixed(2)),
        text: e.textContent.trim().slice(0, 40),
        cls: (e.className && typeof e.className === 'string') ? e.className : '',
        ancestorCard: card ? card.firstElementChild?.className?.slice(0, 60) : null,
        cardTitle,
      })
    }
  }
  return out.sort((a, b) => a.fontSize - b.fontSize)
})
console.log(`offending elements (fontSize < 11px): ${report.length}`)
for (const r of report.slice(0, 25)) {
  console.log(`  ${r.fontSize}px  "${r.text}"  cls="${r.cls}"  card="${r.ancestorCard}"  title="${r.cardTitle}"`)
}
await browser.close()