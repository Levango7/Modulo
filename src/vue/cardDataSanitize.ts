/**
 * `cardData` 的清洗层：盘上数据（JSON.parse 的产物）先过这里再进 `reactive`。
 *
 * 从 cardData.ts 拆出（2026-10-20，#124）。设计前提是「整体不抛」：顶层形状不对
 * 就整份回退示例内容，单条形状不对就只丢那一条 —— 启动永远不被坏数据堵住。
 *
 * `MAX_TIMER_MS` 等跨层共用的上限不在这里 —— 它们在 `cardDataLimits.ts`，
 * 存储层的写入动作（`timerPause` 夹累计值）与这里夹的是同一份。
 */
import {
  isValidBirthday,
  isValidDate,
  MAX_CENTS,
  MAX_MINUTES,
  normalizeHhmm,
  sanitizeCommands,
  sanitizeFeeds,
  sanitizeProbes,
  sanitizeStocks,
  sanitizeLinks,
  sanitizeWatch,
  sanitizeMeetingCityIds,
} from '@levango7/engine'
import { sanitizeEndpoints } from '@levango7/engine/http'
import { sanitizeLaunch } from '@levango7/engine/launcher'
import { sanitizeHtmlCards } from '@levango7/engine/htmlcard'
import { sanitizeExtCards, sanitizeExtState } from '@levango7/engine/extcard'
import {
  MAX_BIRTHDAYS,
  MAX_ITEMS,
  MAX_LEDGER_ROWS,
  MAX_PICKS,
  MAX_TIMER_MS,
  clampWeight,
  knownCategory,
} from './cardDataLimits'
import type { CardData, CountdownSetting, ElapsedSetting, HabitSetting, LedgerRow, MatrixTodo, MeetingSetting, Note, PickItem, Quadrant, StoredBirthday, TimerStore, Todo } from './cardDataTypes'
import { QUADRANTS } from './cardDataTypes'

/** 单条文本截断（清洗层独用；跨层共用的上限在 cardDataLimits.ts） */
const MAX_TEXT = 2000

/**
 * 清洗计时器的持久化块。四个分支形状一样，所以共用一个 `sanitizeRun` 而不是四段几乎相同的代码 ——
 * 四份复制意味着"改了一处忘了另一处"，而这种 bug 平时根本不响。
 *
 * `startedAt` 只接受"有限且为正"的毫秒数；其余一律 null（= 停着）。
 */

const textOf = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** id 必须唯一：toggleTodo / removeTodo 都是按 id find/filter，撞号会连坐改错条目 */
function uniqueId(seen: Set<string>, want: unknown, prefix: string, i: number): string {
  const first = typeof want === 'string' && want ? want : `${prefix}${i}`
  if (!seen.has(first)) {
    seen.add(first)
    return first
  }
  let n = 0
  let id = `${prefix}${i}-${n}`
  while (seen.has(id)) id = `${prefix}${i}-${++n}`
  seen.add(id)
  return id
}

/**
 * 盘上数据先清洗再用。原来只有 try/JSON.parse 兜底，`todos: null` 这类形状错误会一路
 * 传到渲染期的 `todos.filter(...)` 才炸 —— 注释承诺的「不阻塞启动」当时并不成立。
 * 现在整体不抛：顶层不是对象就整份回退，条目形状不对就只丢那一条。
 */
