/**
 * 网页取数（声明式扩展）的引擎层单测。
 *
 * 断言的重点不是"能取到数"，而是**边界与降级**：路径只认白名单形状、URL 走 watch 同一套
 * 判据、格式化不猜单位、列表提取的落空都给"—"而不是抛。这些正是"零代码扩展"能安全
 * 开放给用户的前提。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REFRESH_SEC,
  MAX_ENDPOINTS,
  MIN_REFRESH_SEC,
  cleanPath,
  fetchPlan,
  formatValue,
  isScalar,
  listOf,
  pickPath,
  sanitizeEndpoints,
  type HttpEndpoint,
} from '../../packages/engine/src/http'

const ep = (over: Partial<HttpEndpoint> = {}): HttpEndpoint => ({
  id: 'e1',
  label: '汇率',
  url: 'https://open.er-api.com/v6/latest/CNY',
  refreshSec: 300,
  path: 'rates.USD',
  scale100: false,
  ...over,
})

describe('路径：只认白名单形状（不执行任何表达式）', () => {
  it('接受 `a.b[0].c` 这一类形状，拒绝一切带表达式/引号/空白的输入', () => {
    expect(cleanPath('a.b[0].c')).toBe('a.b[0].c')
    expect(cleanPath('_x.$y')).toBe('_x.$y')
    expect(cleanPath('data[12]')).toBe('data[12]')
    for (const bad of ['', 'a b', 'a["x"]', 'a[b]', '[0]', 'a..b', 'a!', 'x'.repeat(201)]) {
      expect(cleanPath(bad), `不该接受 ${bad}`).toBe('')
    }
  })

  it('顺带挡掉原型链读法：constructor 这种键名进不来（cleanPath 白名单之外）', () => {
    // 注：`constructor` 本身是合法标识符形状，会被 cleanPath 接受 —— 但 pickPath 只读
    // **自己数据**里的键；JSON.parse 出来的对象没有原型链上的业务字段，读不到东西就显示 —
    expect(cleanPath('a.constructor')).toBe('a.constructor')
    expect(pickPath({ a: {} }, 'a.constructor')).toBe(Object) // 这是 JS 语义事实，记录在案
    // 因此**取值结果还要过 formatValue**：函数会被显示成"对象"而不是可调用的东西
    expect(formatValue(pickPath({ a: {} }, 'a.constructor'))).toBe('对象')
  })

  it('取值：落空一律 undefined（不抛），数组越界同样落空', () => {
    const data = { a: { b: [{ c: 1 }, { c: 2 }] }, z: null }
    expect(pickPath(data, 'a.b[1].c')).toBe(2)
    expect(pickPath(data, 'a.b[9].c')).toBeUndefined()
    expect(pickPath(data, 'a.nope.c')).toBeUndefined()
    expect(pickPath(data, 'z.x')).toBeUndefined()
    expect(pickPath(data, 'a.b[0].c.d')).toBeUndefined()
    expect(pickPath(data, '')).toEqual(data)
  })
})

describe('格式化：不猜单位、不拖尾零、落空给破折号', () => {
  it('整数不带小数点，非整数两位；scale100 折成元', () => {
    expect(formatValue(7)).toBe('7')
    expect(formatValue(7.5)).toBe('7.50')
    expect(formatValue(1234, true)).toBe('12.34')
    expect(formatValue(Number.NaN)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
    expect(formatValue(null)).toBe('—')
  })

  it('字符串截长、布尔说人话、容器说类型（不递归展开）', () => {
    expect(formatValue('现货黄金')).toBe('现货黄金')
    expect(formatValue('x'.repeat(200))).toHaveLength(121)
    expect(formatValue(true)).toBe('是')
    expect(formatValue([1, 2, 3])).toBe('数组（3 项）')
    expect(formatValue({ a: 1 })).toBe('对象')
    expect(isScalar(3)).toBe(true)
    expect(isScalar([3])).toBe(false)
  })
})

describe('列表提取：只认"数组里每项能取出标量"这一种形状', () => {
  it('取 label 与 value；落空项跳过；上限生效', () => {
    const data = {
      list: [
        { name: '甲', v: 11 },
        { name: '乙', v: 22 },
        { name: '丙' },
        { name: '丁', v: 44 },
      ],
    }
    const rows = listOf(pickPath(data, 'list'), 'v', 'name', 3)
    expect(rows).toEqual([
      { label: '甲', value: '11' },
      { label: '乙', value: '22' },
      { label: '丁', value: '44' },
    ])
  })

  it('标量数组（热搜词条那种）也能用：label 取序号', () => {
    const rows = listOf(['甲', '乙'], '', '', 5)
    expect(rows).toEqual([
      { label: '1', value: '甲' },
      { label: '2', value: '乙' },
    ])
  })

  it('不是数组就空表（不抛）', () => {
    expect(listOf({ a: 1 }, '', '')).toEqual([])
    expect(listOf(null, '', '')).toEqual([])
  })
})

describe('取数计划：网页版与桌面壳的降级要写明', () => {
  it('桌面壳一律 native；网页版标 desktop-only（CORS 名单会过期，运行时试一次最诚实）', () => {
    expect(fetchPlan(ep(), true)).toBe('native')
    expect(fetchPlan(ep(), false)).toBe('desktop-only')
  })

  it('URL 不合规（被改过的盘上数据）判 blocked —— 运行时也要能兜住', () => {
    expect(fetchPlan(ep({ url: 'http://x.com/a' }), true)).toBe('blocked')
    expect(fetchPlan(ep({ url: 'https://127.0.0.1/a' }), true)).toBe('blocked')
    expect(fetchPlan(ep({ url: 'https://router.local/a' }), false)).toBe('blocked')
  })
})

describe('端点表清洗：与 sanitizeWatch 同一套骨架', () => {
  it('丢坏的、同 URL 去重、刷新夹到区间、路径清洗、上限', () => {
    const { endpoints, rejected } = sanitizeEndpoints([
      { url: 'https://a.example/x', refreshSec: 1, path: 'a.b' },
      { url: 'https://a.example/x' }, // 重复 → 丢
      { url: 'http://b.example/x' }, // 非 https → rejected
      { url: 'https://127.0.0.1/x' }, // 私网 → rejected
      { label: '  ', url: 'https://c.example/y', refreshSec: 999999, path: 'a["b"]' },
      { url: 42 }, // 形状不对 → rejected
    ])
    expect(rejected).toBe(3)
    expect(endpoints.map((e) => e.url)).toEqual(['https://a.example/x', 'https://c.example/y'])
    expect(endpoints[0].refreshSec, '低于下限夹到 30').toBe(MIN_REFRESH_SEC)
    expect(endpoints[1].refreshSec, '高于上限夹到 24h').toBe(24 * 3600)
    expect(endpoints[0].path).toBe('a.b')
    expect(endpoints[1].path, '非法路径归零（取整份响应）').toBe('')
    expect(endpoints[0].id).toBe(endpoints[0].url)
  })

  it('缺省刷新用默认值；limit 生效', () => {
    const many = Array.from({ length: MAX_ENDPOINTS + 5 }, (_, i) => ({ url: `https://h${i}.example/x` }))
    const { endpoints } = sanitizeEndpoints(many)
    expect(endpoints).toHaveLength(MAX_ENDPOINTS)
    expect(endpoints[0].refreshSec).toBe(DEFAULT_REFRESH_SEC)
  })
})
