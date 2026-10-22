/**
 * 编辑事务胶水层（拆分 ②）：快照 / 保存 / 取消 / 还原的状态机。
 *
 * 钉住的都是**口径**而不是实现：
 *  ① 没改动时取消不弹确认框（确认框的第一道闸在 isEditDirty，快照 null = 没进过编辑器）；
 *  ② 「取消」是还原不是丢弃 —— store.restore 复用 apply，所以取消本身也进历史、
 *     还能被撤销回来（不会把历史撕开一个洞）；
 *  ③ 「保存」刷新基线：保存后哪怕还留在编辑态，取消也不再问。
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { REGISTRY } from '../../src/vue/cardRegistry'
import { createLayoutStore, memoryStorage } from '../../src/vue/store'
import type { LayoutDoc } from '@levango7/engine'
import { useEditTransaction, type TxView } from '../../src/vue/useEditTransaction'

function setup() {
  const store = createLayoutStore({ registry: REGISTRY, storage: memoryStorage() })
  const view = ref<TxView>('workbench')
  const tx = useEditTransaction({ store, view })
  return { store, view, tx }
}

/** 造一份与当前版面不同的 doc（挪动第一张卡），用来制造"改动" */
function movedDoc(store: ReturnType<typeof createLayoutStore>): LayoutDoc {
  const doc = JSON.parse(JSON.stringify(store.doc.value)) as LayoutDoc
  if (doc.items.length > 0) doc.items[0] = { ...doc.items[0], x: doc.items[0].x + 1 }
  else doc.items.push({ id: 'x', module: 'clock', variant: 'default', x: 0, y: 0, w: 4, h: 3 })
  return doc
}

describe('useEditTransaction', () => {
  it('进编辑器拍快照：view 进 edit，快照 = 当前版面', () => {
    const { store, view, tx } = setup()
    const before = JSON.stringify(store.doc.value)
    tx.enterEdit()
    expect(view.value).toBe('edit')
    expect(JSON.stringify(tx.editSnapshot.value)).toBe(before)
  })

  it('edit 态再 enterEdit 不换快照（幂等）', () => {
    const { store, tx } = setup()
    tx.enterEdit()
    const snap = JSON.stringify(tx.editSnapshot.value)
    store.restore(movedDoc(store)) // 快照之后改版面
    tx.enterEdit() // 再调不该把快照刷成改动后的版面
    expect(JSON.stringify(tx.editSnapshot.value)).toBe(snap)
  })

  it('有改动才弹确认框；没改动直接退出', () => {
    const { store, view, tx } = setup()
    tx.enterEdit()
    tx.cancelEdit() // 没改过
    expect(tx.cancelAskOpen.value).toBe(false)
    expect(view.value).toBe('workbench')

    tx.enterEdit()
    store.restore(movedDoc(store)) // 改过
    tx.cancelEdit()
    expect(tx.cancelAskOpen.value).toBe(true)
    expect(view.value).toBe('edit') // 还留在编辑态等确认
  })

  it('确认放弃 = 还原到快照 + 关框 + 退 workbench', () => {
    const { store, view, tx } = setup()
    const original = JSON.stringify(store.doc.value)
    tx.enterEdit()
    store.restore(movedDoc(store))
    tx.cancelEdit()
    tx.confirmCancelEdit()
    expect(JSON.stringify(store.doc.value)).toBe(original)
    expect(tx.cancelAskOpen.value).toBe(false)
    expect(view.value).toBe('workbench')
    expect(tx.editSnapshot.value).toBeNull()
  })

  it('「取消」本身可撤销：restore 压了历史，undo 能把放弃的改动找回来', () => {
    const { store, tx } = setup()
    tx.enterEdit()
    const changed = movedDoc(store)
    store.restore(changed)
    tx.cancelEdit()
    tx.confirmCancelEdit()
    expect(JSON.stringify(store.doc.value)).not.toBe(JSON.stringify(changed))
    // 取消不是丢弃：历史里留着"还原"这一步，撤掉它就回到改动后的版面
    expect(store.canUndo.value).toBe(true)
    store.undo()
    expect(JSON.stringify(store.doc.value)).toBe(JSON.stringify(changed))
  })

  it('「继续编辑」只关框，不还原', () => {
    const { store, view, tx } = setup()
    tx.enterEdit()
    store.restore(movedDoc(store))
    const changed = JSON.stringify(store.doc.value)
    tx.cancelEdit()
    tx.dismissCancelAsk()
    expect(tx.cancelAskOpen.value).toBe(false)
    expect(JSON.stringify(store.doc.value)).toBe(changed) // 改动还在
    expect(view.value).toBe('edit') // 还在编辑态
  })

  it('保存 = 确认改动并刷新基线：保存后取消不再问', () => {
    const { store, view, tx } = setup()
    tx.enterEdit()
    store.restore(movedDoc(store))
    const changed = JSON.stringify(store.doc.value)
    tx.saveEdit()
    expect(view.value).toBe('workbench')
    tx.enterEdit() // 再进编辑器，基线是刚才保存的版本
    tx.cancelEdit()
    expect(tx.cancelAskOpen.value).toBe(false) // 相对新基线没有改动
    expect(JSON.stringify(store.doc.value)).toBe(changed) // 版面没被还原
  })

  it('确认放弃时快照已清（界面到不了的防御路径）→ 不 restore、照旧关框退台', () => {
    // 界面路径上确认框只在"有快照且有改动"时出现，快照为 null 时走不到这里；
    // 但 composable 层面可达，钉住的是防御语义：不 crash、不 restore(null)。
    const { store, view, tx } = setup()
    tx.enterEdit()
    tx.editSnapshot.value = null
    const restoreSpy = vi.spyOn(store, 'restore')
    tx.confirmCancelEdit()
    expect(restoreSpy).not.toHaveBeenCalled()
    expect(tx.cancelAskOpen.value).toBe(false)
    expect(view.value).toBe('workbench')
  })

  it('editDirty / editChangeCount 与纯判定联动', async () => {
    const { store, tx } = setup()
    expect(tx.editDirty.value).toBe(false) // 没进过编辑器
    expect(tx.editChangeCount.value).toBe(0)
    tx.enterEdit()
    await nextTick()
    expect(tx.editDirty.value).toBe(false) // 刚拍完快照，一字不差
    store.restore(movedDoc(store))
    await nextTick()
    expect(tx.editDirty.value).toBe(true)
    expect(tx.editChangeCount.value).toBe(1) // 一张卡挪了一格 = 一处
  })
})
