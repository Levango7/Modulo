#!/usr/bin/env node
/**
 * visual-kit/probe.mjs —— Modulo 令牌对比度实测（基线取数工具）
 * ----------------------------------------------------------------------------
 * 为什么需要：对比度矩阵的**基线值**只依赖令牌定义（src/tokens/tokens.css 的
 * :root / [data-theme='dark'] / [data-skin=…] 块），不起 tauri、不需要交互。
 * 本探针自己 build + preview（与 vitest.e2e.setup.ts 同款 production 口径），
 * 用 puppeteer 量三皮肤 × 明暗两主题的真实计算值，写入 _probe/contrast-actual.txt。
 *
 * ⚠️ Node ≥22.18 原生剥类型，可直接 import './contrast.ts' / './measure.ts'；
 *    plain node 不做 .js→.ts 映射，故这里显式带 .ts 扩展名（与 tsc 的 bundler
 *    解析互不干扰——本文件不进 tsconfig include，也不被 vitest 收集）。
 *
 * 运行：cd F:/Nexus/Modulo && node tests/e2e/visual-kit/probe.mjs
 */
import { build, preview } from 'vite'
import puppeteer from 'puppeteer-core'
import { CONTRAST_INJECT } from './contrast.ts'
import { applySkin, readPairs } from './measure.ts'
import { chromePath } from '../chrome.ts'

const EXE = chromePath()
if (!EXE) {
  console.error('未找到本机 Chrome（CHROME_PATH 或 Program Files 常见路径）——探针无法运行')
  process.exit(78)
}

/* 与 vitest.e2e.setup.ts 相同：显式 production 构建，避免污染 vitest 的 NODE_ENV */
const prev = process.env.NODE_ENV
process.env.NODE_ENV = 'production'
await build({ logLevel: 'warn' })
if (prev === undefined) delete process.env.NODE_ENV
else process.env.NODE_ENV = prev

const server = await preview({ preview: { port: 0, host: '127.0.0.1' } })
const addr = server.httpServer.address()
const port = typeof addr === 'object' && addr ? addr.port : 0
const url = `http://127.0.0.1:${port}`

/* 与 contrast-matrix.spec.ts 同一张配对表（两处必须同集，改一处必改另一处） */
const PAIRS = {
  'text-1/bg-page': ['--text-1', '--bg-page'],
  'text-2/bg-page': ['--text-2', '--bg-page'],
  'text-3/bg-page': ['--text-3', '--bg-page'],
  'text-1/bg-card-solid': ['--text-1', '--bg-card-solid'],
  'accent/bg-page': ['--accent', '--bg-page'],
  'c-red/bg-page': ['--c-red', '--bg-page'],
  'text-1/brand-50': ['--text-1', '--brand-50'],
}
const SKINS = ['aurora', 'ink', 'candy']
const THEMES = ['light', 'dark']

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  userDataDir: `F:/tmp/modulo-probe-${Date.now()}`,
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
await page.evaluate(CONTRAST_INJECT)

const report = []
const json = {}
for (const skin of SKINS) {
  json[skin] = {}
  for (const theme of THEMES) {
    await applySkin(page, { skin, theme })
    const rows = await readPairs(page, PAIRS)
    json[skin][theme] = {}
    for (const k of Object.keys(PAIRS)) {
      const r = rows[k]
      const c = r.c === null ? null : Number(r.c.toFixed(2))
      json[skin][theme][k] = c
      const line =
        `${skin} · ${theme} · ${k} = ${c === null ? 'N/A' : c}  ` +
        `[${r.fg} / ${r.bg}${r.bg !== r.bgEff ? ' → ' + r.bgEff : ''}]`
      report.push(line)
      console.log(line)
    }
  }
}

const fs = await import('node:fs')
const path = await import('node:path')
const outDir = path.resolve(process.cwd(), '_probe')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'contrast-actual.txt'), report.join('\n') + '\n', 'utf8')
fs.writeFileSync(path.join(outDir, 'contrast-actual.json'), JSON.stringify(json, null, 2) + '\n', 'utf8')
console.log(`\n写入 ${path.join(outDir, 'contrast-actual.txt')} 与 .json`)

await browser.close()
await server.close()
process.exit(0)
