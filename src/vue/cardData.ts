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
      { id: 't1', text: '把投影不变量跑绿', done: true },
      { id: 't2', text: '给卡片接容器查询', done: false },
      { id: 't3', text: '窄屏堆叠编辑模式', done: false },
    ],
    notes: [{ id: 'n1', title: 'Modulo 的第一条速记', body: '卡片宽度按容器缩放，不再压成碎片。', at: Date.now() }],
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
