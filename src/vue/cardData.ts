import { reactive, watch } from 'vue'
import {
  isValidBirthday,
  isValidDate,
  LEDGER_CATEGORIES,
  MAX_CENTS,
  MAX_MINUTES,
  normalizeHhmm,
  normalizeUrl,
  sanitizeCommands,
  sanitizeLinks,
  sanitizeWatch,
  sanitizeMeetingCityIds,
  type CommandEntry,
  type QuickLink,
  type Watch,
} from '@levango7/engine'
import { browserStorage } from './store'

/** 四个计时器在 `timers` 里的键名。动作共用一份实现（状态形状一样），所以键名也集中一处 */
export type TimerKey = 'stopwatch' | 'countdown' | 'interval' | 'breath'

export interface Todo {
  id: string
  text: string
  done: boolean
  /**
   * 标记完成那一刻的毫秒时间戳。**可选、向后兼容**：v1 数据与旧备份里没有它，
   * 月度统计据此只统计"知道自己何时完成"的那些条目，而不是猜一个月。
   * 取消勾选要清掉它 —— 否则"完成时间"会指向一个不再成立的过去。
   */
  doneAt?: number
}
export interface Note {
  id: string
  title: string
  body: string
  at: number
}

/**
 * 倒数日：**用户写的内容**（名字 + 日子），所以它放在这里、跟着完整备份一起走。
 * 判断标准就一句：用户敲进去的东西进 `cardData`（因此进备份）；"选哪个城市/皮肤"这类偏好
 * 留在各自的 key（换机器重选一次即可）—— 与 §7 的取舍同一条线。
 */
export interface CountdownSetting {
  label: string
  /** `YYYY-MM-DD`，空串 = 还没设 */
  date: string
}

/** 正计时：从哪天起算（"第 N 天"）。与倒数日共用日期口径（`isValidDate`） */
export interface ElapsedSetting {
  label: string
  date: string
}

/** 习惯打卡：名字 + 打过卡的日期集合 */
export interface HabitSetting {
  name: string
  days: string[]
}

/**
 * 生日提醒：**用户写的内容**（名字 + 月日 + 可选出生年），所以进 `cardData`、跟着完整备份走。
 * 与倒数日分开存而不是复用它：生日是"每年一次"、没有年，混进 `countdown` 会让那张卡多一套分支。
 */
export interface StoredBirthday {
  id: string
  name: string
  /** 1–12 */
  month: number
  /** 1–31 */
  day: number
  /** 可选；填了才显示年龄 */
  year?: number
}

/** 抽签名单：用户写的内容，进备份。权重 ≥ 0，0 = 永远抽不到 */
export interface PickItem {
  id: string
  label: string
  weight: number
}

/** 记账条目：**金额存「分」的整数**，不用小数 —— 一个月几十笔浮点加下来会让总额差几分钱 */
export interface LedgerRow {
  id: string
  /** `YYYY-MM-DD` */
  date: string
  /** 单位「分」。整数，永不为负 */
  cents: number
  category: string
  note: string
}

/**
 * 会议规划器：参会城市 + 会议在**本地**的墙上时间与时长。
 *
 * 只存"我说几点开"，不存每个城市几点 —— 后者是算出来的，存下来就会与夏令时变更对不上。
 * 偏好（城市选择、时间、时长）本不进备份，但这份列表是用户自己一组人，反复重选很烦，
 * 因此按"用户输入过的东西进备份"的同一条线存下来。
 */
export interface MeetingSetting {
  /** 参会城市 id（`worldclock.ts` 的候选表内），最多 4 个 */
  cityIds: string[]
  /** 本地墙上时间 `HH:mm` */
  at: string
  /** 时长（分钟） */
  minutes: number
  title: string
}

/**
 * 计时器的持久化形状。
 *
 * **只存「计时器的设定 + 上次停在哪」，不存"当前已跑多少秒"**。
 * 已跑量由 `startedAt` 这个时间戳 + 打开时的 `Date.now()` 算出来 ——
 * 这样跨重启、跨休眠、换机器导入备份之后，时间都是对的；
 * 存一个累加值则永远只对"写它的那一瞬间"成立。
 *
 * `startedAt` 是 epoch 毫秒。诚实说明：**这一版不做跨重启恢复运行态** ——
 * 读回来时把它当 0 处理（钟停在设定值、显示"开始"）。理由写进 CHANGELOG，
 * 因为"看起来该有其实没有"比"没有"更糟。
 */
