/**
 * 设置面板的**分组表**（F-10，2026-10-28）。
 *
 * 为什么单独成文件：这段是纯数据 + 两个纯函数（谁可见、未知 id 落哪儿），满足本仓受测层的
 * 纳入判据「不开浏览器也能断言」（见 `vitest.config.ts` 文件头）。分组文案留在组件里就只剩
 * E2E 一层兜底，而"网页版不该出现「桌面」组"这种判据恰好在组件里最难自己证明自己。
 *
 * 组织原则只有一条：**按"我现在想改什么"分，不按"代码里在哪个组件"分**。
 * 所以备份、同步、数据目录是一组（都是"我的数据在哪、怎么带走"），而不是按组件边界拆三处；
 * 数据目录那句提示也因此从"桌面"组挪到"数据"组 —— 它讲的是数据，不是桌面。
 */

export type SettingsGroupId = 'appearance' | 'layout' | 'data' | 'reminders' | 'desktop' | 'about'

export interface SettingsGroup {
  id: SettingsGroupId
  /** 侧栏上的字，也是这一组的标题 */
  title: string
  /** 鼠标悬停/读屏用的一句话：这一组回答什么问题 */
  hint: string
  /**
   * 只有桌面壳才有。**不是"先藏起来再说"**：网页版没有托盘、没有系统级快捷键，
   * 那两项在那里点了也不会生效 —— 留一个点不动的组比不显示更糟。
   */
  desktopOnly?: boolean
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'appearance', title: '外观', hint: '皮肤方向、明暗与强调色' },
  // 模板入口此前只在顶栏；设置里给同一条入口，省得为了换个排法先退出设置。
  { id: 'layout', title: '版面与方案', hint: '换一套排法，或存取自己的方案册' },
  { id: 'data', title: '数据', hint: '备份、多端同步，以及这些数据在硬盘上的位置' },
  { id: 'reminders', title: '提醒', hint: '倒数日 / 生日 / 习惯的提醒与静默时段' },
  { id: 'desktop', title: '桌面', hint: '托盘、全局快捷键', desktopOnly: true },
  { id: 'about', title: '关于', hint: '版本、检查更新、重新播放首启引导' },
]

/** 当前平台看得到的组（桌面六组 / 网页五组，顺序不变） */
export function visibleGroups(isDesktop: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => isDesktop || !g.desktopOnly)
}

/**
 * 把一个 id 落到"当前平台真的看得到的那一组"。
 *
 * 两个边界都在这里挡住，别让它们漏到模板里：
 *   - 未知 / 空 id（旧链接、写坏的记忆、将来删掉的组）→ 第一组；
 *   - **桌面才有的组在网页版被点到** → 也是第一组，而不是渲染一个不存在的面板。
 */
export function resolveGroup(id: string | null | undefined, isDesktop: boolean): SettingsGroup {
  const groups = visibleGroups(isDesktop)
  const hit = id ? groups.find((g) => g.id === id) : undefined
  return hit ?? groups[0]
}
