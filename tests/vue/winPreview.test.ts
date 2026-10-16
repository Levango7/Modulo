import { describe, expect, it } from 'vitest'
import {
  FPS_DEFAULT,
  FPS_TIERS,
  TITLE_MAX,
  WIDTH_DEFAULT,
  WIDTH_TIERS,
  canPreview,
  clampFps,
  clampMaxWidth,
  filterWindows,
  formatFrameSize,
  sniffImageMime,
  stopReasonText,
  toFrameBytes,
  truncateTitle,
  windowFlagHint,
  windowFlagText,
  windowFlags,
  type WinInfo,
} from '../../src/vue/winPreview'

/** 造一行窗口，只覆盖被测字段，其余走默认值 */
function win(over: Partial<WinInfo> = {}): WinInfo {
  return {
    hwnd: 1001,
    title: '记事本',
    process: 'notepad.exe',
    pid: 4242,
    rect: { x: 0, y: 0, w: 800, h: 600 },
    isMinimized: false,
    isProtected: false,
    ...over,
  }
}

describe('档位与夹取', () => {
  it('合法档位原样返回', () => {
    for (const t of FPS_TIERS) expect(clampFps(t)).toBe(t)
    for (const t of WIDTH_TIERS) expect(clampMaxWidth(t)).toBe(t)
  })

  it('非法值一律回落默认档（不就近取档，也不返回 0）', () => {
    // 0 尤其危险：后端把 0 当"缺省"再落回它自己的默认档，界面就会与实际不符
    for (const bad of [0, 7, 1, 99, -5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, undefined, {}]) {
      expect(clampFps(bad)).toBe(FPS_DEFAULT)
      expect(clampMaxWidth(bad)).toBe(WIDTH_DEFAULT)
    }
    expect(clampFps(0)).not.toBe(0)
  })

  it('返回值恒在档位表内（无论输入什么）', () => {
    const inputs: unknown[] = [0, 5, 6, 10, 15, 1280, 640, 960, 'x', null]
    for (const v of inputs) {
      expect(FPS_TIERS).toContain(clampFps(v))
      expect(WIDTH_TIERS).toContain(clampMaxWidth(v))
    }
    expect(FPS_DEFAULT).toBe(10)
    expect(WIDTH_DEFAULT).toBe(960)
    expect(FPS_TIERS).toEqual([5, 10, 15])
    expect(WIDTH_TIERS).toEqual([640, 960, 1280])
  })
})

describe('filterWindows', () => {
  const list = [
    win({ hwnd: 1, title: 'Visual Studio Code', process: 'Code.exe' }),
    win({ hwnd: 2, title: '无标题 — 记事本', process: 'notepad.exe' }),
    win({ hwnd: 3, title: 'TASKBAR', process: '' }),
  ]

  it('空查询（含纯空白）返回全量副本，且不是同一个数组引用', () => {
    expect(filterWindows(list, '')).toHaveLength(3)
    expect(filterWindows(list, '   ')).toHaveLength(3)
    const copy = filterWindows(list, '')
    expect(copy).not.toBe(list)
    expect(copy).toEqual(list)
  })

  it('按标题匹配，大小写不敏感', () => {
    expect(filterWindows(list, 'visual').map((w) => w.hwnd)).toEqual([1])
    expect(filterWindows(list, 'VISUAL studio').map((w) => w.hwnd)).toEqual([1])
  })

  it('按进程名匹配，大小写不敏感', () => {
    expect(filterWindows(list, 'NOTEPAD').map((w) => w.hwnd)).toEqual([2])
    expect(filterWindows(list, '.EXE').map((w) => w.hwnd)).toEqual([1, 2])
  })

  it('标题或进程都不含关键词时为空', () => {
    expect(filterWindows(list, 'photoshop')).toEqual([])
  })

  it('不拿 pid / hwnd 当搜索词（否则搜数字会意外命中一堆窗口）', () => {
    const withPid = [win({ hwnd: 123456, pid: 999, title: '其他', process: 'other.exe' })]
    expect(filterWindows(withPid, '123456')).toEqual([])
    expect(filterWindows(withPid, '999')).toEqual([])
  })

  it('进程名为空串（取不到名字）不会因此匹配任意关键词', () => {
    const w = win({ hwnd: 7, title: 'Alpha', process: '' })
    expect(filterWindows([w], 'zzz')).toEqual([])
    // 空进程名不参与匹配，但它的标题照常能搜到
    expect(filterWindows([w], 'alpha').map((x) => x.hwnd)).toEqual([7])
  })
})

