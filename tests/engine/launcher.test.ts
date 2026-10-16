/**
 * 速达（launcher）引擎层单测：边界与清洗。
 *
 * 断言的重点不是"能打开"，而是**什么被拒**：裸命令名、非 http(s) 的 scheme、空目标。
 * 这是这张卡敢做"点开就执行"的前提 —— 打开面必须恰好等于"绝对路径 + http(s) 链接"。
 */
import { describe, expect, it } from 'vitest'
import { MAX_LAUNCH_ITEMS, fallbackLabel, kindOf, sanitizeLaunch } from '../../packages/engine/src/launcher'

describe('目标形状：只认绝对路径与 http(s)', () => {
  it('URL 判 url；盘符 / UNC / POSIX 判 file', () => {
    expect(kindOf('https://example.com/a')).toBe('url')
    expect(kindOf('http://example.com')).toBe('url')
    expect(kindOf('C:\\Program Files\\App\\a.exe')).toBe('file')
    expect(kindOf('c:/tools/a.exe')).toBe('file')
    expect(kindOf('\\\\server\\share\\a.docx')).toBe('file')
    expect(kindOf('/usr/bin/thing')).toBe('file')
    expect(kindOf('"C:\\带 空格的 路径\\a.exe"')).toBe('file')
  })

  it('裸命令名与其它 scheme 一律拒（这是"不做任意命令执行"的判据）', () => {
    for (const bad of ['', '   ', 'explorer.exe', 'cmd', 'notepad', 'file:///c:/a.txt', 'javascript:alert(1)', 'ms-settings:', 'shell:startup']) {
      expect(kindOf(bad), `不该接受 ${JSON.stringify(bad)}`).toBeNull()
    }
  })
})

describe('显示名兜底：URL 取主机+路径、文件取末段去扩展名', () => {
  it('URL', () => {
    expect(fallbackLabel('https://example.com/docs/a', 'url')).toBe('example.com/docs/a')
    expect(fallbackLabel('https://example.com/', 'url')).toBe('example.com')
  })
  it('文件', () => {
    expect(fallbackLabel('C:\\Apps\\Visual Studio Code.exe', 'file')).toBe('Visual Studio Code')
    expect(fallbackLabel('/opt/tool/bin/thing', 'file')).toBe('thing')
    expect(fallbackLabel('C:\\', 'file')).toBe('C:')
  })
})

describe('名单清洗：同 watch/endpoints 的骨架', () => {
  it('丢坏条并计数；同目标去重；label 撞名加序号（不丢条目）', () => {
    const { items, rejected } = sanitizeLaunch([
      { target: 'C:\\a\\x.exe' },
      { target: 'c:\\A\\X.EXE' }, // 同目标（大小写不敏感）→ 去重
      { target: 'explorer.exe' }, // 裸命令名 → rejected
      { target: 'https://e.com/a' }, // 无 label → 兜底
      { label: '同名', target: 'C:\\a\\y.exe' },
      { label: '同名', target: 'C:\\a\\z.exe' }, // 撞名 → "同名 2"
      { target: 42 }, // 形状不对 → rejected
    ])
    expect(rejected).toBe(2)
    expect(items.map((i) => i.target)).toEqual(['C:\\a\\x.exe', 'https://e.com/a', 'C:\\a\\y.exe', 'C:\\a\\z.exe'])
    expect(items[0].label, '兜底取末段去扩展名').toBe('x')
    expect(items[1].label).toBe('e.com/a')
    expect(items[2].label).toBe('同名')
    expect(items[3].label).toBe('同名 2')
    expect(items[0].kind).toBe('file')
    expect(items[1].kind).toBe('url')
  })

  it('目标截长、上限生效、空 target 被拒', () => {
    const many = Array.from({ length: MAX_LAUNCH_ITEMS + 3 }, (_, i) => ({ target: `C:\\a\\${i}.exe` }))
    expect(sanitizeLaunch(many).items).toHaveLength(MAX_LAUNCH_ITEMS)
    expect(sanitizeLaunch([{ target: '' }]).rejected).toBe(1)
    const long = sanitizeLaunch([{ target: `C:\\${'x'.repeat(800)}.exe` }])
    expect(long.items[0].target.length).toBeLessThanOrEqual(500)
  })

  it('id 缺省用 target（稳定、可复现）', () => {
    const { items } = sanitizeLaunch([{ target: 'https://e.com/a' }])
    expect(items[0].id).toBe('https://e.com/a')
  })
})
