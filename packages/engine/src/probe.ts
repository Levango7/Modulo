/**
 * 连通性探测的纯逻辑：端点名单清洗 + 延迟样本的环形历史与统计。
 *
 * 探测本身在桌面壳（复用 `web_probe`：elapsedMs 就是往返延迟）；这里管两件纯事：
 * - **端点名单**：与网页监控（`watch.ts`）同一条边界 —— `normalizeUrl` 只放行
 *   合规 https，私网/元数据地址进不了名单（导入别人备份时同样生效）；
 * - **样本窗口**：推入、封顶、统计（最新/均值/最差）与状态分档。
 *
 * 历史不进 cardData（机器采的数据不进备份，这是仓里的口径：用户写的进备份、
 * 机器测的不进），由卡组件存进**独立的持久化键**（具体叫什么由宿主层决定），
 * 进卡前先过这里的 sanitizeSamples 清洗 —— 引擎不碰宿主环境的存取设施。
 */
import { normalizeUrl } from './watch.js'

export interface ProbeTarget {
  id: string
  label: string
  url: string
}

export const MAX_PROBES = 12

/**
 * 清洗端点名单：URL 过 `normalizeUrl`（https 白名单 + 私网边界，与 watch 同源，
 * **不另写一份** —— 两份边界清单迟早分叉）；空标签用主机名兜底；id 唯一。
 */
export function sanitizeProbes(list: Readonly<{ id?: unknown; label?: unknown; url?: unknown }[]>): ProbeTarget[] {
  const seen = new Set<string>()
  const out: ProbeTarget[] = []
  for (let i = 0; i < list.length && out.length < MAX_PROBES; i += 1) {
    const raw = list[i]
    const url = normalizeUrl(typeof raw?.url === 'string' ? raw.url : '')
    if (!url) continue
    const key = url
    if (seen.has(key)) continue
    seen.add(key)
    const label =
      (typeof raw?.label === 'string' && raw.label.trim().slice(0, 24)) ||
      (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).slice(0, 24)
    let id = typeof raw?.id === 'string' && raw.id ? raw.id : `p${i}`
    while (out.some((x) => x.id === id)) id = `${id}-${out.length}`
    out.push({ id, label, url })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
}

export interface ProbeSample {
  /** epoch 毫秒 */
  at: number
  /** 往返毫秒；0 = 这次没探通（web_probe 失败时 elapsedMs 为 0） */
  ms: number
}

export const PROBE_WINDOW = 24
export const PROBE_INTERVAL_MS = 30_000

/** 推一个样本进环形窗口：尾部追加、超窗砍头。ms 负数按 0（防御持久化数据） */
export function pushSample(samples: readonly ProbeSample[], s: ProbeSample, cap = PROBE_WINDOW): ProbeSample[] {
  const clean: ProbeSample = {
    at: Number.isFinite(s.at) ? Math.trunc(s.at) : 0,
    ms: Number.isFinite(s.ms) && s.ms > 0 ? Math.round(s.ms) : 0,
  }
  const next = [...samples, clean]
  return next.length > cap ? next.slice(next.length - cap) : next
}

export interface ProbeStats {
  count: number
  okCount: number
  latest: number
  avg: number
  worst: number
}

/** 统计：0ms 样本算失败不计入延迟均值；没样本全 0（界面显示「还没探过」而不是 NaN） */
export function probeStats(samples: readonly ProbeSample[]): ProbeStats {
  const oks = samples.filter((s) => s.ms > 0)
  const latest = samples.length ? samples[samples.length - 1].ms : 0
  if (!oks.length) return { count: samples.length, okCount: 0, latest, avg: 0, worst: 0 }
  const sum = oks.reduce((a, s) => a + s.ms, 0)
  return {
    count: samples.length,
    okCount: oks.length,
    latest,
    avg: Math.round(sum / oks.length),
    worst: oks.reduce((a, s) => Math.max(a, s.ms), 0),
  }
}

/** 延迟给界面的档位：<150 快（绿）、<400 正常（主题色）、其余慢（红）、0 = 不通 */
export type ProbeLevel = 'down' | 'slow' | 'ok' | 'fast'

export function probeLevel(ms: number): ProbeLevel {
  if (!(ms > 0)) return 'down'
  if (ms < 150) return 'fast'
  if (ms < 400) return 'ok'
  return 'slow'
}

/** 清洗持久化的历史：形状不对的样本丢弃，窗口封顶（坏数据不该冻住卡片） */
export function sanitizeSamples(raw: unknown, cap = PROBE_WINDOW): ProbeSample[] {
  if (!Array.isArray(raw)) return []
  const out: ProbeSample[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const at = (item as { at?: unknown }).at
    const ms = (item as { ms?: unknown }).ms
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) continue
    out.push({ at: Math.trunc(at), ms: Math.round(ms) })
    if (out.length >= cap) break
  }
  return out
}
