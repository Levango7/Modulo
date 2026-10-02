import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url))

/**
 * 标签页图标必须就是产品图标本身，而不是"看起来差不多"的另画一份 ——
 * 桌面壳那套 M 是设计过的（build/icon.svg 的注释里记着实心长条会被读成 H），
 * 复制一份到 public/ 就必须钉住它不漂。
 */
describe('站点图标', () => {
  it('public/favicon.svg 与 build/icon.svg 逐字节相同', () => {
    expect(read('../../public/favicon.svg').equals(read('../../build/icon.svg'))).toBe(true)
  })

  it('PNG 兜底用的就是桌面壳那套 32×32，不是随手截的图', () => {
    expect(read('../../public/favicon.png').equals(read('../../src-tauri/icons/32x32.png'))).toBe(true)
  })

  /** 光有文件不算数：入口没声明等于浏览器继续显示默认地球 */
  it('index.html 声明了 icon，且每个 href 指向的文件真在 public 里', () => {
    const html = read('../../index.html').toString('utf8')
    const hrefs = [...html.matchAll(/rel="(?:alternate )?icon"[^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual(['/favicon.svg', '/favicon.png'])
    for (const h of hrefs) expect(read(`../../public${h}`).length, h).toBeGreaterThan(0)
  })
})
