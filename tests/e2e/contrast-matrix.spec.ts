/**
 * contrast-matrix.spec.ts —— 渲染层对比度矩阵（视觉回归模板 · Modulo 落地）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 visual-kit 移植（corps 试点之后的第三站，puppeteer 适配层）。
 * 守护的是**渲染层不变量**（不依赖像素基线，本机与 CI 结果一致）：
 *   ① 三皮肤（aurora/ink/candy）× 明暗两主题的令牌配对对比度 ≥ 实测基线 × 0.9
 *   ② 令牌本身有值（缺失会让皮肤静默退化）
 *   ③ 默认皮肤无横向溢出
 *
 * 基线 = 2026-10-14 本机实测（tests/e2e/visual-kit/probe.mjs：production build +
 * preview + 真实 Chrome，半透明令牌按 --bg-page 合成后计算）。
 * 口径：实测值 ≥ max(ABS_FLOOR, 基线 × 0.9)（允许 10% 抖动，退步超过一成就红）。
 * ⚠️ 调基线必须在提交信息里说明原因，不要为了变绿而下调。
 * ⚠️ BASELINE 的键必须与下面 PAIRS 一致（ corps 试点踩过：清单缺一组 → 必红）。
 *
 * 2026-10-17 补记（一次真实漏网）：
 *   · 上面六组没覆盖 `button:hover`（底色 --brand-50 / 文字继承 --text-1），于是暗色下
 *     "hover 时文字基本消失"溜了过去 —— 实测 text-1/brand-50 = aurora 1.04 / ink 1.01 /
 *     candy 1.01，**三皮肤全部低于 ABS_FLOOR 1.5**。补 `text-1/brand-50` 一对堵住它。
 *   · 取数口径扩了一层：--brand-50 是 `color-mix(in oklab, …)`，自定义属性的计算值只是
 *     「var() 已代入的 token 流」，color-mix 不求值；借真实属性读回来也只是同一个 oklab 串。
 *     visual-kit/measure.ts 加了 resolveColor —— 用 canvas 的 fillStyle + getImageData
 *     把它落成 8bit sRGB。legacy 写法仍原样返回，既有六组数字不变。
 *
 * 本机实测顺带发现的两处现状（基线录现状，门禁管回归；要不要改是产品裁决）：
 *   · **candy 亮色 accent/bg-page = 2.68** —— SettingsPanel.vue 有 `color: var(--accent)`
 *     的用法，粉色作文字色低于 WCAG AA 4.5；如产品要把 accent 当正文/链接色，需单独调令牌。
 *   · **亮色 text-3/bg-page ≈ 3.2（三皮肤一致）** —— 第三级弱化文字档，低于 AA 4.5；
 *     仅当它承担正文职责时才需要处理。
 */
import { describe, expect, it } from 'vitest'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome'
import { CONTRAST_INJECT, ABS_FLOOR, TOLERANCE, applySkin, readPairs, dumpReport } from './visual-kit/index'

const EXE = chromePath()
const skip = !EXE

const SKINS = ['aurora', 'ink', 'candy']
const THEMES = ['light', 'dark']

/** 关键前景/背景令牌配对（Modulo 特定：text-1..3 文字档 / accent / c-red × bg-page/bg-card-solid）。 */
const PAIRS: Record<string, [string, string]> = {
  'text-1/bg-page': ['--text-1', '--bg-page'],
  'text-2/bg-page': ['--text-2', '--bg-page'],
  'text-3/bg-page': ['--text-3', '--bg-page'],
  'text-1/bg-card-solid': ['--text-1', '--bg-card-solid'],
  'accent/bg-page': ['--accent', '--bg-page'],
  'c-red/bg-page': ['--c-red', '--bg-page'],
  /* 2026-10-17 新增：`button:hover` 的底色是 --brand-50、文字继承 --text-1，
     但上面六组一个都没覆盖这条路径 —— 所以暗色下"hover 时文字基本消失"的缺陷
     （实测 text-1/brand-50 = aurora 1.04 / ink 1.01 / candy 1.01，全部低于
     ABS_FLOOR 1.5）从门禁底下溜了过去。补上这一对，把那条路径钉住。 */
  'text-1/brand-50': ['--text-1', '--brand-50'],
}

/** 基线表（2026-10-14 probe.mjs 实测；键与 PAIRS 同集）。
 *  `text-1/brand-50` 一组为 2026-10-17 实测（配对同日记入 PAIRS，见那里的注释）；
 *  --brand-50 是 color-mix 令牌，取数走 canvas 回读（见 visual-kit/measure.ts 的 resolveColor）。 */
