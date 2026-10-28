/**
 * 内容级撤销（2026-10-20，P0-②）。
 *
 * ## 为什么需要它
 * 版面撤销一直是有的（引擎的 `history.ts`），但**用户敲进去的字**没有：删掉一条待办、
 * 清空便签、删掉一笔账，Ctrl+Z 只会撤版面，内容永久丢失。对一个"记录工具"这是硬伤。
 *
 * ## 做法：整份快照 + 连续输入合并
 * `CardData` 是一份小 JSON（几十 KB 量级），所以不做逐操作的反向补丁，直接存快照：
 *  - 一次**连续输入**（500ms 窗口内）合并成一步 —— 否则打十个字要按十次撤销；
 *  - 环形上限 50 步，与版面历史同量级；
 *  - 撤销/重做时整份回填，回填过程用 `suppress` 标记，避免再次入栈。
 *
 * ## 为什么监听整个 state 而不是包一层 API
 * 卡组件既通过 `cards.addTodo()` 这类方法改数据，也直接 `v-model` 绑定 `state.sticky`。
 * 只在方法上挂钩子会漏掉一半写入路径；`watch(deep, sync)` 覆盖全部，且同步执行
 * （`flush:'sync'`）才能让 `suppress` 在回填期间真的挡住记录 —— 默认的 `pre` 队列
 * 会在 suppress 复位之后才跑回调，回填会被当成一次用户改动录进去。
 *
 * ## 与布局撤销的关系
 * 两个栈各自独立，由 App 的 `undoLatest()` 按时间戳选"谁更近"：编辑态永远是版面撤销
 * （那时只在改版面）；工作台态内容改动通常更近。两边都有历史时不会互相踩。
 */
import { computed, ref, toRaw, watch, type ComputedRef, type Ref } from 'vue'
import type { CardData } from './cardDataTypes'

interface Step {
  data: CardData
  at: number
}

export interface ContentHistoryApi {
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 最近一次内容改动的时刻（毫秒）。App 用它和版面历史比"谁更近" */
  lastAt: Ref<number>
  /** 把尚未落定的连续输入立刻合并成一步（测试、切方案/关闭前用） */
  flush(): void
  undo(): boolean
  redo(): boolean
  clear(): void
}

export interface ContentHistoryOptions {
  /** 历史步数上限（默认 50，与版面历史一致） */
  limit?: number
  /** 连续输入的合并窗口（毫秒，默认 500） */
  windowMs?: number
  /** 可注入的时钟（测试用） */
  now?: () => number
}

export function createContentHistory(state: CardData, opts: ContentHistoryOptions = {}): ContentHistoryApi {
  const limit = opts.limit ?? 50
  const windowMs = opts.windowMs ?? 500
  const now = opts.now ?? (() => Date.now())

  const snapshot = (): CardData => JSON.parse(JSON.stringify(toRaw(state))) as CardData
  const past: Step[] = []
  const future: Step[] = []
  const lastAt = ref(0)
  const version = ref(0)

  /** 上一段"已落定"的状态（每次提交后更新） */
  let live: CardData = snapshot()
  /** 当前这一段连续输入的起点（null = 没有未落定的输入） */
  let burstBase: CardData | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let suppress = false

  const canUndo = computed(() => version.value >= 0 && (past.length > 0 || burstBase !== null))
  const canRedo = computed(() => version.value >= 0 && future.length > 0)
  const bump = () => void version.value++

  function commitBurst(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!burstBase) return
    past.push({ data: burstBase, at: now() })
    if (past.length > limit) past.splice(0, past.length - limit)
    future.length = 0
    burstBase = null
    live = snapshot()
    lastAt.value = now()
    bump()
  }

  /**
   * 回填：删掉现有键再赋新值（保留同一个 reactive 对象的引用，组件不重挂）。
   *
   * **必须走代理改，不能 `toRaw` 改（2026-10-29 修）**：原写法先 `toRaw(state)` 拿原始对象
   * 再删键赋值 —— 直接写原始对象**不过 Proxy，一个依赖都不触发**（本机实测：`watch(deep, sync)`
   * 的 fired 增量 = 0；走代理则是 4）。后果是撤销/重做之后：界面不刷新（卡片还显示旧内容）、
   * `cardData` 那个 300ms 落盘 watch 也不响（**刷新一下，撤销就蒸发了**）。
   * 单测读的是 `state` 本身 —— 代理读会拿到新值，所以这条缺陷在单测里一直是绿的，
   * 只有端到端（`tests/e2e/undo.spec.ts`）看得见。
   */
  function apply(data: CardData): void {
    const target = state as unknown as Record<string, unknown>
    suppress = true
    try {
      for (const k of Object.keys(target)) delete target[k]
      Object.assign(target, JSON.parse(JSON.stringify(data)) as Record<string, unknown>)
    } finally {
      suppress = false
    }
    live = snapshot()
  }

  watch(
    () => state,
    () => {
      if (suppress) return
      if (!burstBase) burstBase = live
      if (timer) clearTimeout(timer)
      timer = setTimeout(commitBurst, windowMs)
      bump()
    },
    { deep: true, flush: 'sync' },
  )

  return {
    canUndo,
    canRedo,
    lastAt,
    flush: commitBurst,
    undo(): boolean {
      commitBurst()
      const prev = past.pop()
      if (!prev) return false
      future.push({ data: snapshot(), at: now() })
      apply(prev.data)
      lastAt.value = now()
      bump()
      return true
    },
    redo(): boolean {
      commitBurst()
      const next = future.pop()
      if (!next) return false
      past.push({ data: snapshot(), at: now() })
      if (past.length > limit) past.splice(0, past.length - limit)
      apply(next.data)
      lastAt.value = now()
      bump()
      return true
    },
    clear(): void {
      if (timer) clearTimeout(timer)
      timer = null
      past.length = 0
      future.length = 0
      burstBase = null
      live = snapshot()
      bump()
    },
  }
}
