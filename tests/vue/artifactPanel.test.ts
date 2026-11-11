/**
 * 右栏产物面板的判定层（`src/vue/artifactPanel.ts`，F-15 P0）。
 *
 * 同 `moduleFilter.test.ts` / `floatList.test.ts` 的理由：组件层在本仓**没有测试设施**
 * （无 @vue/test-utils / jsdom），这里是这几条判定除了 E2E 之外唯一的钉子。
 *
 * 每条断言都对着 `artifactPanel.ts` 文件头写明的四条口径。尤其钉死两件事：
 * **① 任何坏输入都给得出合法宽度**（它会喂 `style.width`，一个 NaN 就让整列消失）；
 * **② 面板再宽也不许把对话压到 480 以下**（契约 §1.2 的末句，最容易在实现里漏掉）。
 */
import { describe, expect, it } from 'vitest'
import {
  ART_CANVAS_MIN,
  ART_CHAT_MIN,
  ART_DEFAULT_STATE,
  ART_NARROW,
  ART_WIDTH_DEFAULT,
  ART_WIDTH_MAX,
  ART_WIDTH_MIN,
  artLayout,
  canvasFits,
  clampArtWidth,
  isArtifactView,
  isNarrow,
  parseArtState,
  serializeArtState,
  type ArtState,
} from '../../src/vue/artifactPanel'

describe('宽度夹取', () => {
  it('区间内原样（四舍五入到整数）', () => {
    expect(clampArtWidth(420)).toBe(420)
    expect(clampArtWidth(500.4)).toBe(500)
    expect(clampArtWidth(500.6)).toBe(501)
  })

  it('上下边界就近夹住，不外溢一像素', () => {
    expect(clampArtWidth(ART_WIDTH_MIN)).toBe(ART_WIDTH_MIN)
    expect(clampArtWidth(ART_WIDTH_MAX)).toBe(ART_WIDTH_MAX)
    expect(clampArtWidth(0)).toBe(ART_WIDTH_MIN)
    expect(clampArtWidth(-9999)).toBe(ART_WIDTH_MIN)
    expect(clampArtWidth(9999)).toBe(ART_WIDTH_MAX)
    expect(clampArtWidth(1e9)).toBe(ART_WIDTH_MAX)
  })

  it('非有限数 / 非数字回落默认值（它喂的是 style.width，绝不能是 NaN）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampArtWidth(bad)).toBe(ART_WIDTH_DEFAULT)
    }
    for (const bad of [undefined, null, '420', {}, [], true]) {
      expect(clampArtWidth(bad)).toBe(ART_WIDTH_DEFAULT)
    }
  })
})

describe('视图取值', () => {
  it('三个已知 id 认得出来，其余一律不认', () => {
    expect(isArtifactView('layout')).toBe(true)
    expect(isArtifactView('canvas')).toBe(true)
    expect(isArtifactView('stack')).toBe(true)
    for (const bad of ['grid', '', undefined, null, 0, {}, []]) expect(isArtifactView(bad)).toBe(false)
  })
})

describe('存档读取：逐字段回落', () => {
  it('没写过 ⇒ 默认态', () => {
    expect(parseArtState(null)).toEqual(ART_DEFAULT_STATE)
    expect(parseArtState('')).toEqual(ART_DEFAULT_STATE)
  })

  it('坏 JSON / 非对象 / 数组 ⇒ 默认态（不是抛错）', () => {
    expect(parseArtState('{')).toEqual(ART_DEFAULT_STATE)
    expect(parseArtState('null')).toEqual(ART_DEFAULT_STATE)
    expect(parseArtState('42')).toEqual(ART_DEFAULT_STATE)
    expect(parseArtState('"layout"')).toEqual(ART_DEFAULT_STATE)
    expect(parseArtState('[1,2]')).toEqual(ART_DEFAULT_STATE)
  })

  it('坏一个字段不连带丢别的：宽度坏了，视图与折叠照旧读回来', () => {
    expect(parseArtState('{"width":"宽","collapsed":true,"view":"stack"}')).toEqual({
      width: ART_WIDTH_DEFAULT,
      collapsed: true,
      view: 'stack',
    })
    expect(parseArtState('{"width":600,"collapsed":false,"view":"不认识"}')).toEqual({
      width: 600,
      collapsed: false,
      view: 'layout',
    })
  })

  it('collapsed 只认真正的 true —— 字符串 "true" / 1 都不算', () => {
    for (const bad of ['"true"', '1', '{}', 'null']) {
      expect(parseArtState(`{"collapsed":${bad}}`).collapsed).toBe(false)
    }
  })

  it('存进去再读回来是同一个态（夹取后的值）', () => {
    const s: ArtState = { width: 9999, collapsed: true, view: 'canvas' }
    expect(parseArtState(serializeArtState(s))).toEqual({
      width: ART_WIDTH_MAX,
      collapsed: true,
      view: 'canvas',
    })
  })
})

