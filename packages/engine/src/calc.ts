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
 *
 * ## 嵌套深度上限（2026-10-11 补）
 *
 * 递归下降是**按嵌套深度吃栈**的：`primary → expression → term → unary → postfix → primary`
 * 每层括号约 6 个栈帧。实测（node 22，本机默认栈）：**1000 层括号正常、2000 层抛
 * `RangeError: Maximum call stack size exceeded`** —— 而上面那句「永不抛异常」当时**并不成立**：
 * `evaluate` 的 catch 只接 `CalcError`，栈溢出会原样漏给调用方（浏览器的栈通常比 node 更小，
 * 会更早触发）。修法是两道：`MAX_DEPTH` 先给出**明确的用户话术**，`RangeError` 再兜一层 ——
 * 契约既然写了「永不抛」，就不能留任何一条漏出去的路径。
 */

export interface CalcResult {
  value: number
  error: string | null
}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: '(' | ')' }

/** 解析内部的失败信号：`evaluate` 捕获后转成 `error` 文案。它**不会**漏到调用方去 */
class CalcError extends Error {}

/**
 * 嵌套深度上限。取值依据是实测：1000 层才接近栈的物理极限（2000 层溢出），
 * 而**真实用户不会写超过个位数层的括号** —— 100 层既远离危险区，又不可能误伤正常输入。
 */
const MAX_DEPTH = 100

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
  /** 当前递归深度。两个会自我递归的地方（括号、一元负号）进来前都要过这一关 */
  let depth = 0
  const peek = (): Token | null => tokens[pos] ?? null
  const take = (): Token | null => tokens[pos++] ?? null

  /** 进一层递归。用 try/finally 包住，保证无论正常返回还是抛错都退回来 */
  function descend<T>(f: () => T): T {
    depth += 1
    if (depth > MAX_DEPTH) throw new CalcError('嵌套太深了')
    try {
      return f()
    } finally {
      depth -= 1
    }
  }

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
      // `----1` 这种连续负号也是递归，一样要计入深度
      return descend(() => -unary())
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
      const v = descend(expression)
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
    // 兜底：`MAX_DEPTH` 本应先挡住，但**栈的物理极限随宿主变化**（浏览器的栈通常比 node 小），
    // 所以这里再兜一层。文件头承诺「永不抛异常」，就不能有任何一条路径漏出去。
    // 只兜 RangeError（栈溢出），其他异常照旧上抛 —— 别把真正的 bug 一起吞了。
    if (e instanceof RangeError) return { value: Number.NaN, error: '表达式太深，算不了' }
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
