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
    if (raw) initial = { ...fallback, ...(JSON.parse(raw) as Partial<CardData>) }
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
