import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

/**
 * 手写 SVG → 1024 PNG 图标源。
 * 用真 Chrome 光栅化而不是找图像库：渲染结果与浏览器一致、零额外依赖，
 * 且图标是纯文本 SVG，可随时改、可复现、没有生成图的水印与"AI 味"。
 */
const EXE = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

if (!EXE) {
  console.error('找不到 Chrome，可用 CHROME_PATH 指定')
  process.exit(1)
}

/** 默认渲染正式图标并产出全套尺寸；带 <svg> <png> 两个参数时只光栅化，
 *  用来肉眼对比候选稿而不污染 src-tauri/icons。 */
const [SVG_IN = 'build/icon.svg', PNG_OUT = 'build/app-icon.png'] = process.argv.slice(2)
const DESKTOP_ONLY = SVG_IN !== 'build/icon.svg'

const svg = readFileSync(resolve(SVG_IN), 'utf8')
/** width 属性优先：改一下 width/height 就能按真实像素尺寸出小图，肉眼验证托盘尺寸够不够清楚。 */
const declared = /\swidth="(\d+)"/.exec(svg)
const box = /viewBox="[^"]*\s(\d+)\s\d+"/.exec(svg)
const size = declared ? Number(declared[1]) : box ? Number(box[1]) : 1024
const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage()
await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
await page.setContent(
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#171512}svg{display:block}</style>${svg}`,
)
writeFileSync(resolve(PNG_OUT), await page.screenshot({ type: 'png' }))
await browser.close()
console.log(`已生成 ${PNG_OUT}`)
if (DESKTOP_ONLY) process.exit(0)

/** 用当前 node 直接跑 CLI 的 JS 入口：Windows 下 Node 禁止无 shell 启动 .cmd（CVE 修复），
 *  走 npx.cmd 会 EINVAL，而这里根本没有需要 shell 的地方。 */
execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', 'build/app-icon.png'], {
  stdio: 'inherit',
})
console.log('已生成 src-tauri/icons')
