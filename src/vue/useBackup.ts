/**
 * 完整备份的胶水层：拼包在 `backup.ts`（纯函数），这里只做"下载 / 读文件 / 问一句再覆盖"。
 *
 * 覆盖是破坏性的，所以导入走两步：**先解析并把事实摆出来（几个模块、几条待办、有没有便签），
 * 用户点了确认才落**。理由与 §10.12 那条一致 —— 破坏性动作可以简陋，但不能没有安全网；
 * 而这里比"载入推荐布局"更该有网，因为它动的是用户自己写的字。
 */

import { ref } from 'vue'
import * as E from '@modulo/engine'
import { buildBackup, backupToJson, parseBackup, type BackupSummary, type ParsedBackup } from './backup'
import { downloadText, pickTextFile, stamp } from './fileIo'
import type { CardData } from './cardData'
import type { LayoutStore } from './store'
import type { SchemesApi } from './useSchemes'

/** 与 package.json / Cargo.toml / Cargo.lock / tauri.conf.json 同源；发布时四处一起对齐 */
export const APP_VERSION = '0.4.0'

export interface PendingRestore extends BackupSummary {
  parsed: ParsedBackup
}

export function useBackup(store: LayoutStore, schemes: SchemesApi, cardData: () => CardData) {
  /** 待确认的恢复动作；非 null 时设置面板显示确认块 */
  const pending = ref<PendingRestore | null>(null)
  const notices = ref<string[]>([])

  function exportBackup(): void {
    const payload = buildBackup({
      layout: store.doc.value,
      schemes: schemes.book.value,
      cardData: cardData(),
      app: APP_VERSION,
    })
    downloadText(`modulo-backup-${stamp()}.json`, backupToJson(payload))
    notices.value = [
      `已导出：${payload.layout.items.length} 个模块、${payload.cardData.todos.length} 条待办、${payload.cardData.notes.length} 条速记`,
    ]
  }

  /** 选文件 → 解析 → 停在确认块。**不直接写**：解析结果要先给用户看 */
  async function chooseBackupToRestore(): Promise<void> {
    const raw = await pickTextFile()
    if (raw === null) return
    const parsed = parseBackup(raw, store.reg)
    if (parsed.kind === 'unknown') {
      pending.value = null
      notices.value = parsed.warnings
      return
    }
    pending.value = { ...parsed.summary, parsed }
  }

  /**
   * 确认执行。分三处落地，每处都过自己的清洗：
   * - 版面走 `store.importJson` —— 因此**可 Ctrl+Z 退回**（E2E 锁着这条）
   * - 方案册走 `mergeBooks` —— 备份里的方案并进来，不覆盖用户已有的
   * - 卡片内容直接赋值给 reactive state，watcher 会写盘
   */
  function confirmRestore(): void {
    const p = pending.value
    if (!p) return
    const done: string[] = []
    if (p.parsed.layout) {
      store.importJson(E.docToJson(p.parsed.layout))
      done.push(`版面 ${p.parsed.layout.items.length} 个模块`)
    }
    if (p.parsed.schemes) {
      const before = schemes.book.value.schemes.length
      schemes.mergeBook(p.parsed.schemes)
      done.push(`方案册 +${schemes.book.value.schemes.length - before} 条`)
    }
    if (p.parsed.cardData) {
      const target = cardData()
      target.sticky = p.parsed.cardData.sticky
      target.todos = p.parsed.cardData.todos.map((t) => ({ ...t }))
      target.notes = p.parsed.cardData.notes.map((n) => ({ ...n }))
      done.push(`内容 ${p.parsed.cardData.todos.length} 条待办 / ${p.parsed.cardData.notes.length} 条速记`)
    }
    pending.value = null
    notices.value = [...p.parsed.warnings, `已恢复：${done.join('、')}`]
  }

  function cancelRestore(): void {
    pending.value = null
    notices.value = ['已取消，没有改动任何东西']
  }

  return { pending, notices, exportBackup, chooseBackupToRestore, confirmRestore, cancelRestore }
}

export type BackupApi = ReturnType<typeof useBackup>
