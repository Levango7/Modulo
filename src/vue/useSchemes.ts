import { computed, ref } from 'vue'
import * as E from '../engine'
import { browserStorage, type LayoutStore } from './store'
import { downloadText, pickTextFile, stamp } from './fileIo'

const KEY = 'modulo.schemes.v1'

export function useSchemes(store: LayoutStore, storage = browserStorage()) {
  const parsed = E.parseBook(storage.get(KEY) ?? '', store.reg)
  const book = ref<E.SchemeBook>(parsed.book)
  const notices = ref<string[]>([...parsed.warnings])

  const persist = () => storage.set(KEY, E.bookToJson(book.value))
  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const active = computed(() => book.value.schemes.find((s) => s.id === book.value.activeId) ?? null)

  function saveAs(name: string) {
    book.value = E.createScheme(book.value, newId(), name || `版面 ${stamp()}`, store.doc.value, Date.now())
    notices.value = []
    persist()
  }
  /** 从零开始：建一条空白方案并立刻切过去，而不是逼用户先清空当前版面再另存 */
  function createBlank(name: string) {
    const id = newId()
    book.value = E.createBlankScheme(book.value, id, name || `空白版面 ${stamp()}`, Date.now())
    store.importJson(E.docToJson(E.emptyDoc()))
    notices.value = []
    persist()
  }
  /** 引擎在"位置没变"时返回同一个对象，正好用来跳过无意义的写盘 */
  function move(id: string, to: number) {
    const next = E.moveScheme(book.value, id, to)
    if (next === book.value) return
    book.value = next
    persist()
  }
  function overwrite() {
    if (!book.value.activeId) return
    book.value = E.updateScheme(book.value, book.value.activeId, store.doc.value, Date.now())
    persist()
  }
  function activate(id: string) {
    const s = book.value.schemes.find((q) => q.id === id)
    if (!s) return
    store.importJson(E.docToJson(s.doc))
    book.value = { ...book.value, activeId: id }
    notices.value = store.warnings.value
    persist()
  }
  function rename(id: string, name: string) {
    book.value = E.renameScheme(book.value, id, name)
    persist()
  }
  function remove(id: string) {
    book.value = E.removeScheme(book.value, id)
    persist()
  }

  function exportCurrent() {
    downloadText(`modulo-layout-${stamp()}.json`, E.docToJson(store.doc.value))
  }
  function exportAll() {
    downloadText(`modulo-schemes-${stamp()}.json`, E.bookToJson(book.value))
  }
  async function importCurrent() {
    const raw = await pickTextFile()
    if (raw === null) return
    store.importJson(raw)
    notices.value = store.warnings.value
  }
  async function importBook() {
    const raw = await pickTextFile()
    if (raw === null) return
    const r = E.parseBook(raw, store.reg)
    book.value = E.mergeBooks(book.value, r.book)
    notices.value = r.warnings
    persist()
  }

  return { book, notices, active, saveAs, createBlank, move, overwrite, activate, rename, remove, exportCurrent, exportAll, importCurrent, importBook }
}

export type SchemesApi = ReturnType<typeof useSchemes>
