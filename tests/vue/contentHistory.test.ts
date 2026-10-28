/**
 * 内容级撤销（`src/vue/contentHistory.ts`）的判据。
 *
 * 为什么要有它：版面撤销一直有，**用户敲进去的字**没有 —— 删一条待办、清空便签，
 * Ctrl+Z 只撤版面，内容永久丢失。这几条测试锁住四件事：
 *  ① 增/删/改都能撤回来；
 *  ② 一段连续输入合并成**一步**（窗口内多次改动只撤一次）；
 *  ③ 撤销/重做都不制造新历史（否则 Ctrl+Z 会自己套娃）；
 *  ④ 上限与"新改动清空重做"；
 *  ⑤ 直接改 `state`（卡组件的 v-model 路径）与走 API 一样被记录。
 */
import { describe, expect, it } from 'vitest'
import { reactive, watch } from 'vue'
import { createFallbackCardData } from '../../src/vue/cardDataFallback'
import { createContentHistory } from '../../src/vue/contentHistory'

const setup = (opts: { limit?: number } = {}) => {
  const state = reactive(createFallbackCardData())
  const hist = createContentHistory(state, { limit: opts.limit, windowMs: 500 })
  return { state, hist }
}

describe('内容级撤销', () => {
  it('删掉一条待办 → 撤销能整条回来，重做再删掉', () => {
    const { state, hist } = setup()
    const before = state.todos.length
    const id = state.todos[0].id
    state.todos = state.todos.filter((t) => t.id !== id)
    hist.flush()
    expect(state.todos.some((t) => t.id === id)).toBe(false)

    expect(hist.undo()).toBe(true)
    expect(state.todos.some((t) => t.id === id), '撤销把条目恢复').toBe(true)
    expect(state.todos.length).toBe(before)

    expect(hist.redo()).toBe(true)
    expect(state.todos.some((t) => t.id === id), '重做再删掉').toBe(false)
  })

  it('一段连续输入合并成一步：窗口内多次改动只撤一次就回到起点', () => {
    const { state, hist } = setup()
    const start = state.sticky
    state.sticky = `${start}a`
    state.sticky = `${start}ab`
    state.sticky = `${start}abc`
    hist.flush()
    expect(hist.undo()).toBe(true)
    expect(state.sticky).toBe(start)
    expect(hist.canUndo.value, '这三下是一步，撤完就到头了').toBe(false)
  })

  it('两段之间 flush 后各自成步，撤销顺序从近到远', () => {
    const { state, hist } = setup()
    const start = state.sticky
    state.sticky = `${start}1`
    hist.flush()
    state.sticky = `${start}12`
    hist.flush()
    expect(hist.undo()).toBe(true)
    expect(state.sticky).toBe(`${start}1`)
    expect(hist.undo()).toBe(true)
    expect(state.sticky).toBe(start)
  })

  it('撤销与重做都不制造新历史（不会 Ctrl+Z 套娃）', () => {
    const { state, hist } = setup()
    state.sticky = 'x'
    hist.flush()
    hist.undo()
    expect(hist.canRedo.value).toBe(true)
    hist.undo() // 没有更早的了
    expect(state.sticky, '多余的撤销不改变状态').toBe('')
    hist.redo()
    hist.redo() // 没有更多可重做
    expect(state.sticky).toBe('x')
  })

  it('新改动清空重做栈', () => {
    const { state, hist } = setup()
    state.sticky = 'a'
    hist.flush()
    hist.undo()
    expect(hist.canRedo.value).toBe(true)
    state.sticky = 'b'
    hist.flush()
    expect(hist.canRedo.value, '新的改动之后旧的重做不该还在').toBe(false)
  })

  it('历史上限生效：limit=3 时最多撤 3 步', () => {
    const { state, hist } = setup({ limit: 3 })
    for (let i = 0; i < 6; i++) {
      state.sticky = `v${i}`
      hist.flush()
    }
    let n = 0
    while (hist.undo()) n++
    expect(n).toBe(3)
  })

  it('直接赋值与数组变更都被记录（卡组件的 v-model 路径）', () => {
    const { state, hist } = setup()
    state.todos.push({ id: 'tmp', text: '新条目', done: false })
    state.ledger.symbol = '€'
    hist.flush()
    expect(hist.undo()).toBe(true)
    expect(state.ledger.symbol, '改单个字段也能撤').not.toBe('€')
    expect(state.todos.some((t) => t.id === 'tmp'), '数组 push 也能撤').toBe(false)
  })

  it('回填保留顶层 reactive 对象（组件依赖同一个注入对象）', () => {
    const { state, hist } = setup()
    const same = state
    state.sticky = 'y'
    hist.flush()
    hist.undo()
    expect(state).toBe(same)
    expect(state.sticky).toBe('')
  })

  it('空历史时 undo 返回 false，不会误报成功', () => {
    const { hist } = setup()
    expect(hist.undo()).toBe(false)
    expect(hist.redo()).toBe(false)
  })

  /**
   * 2026-10-29：E2E 抓出来的缺陷（`apply()` 用 `toRaw(state)` 回填）。
   * 直接写原始对象**不过 Proxy，一个依赖都不触发** —— 数据确实变了（上面几条读 `state`
   * 的断言因此全绿），但界面不刷新、`cardData` 的落盘 watch 也不响：**刷新一下撤销就没了**。
   * 这里用一个 deep + sync 的观察者模拟那两个下游（组件渲染 / 落盘 watch），它必须响。
   */
  it('回填必须走响应式：撤销之后依赖 state 的观察者要被触发（界面与落盘都靠这一下）', () => {
    const { state, hist } = setup()
    const start = state.sticky
    let fired = 0
    let seen = start
    watch(
      () => state,
      () => {
        fired++
        seen = state.sticky
      },
      { deep: true, flush: 'sync' },
    )

    state.sticky = '改动一'
    hist.flush()
    const afterEdit = fired
    expect(afterEdit, '前置：用户自己的改动本来就会被观察到').toBeGreaterThan(0)

    expect(hist.undo()).toBe(true)
    expect(fired, '撤销的回填必须触发依赖（写 toRaw 时这里是 0，界面与落盘都收不到）').toBeGreaterThan(afterEdit)
    expect(seen, '观察者读到的是撤销后的值').toBe(start)
  })
})