export function sanitizeCardData(raw: unknown, fallback: CardData): CardData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback
  const o = raw as Record<string, unknown>

  const todoSeen = new Set<string>()
  const todos: Todo[] = []
  if (Array.isArray(o.todos)) {
    for (const entry of o.todos.slice(0, MAX_ITEMS)) {
      const e = entry as Partial<Todo> | null
      if (!e || typeof e.text !== 'string' || !e.text.trim()) continue
      // doneAt 只在"已完成且时间戳合法"时留下：未完成的条目带着一个完成时刻没有意义，
      // 而一个坏时间戳会让月度统计按 NaN 比较，静默少算一条 —— 不如当作没有。
      const doneAt = e.done === true && typeof e.doneAt === 'number' && Number.isFinite(e.doneAt) ? e.doneAt : undefined
      todos.push({
        id: uniqueId(todoSeen, e.id, 't', todos.length),
        text: textOf(e.text),
        done: e.done === true,
        ...(doneAt === undefined ? {} : { doneAt }),
      })
    }
  }

  const matrixSeen = new Set<string>()
  const matrix: MatrixTodo[] = []
  if (Array.isArray(o.matrix)) {
    for (const entry of o.matrix.slice(0, MAX_ITEMS)) {
      const e = entry as Partial<MatrixTodo> | null
      if (!e || typeof e.text !== 'string' || !e.text.trim()) continue
      const doneAt = e.done === true && typeof e.doneAt === 'number' && Number.isFinite(e.doneAt) ? e.doneAt : undefined
      matrix.push({
        id: uniqueId(matrixSeen, e.id, 'm', matrix.length),
        text: textOf(e.text),
        q: QUADRANTS.includes(e.q as Quadrant) ? (e.q as Quadrant) : 'do', // 坏象限归位而不是丢条目：字是用户写的
        done: e.done === true,
        ...(doneAt === undefined ? {} : { doneAt }),
      })
    }
  }

  const noteSeen = new Set<string>()
  const notes: Note[] = []
  if (Array.isArray(o.notes)) {
    for (const entry of o.notes.slice(0, MAX_ITEMS)) {
      const e = entry as Partial<Note> | null
      if (!e || (typeof e.title !== 'string' && typeof e.body !== 'string')) continue
      notes.push({
        id: uniqueId(noteSeen, e.id, 'n', notes.length),
        title: textOf(e.title) || '无标题',
        body: textOf(e.body),
        at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : Date.now(),
      })
    }
  }

  const cdRaw = o.countdown as Partial<CountdownSetting> | undefined
  const countdown: CountdownSetting = cdRaw && typeof cdRaw === 'object' && !Array.isArray(cdRaw)
    ? {
        // 名字截短：它只在一张卡上显示，24 个字足够；日期必须真存在（2026-02-30 一律当没设）
        label: textOf(cdRaw.label, 24).trim(),
        date: typeof cdRaw.date === 'string' && isValidDate(cdRaw.date) ? cdRaw.date : '',
      }
    : fallback.countdown

  const elRaw = o.elapsed as Partial<ElapsedSetting> | undefined
  const elapsed: ElapsedSetting = elRaw && typeof elRaw === 'object' && !Array.isArray(elRaw)
    ? {
        label: textOf(elRaw.label, 24).trim(),
        date: typeof elRaw.date === 'string' && isValidDate(elRaw.date) ? elRaw.date : '',
      }
    : fallback.elapsed

  const hbRaw = o.habit as Partial<HabitSetting> | undefined
  const habit: HabitSetting = hbRaw && typeof hbRaw === 'object' && !Array.isArray(hbRaw)
    ? {
        name: textOf(hbRaw.name, 16).trim(),
        days: Array.isArray(hbRaw.days)
          ? [...new Set(hbRaw.days.filter((x): x is string => typeof x === 'string' && isValidDate(x)))].slice(0, 1000)
          : fallback.habit.days,
      }
    : fallback.habit

  const bdSeen = new Set<string>()
  const birthdays: StoredBirthday[] = []
  if (Array.isArray(o.birthdays)) {
    for (const entry of o.birthdays.slice(0, MAX_BIRTHDAYS)) {
      const e = entry as Partial<StoredBirthday> | null
      if (!e || typeof e.name !== 'string' || !e.name.trim()) continue
      if (!isValidBirthday({ month: e.month as number, day: e.day as number })) continue
      birthdays.push({
        id: uniqueId(bdSeen, e.id, 'b', birthdays.length),
        name: textOf(e.name, 24).trim(),
        month: e.month as number,
        day: e.day as number,
        // 年份非法（0 / 负数 / 3000）就不带 —— 引擎会把没有年份当作"不算年龄"，这里只保证不写垃圾进去
        ...(typeof e.year === 'number' && Number.isInteger(e.year) && e.year > 0 && e.year <= 9999 ? { year: e.year } : {}),
      })
    }
  }

  const rowSeen = new Set<string>()
  const entries: LedgerRow[] = []
  const ledRaw =
    typeof o.ledger === 'object' && o.ledger !== null && !Array.isArray(o.ledger)
      ? (o.ledger as { symbol?: unknown; entries?: unknown })
      : undefined
  const ledEntries = Array.isArray(ledRaw?.entries) ? (ledRaw.entries as unknown[]) : []
  for (const entry of ledEntries.slice(0, MAX_LEDGER_ROWS)) {
    const e = entry as Partial<LedgerRow> | null
    if (!e || typeof e.date !== 'string' || !isValidDate(e.date)) continue
    // 金额必须是**非负整数分**。小数 / NaN / 负数 / 字符串一律丢这条 ——
    // 半条账比错账更危险：错账能看出来，半条账会让"总额"悄悄少一块。
    if (typeof e.cents !== 'number' || !Number.isSafeInteger(e.cents) || e.cents < 0 || e.cents > MAX_CENTS) continue
    entries.push({
      id: uniqueId(rowSeen, e.id, 'e', entries.length),
      date: e.date,
      cents: e.cents,
      category: knownCategory(e.category),
      note: textOf(e.note, 40).trim(),
    })
  }

  const mtRaw = o.meeting as Partial<MeetingSetting> | undefined
  const meeting: MeetingSetting =
    mtRaw && typeof mtRaw === 'object' && !Array.isArray(mtRaw)
      ? {
          cityIds: Array.isArray(mtRaw.cityIds) ? sanitizeMeetingCityIds(mtRaw.cityIds.filter((x): x is string => typeof x === 'string')) : fallback.meeting.cityIds,
          at: typeof mtRaw.at === 'string' ? (normalizeHhmm(mtRaw.at) ?? fallback.meeting.at) : fallback.meeting.at,
          minutes: typeof mtRaw.minutes === 'number' && Number.isFinite(mtRaw.minutes) ? Math.min(600, Math.max(5, Math.round(mtRaw.minutes))) : fallback.meeting.minutes,
          title: textOf(mtRaw.title, 24).trim(),
        }
      : fallback.meeting

  const tmRaw = o.timers as Record<string, unknown> | undefined


  /**
 * 清洗计时器的持久化块。四个分支形状一样，所以写一个小循环而不是四段几乎相同的代码 ——
 * 四份复制意味着"改了一处忘了另一处"，而这种 bug 平时根本不响。
 *
 * `startedAt` 只接受"有限且非负"的毫秒数；其余一律 null（= 停着）。
 * 累加量夹在 0–MAX_TIMER_MS（约 7 天）：一个"累计 3 年的秒表"多半是脏数据。
 */