export interface TimerStore {
  /** 秒表：上次停在哪（毫秒）与上次启动时刻 */
  stopwatch: { accumulatedMs: number; startedAt: number | null }
  /** 倒计时：设定时长（分钟）与进度 */
  countdown: { minutes: number; accumulatedMs: number; startedAt: number | null }
  /** 间歇计时：预设 id + 已完成段数 + 本段进度 */
  interval: { presetId: string; completedFocus: number; phaseIndex: number; accumulatedMs: number; startedAt: number | null }
  /** 呼吸计时：节奏 id + 进度 */
  breath: { patternId: string; accumulatedMs: number; startedAt: number | null }
}

/** 值班表：名单 + 轮转锚点（班次用引擎的默认三班，不给用户配 —— 可配置的排班规则是另一个产品） */
export interface DutySetting {
  /** 按顺序轮转的姓名 */
  roster: string[]
  /** 轮转起点 `YYYY-MM-DD` */
  anchor: string
}

export interface CardData {
  sticky: string
  todos: Todo[]
  notes: Note[]
  countdown: CountdownSetting
  elapsed: ElapsedSetting
  habit: HabitSetting
  birthdays: StoredBirthday[]
  pickList: PickItem[]
  ledger: {
    /** 币种符号，用户填一次全表跟着走 */
    symbol: string
    entries: LedgerRow[]
  }
  meeting: MeetingSetting
  timers: TimerStore
  /** 快捷链接：点一下复制（不做"打开"—— 那要 opener 插件，见 links.ts 文件头） */
  links: QuickLink[]
  /** 命令速查：点一下复制命令（清洗在引擎 commands.ts，与 links 同一套分层） */
  commands: CommandEntry[]
  /** 网页监控的名单。边界（只 https、不许私网 IP）见 watch.ts 文件头 */
  watch: Watch[]
  /** 固定整数位计算的输入草稿；结果全在引擎算，这里只存两个输入 */
  fixed: { base: string; rate: string; symbol: string }
  duty: DutySetting
}

const KEY = 'modulo.carddata.v1'

/** 一个几百 MB 的坏文件不该把首屏冻住；单条文本也截断 */
const MAX_ITEMS = 200
const MAX_TEXT = 2000
/** 生日卡最多认这么多条：再多就该用别的工具管人，而不是一张工作台卡片 */
const MAX_BIRTHDAYS = 100
/** 抽签名单同理；权重夹在 0–99（不是 0–∞）：99 已经是"几乎必中"，再大没有意义 */
const MAX_PICKS = 60
const MAX_PICK_WEIGHT = 99
/** 记账：一个月的条目量级。超了说明这是账本软件，不是工作台卡片 */
const MAX_LEDGER_ROWS = 2000
/** 分类截短；不在候选表里的一律回「其他」，免得汇总里冒出一堆只出现一次的类 */
const MAX_CATEGORY = 12
/**
 * 计时器累计量上限（约 7 天）。一个"累计 3 年的秒表"多半是脏数据，不该原样落盘。
 * 放在模块顶层而不是清洗函数里：`timerPause` 也要用它夹，两个作用域都用得到。
 */
const MAX_TIMER_MS = 599 * 60_000 * 7

/**
 * 清洗计时器的持久化块。四个分支形状一样，所以共用一个 `sanitizeRun` 而不是四段几乎相同的代码 ——
 * 四份复制意味着"改了一处忘了另一处"，而这种 bug 平时根本不响。
 *
 * `startedAt` 只接受"有限且为正"的毫秒数；其余一律 null（= 停着）。
 */

const textOf = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * 分类必须在候选表里，不在就回「其他」。
 * 自由文本分类会让"按类汇总"退化成一堆只出现一次的类，而那张卡回答的是"钱去哪了"。
 */
function knownCategory(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().slice(0, MAX_CATEGORY) : ''
  return (LEDGER_CATEGORIES as readonly string[]).includes(s) ? s : '其他'
}

