import { describe, expect, it } from 'vitest'
import { evaluate, formatCalcNumber } from '@modulo/engine/calc'

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
})
