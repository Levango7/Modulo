import { describe, expect, it } from 'vitest'
import { textStats } from '@levango7/engine/textstat'

describe('textStats：字符 / 词 / 行的口径', () => {
  it('纯英文：词按连续串算，字符按码点', () => {
    expect(textStats('hello world')).toEqual({ chars: 11, charsNoSpaces: 10, words: 2, lines: 1, cjk: 0 })
  })

  it('纯中文：一字一词', () => {
    const r = textStats('你好世界')
    expect(r.chars).toBe(4)
    expect(r.words).toBe(4)
    expect(r.cjk).toBe(4)
  })

  it('中英混排：CJK 单字 + 拉丁串，两种规则在同一遍里跑', () => {
    const r = textStats('用 GitHub 管理代码')
    expect(r.cjk).toBe(5) // 用 / 管 / 理 / 代 / 码
    expect(r.words).toBe(6) // 5 个 CJK 字 + GitHub 一个词
  })

  it('字素口径：三人家庭 emoji 是 1 个字符（码点是 5、UTF-16 单元是 8）', () => {
    const r = textStats('👨‍👩‍👧')
    expect(r.chars).toBe(1)
  })

  it('换行：空文本是 1 行（编辑器口径），两个 \n 是 3 行', () => {
    expect(textStats('').lines).toBe(1)
    expect(textStats('a').lines).toBe(1)
    expect(textStats('a\nb').lines).toBe(2)
    expect(textStats('a\n\nb').lines).toBe(3)
  })

  it('去空白字符数与总字符数的差就是空白', () => {
    const r = textStats('a b\n c')
    expect(r.chars).toBe(6)
    expect(r.charsNoSpaces).toBe(3)
  })

  it('标点不是词、不是 CJK：夹在中文里不算词数', () => {
    const r = textStats('你好，世界！')
    expect(r.words).toBe(4)
    expect(r.cjk).toBe(4)
  })
})
