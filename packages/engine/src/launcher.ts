/**
 * 速达：把常用的程序 / 网页 / 文件收成"点一下就打开"的收藏。
 *
 * 对标 x-hub 的「速达」里最核心的一半。三件事在本模块定死（纯函数，可测）：
 *
 * 1. **目标类型判定**：`https://…` 是网页、`C:\…` 或 `/…` 是文件路径、双引号包着空格
 *    的路径也算。**不做 shell 解释** —— 目标要么是 URL、要么是路径，没有中间态。
 * 2. **路径不做规范化改写**：用户粘贴什么就是什么（`explorer.exe` 那类裸命令名
 *    会被 Windows 的 ShellExecute 按 PATH 解析，这是系统行为，不由我们重写）。
 * 3. **名单清洗**：去空白、截长、同名去重（label 撞了加序号）、砍上限。
 *
 * 为什么只做"打开"不做"启动参数"：参数一进来，这个模块就要面对引号/转义/变量展开，
 * 而那正是把"点一下打开"变成"半门 shell"的地方。不做。
 */

export type LaunchKind = 'app' | 'url' | 'file'

export interface LaunchItem {
  id: string
  /** 显示名；空则取路径/URL 的末段 */
  label: string
  /** 目标：https URL 或本机路径。**原样保存，不改写** */
  target: string
  kind: LaunchKind
}

export const MAX_LAUNCH_ITEMS = 24
export const MAX_LAUNCH_LABEL = 20
export const MAX_TARGET_LEN = 500

/**
 * 判定目标类型。URL 只看 `https?://` 前缀；其余一律当路径（Windows 盘符、UNC、POSIX）。
 * 刻意**不认** `file://`、`javascript:`、`shell:` 这类 scheme —— 它们要么不是路径、
 * 要么就是 shell 面。
 */
export function kindOf(target: string): LaunchKind | null {
  const t = target.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return 'url'
  // 去掉可能的两端引号（从资源管理器"复制为路径"粘过来会带引号）
  const bare = t.replace(/^"|"$/g, '')
  if (/^[A-Za-z]:[\\/]/.test(bare) || bare.startsWith('\\\\') || bare.startsWith('/')) return 'file'
  // 既不是 URL 也不是绝对路径：**宁可拒绝也不猜**（裸命令名会让"打开"变成"执行任意命令"）
  return null
}

/** 显示名兜底：取末段，去掉扩展名与两端引号 */
export function fallbackLabel(target: string, kind: LaunchKind): string {
  const t = target.trim().replace(/^"|"$/g, '')
  if (kind === 'url') {
    // **不用全局 `URL`**：引擎包要对任何宿主成立（`tsconfig.build.json` 没有 DOM lib，
    // CI 的"引擎包独立构建"门禁当场抓到过）。手写解析只为取"主机名 + 路径"这一件事：
    // `https://host:port/path?query#frag` → `host/path`（host 带端口，路径去掉查询与片段）
    const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(t)
    if (!m) return t.slice(0, MAX_LAUNCH_LABEL)
    const host = m[1]
    const path = m[2] && m[2] !== '/' ? m[2] : ''
    return (host + path).slice(0, MAX_LAUNCH_LABEL)
  }
  const seg = t.split(/[\\/]/).filter(Boolean).pop() ?? t
  return seg.replace(/\.[A-Za-z0-9]{1,6}$/, '').slice(0, MAX_LAUNCH_LABEL) || '未命名'
}

/**
 * 清洗整份名单。返回 rejected 计数（导入备份时回显用），与 watch / endpoints 同骨架。
 * 同名去重：label 撞了就加" 2"、\" 3\"——**不丢条目**（x-hub 的小类是另一个概念，这里不做）。
 */
export function sanitizeLaunch(
  list: Readonly<{ id?: unknown; label?: unknown; target?: unknown }>[],
): { items: LaunchItem[]; rejected: number } {
  const items: LaunchItem[] = []
  const seenTargets = new Set<string>()
  const usedLabels = new Set<string>()
  let rejected = 0
  for (const raw of list) {
    if (items.length >= MAX_LAUNCH_ITEMS) break
    if (typeof raw?.target !== 'string') {
      rejected++
      continue
    }
    const target = raw.target.trim().slice(0, MAX_TARGET_LEN)
    const kind = kindOf(target)
    if (!kind) {
      rejected++
      continue
    }
    // 同一目标只留一条（同 URL 同路径重复收录没有意义）
    const key = target.toLowerCase()
    if (seenTargets.has(key)) continue
    seenTargets.add(key)

    let label = (typeof raw.label === 'string' ? raw.label.trim() : '').slice(0, MAX_LAUNCH_LABEL)
    if (!label) label = fallbackLabel(target, kind)
    let unique = label
    let n = 2
    while (usedLabels.has(unique)) unique = `${label} ${n++}`.slice(0, MAX_LAUNCH_LABEL + 2)
    usedLabels.add(unique)

    items.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : target,
      label: unique,
      target,
      kind,
    })
  }
  return { items, rejected }
}
