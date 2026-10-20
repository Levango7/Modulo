/**
 * 系统通知的投递层（P0-④ 阶段 2，2026-10-21）。
 *
 * 判定与去重在 `useReminders.ts` / `reminders.ts`，这里只做三件事：**动态加载插件**
 * （网页版不进包，和 `float/api.ts` 同招式）、**拿权限**、把一组提醒交给系统 Toast。
 *
 * **Windows 上的已知边界（查过插件文档，不是猜的）**：
 *  - 交互式 action（点击回传"点了哪一条"）只有移动端有；**Windows 桌面拿不到点击载荷**。
 *    所以"点通知回到对应卡"这一条当前**做不到** —— 只能做到系统默认行为"点一下把应用带到前台"。
 *    要真深链得自己做 Toast COM 激活或换通道，属于另一笔，不在这里假装完成。
 *  - **开发态** Toast 显示的是 `powershell.exe` 的身份与图标；装成安装包后才显示 Modulo
 *    （插件文档原话："Only works for installed apps. Shows powershell name & icon in development."）。
 *
 * 失败一律返回 false、不抛：通知是"加分项"，它坏了不该让提醒本身（应用内横幅）也消失。
 */

export interface NotifyItem {
  key: string
  title: string
  body: string
}

/** 只声明我们用到的那三条；真插件由动态 import 提供，测试可注入替身 */
export interface NotifyPlugin {
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<'granted' | 'denied' | 'default'>
  sendNotification(options: { title: string; body: string }): void
}

export interface NotifyOptions {
  /** 测试缝：默认 = 动态 import `@tauri-apps/plugin-notification` */
  load?: () => Promise<NotifyPlugin | null>
}

async function loadPlugin(): Promise<NotifyPlugin | null> {
  try {
    return (await import('@tauri-apps/plugin-notification')) as unknown as NotifyPlugin
  } catch {
    /* 网页版 / 插件没装：静默降级，应用内横幅仍然是投递面 */
    return null
  }
}

export async function sendSystemNotifications(items: readonly NotifyItem[], opts: NotifyOptions = {}): Promise<boolean> {
  if (!items.length) return false
  let plugin: NotifyPlugin | null
  try {
    plugin = await (opts.load ?? loadPlugin)()
  } catch {
    /* 加载器自己炸了（包没打进来 / IPC 不可用）：与"没装插件"同一条降级路径 */
    return false
  }
  if (!plugin) return false
  try {
    let granted = await plugin.isPermissionGranted()
    if (!granted) granted = (await plugin.requestPermission()) === 'granted'
    if (!granted) return false
    for (const it of items) plugin.sendNotification({ title: it.title, body: it.body })
    return true
  } catch {
    return false
  }
}
