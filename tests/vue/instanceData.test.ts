/**
 * 按实例取数（F-01 阶段 2）：判定层的用例。
 *
 * 这里只钉**判定**（读哪一份 / 写哪一份）—— 卡片里那半（v-model 接成读写对）由 E2E 钉，
 * 与 `floatList.test.ts` / `moduleFilter.test.ts` 同一条分工。
 *
 * 三条口径各有用例，外加两条"不许静默变空"的防守：
 * 只拿到实例 id、拿不到模块 id 时必须回落到顶层 —— 那样任何还没传 module-id 的渲染点
 * 行为都与今天一致，而不是把内容变没。
 */
import { describe, expect, it } from 'vitest'
import { stickyOf, writeSticky, type InstanceSource } from '../../src/vue/instanceData'

const src = (sticky: string, byInstance?: InstanceSource['byInstance']): InstanceSource =>
  byInstance ? { sticky, byInstance } : { sticky }

describe('stickyOf：读哪一份', () => {
  it('单实例（实例 id 就是模块 id）读顶层那一份', () => {
    expect(stickyOf(src('共享的正文'), 'sticky', 'sticky')).toBe('共享的正文')
  })

  it('只拿到实例 id、拿不到模块 id ⇒ 读顶层（不静默变空）', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), undefined, 'sticky:2')).toBe('共享的正文')
  })

  it('拿不到实例 id ⇒ 读顶层', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), 'sticky', undefined)).toBe('共享的正文')
  })

  it('第二实例有自己的内容 ⇒ 读自己的', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': { sticky: '第二张' } }), 'sticky', 'sticky:2')).toBe('第二张')
  })

  it('第二实例还没写过 ⇒ 空白，不继承顶层（第二条口径）', () => {
    expect(stickyOf(src('共享的正文'), 'sticky', 'sticky:2')).toBe('')
  })

  it('byInstance 里那一份没有 sticky 字段 ⇒ 空白', () => {
    expect(stickyOf(src('共享的正文', { 'sticky:2': {} }), 'sticky', 'sticky:2')).toBe('')
  })

  it('顶层那一份本身没内容 ⇒ 空串（防御，不返回 undefined）', () => {
    expect(stickyOf({ sticky: undefined as unknown as string }, 'sticky', 'sticky')).toBe('')
  })

  it('判定不靠解析 `:2` 后缀：只看两个 id 是否相等', () => {
    // 形状上不像"第二张"，但只要实例 id ≠ 模块 id 就按第二实例处理
    expect(stickyOf(src('共享', { 'abc': { sticky: '自己的' } }), 'sticky', 'abc')).toBe('自己的')
  })
})

describe('writeSticky：写哪一份', () => {
  it('写第一实例 ⇒ 仍写顶层，不建 byInstance', () => {
    const d = src('旧的')
    writeSticky(d, 'sticky', 'sticky', '新的')
    expect(d.sticky).toBe('新的')
    expect(d.byInstance).toBeUndefined()
  })

  it('写第二实例 ⇒ 建自己的一份，顶层不动', () => {
    const d = src('第一张的正文')
    writeSticky(d, 'sticky', 'sticky:2', '第二张的正文')
    expect(d.sticky).toBe('第一张的正文')
    expect(d.byInstance).toEqual({ 'sticky:2': { sticky: '第二张的正文' } })
    expect(stickyOf(d, 'sticky', 'sticky:2')).toBe('第二张的正文')
  })

  it('第二实例反复写 ⇒ 覆盖自己的那一份，也不碰同模块的其它实例', () => {
    const d = src('第一张')
    writeSticky(d, 'sticky', 'sticky:2', '甲')
    writeSticky(d, 'sticky', 'sticky:3', '乙')
    writeSticky(d, 'sticky', 'sticky:2', '甲改过')
    expect(d.byInstance).toEqual({ 'sticky:2': { sticky: '甲改过' }, 'sticky:3': { sticky: '乙' } })
  })

  it('已有 byInstance 时再写 ⇒ 保留同实例里将来会有的其它字段（现在是空集，形状要留着）', () => {
    const d = src('第一张', { 'sticky:2': {} })
    writeSticky(d, 'sticky', 'sticky:2', '写了')
    expect(d.byInstance?.['sticky:2']).toEqual({ sticky: '写了' })
  })

  it('拿不到模块 id 时写 ⇒ 写顶层（与读的回落同一条口径）', () => {
    const d = src('旧的')
    writeSticky(d, undefined, 'sticky:2', '新的')
    expect(d.sticky).toBe('新的')
    expect(d.byInstance).toBeUndefined()
  })
})