/** 权重必须是 0–99 的整数；`undefined`（没写）= 等概率 1，坏值也回 1 而不是 0（0 意味着"永远抽不到"） */
function clampWeight(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.min(MAX_PICK_WEIGHT, Math.max(0, Math.round(v)))
}

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
    // 同理走引擎的 `sanitizeWatch`。它比 sanitizeLinks 多做一件事：**丢弃不合规的条目并计数**。
    // 那是边界 5（导入别人的备份时不该把私网地址带进来）—— 被挡掉的条数要回显给用户，
    // 否则他只会看到自己的名单莫名其妙少了几条。
    watch: (() => {
      if (!Array.isArray(o.watch)) return fallback.watch
      const r = sanitizeWatch(o.watch as { id?: unknown; label?: unknown; url?: unknown }[])
      if (r.rejected > 0) console.warn(`导入的网页监控名单里有 ${r.rejected} 条不合规（不是 https，或指向私有网段），已丢弃`)
      return r.watch
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

export function createCardData(storage = browserStorage()) {
  const fallback: CardData = {
    sticky: '',
    todos: [
      { id: 't1', text: '写下今天最重要的三件事', done: true },
      { id: 't2', text: '回一封拖了三天的邮件', done: false },
      { id: 't3', text: '把周报草稿发出去', done: false },
    ],
    notes: [{ id: 'n1', title: '先扔进来的念头', body: '开会时冒出来的一句话，不整理也没关系，回头再收。', at: Date.now() }],
    // 示例内容只给"待办/速记"这两张默认在版面上的卡；倒数日/正计时/习惯给人留空
    countdown: { label: '', date: '' },
    elapsed: { label: '', date: '' },
    habit: { name: '', days: [] },
    birthdays: [],
    pickList: [],
    ledger: { symbol: '¥', entries: [] },
    // 示例会议：三个跨时区城市 + 一个体面的本地时间。第一次打开就有东西看，
    // 而"全空的会议卡"演示不出这张卡到底解决什么问题
    meeting: { cityIds: ['shanghai', 'london', 'new-york'], at: '20:00', minutes: 60, title: '' },
    // 四个计时器都给空档：钟停在起点、显示「开始」，
    // 而不是替用户预设一个"已经在跑"的计时 —— 一个自己会走的钟是最容易让人怀疑的界面
    timers: {
      stopwatch: { accumulatedMs: 0, startedAt: null },
      countdown: { minutes: 25, accumulatedMs: 0, startedAt: null },
      interval: { presetId: 'pomodoro', completedFocus: 0, phaseIndex: 0, accumulatedMs: 0, startedAt: null },
      breath: { patternId: 'box', accumulatedMs: 0, startedAt: null },
    },
    links: [],
    commands: [],
  watch: [],
    fixed: { base: '', rate: '', symbol: '¥' },
    duty: { roster: [], anchor: '' },
  }
  let initial = fallback
  try {
    const raw = storage.get(KEY)
    if (raw) initial = sanitizeCardData(JSON.parse(raw) as unknown, fallback)
  } catch {
    /* 数据损坏时回退示例内容，不阻塞启动 */
  }

  const state = reactive<CardData>(initial)
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
  watch: [...state.watch],
      'duty.roster': [...state.duty.roster],
      timers: {
        stopwatch: { ...state.timers.stopwatch },
        countdown: { ...state.timers.countdown },
        interval: { ...state.timers.interval },
        breath: { ...state.timers.breath },
      },
    }),
    (v) => storage.set(KEY, JSON.stringify(v)),
    { deep: true },
  )

  return {
    state,
    addTodo(text: string) {
      const t = text.trim()
      if (!t) return
      state.todos.push({ id: `t${Date.now()}`, text: t, done: false })
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
      state.notes.unshift({ id: `n${Date.now()}`, title: title.trim() || '无标题', body, at: Date.now() })
    },
    addBirthday(name: string, month: number, day: number, year?: number) {
      const n = name.trim()
      if (!n || !isValidBirthday({ month, day })) return
      if (state.birthdays.length >= MAX_BIRTHDAYS) return
      state.birthdays.push({
        id: `b${Date.now()}`,
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
      state.pickList.push({ id: `p${Date.now()}`, label: l.slice(0, 24), weight: 1 })
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
        id: `e${Date.now()}`,
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
    /**
     * 加一条监控。`normalizeUrl` 先在**前端**过一遍边界，用户敲错时立刻有反馈；
     * 但这**不是**安全边界 —— 页面能被 XSS 改，真正的判定在 Rust 侧（`net.rs`），
     * 两边各判一次是有意的冗余，不是重复实现。
     */
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
