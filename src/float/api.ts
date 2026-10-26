/**
 * 「脱离浮窗」的前端 API（2026-10-13 第一批）。
 *
 * 全部命令只在桌面壳存在；网页版走 `floatingSupported()` 分支一律返回"不支持"，
 * 调用点据此隐藏入口 —— 与 sysmon / feeds 的"网页版如实降级"同一口径。
 * 浮窗几何是窗口属性、持久化在 Rust 侧（detached.json），前端只维护**哪些卡在浮动**。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktop } from '../vue/useShell'

export interface FloatEntry {
  card_id: string
  x: number | null
  y: number | null
  w: number
  h: number
}

export const floatingSupported = (): boolean => isDesktop

/** 当前在浮动的卡（启动时拉一次；之后靠 floats-changed 事件增量同步） */
export async function fetchFloats(): Promise<FloatEntry[]> {
  if (!isDesktop) return []
  try {
    return await invoke<FloatEntry[]>('list_floats')
  } catch {
    return []
  }
}

/**
 * 把卡片脱离成浮窗。返回 false = 已浮动（只聚焦了已有窗口）。
 * `defaultW/H` 是首次脱离时的窗口尺寸（像素）——之后由用户拖动/缩放决定并记忆。
 */
export async function floatCard(cardId: string, defaultW: number, defaultH: number): Promise<boolean> {
  if (!isDesktop) throw new Error('浮窗只在桌面壳可用')
  return invoke<boolean>('float_card', { cardId, defaultW: Math.round(defaultW), defaultH: Math.round(defaultH) })
}

/** 关掉浮窗（卡片由主窗按 floats-changed 事件放回工作台） */
export async function unfloatCard(cardId: string): Promise<void> {
  if (!isDesktop) return
  await invoke('unfloat_card', { cardId })
}

/**
 * 把某张卡的浮窗提到最前（F-08 的「置顶 / 定位」）。
 *
 * 返回 false = 那张窗已经不在了（刚被关掉 / 从没脱离）—— 这是**正常结果不是错误**，
 * 不必弹错误：清单会由 `floats-changed` 广播自己收敛，不必为此重拉。
 * 网页版直接返回 false（没有浮窗这回事）。
 */
export async function focusFloat(cardId: string): Promise<boolean> {
  if (!isDesktop) return false
  try {
    return await invoke<boolean>('focus_float', { cardId })
  } catch {
    return false
  }
}

/** 浮动清单变化（任意窗口触发都广播）：返回退订函数 */
export function onFloatsChanged(cb: (floats: FloatEntry[]) => void): () => void {
  if (!isDesktop) return () => {}
  let un: UnlistenFn | null = null
  void listen<FloatEntry[]>('modulo:floats-changed', (e) => cb(e.payload)).then((u) => (un = u))
  return () => un?.()
}

/** 主窗写盘通知（主窗写 doc 后广播）：浮窗据此重读数据 */
export function onDocWritten(cb: () => void): () => void {
  if (!isDesktop) return () => {}
  let un: UnlistenFn | null = null
  void listen('modulo:doc-written', () => cb()).then((u) => (un = u))
  return () => un?.()
}