function sanitizeRun(o: unknown, fallback: { accumulatedMs: number; startedAt: number | null }) {
  const r = (typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {}) as Record<string, unknown>
  const acc = typeof r.accumulatedMs === 'number' && Number.isFinite(r.accumulatedMs) ? Math.min(MAX_TIMER_MS, Math.max(0, r.accumulatedMs)) : fallback.accumulatedMs
  const st = typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt > 0 ? r.startedAt : null
  return { accumulatedMs: acc, startedAt: st }
}

function sanitizeTimers(o: Record<string, unknown>, fallback: TimerStore): TimerStore {
  const sub = (k: string): Record<string, unknown> =>
    typeof o[k] === 'object' && o[k] !== null && !Array.isArray(o[k]) ? (o[k] as Record<string, unknown>) : {}
  const iv = sub('interval')
  const cnt = typeof iv.completedFocus === 'number' && Number.isFinite(iv.completedFocus) ? Math.min(9999, Math.max(0, Math.round(iv.completedFocus))) : fallback.interval.completedFocus
  const idx = typeof iv.phaseIndex === 'number' && Number.isFinite(iv.phaseIndex) ? Math.min(9999, Math.max(0, Math.round(iv.phaseIndex))) : fallback.interval.phaseIndex
  return {
    stopwatch: sanitizeRun(o.stopwatch, fallback.stopwatch),
    // 时长单独处理：它不是"跑了多少"，是一个设定值，且要按分钟单位夹
    countdown: {
      ...sanitizeRun(o.countdown, fallback.countdown),
      minutes:
        typeof (o.countdown as Record<string, unknown> | undefined)?.minutes === 'number' &&
        Number.isFinite((o.countdown as Record<string, unknown>).minutes)
          ? Math.min(MAX_MINUTES, Math.max(1, Math.round((o.countdown as Record<string, number>).minutes)))
          : fallback.countdown.minutes,
    },
    interval: {
      // 预设 id 认不出的 → 番茄（引擎那边也是同一套落法，两边一致）
      presetId: typeof iv.presetId === 'string' ? iv.presetId : fallback.interval.presetId,
      completedFocus: cnt,
      phaseIndex: idx,
      ...sanitizeRun(iv, fallback.interval),
    },
    breath: {
      patternId: typeof sub('breath').patternId === 'string' ? (sub('breath').patternId as string) : fallback.breath.patternId,
      ...sanitizeRun(o.breath, fallback.breath),
    },
  }
}

