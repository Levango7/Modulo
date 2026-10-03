import { reactive, watch } from 'vue'
import { isValidDate } from '@modulo/engine'
import { browserStorage } from './store'

export interface Todo {
  id: string
  text: string
  done: boolean
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

export interface CardData {
  sticky: string
  todos: Todo[]
  notes: Note[]
  countdown: CountdownSetting
  elapsed: ElapsedSetting
  habit: HabitSetting
}

const KEY = 'modulo.carddata.v1'

/** 一个几百 MB 的坏文件不该把首屏冻住；单条文本也截断 */
const MAX_ITEMS = 200
const MAX_TEXT = 2000

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
      todos.push({ id: uniqueId(todoSeen, e.id, 't', todos.length), text: textOf(e.text), done: e.done === true })
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

  return {
    sticky: textOf(o.sticky, 4000),
    todos: Array.isArray(o.todos) ? todos : fallback.todos,
    notes: Array.isArray(o.notes) ? notes : fallback.notes,
    countdown,
    elapsed,
    habit,
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
    () => ({ ...state, todos: [...state.todos], notes: [...state.notes] }),
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
      if (t) t.done = !t.done
    },
    removeTodo(id: string) {
      state.todos = state.todos.filter((x) => x.id !== id)
    },
    addNote(title: string, body: string) {
      state.notes.unshift({ id: `n${Date.now()}`, title: title.trim() || '无标题', body, at: Date.now() })
    },
  }
}

export type CardDataApi = ReturnType<typeof createCardData>
