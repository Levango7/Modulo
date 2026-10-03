/**
 * 计算器的表达式求值：四则、括号、一元负号、百分号。**没有 `eval`** ——
 * 表达式是用户敲的，`eval` 等于把"任意代码执行"挂在一个计算器上。
 *
 * 语法（递归下降，优先级从低到高）：
 *   表达式 := 项 (('+' | '-') 项)*
 *   项     := 一元 (('*' | '/') 一元)*
 *   一元   := '-' 一元 | 后缀
 *   后缀   := 初值 ('%')*
 *   初值   := 数字 | '(' 表达式 ')'
 *
 * 百分号就是"除以一百"（`50%` → 0.5），**不做**"200+10% = 220"那种依赖左值的
 * 计算器私货 —— 那套规则每个厂商都不一样，猜错比没有更糟。
 *
 * 永不抛异常：坏表达给 `error`，`value` 为 `NaN`。
 */

export interface CalcResult {
  value: number
  error: string | null
}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: '(' | ')' }

/** 解析内部的失败信号：`evaluate` 捕获后转成 `error` 文案。它**不会**漏到调用方去 */
class CalcError extends Error {}

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const text = src.slice(i, j)
      if ((text.match(/\./g) ?? []).length > 1) return null
      tokens.push({ type: 'num', value: Number(text) })
      i = j
      continue
    }
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch })
      i++
      continue
    }
    return null // 不认识的字符
  }
  return tokens
}

function makeParser(tokens: Token[]) {
  let pos = 0
  const peek = (): Token | null => tokens[pos] ?? null
  const take = (): Token | null => tokens[pos++] ?? null

  function expression(): number {
    let left = term()
    for (;;) {
      const t = peek()
      if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) return left
      take()
      const right = term()
      left = t.value === '+' ? left + right : left - right
    }
  }

  function term(): number {
    let left = unary()
    for (;;) {
      const t = peek()
      // 注意 `%` 不在这一层：它是后缀（除以一百），写在乘除这层会和后缀语义打架 —— 单测抓过
      if (!t || t.type !== 'op' || (t.value !== '*' && t.value !== '/')) return left
      take()
      const right = unary()
      if (t.value === '*') left = left * right
      else {
        if (right === 0) throw new CalcError('除以零') // 不出 Infinity：交给界面一句话
        left = left / right
      }
    }
  }

  function unary(): number {
    const t = peek()
    if (t && t.type === 'op' && t.value === '-') {
      take()
      return -unary()
    }
    return postfix()
  }

  function postfix(): number {
    let v = primary()
    while (peek()?.type === 'op' && peek()!.value === '%') {
      take()
      v = v / 100
    }
    return v
  }

  function primary(): number {
    const t = take()
    if (!t) throw new CalcError('表达式不完整')
    if (t.type === 'num') {
      if (!Number.isFinite(t.value)) throw new CalcError('数字写坏了')
      return t.value
    }
    if (t.type === 'paren' && t.value === '(') {
      const v = expression()
      const close = take()
      if (!close || close.type !== 'paren' || close.value !== ')') throw new CalcError('括号没配对')
      return v
    }
    throw new CalcError('表达式不完整或括号没配对')
  }

  return function runTop(): number {
    const v = expression()
    // 尾随的垃圾必须拒绝：`1+2)` 里那个括号不是配对括号，装没看见就等于答错了题
    if (peek()) throw new CalcError('表达式末尾有多余的内容')
    return v
  }
}

/** 求值。错误时 `value` 为 `NaN`、`error` 说明是哪一种坏（语法 / 除以零） */
export function evaluate(expr: string): CalcResult {
  const tokens = tokenize(expr)
  if (!tokens || tokens.length === 0) return { value: Number.NaN, error: '表达式是空的或含不认识的字符' }
  try {
    return { value: makeParser(tokens)(), error: null }
  } catch (e) {
    if (e instanceof CalcError) return { value: Number.NaN, error: e.message }
    throw e
  }
}

/**
 * 结果给人看：最多 12 位有效数字，去尾零 —— `0.1+0.2` 该显示 `0.3` 而不是
 * `0.30000000000000004`（浮点误差是表示问题，不是用户算错了）。
 */
export function formatCalcNumber(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const rounded = Number(v.toPrecision(12))
  return String(rounded)
}
