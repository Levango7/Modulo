/**
 * `cardData` 存储层：reactive 状态 + 持久化 + 全部写入动作，外加本族的 barrel 再导出。
 *
 * 2026-10-20（#124）从 909 行拆成五份，公开 API 一字未动：
 *   - 类型定义      → `cardDataTypes.ts`
 *   - 数值边界/夹取 → `cardDataLimits.ts`（两层共用的上限单一真相）
 *   - 清洗层        → `cardDataSanitize.ts`
 *   - 示例内容      → `cardDataFallback.ts`
 * 卡片组件与测试仍从本文件 import（`export *` + 显式再导出保持导出面逐字一致）。
 */
import { reactive, watch } from 'vue'
import {
  isValidBirthday,
  isValidDate,
  MAX_CENTS,
  MAX_MINUTES,
  normalizeHhmm,
  normalizeUrl,
  sanitizeCommands,
  sanitizeFeeds,
  sanitizeLinks,
  sanitizeProbes,
  sanitizeStocks,
  sanitizeWatch,
} from '@levango7/engine'
import { sanitizeEndpoints } from '@levango7/engine/http'
import { sanitizeLaunch } from '@levango7/engine/launcher'
import { MAX_HTML_CARDS, validateSnippet } from '@levango7/engine/htmlcard'
import { MAX_EXT_CARDS, parseExtManifest, sanitizeExtState } from '@levango7/engine/extcard'
import { sanitizeCardData } from './cardDataSanitize'
import {
  MAX_BIRTHDAYS,
  MAX_ITEMS,
  MAX_LEDGER_ROWS,
  MAX_PICKS,
  MAX_TIMER_MS,
  clampWeight,
  knownCategory,
} from './cardDataLimits'
import { createFallbackCardData } from './cardDataFallback'
import { browserStorage } from './store'
import { QUADRANTS, type CardData, type Quadrant, type TimerKey } from './cardDataTypes'

export * from './cardDataTypes'
export { sanitizeCardData } from './cardDataSanitize'
/** 按实例取数的判定层（F-01 阶段 2）：卡片组件直接拿它配 `state` 用，不绕一层 API */
export { stickyOf, writeSticky } from './instanceData'

const KEY = 'modulo.carddata.v1'