const pickSeen = new Set<string>()
  const pickList: PickItem[] = []
  if (Array.isArray(o.pickList)) {
    for (const entry of o.pickList.slice(0, MAX_PICKS)) {
      const e = entry as Partial<PickItem> | null
      if (!e || typeof e.label !== 'string' || !e.label.trim()) continue
      pickList.push({
        id: uniqueId(pickSeen, e.id, 'p', pickList.length),
        label: textOf(e.label, 24).trim(),
        // 缺省权重 1（等概率）。NaN / 负数 / 非整数一律夹回 1 —— 一个坏权重会让整张卡抽不出东西
        weight: clampWeight(e.weight),
      })
    }
  }

  return {
    sticky: textOf(o.sticky, 4000),
    todos: Array.isArray(o.todos) ? todos : fallback.todos,
    notes: Array.isArray(o.notes) ? notes : fallback.notes,
    countdown,
    elapsed,
    habit,
    birthdays: Array.isArray(o.birthdays) ? birthdays : fallback.birthdays,
    pickList: Array.isArray(o.pickList) ? pickList : fallback.pickList,
    ledger: {
      symbol: typeof ledRaw?.symbol === 'string' && ledRaw.symbol.trim() ? textOf(ledRaw.symbol, 4).trim() : fallback.ledger.symbol,
      entries,
    },
    meeting,
    timers: tmRaw && typeof tmRaw === 'object' && !Array.isArray(tmRaw) ? sanitizeTimers(tmRaw, fallback.timers) : fallback.timers,
    // 快捷链接走引擎的 `sanitizeLinks`：协议白名单、去重、排序、id 唯一都在那边，
    // 这里**不重复实现一遍** —— 两份清单迟早不一致，而不一致之后没人知道哪份对
    links: Array.isArray(o.links) ? sanitizeLinks(o.links as { id?: unknown; label?: unknown; href?: unknown }[]) : fallback.links,
    // 命令速查同 links 的分层：清洗（去空白/截长/去重/排序/id 唯一）在引擎 commands.ts
    commands: Array.isArray(o.commands) ? sanitizeCommands(o.commands as { id?: unknown; label?: unknown; cmd?: unknown }[]) : fallback.commands,
    matrix: Array.isArray(o.matrix) ? matrix : fallback.matrix,
    probes: Array.isArray(o.probes) ? sanitizeProbes(o.probes as { id?: unknown; label?: unknown; url?: unknown }[]) : fallback.probes,
    stocks: Array.isArray(o.stocks) ? sanitizeStocks(o.stocks as { id?: unknown; label?: unknown; code?: unknown }[]) : fallback.stocks,
    feeds: Array.isArray(o.feeds) ? sanitizeFeeds(o.feeds as { id?: unknown; label?: unknown; url?: unknown }[]) : fallback.feeds,
    // 同理走引擎的 `sanitizeWatch`。它比 sanitizeLinks 多做一件事：**丢弃不合规的条目并计数**。
    // 那是边界 5（导入别人的备份时不该把私网地址带进来）—— 被挡掉的条数要回显给用户，
    // 否则他只会看到自己的名单莫名其妙少了几条。
    watch: (() => {
      if (!Array.isArray(o.watch)) return fallback.watch
      const r = sanitizeWatch(o.watch as { id?: unknown; label?: unknown; url?: unknown }[])
      if (r.rejected > 0) console.warn(`导入的网页监控名单里有 ${r.rejected} 条不合规（不是 https，或指向私有网段），已丢弃`)
      return r.watch
    })(),
    // 取数端点同 watch 的骨架：丢不合规 + 计数回显（导入别人的备份时，私网 URL 在这一步被挡）
    endpoints: (() => {
      if (!Array.isArray(o.endpoints)) return fallback.endpoints
      const r = sanitizeEndpoints(
        o.endpoints as { id?: unknown; label?: unknown; url?: unknown; refreshSec?: unknown; path?: unknown; scale100?: unknown }[],
      )
      if (r.rejected > 0) console.warn(`导入的取数端点里有 ${r.rejected} 条不合规（不是 https，或指向私有网段），已丢弃`)
      return r.endpoints
    })(),
    htmlCards: (() => {
      if (!Array.isArray(o.htmlCards)) return fallback.htmlCards
      const r = sanitizeHtmlCards(o.htmlCards as { id?: unknown; title?: unknown; html?: unknown }[])
      if (r.rejected > 0) console.warn(`导入的自定卡里有 ${r.rejected} 条没能通过校验（空片段/超长/带 </script>），已丢弃`)
      return r.cards
    })(),
    // 扩展卡名单同 htmlCards 的骨架：manifest 逐份过 parseExtManifest，坏的丢并计数回显
    extCards: (() => {
      if (!Array.isArray(o.extCards)) return fallback.extCards
      const r = sanitizeExtCards(o.extCards)
      if (r.rejected > 0) console.warn(`导入的扩展卡里有 ${r.rejected} 份没能通过校验（manifest 缺字段或超上限），已丢弃`)
      return r.cards
    })(),
    // 状态逐键过 sanitizeExtState（朴素 JSON + 字节上限）：盘上数据不可信，坏的丢那一键，不整份报废
    extState: (() => {
      if (typeof o.extState !== 'object' || o.extState === null || Array.isArray(o.extState)) return fallback.extState
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o.extState as Record<string, unknown>)) {
        const st = sanitizeExtState(v)
        if (st.ok) out[k] = st.value
      }
      return out
    })(),
    launch: (() => {
      if (!Array.isArray(o.launch)) return fallback.launch
      const r = sanitizeLaunch(o.launch as { id?: unknown; label?: unknown; target?: unknown }[])
      if (r.rejected > 0) console.warn(`导入的速达名单里有 ${r.rejected} 条不合规（既不是 http(s) 链接也不是绝对路径），已丢弃`)
      return r.items
    })(),
    fixed: {
      base: typeof o.fixed === 'object' && o.fixed !== null && !Array.isArray(o.fixed) ? textOf((o.fixed as Record<string, unknown>).base, 20).trim() : fallback.fixed.base,
      rate: typeof o.fixed === 'object' && o.fixed !== null && !Array.isArray(o.fixed) ? textOf((o.fixed as Record<string, unknown>).rate, 12).trim() : fallback.fixed.rate,
      symbol:
        typeof o.fixed === 'object' && o.fixed !== null && !Array.isArray(o.fixed) && typeof (o.fixed as Record<string, unknown>).symbol === 'string' && String((o.fixed as Record<string, unknown>).symbol).trim()
          ? textOf((o.fixed as Record<string, unknown>).symbol, 4).trim()
          : fallback.fixed.symbol,
    },
    duty: {
      // 名单去重保序：同一个人排两次会让轮转表出现重复行，而用户不会知道是去重还是真排了两班
      roster: Array.isArray((o.duty as Record<string, unknown> | undefined)?.roster)
        ? [
            ...new Set(
              ((o.duty as Record<string, unknown>).roster as unknown[])
                .filter((x): x is string => typeof x === 'string')
                .map((x) => x.trim().slice(0, 16))
                .filter(Boolean),
            ),
          ].slice(0, 30)
        : fallback.duty.roster,
      anchor:
        typeof (o.duty as Record<string, unknown> | undefined)?.anchor === 'string' &&
        isValidDate(String((o.duty as Record<string, unknown>).anchor))
          ? String((o.duty as Record<string, unknown>).anchor)
          : fallback.duty.anchor,
    },
  }
}