describe('画布视图的最低宽度', () => {
  it('低于 640 判为画不开（那条栏里 CanvasEditor 的模块库会吃掉 220px）', () => {
    expect(ART_CANVAS_MIN).toBe(640)
    expect(canvasFits(ART_CANVAS_MIN - 1)).toBe(false)
    expect(canvasFits(ART_CANVAS_MIN)).toBe(true)
    expect(canvasFits(720)).toBe(true)
  })

  it('默认栏宽（420）画不开 —— 这条是那个坏界面的回归钉', () => {
    // 2026-11-11 实测：420 时模块库把画布挤成 ~60px，卡片全糊在一起
    expect(canvasFits(ART_WIDTH_DEFAULT)).toBe(false)
  })
})

describe('窄屏判定', () => {
  it('严格小于 1100 才算窄屏（1100 本身仍是宽屏）', () => {
    expect(isNarrow(ART_NARROW - 1)).toBe(true)
    expect(isNarrow(ART_NARROW)).toBe(false)
    expect(isNarrow(1600)).toBe(false)
  })
})

describe('摆法：折叠 / 窄屏浮层 / 对话区保底', () => {
  const wide = (state: ArtState, available = 1200, overlayOpen = false) =>
    artLayout({ winW: 1600, available, state, overlayOpen })
  const narrow = (state: ArtState, overlayOpen: boolean) =>
    artLayout({ winW: 900, available: 860, state, overlayOpen })

  it('宽屏展开 ⇒ 右栏，宽度就是存档里的宽度', () => {
    expect(wide({ width: 500, collapsed: false, view: 'layout' })).toEqual({
      narrow: false,
      width: 500,
      overlay: false,
    })
  })

  it('宽屏折叠 ⇒ 0 宽（对话满宽）', () => {
    expect(wide({ width: 500, collapsed: true, view: 'layout' })).toEqual({
      narrow: false,
      width: 0,
      overlay: false,
    })
  })

  it('窄屏一律不占列宽：折叠时不出现，展开时是浮层', () => {
    expect(narrow({ width: 500, collapsed: false, view: 'layout' }, false)).toEqual({
      narrow: true,
      width: 0,
      overlay: false,
    })
    expect(narrow({ width: 500, collapsed: true, view: 'layout' }, true)).toEqual({
      narrow: true,
      width: 0,
      overlay: true,
    })
  })

  it('对话区保底 480：想要的宽度吃掉对话空间时，让面板退', () => {
    // 可用 900 ⇒ 面板最多 420（900−480）
    expect(wide({ width: 700, collapsed: false, view: 'layout' }, 900).width).toBe(900 - ART_CHAT_MIN)
    // 可用 1050 ⇒ 面板最多 570（1050−480）；700 会把对话压到 350，退到 570
    expect(wide({ width: 700, collapsed: false, view: 'layout' }, 1050).width).toBe(1050 - ART_CHAT_MIN)
    // 可用刚好 1180（700+480）⇒ 700 装得下，就按 700
    expect(wide({ width: 700, collapsed: false, view: 'layout' }, 1180).width).toBe(700)
  })

  it('可用宽连 480 都保不住 ⇒ 0（宁可不显示，也不把对话压成一条缝）', () => {
    expect(wide({ width: 400, collapsed: false, view: 'layout' }, 460).width).toBe(0)
    expect(wide({ width: 400, collapsed: false, view: 'layout' }, ART_CHAT_MIN).width).toBe(0)
  })

  it('窄屏判定用的是窗口宽，与可用宽无关', () => {
    const l = artLayout({ winW: 1099, available: 2000, state: ART_DEFAULT_STATE, overlayOpen: false })
    expect(l).toEqual({ narrow: true, width: 0, overlay: false })
  })
})
