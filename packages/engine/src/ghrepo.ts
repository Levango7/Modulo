/**
 * GitHub 仓库动态：解析 `api.github.com/repos/{owner}/{repo}` 的响应。
 *
 * 选它是因为**已经在 CSP 白名单里**（更新检查用的就是 api.github.com）—— 不为一张卡再加域名。
 * 不需要 key（未认证 60 次/小时，对"用户点了才查"的节奏绰绰有余）。
 */

export interface RepoSnapshot {
  fullName: string
  description: string
  stars: number
  issues: number
  pushedAt: string
  language: string
  fetchedAt: number
}

/** `owner/name` 的严格形状：两段，只许字母数字、`-`、`_`、`.`（挡住把任意字符串拼进 URL） */
export function repoPathOk(s: string): boolean {
  const t = s.trim()
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(t)
  if (!m) return false
  return !m[1].startsWith('.') && !m[2].startsWith('.')
}

export function repoApiUrl(repo: string): string | null {
  const t = repo.trim()
  return repoPathOk(t) ? `https://api.github.com/repos/${t}` : null
}

export function repoPageUrl(repo: string): string | null {
  const t = repo.trim()
  return repoPathOk(t) ? `https://github.com/${t}` : null
}

/** 形状不对（或 API 给了错误体）就 null —— 认不出就显示"取不到"，不显示半张卡 */
export function parseRepo(payload: unknown, now: number): RepoSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  if (typeof o.full_name !== 'string' || !o.full_name) return null
  // 错误响应长这样：{ message: 'Not Found' } —— 没有 full_name，上面那一关就拦住了
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return {
    fullName: o.full_name,
    description: typeof o.description === 'string' ? o.description : '',
    stars: num(o.stargazers_count),
    issues: num(o.open_issues_count),
    pushedAt: typeof o.pushed_at === 'string' ? o.pushed_at : '',
    language: typeof o.language === 'string' ? o.language : '',
    fetchedAt: now,
  }
}
