/**
 * visual-kit/measure.ts —— 页面测量工具（Modulo 适配层：puppeteer-core）
 * ----------------------------------------------------------------------------
 * 与 Interaction/corps 的 Playwright 版同源，差异在 driver：
 *   · applySkin(page, { skin, theme }) —— 切皮肤（data-skin）+ 主题（data-theme）。
 *     Modulo 的皮肤是 data-skin（aurora/ink/candy），主题是 data-theme（light 默认/dark）。
 *   · readPairs(page, pairs, baseToken) —— 读令牌配对的对比度。
 *     **Modulo 特有一层：半透明令牌合成** —— 皮肤的 --bg-card / --frost-surface 等是
 *     rgba 半透明，直接当不透明色算对比度会用错底；先按 baseToken（默认 --bg-page，
 *     不透明）合成出有效底色再算。这是渲染层不变量在多皮肤项目上的必要适配。
 *   · checkOverflow(page) —— 横向溢出检测。
 *   · dumpReport(lines, name) —— 实测值落盘（cwd/_probe/，vitest 的 cwd = 仓库根）。
 *
 * ⚠️ 与 corps 同款约束：Playwright/vitest 以 CommonJS 语义转译时 import.meta 语法错，
 *    本目录**不用 import.meta**；目录定位用 process.cwd()。
 */

import type { Page } from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

/** contrast.ts 注入的 window.__vk 命名空间形状（注入后全局可用）。 */
interface VkNamespace {
  lum(rgb: number[]): number
  parse(s: string): number[] | null
  contrast(a: string, b: string): number | null
}

declare global {
  interface Window {
    __vk?: VkNamespace
  }
}

/** 切皮肤与主题。theme 为 'light' 时移除 data-theme（默认态），'dark' 时设置。 */
export async function applySkin(
  page: Page,
  opts: { skin: string; theme: 'light' | 'dark' },
): Promise<void> {
  await page.evaluate(({ skin, theme }) => {
    const el = document.documentElement
    el.setAttribute('data-skin', skin)
    if (theme === 'dark') el.setAttribute('data-theme', 'dark')
    else el.removeAttribute('data-theme')
  }, opts)
}

/** 注入对比度内核（page.evaluate 原样执行字符串，与 spec  beforeEach 同款）。 */
export async function injectKernel(page: Page): Promise<void> {
  const { CONTRAST_INJECT } = await import('./contrast')
  await page.evaluate(CONTRAST_INJECT)
}

export interface PairResult {
  fg: string
  bg: string
  /** 合成半透明后的有效底色（不透明 rgb/hex 原文） */
  bgEff: string
  c: number | null
}

/**
 * 读取前景/背景令牌配对的对比度。pairs 格式：{ "名称": ["--fg-token", "--bg-token"], ... }
 * 半透明背景按 baseToken（默认 --bg-page）合成后计算；返回 { "名称": PairResult }。
 */
export async function readPairs(
  page: Page,
  pairs: Record<string, [string, string]>,
  baseToken = '--bg-page',
): Promise<Record<string, PairResult>> {
  return page.evaluate(
    (pairs, baseToken) => {
      const cs = getComputedStyle(document.documentElement)
      const g = (k: string): string => cs.getPropertyValue(k).trim()
      const vk = window.__vk

      /* 声明原文 → 内核能吃的 rgb/rgba。内核只认 legacy 写法（hex / rgb / rgba），
         而本仓的**派生**令牌用的是 `color-mix(in oklab, …)`（--brand-50 等）。
         自定义属性的计算值只是「var() 已代入的 token 流」，color-mix 不会被求值；
         借真实属性（如 color）读回来 —— 2026-10-17 探针实测 —— 得到的仍是
         `oklab(…)`，内核照样解析不了。唯一「什么写法都能画进去、读回来一定是
         8bit sRGB」的口径是 canvas：fillStyle 接受 color-mix，fillRect +
         getImageData 取回的就是用户实际看到的字节（越色域部分由 canvas clamp 到
         sRGB，正好是屏幕上的结果）。**legacy 值原样返回**，保证既有配对的测量结果
         逐字节不变 —— 这一层只为 color-mix 这类新写法兜底。 */
      const cv = document.createElement('canvas')
      cv.width = 1
      cv.height = 1
      const cctx = cv.getContext('2d')
      /** 哨兵：明显不可能是设计令牌的值。赋值失败时 fillStyle 会留在它上面，据此判无效。 */
      const SENTINEL = '#010203'
      const resolveColor = (raw: string): string => {
        if (!raw || !cctx) return raw
        if (vk && vk.parse(raw)) return raw
        cctx.fillStyle = SENTINEL
        cctx.fillStyle = raw // 无效值会被忽略，fillStyle 仍是哨兵
        if (cctx.fillStyle === SENTINEL && raw.trim().toLowerCase() !== SENTINEL) return raw
        cctx.clearRect(0, 0, 1, 1)
        cctx.fillRect(0, 0, 1, 1)
        const d = cctx.getImageData(0, 0, 1, 1).data
        return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${(d[3] / 255).toFixed(3)})`
      }

      const base = resolveColor(g(baseToken))
      const alphaOf = (s: string): number => {
        /* Chrome 对半透明令牌的两种序列化都要认：rgba(...) 与 8 位 hex #rrggbbaa
           （Modulo 探针实测——--bg-card-solid 的 rgba(255,253,249,.92) 被序列化成 #fffdf9eb） */
        const m8 = s.match(/^#([0-9a-f]{8})$/i)
        if (m8) return parseInt(m8[1].slice(6, 8), 16) / 255
        const m = s.match(/rgba?\(([^)]+)\)/)
        if (!m) return 1
        const p = m[1].split(',').map((x) => parseFloat(x))
        return p.length > 3 ? p[3] : 1
      }
      const composite = (fg: string, bg: string): string => {
        const a = alphaOf(fg)
        if (a >= 1) return fg
        const F = vk ? vk.parse(fg) : null
        const B = vk ? vk.parse(bg) : null
        if (!F || !B) return fg
        const out = F.map((v, i) => Math.round(v * a + B[i] * (1 - a)))
        return 'rgb(' + out[0] + ', ' + out[1] + ', ' + out[2] + ')'
      }
      const out: Record<string, { fg: string; bg: string; bgEff: string; c: number | null }> = {}
      for (const k of Object.keys(pairs)) {
        const fg = resolveColor(g(pairs[k][0]))
        const bg = resolveColor(g(pairs[k][1]))
        const bgEff = composite(bg, base)
        out[k] = { fg, bg, bgEff, c: vk && vk.contrast ? vk.contrast(fg, bgEff) : null }
      }
      return out
    },
    pairs,
    baseToken,
  )
}

/** 读取若干 CSS 变量的声明原文。返回 { tokenName: value }。 */
export async function readTokens(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement)
    const g = (k: string): string => cs.getPropertyValue(k).trim()
    const out: Record<string, string> = {}
    for (const n of names) out[n] = g(n)
    return out
  }, names)
}

/** 检测横向溢出。返回溢出像素数（≤0 表示无溢出）。 */
export async function checkOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/**
 * 把若干行文本落盘（默认 <cwd>/_probe/<name>.txt）。vitest 的 cwd = 仓库根
 * （vitest.e2e.config.ts 所在目录），与 probe.mjs 的输出目录一致。
 */
export function dumpReport(lines: string[], name: string): string | null {
  try {
    const d = path.resolve(process.cwd(), '_probe')
    const file = path.join(d, name + '.txt')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
    return file
  } catch {
    /* 落盘失败不影响断言 */
    return null
  }
}
