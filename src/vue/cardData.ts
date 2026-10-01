import { reactive, watch } from 'vue'
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

export interface CardData {
  sticky: string
  todos: Todo[]
  notes: Note[]
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

  return {
    sticky: textOf(o.sticky, 4000),
    todos: Array.isArray(o.todos) ? todos : fallback.todos,
    notes: Array.isArray(o.notes) ? notes : fallback.notes,
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
