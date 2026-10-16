import { describe, expect, it } from 'vitest'
import { evaluate, formatCalcNumber } from '@levango7/engine/calc'

describe('evaluate：四则、括号、优先级', () => {
  it('优先级：先乘除后加减', () => {
    expect(evaluate('2+3*4').value).toBe(14)
    expect(evaluate('(2+3)*4').value).toBe(20)
    expect(evaluate('10/4').value).toBe(2.5)
  })

  it('一元负号与连续负号', () => {
    expect(evaluate('-3+5').value).toBe(2)
    expect(evaluate('3--2').value).toBe(5)
    expect(evaluate('-(2+3)*2').value).toBe(-10)
  })

  it('括号嵌套', () => {
    expect(evaluate('((1+2)*(3+4))').value).toBe(21)
    expect(evaluate('2*(3+(4-1))').value).toBe(12)
  })

  it('百分号就是除以一百（不做依赖左值的计算器私货）', () => {
    expect(evaluate('50%').value).toBe(0.5)
    expect(evaluate('200*10%').value).toBe(20)
    expect(evaluate('(1+1)%').value).toBe(0.02)
  })

  it('空格随便加，数字里两个小数点不行', () => {
    expect(evaluate('  1 +  2 * 3 ').value).toBe(7)
    expect(evaluate('1.2.3').error).not.toBeNull()
  })

  it('错误全走 error 文案，绝不抛、绝不出 Infinity', () => {
    expect(evaluate('1/0').error).toBe('除以零')
    expect(evaluate('2+').error).not.toBeNull()
    expect(evaluate('(1+2').error).not.toBeNull()
    expect(evaluate('1+2)').error).not.toBeNull()
    expect(evaluate('abc').error).not.toBeNull()
    expect(evaluate('').error).not.toBeNull()
    expect(evaluate('2+(3*4').value).toBeNaN()
  })

  it('浮点表示误差在结果里被修掉（0.1+0.2 就是 0.3）', () => {
    expect(formatCalcNumber(evaluate('0.1+0.2').value)).toBe('0.3')
    expect(formatCalcNumber(evaluate('1/3').value)).toBe('0.333333333333')
  })

  it('formatCalcNumber：整数不带小数点、除以零给占位', () => {
    expect(formatCalcNumber(42)).toBe('42')
    expect(formatCalcNumber(2.5)).toBe('2.5')
    expect(formatCalcNumber(Number.NaN)).toBe('—')
    expect(formatCalcNumber(Number.POSITIVE_INFINITY)).toBe('—')
  })

  /**
   * 深层嵌套（2026-10-11 修）。
   *
   * 修前实测：**2000 层括号抛 `RangeError: Maximum call stack size exceeded`**，
   * 5000 个不配对的左括号同样抛 —— 而文件头承诺「永不抛异常」。
   * 根因是 `evaluate` 的 catch 只接 `CalcError`，栈溢出原样漏给调用方。
   * 修法两道：`MAX_DEPTH`（100）先给明确话术，`RangeError` 再兜底。
   */
  it('深层嵌套只给 error，绝不把 RangeError 漏出去', () => {
    for (const n of [200, 1000, 5000, 50000]) {
      const deep = '('.repeat(n) + '1' + ')'.repeat(n)
      expect(() => evaluate(deep), `${n} 层括号不该抛`).not.toThrow()
      const r = evaluate(deep)
      expect(r.value, `${n} 层：值应为 NaN`).toBeNaN()
      expect(r.error, `${n} 层：应给出 error 文案`).not.toBeNull()
    }
    // 连续一元负号走的是同一条递归路径，也要受限
    expect(() => evaluate('-'.repeat(50000) + '1')).not.toThrow()
    expect(evaluate('-'.repeat(50000) + '1').error).not.toBeNull()
    // 单边括号（不配对）深了同样不能抛
    expect(() => evaluate('('.repeat(5000) + '1')).not.toThrow()
    expect(evaluate('('.repeat(5000) + '1').error).not.toBeNull()
  })

  it('深度上限不误伤正常输入（100 层以内照常算对）', () => {
    expect(evaluate('('.repeat(50) + '1+1' + ')'.repeat(50)).value).toBe(2)
    expect(evaluate('('.repeat(100) + '1' + ')'.repeat(100)).value).toBe(1)
    // 边界外侧：101 层就该被挡下，而不是继续吃栈
    expect(evaluate('('.repeat(101) + '1' + ')'.repeat(101)).error).toBe('嵌套太深了')
  })
})
