/**
 * 版本检查：问 GitHub Releases 有没有比当前更新的 tag。
 *
 * 定位必须说清楚 —— 它**不是自动更新**，只是"有新版了，去看一眼"：
 * 自动更新要签名（OV/EV 证书 + tauri-plugin-updater 的公钥），那是另一件花钱的事。
 * 眼下 0.1.0 已被作废、0.3.0 还没发，装过旧版的人没有任何途径知道，
 * 所以先解决"知道"，再谈"自动装"。
 *
 * 纯逻辑（比版本、解析 releases、取下载地址）都在这里，可单测；网络与 DOM 在 `useUpdateCheck.ts`。
 */

export const RELEASES_API = 'https://api.github.com/repos/Levango7/Modulo/releases/latest'

export interface UpdateInfo {
  latest: string
  url: string
  notes: string
  publishedAt: string
}

/**
 * 比版本号。只按 `数字.数字.数字` 的正式段比，忽略任何后缀（`0.3.0-rc1` 视为 0.3.0）。
 * 返回 `>0` 表示 incoming 更新。
 *
 * 为什么不引 semver 库：这里只需要"三段数字谁大"，而多一个依赖就多一处供应链面 ——
 * 桌面壳的唯一网络请求用它去读自己仓库的 Releases，不值当。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => {
        const x = Number.parseInt(n, 10)
        return Number.isFinite(x) && x >= 0 ? x : 0
      })
  const pa = parse(a)
  const pb = parse(b)
  const n = Math.max(3, pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function isNewer(incoming: string, current: string): boolean {
  return compareVersions(incoming, current) > 0
}

/** 从 Releases API 的返回里取出我们关心的四个字段；不是对象就当没查到 */
export function pickUpdate(payload: unknown, current: string): UpdateInfo | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  const tag = typeof o.tag_name === 'string' ? o.tag_name : typeof o.name === 'string' ? o.name : ''
  if (!tag) return null
  if (!isNewer(tag, current)) return null
  const url = typeof o.html_url === 'string' && /^https:\/\//.test(o.html_url) ? o.html_url : 'https://github.com/Levango7/Modulo/releases'
  return {
    latest: tag.replace(/^v/i, ''),
    url,
    // release notes 是 markdown，直接插进界面等于把远端内容当 HTML 解析 —— 只取纯文本前 200 字
    notes: typeof o.body === 'string' ? plainText(o.body).slice(0, 200) : '',
    publishedAt: typeof o.published_at === 'string' ? o.published_at : '',
  }
}

/**
 * markdown → 纯文本：去标签、去多余空白。只为了在界面上显示一行摘要。
 * 链接**保留文字、丢掉地址** —— 丢掉整段会让人读不到"点了会发生什么"，而地址本身在界面上没用。
 */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'found'; info: UpdateInfo }
  | { status: 'failed'; message: string }
