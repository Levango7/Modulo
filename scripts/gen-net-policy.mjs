/**
 * 从仓库根的 `net-policy.json`（**唯一真源**）生成两侧产物：
 *
 * 1. `packages/engine/src/netPolicy.generated.ts` —— 引擎 / 前端读的常量（**入库**，
 *    因为引擎包要能独立构建，不能依赖生成步骤在消费侧跑过）。
 * 2. `src-tauri/tauri.conf.json` 里 `app.security.csp` 与 `app.security.devCsp` 两条的
 *    `connect-src` 段 —— 桌面壳 CSP。
 *
 * ## 为什么要有这一层
 *
 * 2026-10-22 之前，超时与上限的数字散在六处（引擎 `http.ts` / `watch.ts`、三个
 * `src/vue/use*.ts`、Rust 的 `net.rs` / `feeds.rs` / `ai/openai_compat.rs`、以及
 * `tauri.conf.json` 的 CSP），互相靠注释维系同源。其中一处的后果是**用户可见的**：
 * CSP 的 `connect-src` 漏了 `https://push2.eastmoney.com`，而那正是
 * `packages/engine/src/stock.ts` 的 `QUOTES_URL` —— 桌面壳里股票卡取数被 CSP 实拦，
 * 网页版没有 CSP 所以一直是好的，于是它长期没被发现。
 *
 * 注释维系同源 = 没有任何机器保证。这个脚本 + `scripts/net-policy-check.mjs`
 * 把「单源 → 三侧消费」变成可断言的事：数字只在 `net-policy.json` 里出现一次。
 *
 * ## 幂等
 *
 * 两个产物都先比对再写，内容相同就不落盘 —— 所以它挂在 `tauri.conf.json` 的
 * `beforeDevCommand` / `beforeBuildCommand` 上，跑几次都不会产生 git diff。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const POLICY = join(root, 'net-policy.json')
const GENERATED = join(root, 'packages', 'engine', 'src', 'netPolicy.generated.ts')
const TAURI_CONF = join(root, 'src-tauri', 'tauri.conf.json')

const raw = JSON.parse(readFileSync(POLICY, 'utf8'))

/** 少一个字段就红，别让 `undefined` 悄悄进产物（它会变成 TS 里的 `undefined` 常量） */
function need(obj, path) {
  const keys = path.split('.')
  let cur = obj
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) {
      throw new Error(`net-policy.json 缺少 ${path}（单源不完整，拒绝生成半份产物）`)
    }
    cur = cur[k]
  }
  if (typeof cur !== 'number' && !Array.isArray(cur)) {
    throw new Error(`net-policy.json 的 ${path} 不是数字或数组（拿到 ${typeof cur}）`)
  }
  return cur
}

const numbers = {
  FETCH_TIMEOUT_MS: need(raw, 'timeouts.fetchMs'),
  DESKTOP_FETCH_TIMEOUT_MS: need(raw, 'timeouts.desktopFetchMs'),
  AI_SUMMARIZE_TIMEOUT_MS: need(raw, 'timeouts.aiSummarizeMs'),
  AI_PROBE_TIMEOUT_MS: need(raw, 'timeouts.aiProbeMs'),
  AI_CONNECT_TIMEOUT_MS: need(raw, 'timeouts.aiConnectMs'),
  MAX_URL_LENGTH: need(raw, 'limits.urlLength'),
  MAX_HTTP_BODY_BYTES: need(raw, 'limits.httpBodyBytes'),
  MAX_FEED_BODY_BYTES: need(raw, 'limits.feedBodyBytes'),
}

// ── connect-src ────────────────────────────────────────────────────────────
// dev 那两条（vite 的 HMR 与自身端口）只进 devCsp，插在 devInsertAfter 之后；
// 生产那条 CSP 不该有 localhost —— 装到用户机器上的壳去连本机端口没有意义。
const origins = raw.connectOrigins ?? {}
const base = origins.base
if (!Array.isArray(base) || base.length === 0) {
  throw new Error('net-policy.json 的 connectOrigins.base 必须是非空数组')
}
const dev = Array.isArray(origins.dev) ? origins.dev : []
const after = origins.devInsertAfter
const at = after ? base.indexOf(after) : -1
if (after && at < 0) {
  throw new Error(`connectOrigins.devInsertAfter 是 ${after}，但它不在 base 里 —— 拼出来的 dev CSP 会静默少一段`)
}
const devBase = at < 0 ? [...base, ...dev] : [...base.slice(0, at + 1), ...dev, ...base.slice(at + 1)]

const CSP_CONNECT_SRC = base.join(' ')
const DEV_CSP_CONNECT_SRC = devBase.join(' ')

