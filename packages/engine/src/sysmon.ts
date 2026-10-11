/**
 * 系统监控卡的纯计算：字节的人话化与网卡速率。
 *
 * Rust 侧（`sysmon.rs`）只回**原始计数**（累计收发字节、CPU%、内存字节），这里补
 * 前端要用的三件纯事：
 * - `formatBytes`：字节 → 人话（KB/MB/GB，1 位小数）；
 * - `netRate`：相邻两次采样的计数差 → B/s（除零吸收：dt ≤ 0 或计数回绕给 0）；
 * - `pickDisk`：从磁盘列表里选要展示的那块（系统盘优先，否则最大的）。
 *
 * 不碰 DOM、不碰 `Date.now()` —— 时间差由调用方传入，纯函数可单测。
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 系统体量的人话化（1024 进制，与内存/磁盘的 GiB 惯例一致）。
 * 注意与 update.ts 的 formatBytes 是**两种口径**：那边 1000 进制、对齐 Releases 页写体积的习惯，
 * 只到 MB；这边到 TB —— 撞名会歧义，所以这里叫 formatSize。0 与负数给 0 B。 */
export function formatSize(bytes: number): string {
  const n = Number.isFinite(bytes) ? Math.max(0, Math.trunc(bytes)) : 0
  if (n < 1024) return `${n} B`
  let v = n
  let u = 0
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024
    u += 1
  }
  // 一位小数够看：系统监控不是账本，两位小数只会抖动
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${UNITS[u]}`
}

/**
 * 网卡速率（B/s）：相邻两次采样差分。
 * 计数器回绕/清零（重启网卡、睡眠唤醒）会让 cur < prev —— 那不是"负速率"，
 * 如实给 0 而不是让界面上出现 -2.1 MB/s 这种没人能解释的数。
 */
export function netRate(prevTotal: number, curTotal: number, dtMs: number): number {
  if (!(dtMs > 0) || !Number.isFinite(prevTotal) || !Number.isFinite(curTotal)) return 0
  if (curTotal < prevTotal) return 0
  return Math.round(((curTotal - prevTotal) / dtMs) * 1000)
}

/**
 * 选展示哪块盘：挂载点含 `:\\`（Windows 盘符）或以 `/` 开头的最短挂载点优先
 * （越短越接近根/系统盘），一条都没有就退最大的一块。空表返回 null ——
 * 卡片显示「没探到磁盘」而不是编一块。
 */
export interface DiskLike {
  mount: string
  used: number
  total: number
}

export function pickDisk(disks: readonly DiskLike[]): DiskLike | null {
  if (!disks.length) return null
  const rooted = disks
    .filter((d) => /^([a-z]:\\|\/$)/i.test(d.mount))
    .sort((a, b) => a.mount.length - b.mount.length)
  if (rooted.length) return rooted[0]
  return [...disks].sort((a, b) => b.total - a.total)[0]
}

/** 水平条的填充比例（0–1），四舍五入 3 位。cap 住 1，别让 100.4% 的 CPU 撑破条 */
export function barFrac(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.round((value / max) * 1000) / 1000, 1)
}