const BASELINE: Record<string, Record<string, Record<string, number>>> = {
  aurora: {
    light: {
      'text-1/bg-page': 13.88,
      'text-2/bg-page': 6.86,
      'text-3/bg-page': 3.16,
      'text-1/bg-card-solid': 15.29,
      'accent/bg-page': 5.59,
      'c-red/bg-page': 3.33,
      'text-1/brand-50': 13.09,
    },
    dark: {
      'text-1/bg-page': 15.73,
      'text-2/bg-page': 10.82,
      'text-3/bg-page': 6.14,
      'text-1/bg-card-solid': 14,
      'accent/bg-page': 7.03,
      'c-red/bg-page': 4.8,
      'text-1/brand-50': 11.32,
    },
  },
  ink: {
    light: {
      'text-1/bg-page': 16.07,
      'text-2/bg-page': 7.82,
      'text-3/bg-page': 3.39,
      'text-1/bg-card-solid': 18.04,
      'accent/bg-page': 4.52,
      'c-red/bg-page': 3.35,
      'text-1/brand-50': 15.39,
    },
    dark: {
      'text-1/bg-page': 17.65,
      'text-2/bg-page': 9.64,
      'text-3/bg-page': 4.71,
      'text-1/bg-card-solid': 15.79,
      'accent/bg-page': 7.54,
      'c-red/bg-page': 5.17,
      'text-1/brand-50': 13.31,
    },
  },
  candy: {
    light: {
      'text-1/bg-page': 14.51,
      'text-2/bg-page': 6.27,
      'text-3/bg-page': 3.25,
      'text-1/bg-card-solid': 15.56,
      'accent/bg-page': 2.68,
      'c-red/bg-page': 3.43,
      'text-1/brand-50': 14.11,
    },
    dark: {
      'text-1/bg-page': 16.13,
      'text-2/bg-page': 10.14,
      'text-3/bg-page': 6.25,
      'text-1/bg-card-solid': 14.07,
      'accent/bg-page': 6.26,
      'c-red/bg-page': 4.89,
      'text-1/brand-50': 11.97,
    },
  },
}

describe.skipIf(skip)('渲染层对比度矩阵（三皮肤 × 明暗）', () => {
  it('每套皮肤/主题的配对对比度不低于实测基线，且令牌非空、无横向溢出', async () => {
    const browser = await puppeteer.launch({
      executablePath: EXE!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
      userDataDir: `F:/tmp/pptr-profile-${Date.now()}`,
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
      await page.goto(process.env.MODULO_URL ?? 'http://localhost:1430', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })
      await page.evaluate(CONTRAST_INJECT)

      const report: string[] = []
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          await applySkin(page, { skin, theme: theme as 'light' | 'dark' })
          const pairs = await readPairs(page, PAIRS)
          const base = BASELINE[skin][theme]
          for (const k in base) {
            const v = pairs[k]
            expect(v, `皮肤 ${skin} ${theme} 缺少配对 ${k}（PAIRS 与 BASELINE 必须同集）`).toBeTruthy()
            expect(v.fg, `皮肤 ${skin} ${theme} 的前景令牌 ${PAIRS[k][0]} 为空`).not.toBe('')
            expect(v.bg, `皮肤 ${skin} ${theme} 的背景令牌 ${PAIRS[k][1]} 为空`).not.toBe('')
            if (v.c === null) continue
            const floor = Math.max(ABS_FLOOR, base[k] * TOLERANCE)
            const line =
              `${skin} · ${theme} · ${k} = ${v.c.toFixed(2)}` +
              `（基线 ${base[k]}，下限 ${floor.toFixed(2)}）`
            report.push(line)
            expect(
              v.c,
              `对比度退步：${line}  [${v.fg} / ${v.bg}${v.bg !== v.bgEff ? ' → ' + v.bgEff : ''}]`,
            ).toBeGreaterThanOrEqual(floor)
          }
        }
      }

      /* 默认皮肤（aurora light）无横向溢出 */
      await applySkin(page, { skin: 'aurora', theme: 'light' })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `aurora light 出现横向溢出 ${overflow}px`).toBeLessThanOrEqual(0)

      dumpReport(report, 'contrast-actual')
    } finally {
      await browser.close()
    }
  })
})