/**
 * 条目 id：时间戳（base36）+ 4 位随机后缀。
 * 裸 `Date.now()` 会撞号 —— 同一毫秒连加两条，update/remove 按 id 定点就会连坐误伤
 * （#124 拆分补测试时抓出的真 bug：addHtmlCard 同毫秒两张卡共享 id，改一张两张一起改）。
 * cardDataSanitize.ts 的 uniqueId 注释早写明"撞号会连坐"，这里让写入路径兑现它。
 * 与 useSchemes.ts 的 newId 同一招式；sanitize 只认非空字符串，id 格式不设契约。
 */
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function createCardData(storage = browserStorage()) {
  const fallback = createFallbackCardData()
  let initial = fallback
  try {
    const raw = storage.get(KEY)
    if (raw) initial = sanitizeCardData(JSON.parse(raw) as unknown, fallback)
  } catch {
    /* 数据损坏时回退示例内容，不阻塞启动 */
  }

  const state = reactive<CardData>(initial)
  /**
   * 写入防抖（2026-10-21，P0-② 起挂着的遗留）：每敲一个字都把整份 cardData 序列化写盘，
   * 一次长输入就是几十次整份 JSON 写。300 ms 内合并成一次 —— 判据是「≤300ms」（§4 性能表）。
   *
   * **必须能被"立刻"冲刷**：`pagehide` / `beforeunload` 时把最后一笔写掉，否则
   * "输入后立刻刷新"会丢字（E2E 与真用户都会踩）。桌面壳关窗收进托盘不触发 unload，
   * 但那时 300ms 的定时器早已落盘。`flush()` 也暴露给调用方（测试与"导出前"用）。
   */
  const WRITE_DEBOUNCE_MS = 300
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending === null) return
    const json = pending
    pending = null
    storage.set(KEY, json)
  }

  function schedule(json: string): void {
    pending = json
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, WRITE_DEBOUNCE_MS)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
  }

  watch(
    () => ({
      ...state,
      todos: [...state.todos],
      notes: [...state.notes],
      birthdays: [...state.birthdays],
      pickList: [...state.pickList],
      'ledger.entries': state.ledger.entries.map((r) => ({ ...r })),
      links: [...state.links],
      commands: [...state.commands],
      matrix: [...state.matrix],
      probes: [...state.probes],
      stocks: [...state.stocks],
      feeds: [...state.feeds],
      watch: [...state.watch],
      endpoints: [...state.endpoints],
      launch: [...state.launch],
      htmlCards: state.htmlCards.map((c) => ({ ...c })),
      extCards: state.extCards.map((c) => ({ ...c })),
      extState: { ...state.extState },
      // 按实例的内容（F-01 阶段 2）：整段替换式写入（见 `instanceData.ts` 的 writeSticky），
      // 所以这里浅拷贝一层就够触发 —— 但它必须出现在 getter 里，否则深层 watch 看不见它。
      byInstance: { ...state.byInstance },
      'duty.roster': [...state.duty.roster],
      timers: {
        stopwatch: { ...state.timers.stopwatch },
        countdown: { ...state.timers.countdown },
        interval: { ...state.timers.interval },
        breath: { ...state.timers.breath },
      },
    }),
    (v) => schedule(JSON.stringify(v)),
    { deep: true },
  )

  return {
    state,
    /** 立刻落盘（合并窗口内还没写的那一笔） */
    flush,
    addTodo(text: string) {
      const t = text.trim()
      if (!t) return
      state.todos.push({ id: nextId('t'), text: t, done: false })
    },
    toggleTodo(id: string) {
      const t = state.todos.find((x) => x.id === id)
      if (!t) return
      t.done = !t.done
      // 打勾记完成时刻，取消勾就抹掉 —— 否则"完成时间"会指向一个不再成立的过去，
      // 月度统计也会把这条算进一个它并没有完成的月份。
      if (t.done) t.doneAt = Date.now()
      else delete t.doneAt
    },
    removeTodo(id: string) {
      state.todos = state.todos.filter((x) => x.id !== id)
    },
    addNote(title: string, body: string) {
      state.notes.unshift({ id: nextId('n'), title: title.trim() || '无标题', body, at: Date.now() })
    },
    addBirthday(name: string, month: number, day: number, year?: number) {
      const n = name.trim()
      if (!n || !isValidBirthday({ month, day })) return
      if (state.birthdays.length >= MAX_BIRTHDAYS) return
      state.birthdays.push({
        id: nextId('b'),
        name: n.slice(0, 24),
        month,
        day,
        ...(typeof year === 'number' && Number.isInteger(year) && year > 0 && year <= 9999 ? { year } : {}),
      })
    },
    removeBirthday(id: string) {
      state.birthdays = state.birthdays.filter((b) => b.id !== id)
    },
    addPick(label: string) {
      const l = label.trim()
      if (!l || state.pickList.length >= MAX_PICKS) return
      state.pickList.push({ id: nextId('p'), label: l.slice(0, 24), weight: 1 })
    },
    setPickWeight(id: string, weight: number) {
      const p = state.pickList.find((x) => x.id === id)
      if (p) p.weight = clampWeight(weight)
    },
    removePick(id: string) {
      state.pickList = state.pickList.filter((p) => p.id !== id)
    },
    addLedger(date: string, cents: number, category: string, note: string) {
      if (!isValidDate(date)) return
      if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) return
      if (state.ledger.entries.length >= MAX_LEDGER_ROWS) return
      state.ledger.entries.push({
        id: nextId('e'),
        date,
        cents,
        category: knownCategory(category),
        note: note.trim().slice(0, 40),
      })
    },
    removeLedger(id: string) {
      state.ledger.entries = state.ledger.entries.filter((r) => r.id !== id)
    },
    toggleMeetingCity(id: string) {
      const list = state.meeting.cityIds
      const at = list.indexOf(id)
      if (at >= 0) state.meeting.cityIds = list.filter((x) => x !== id)
      // 最多 4 个：第五个不是"再加一个"，而是"先去掉一个" —— 静默丢弃更让人困惑
      else if (list.length < 4) state.meeting.cityIds = [...list, id]
    },
    setMeetingTime(at: string, minutes: number) {
      const norm = normalizeHhmm(at)
      if (norm) state.meeting.at = norm
      if (Number.isFinite(minutes)) state.meeting.minutes = Math.min(600, Math.max(5, Math.round(minutes)))
    },
    setMeetingTitle(title: string) {
      state.meeting.title = title.trim().slice(0, 24)
    },
    /** 计时器：四个钟共用三个动作 —— 状态形状一样，所以这里也只有一份实现 */
    timerStart(which: TimerKey) {
      const t = state.timers[which]
      if (!t.startedAt) t.startedAt = Date.now()
    },
    timerPause(which: TimerKey) {
      const t = state.timers[which]
      if (t.startedAt === null) return
      t.accumulatedMs = Math.min(MAX_TIMER_MS, t.accumulatedMs + Math.max(0, Date.now() - t.startedAt))
      t.startedAt = null
    },
    timerReset(which: TimerKey) {
      const t = state.timers[which]
      t.accumulatedMs = 0
      t.startedAt = null
    },
    setCountdownMinutes(min: number) {
      state.timers.countdown.minutes = Math.min(MAX_MINUTES, Math.max(1, Math.round(Number.isFinite(min) ? min : 25)))
    },
    /** 换预设：进度保留，但已完成段数与相位归零 —— 换了节奏还停在"番茄的第 3 段"没有意义 */
    setIntervalPreset(presetId: string) {
      state.timers.interval.presetId = presetId
      state.timers.interval.completedFocus = 0
      state.timers.interval.phaseIndex = 0
      state.timers.interval.accumulatedMs = 0
      state.timers.interval.startedAt = null
    },
    /** 引擎的 `intervalView` 是纯计算；切段后由界面把结果写回来。不写的话暂停再继续会弹回上一段 */
    setIntervalPhase(phaseIndex: number, completedFocus: number) {
      const iv = state.timers.interval
      iv.phaseIndex = Math.max(0, Math.round(Number.isFinite(phaseIndex) ? phaseIndex : 0))
      iv.completedFocus = Math.max(0, Math.round(Number.isFinite(completedFocus) ? completedFocus : 0))
      // 换段 = 本段已跑完，进度归零
      iv.accumulatedMs = 0
      iv.startedAt = null
    },
    setBreathPattern(patternId: string) {
      state.timers.breath.patternId = patternId
      state.timers.breath.accumulatedMs = 0
      state.timers.breath.startedAt = null
    },
    addLink(label: string, href: string) {
      const next = sanitizeLinks([...state.links, { label, href }])
      // `sanitizeLinks` 会重排去重，所以"加一条"要把**整份**结果写回，不能只 push
      if (next.length === state.links.length && !next.some((l) => l.href === href.trim())) return
      state.links = next
    },
    removeLink(id: string) {
      state.links = state.links.filter((l) => l.id !== id)
    },
    /** 命令速查：与 addLink 同一思路——整份清洗结果写回（sanitizeCommands 会重排去重） */
    addCommand(label: string, cmd: string) {
      if (!cmd.trim()) return
      const next = sanitizeCommands([...state.commands, { label, cmd }])
      if (next.length === state.commands.length && !next.some((c) => c.cmd === cmd.trim())) return
      state.commands = next
    },
    removeCommand(id: string) {
      state.commands = state.commands.filter((c) => c.id !== id)
    },
    /** 四象限待办：加一条（带象限）；勾/挪/删。与 todos 同一套 doneAt 语义 */
    addMatrixTodo(text: string, q: Quadrant) {
      const t = text.trim()
      if (!t || state.matrix.length >= MAX_ITEMS) return
      state.matrix.push({ id: nextId('m'), text: t, done: false, q: QUADRANTS.includes(q) ? q : 'do' })
    },
    toggleMatrixTodo(id: string) {
      const t = state.matrix.find((x) => x.id === id)
      if (!t) return
      t.done = !t.done
      if (t.done) t.doneAt = Date.now()
      else delete t.doneAt
    },
    moveMatrixTodo(id: string, q: Quadrant) {
      const t = state.matrix.find((x) => x.id === id)
      if (t && QUADRANTS.includes(q)) t.q = q
    },
    removeMatrixTodo(id: string) {
      state.matrix = state.matrix.filter((x) => x.id !== id)
    },
    /** 连通性探测：端点名单与 watch 同一条边界（sanitizeProbes 走 normalizeUrl） */
    addProbe(label: string, url: string) {
      if (!url.trim()) return
      const next = sanitizeProbes([...state.probes, { label, url }])
      if (next.length === state.probes.length && !next.some((p) => p.url === url.trim())) return
      state.probes = next
    },
    removeProbe(id: string) {
      state.probes = state.probes.filter((p) => p.id !== id)
    },
    /** 股票自选：代码过引擎规范化（同码不同所：前缀保留），坏代码静默拒 */
    addStock(label: string, code: string) {
      if (!code.trim()) return
      const next = sanitizeStocks([...state.stocks, { label, code }])
      if (next.length === state.stocks.length && !next.some((x) => x.code === code.trim().toLowerCase())) return
      state.stocks = next
    },
    removeStock(id: string) {
      state.stocks = state.stocks.filter((x) => x.id !== id)
    },
    /** RSS 订阅：与 watch/probe 同一条 URL 边界（sanitizeFeeds 走 normalizeUrl） */
    addFeed(label: string, url: string) {
      if (!url.trim()) return
      const next = sanitizeFeeds([...state.feeds, { label, url }])
      if (next.length === state.feeds.length && !next.some((x) => x.url === url.trim())) return
      state.feeds = next
    },
    removeFeed(id: string) {
      state.feeds = state.feeds.filter((f) => f.id !== id)
    },
    /**
     * 加一条监控。`normalizeUrl` 先在**前端**过一遍边界，用户敲错时立刻有反馈；
     * 但这**不是**安全边界 —— 页面能被 XSS 改，真正的判定在 Rust 侧（`net.rs`），
     * 两边各判一次是有意的冗余，不是重复实现。
     */
    /** 网页取数：加一个端点；返回 false = URL 不合规（调用方据此提示，不静默丢弃） */
    addEndpoint(label: string, url: string) {
      const { endpoints, rejected } = sanitizeEndpoints([...state.endpoints, { label, url }])
      if (rejected > 0) return false
      state.endpoints = endpoints
      return true
    },
    removeEndpoint(id: string) {
      state.endpoints = state.endpoints.filter((e) => e.id !== id)
    },
    /** 改显示参数（路径 / 刷新 / 金额模式 / 显示名）——URL 与 id 不动 */
    tuneEndpoint(id: string, patch: { path?: string; refreshSec?: number; scale100?: boolean; label?: string }) {
      state.endpoints = sanitizeEndpoints(state.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e))).endpoints
    },
    /** 速达：加一条；返回 false = 目标形状不合规（调用方据此提示） */
    /** 自定卡：加一张；返回原因字符串（null = 成功）—— 校验信息要能原样显示给用户 */
    addHtmlCard(title: string, html: string): string | null {
      const check = validateSnippet(html)
      if (!check.ok) return check.reason ?? '这条没能通过校验'
      if (state.htmlCards.length >= MAX_HTML_CARDS) return `自定卡最多 ${MAX_HTML_CARDS} 张`
      const id = nextId('h')
      state.htmlCards = [...state.htmlCards, { id, title: title.trim().slice(0, 24) || '自定卡', html }]
      return null
    },
    updateHtmlCard(id: string, patch: { title?: string; html?: string }): string | null {
      if (patch.html !== undefined) {
        const check = validateSnippet(patch.html)
        if (!check.ok) return check.reason ?? '这条没能通过校验'
      }
      state.htmlCards = state.htmlCards.map((c) =>
        c.id === id ? { ...c, ...patch, title: (patch.title ?? c.title).trim().slice(0, 24) || c.title } : c,
      )
      return null
    },
    removeHtmlCard(id: string) {
      state.htmlCards = state.htmlCards.filter((c) => c.id !== id)
    },
    /**
     * 原生卡：导入一份卡包（JSON 文本）。返回原因字符串（null = 成功）——
     * 与 addHtmlCard 同一条约定：校验信息要能原样显示给用户，不静默改写。
     */
    addExtCard(json: string): string | null {
      let raw: unknown
      try {
        raw = JSON.parse(json)
      } catch {
        return '这段 JSON 没解析开 —— 卡包要是一份合法 JSON（manifest 字段 + html 入口）'
      }
      const r = parseExtManifest(raw)
      if (!r.ok) return r.reason
      if (state.extCards.length >= MAX_EXT_CARDS) return `扩展卡最多 ${MAX_EXT_CARDS} 张`
      if (state.extCards.some((c) => c.id === r.card.id)) {
        return `已经装着 id 为 ${r.card.id} 的卡包 —— 先删掉旧的再导入`
      }
      state.extCards = [...state.extCards, r.card]
      return null
    },
    /** 卸载扩展卡：状态跟着走 —— 留着它的 extState 是数据尸体，重装同名卡包从空白开始更干净 */
    removeExtCard(id: string) {
      state.extCards = state.extCards.filter((c) => c.id !== id)
      if (id in state.extState) {
        const rest = { ...state.extState }
        delete rest[id]
        state.extState = rest
      }
    },
    /** 桥 setState 的唯一落点：上限与朴素 JSON 校验在引擎 `sanitizeExtState`，这里只管写回 */
    setExtState(id: string, value: unknown): string | null {
      const st = sanitizeExtState(value)
      if (!st.ok) return st.reason
      state.extState = { ...state.extState, [id]: st.value }
      return null
    },
    addLaunch(label: string, target: string) {
      const { items, rejected } = sanitizeLaunch([...state.launch, { label, target }])
      if (rejected > 0) return false
      state.launch = items
      return true
    },
    removeLaunch(id: string) {
      state.launch = state.launch.filter((x) => x.id !== id)
    },
    addWatch(label: string, url: string) {
      const clean = normalizeUrl(url)
      if (!clean) return
      const r = sanitizeWatch([...state.watch, { label, url: clean }])
      if (r.watch.length === state.watch.length && !r.watch.some((w) => w.url === clean)) return
      state.watch = r.watch
    },
    removeWatch(id: string) {
      state.watch = state.watch.filter((w) => w.id !== id)
    },
    setFixed(base: string, rate: string) {
      state.fixed.base = base.slice(0, 20)
      state.fixed.rate = rate.slice(0, 12)
    },
    addDuty(name: string) {
      const n = name.trim().slice(0, 16)
      if (!n || state.duty.roster.length >= 30 || state.duty.roster.includes(n)) return
      state.duty.roster = [...state.duty.roster, n]
    },
    removeDuty(index: number) {
      state.duty.roster = state.duty.roster.filter((_, i) => i !== index)
    },
    setDutyAnchor(anchor: string) {
      // 空串是合法输入：它表示"以今天为轮转起点"，由界面在读取时补
      state.duty.anchor = anchor === '' || isValidDate(anchor) ? anchor : ''
    },
  }
}

export type CardDataApi = ReturnType<typeof createCardData>