describe('truncateTitle', () => {
  it('短标题原样返回', () => {
    expect(truncateTitle('记事本')).toBe('记事本')
  })

  it('连续空白折成单空格并 trim', () => {
    expect(truncateTitle('  a\t\t b \n c  ')).toBe('a b c')
  })

  it('恰好等于上限时不加省略号', () => {
    const s = 'a'.repeat(TITLE_MAX)
    expect(truncateTitle(s)).toBe(s)
    expect(truncateTitle(s).length).toBe(TITLE_MAX)
  })

  it('超长则截断，结果长度不超过上限（省略号算一个字符）', () => {
    const s = 'a'.repeat(TITLE_MAX + 20)
    const out = truncateTitle(s)
    expect(out.length).toBe(TITLE_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toBe(`${'a'.repeat(TITLE_MAX - 1)}…`)
  })

  it('自定义上限也守"不超过 max"这条', () => {
    expect(truncateTitle('abcdefgh', 4)).toBe('abc…')
    expect(truncateTitle('abc', 4)).toBe('abc')
    expect(truncateTitle('abc', 1)).toBe('…')
  })

  it('非正的上限返回空串，不产生越界切片', () => {
    expect(truncateTitle('abc', 0)).toBe('')
    expect(truncateTitle('abc', -3)).toBe('')
  })

  it('空标题返回空串（不去编一个占位名）', () => {
    expect(truncateTitle('')).toBe('')
    expect(truncateTitle('   ')).toBe('')
  })
})

describe('stopReasonText', () => {
  it('三档词表各有人话', () => {
    expect(stopReasonText('user')).toContain('已停止')
    expect(stopReasonText('window-closed')).toContain('窗口已关闭')
    expect(stopReasonText('error')).toContain('出错')
  })

  it('window-closed 要解释"发生了什么"，不能只说停止了', () => {
    // 用户没点停止画面却没了，必须说清是被预览的窗口被关了
    expect(stopReasonText('window-closed')).not.toBe(stopReasonText('user'))
  })

  it('认不出的原因也有兜底人话，不出现 undefined', () => {
    for (const bad of [undefined, null, '', 'weird', 42, {}]) {
      const t = stopReasonText(bad)
      expect(t.length).toBeGreaterThan(0)
      expect(t).not.toContain('undefined')
    }
  })
})

describe('窗口状态标记', () => {
  it('按"最小化在前、受保护在后"的固定顺序给出标记', () => {
    expect(windowFlags({ isMinimized: true, isProtected: true })).toEqual(['minimized', 'protected'])
    expect(windowFlags({ isMinimized: true, isProtected: false })).toEqual(['minimized'])
    expect(windowFlags({ isMinimized: false, isProtected: true })).toEqual(['protected'])
    expect(windowFlags({ isMinimized: false, isProtected: false })).toEqual([])
  })

  it('标记都有非空文字（状态双编码里的文字那一半）', () => {
    expect(windowFlagText('minimized')).toBe('已最小化')
    expect(windowFlagText('protected')).toBe('受保护')
  })

  it('标记都有解释文案，且两档解释不同', () => {
    const a = windowFlagHint('minimized')
    const b = windowFlagHint('protected')
    expect(a).toContain('还原')
    expect(b).toContain('黑帧')
    expect(a).not.toBe(b)
  })

  it('能否预览只看是否最小化：受保护窗口仍可起预览（黑帧照出）', () => {
    expect(canPreview({ isMinimized: false })).toBe(true)
    expect(canPreview({ isMinimized: true })).toBe(false)
    expect(canPreview(win({ isMinimized: false, isProtected: true }))).toBe(true)
  })
})

describe('sniffImageMime（魔数，不靠约定）', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('认出 JPEG 与 PNG', () => {
    expect(sniffImageMime(jpeg)).toBe('image/jpeg')
    expect(sniffImageMime(png)).toBe('image/png')
  })

  it('只有 FF D8 两个字节不算 JPEG（第三字节必须是 FF）', () => {
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8]))).toBe('application/octet-stream')
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0x00]))).toBe('application/octet-stream')
  })

  it('PNG 签名不足 8 字节不算 PNG', () => {
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('application/octet-stream')
  })

  it('空 / 非图片字节落到 octet-stream（会走到 @error，比假装成 JPEG 更早暴露）', () => {
    expect(sniffImageMime(new Uint8Array(0))).toBe('application/octet-stream')
    expect(sniffImageMime(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe('application/octet-stream')
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
  })
})