// ── 产物 1：引擎常量 ───────────────────────────────────────────────────────
const lines = []
lines.push('/**')
lines.push(' * 网络策略常量 —— **本文件由 `scripts/gen-net-policy.mjs` 从仓库根的 `net-policy.json` 生成，不要手改**。')
lines.push(' *')
lines.push(' * ## 为什么它是生成的而不是手写的')
lines.push(' *')
lines.push(' * 这些数字此前散在六处（引擎 `http.ts` / `watch.ts`、三个 `src/vue/use*.ts`、')
lines.push(' * Rust 的 `net.rs` / `feeds.rs` / `ai/openai_compat.rs`、以及 `tauri.conf.json` 的 CSP），')
lines.push(' * 互相靠注释维系同源 —— 而注释维系同源等于没有保证：')
lines.push(' * `http.ts` 曾写「响应上限与超时沿用 net.rs（1 MiB / 5s）」，而 `net.rs` 实际是 10s。')
lines.push(' * 同一类漂移在 CSP 上还造成过一个**用户可见的 bug**：`connect-src` 漏了')
lines.push(' * `https://push2.eastmoney.com`（`stock.ts` 的 `QUOTES_URL`），桌面壳里股票卡取数被实拦。')
lines.push(' *')
lines.push(' * 现在三侧同读 `net-policy.json`：引擎读本文件，Rust 读 `src-tauri/src/net_policy.rs`')
lines.push(' *（`include_str!` 同一份 JSON），CSP 的 `connect-src` 由同一份清单生成。')
lines.push(' * `scripts/net-policy-check.mjs` 断言三侧没有漂移。')
lines.push(' *')
lines.push(' * 改数字的**正确姿势**是改 `net-policy.json`，然后 `node scripts/gen-net-policy.mjs`。')
lines.push(' */')
lines.push('')
lines.push('/** 单源 `net-policy.json` 的 `version`；单源换版时跟着动，便于对账 */')
lines.push(`export const NET_POLICY_VERSION = ${JSON.stringify(raw.version ?? 1)}`)
lines.push('')
for (const [name, value] of Object.entries(numbers)) {
  lines.push(`export const ${name} = ${value}`)
}
lines.push('')
lines.push('/**')
lines.push(' * 允许外连的源清单（生产 CSP 的 `connect-src`）。')
lines.push(' *')
lines.push(' * `https://push2.eastmoney.com` 是 `stock.ts` 的行情接口 —— 它曾漏在这份清单之外，')
lines.push(' * 于是桌面壳里股票卡取数被 CSP 拦掉，而网页版没有 CSP，所以一直没人发现。')
lines.push(' */')
lines.push(`export const CONNECT_ORIGINS: readonly string[] = [${base.map((s) => JSON.stringify(s)).join(', ')}]`)
lines.push('')
lines.push('/** 只在 dev CSP 里额外放行的源（vite dev server 的 HMR 与自身端口），生产不该有 */')
lines.push(`export const DEV_CONNECT_ORIGINS: readonly string[] = [${dev.map((s) => JSON.stringify(s)).join(', ')}]`)
lines.push('')
lines.push('/** 生产 CSP 的 `connect-src` 段（生成 `tauri.conf.json` 的 `app.security.csp` 用） */')
lines.push(`export const CSP_CONNECT_SRC = ${JSON.stringify(CSP_CONNECT_SRC)}`)
lines.push('')
lines.push('/** dev CSP 的 `connect-src` 段（生成 `tauri.conf.json` 的 `app.security.devCsp` 用） */')
lines.push(`export const DEV_CSP_CONNECT_SRC = ${JSON.stringify(DEV_CSP_CONNECT_SRC)}`)
lines.push('')

const generated = lines.join('\n')
const prevGenerated = safeRead(GENERATED)
if (prevGenerated !== generated) {
  writeFileSync(GENERATED, generated, 'utf8')
  console.log(`[gen-net-policy] 已写入 packages/engine/src/netPolicy.generated.ts`)
} else {
  console.log('[gen-net-policy] packages/engine/src/netPolicy.generated.ts 已与单源一致，未改动')
}

// ── 产物 2：tauri.conf.json 的 connect-src ─────────────────────────────────
// 只换 `connect-src ` 之后那一段，不重排整个 JSON：这个文件里还有 updater 的
// pubkey 等一大堆别的东西，整份 stringify 会产生噪音 diff。
const confText = readFileSync(TAURI_CONF, 'utf8')
const next = confText
  .replace(/("csp":\s*"[^"]*?connect-src )[^"]*"/, (_m, head) => `${head}${CSP_CONNECT_SRC}"`)
  .replace(/("devCsp":\s*"[^"]*?connect-src )[^"]*"/, (_m, head) => `${head}${DEV_CSP_CONNECT_SRC}"`)

// 替换没命中 = 正则与文件结构脱节。此时**必须红**：否则脚本会假装"生成成功"，
// 而 CSP 里那个漏掉的域名会一直漏下去（这正是②号 bug 躺了那么久的形状）。
if (!next.includes(`connect-src ${CSP_CONNECT_SRC}"`)) {
  throw new Error('tauri.conf.json 里没找到可替换的 csp / connect-src —— 要么键名变了，要么格式变了')
}
if (!next.includes(`connect-src ${DEV_CSP_CONNECT_SRC}"`)) {
  throw new Error('tauri.conf.json 里没找到可替换的 devCsp / connect-src —— 要么键名变了，要么格式变了')
}
if (next !== confText) {
  writeFileSync(TAURI_CONF, next, 'utf8')
  console.log('[gen-net-policy] 已更新 src-tauri/tauri.conf.json 的 csp / devCsp（connect-src）')
} else {
  console.log('[gen-net-policy] src-tauri/tauri.conf.json 的 connect-src 已与单源一致，未改动')
}

function safeRead(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
