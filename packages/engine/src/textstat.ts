/**
 * 文本统计：字符 / 词 / 行。
 *
 * 口径先说死，"字符"与"词"对中英文必须是同一个函数里的两件事：
 * - **字符**按**字素簇**数（`Intl.Segmenter`）：一个 emoji 是 1 个字符 ——
 *   哪怕是三人家庭那种组合（按码点数是 5、按 UTF-16 单元是 8，都不是用户理解的"字符"）；
 * - **词** = CJK 单字各算一个 + 连续拉丁/数字串算一个（这是中英混排文本的通行口径）；
 * - **行**按 `\n` 切，空文本是 1 行（编辑器口径）。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/

export interface TextStats {
  /** 字素簇数（一个 emoji 算 1） */
  chars: number
  /** 去掉空白后的字素簇数 */
  charsNoSpaces: number
  words: number
  lines: number
  /** 其中 CJK 字符数（给"中英占比"这类提示用） */
  cjk: number
}

function graphemes(s: string): string[] {
  const seg = (Intl as unknown as { Segmenter?: new (l: string | undefined, o: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter
  if (seg) {
    return [...new seg(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment)
  }
  return [...s] // 没有 Segmenter 的老环境退回码点（统计口径略粗，但功能不坏）
}

export function textStats(s: string): TextStats {
  const graphemeList = graphemes(s)
  const chars = graphemeList.length
  let cjk = 0
  let words = 0
  let inLatinWord = false
  for (const ch of s) {
    if (CJK.test(ch)) {
      cjk++
      words++ // CJK 每个字就是一个词
      inLatinWord = false
      continue
    }
    if (/\w/u.test(ch)) {
      if (!inLatinWord) words++ // 拉丁词的第一个字符
      inLatinWord = true
    } else {
      inLatinWord = false
    }
  }
  return {
    chars,
    charsNoSpaces: graphemes(s.replace(/\s/g, '')).length,
    words,
    lines: s === '' ? 1 : s.split('\n').length,
    cjk,
  }
}