describe('toFrameBytes（防御式归一化：三种通道形态都兼容）', () => {
  const bytes = [1, 2, 3, 4]

  it('ArrayBuffer → 同字节的视图', () => {
    const buf = Uint8Array.from(bytes).buffer
    const out = toFrameBytes(buf)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out!)).toEqual(bytes)
  })

  it('Uint8Array（视图）→ 尊重 byteOffset/byteLength，不多不少', () => {
    const backing = Uint8Array.from([9, 9, ...bytes, 9, 9])
    const view = new Uint8Array(backing.buffer, 2, bytes.length)
    const out = toFrameBytes(view)
    expect(Array.from(out!)).toEqual(bytes)
  })

  it('DataView（也是视图）同样归一化', () => {
    const backing = Uint8Array.from(bytes)
    const out = toFrameBytes(new DataView(backing.buffer))
    expect(Array.from(out!)).toEqual(bytes)
  })

  it('number[] → 归一化成一模一样的字节', () => {
    const out = toFrameBytes(bytes)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out!)).toEqual(bytes)
  })

  it('三种形态归一化后字节完全一致（这是"防御式"的意义）', () => {
    const a = toFrameBytes(Uint8Array.from(bytes).buffer)!
    const b = toFrameBytes(Uint8Array.from(bytes))!
    const c = toFrameBytes(bytes)!
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(b)).toEqual(Array.from(c))
  })

  it('空负载返回 null（丢帧，不渲染垃圾）', () => {
    expect(toFrameBytes(new ArrayBuffer(0))).toBeNull()
    expect(toFrameBytes(new Uint8Array(0))).toBeNull()
    expect(toFrameBytes([])).toBeNull()
  })

  it('认不出的形态返回 null', () => {
    for (const bad of [null, undefined, 'abc', 42, {}, { byteLength: 4 }, new Blob([])]) {
      expect(toFrameBytes(bad)).toBeNull()
    }
  })
})

describe('formatFrameSize', () => {
  it('正常尺寸给出 W×H', () => {
    expect(formatFrameSize(960, 540)).toBe('960×540')
  })

  it('小数四舍五入', () => {
    expect(formatFrameSize(960.4, 539.6)).toBe('960×540')
  })

  it('量不到（0 / 负 / 非有限）返回空串，界面别显示这一格', () => {
    for (const [w, h] of [
      [0, 540],
      [960, 0],
      [-1, 540],
      [Number.NaN, 540],
      [960, Number.POSITIVE_INFINITY],
    ]) {
      expect(formatFrameSize(w, h)).toBe('')
    }
  })
})
