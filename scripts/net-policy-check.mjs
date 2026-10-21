/**
 * 「单源 → 三侧消费」一致性门禁。
 *
 * ## 它防的是什么
 *
 * `net-policy.json` 是网络/超时策略的唯一真源，三侧同读它：
 *
 * - **引擎 TS**：`packages/engine/src/netPolicy.generated.ts`（`scripts/gen-net-policy.mjs` 生成并入库）
 * - **桌面壳 Rust**：`src-tauri/src/net_policy.rs`（`include_str!` 同一份 JSON），消费点是
 *   `net.rs` / `net/winhttp.rs` / `feeds.rs` / `ai/openai_compat.rs`
 * - **CSP**：`src-tauri/tauri.conf.json` 的 `app.security.csp` 与 `app.security.devCsp`
 *   两条 `connect-src`，由同一份域名清单生成
 *
 * 在此之前这些数字散在六处、靠注释维系同源，而注释维系同源没有任何机器保证 —— 已经
 * 出过两次事：① `http.ts` 注释写「沿用 net.rs（1 MiB / 5s）」而 `net.rs` 实际是 10s；
 * ② CSP 的 `connect-src` 漏了 `https://push2.eastmoney.com`（`stock.ts` 的 `QUOTES_URL`），
 * 桌面壳里股票卡取数被实拦，网页版没有 CSP 所以一直没暴露。
 *
 * 这个脚本把"三侧有没有漂移"变成可断言的事：**任一处漂移即红**。
 * 它只读文件，不改任何东西 —— 修漂移的正道是改 `net-policy.json` 再跑
 * `node scripts/gen-net-policy.mjs`。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const failures = []
let checks = 0

function ok(name, cond, detail = '') {
  checks++
  if (cond) return
  failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
}

/** 断言某处**不再**出现某个手抄的数字（旧写法） */
function absent(name, file, needle) {
  const text = read(file)
  ok(name, !text.includes(needle), `${file} 里仍有 ${needle}（应当改读 net-policy.json 单源）`)
}

/** 断言某处**确实**引用了单源（光删数字不算接入） */
function wired(name, file, needle) {
  const text = read(file)
  ok(name, text.includes(needle), `${file} 里找不到 ${needle}（没有真正接上单源）`)
}

// ── 1. 单源本身 ────────────────────────────────────────────────────────────
const policy = JSON.parse(read('net-policy.json'))
ok('单源有 version', typeof policy.version === 'number')
for (const k of ['fetchMs', 'desktopFetchMs', 'aiSummarizeMs', 'aiProbeMs', 'aiConnectMs']) {
  ok(`单源 timeouts.${k} 是正数`, Number.isInteger(policy.timeouts?.[k]) && policy.timeouts[k] > 0)
}
for (const k of ['urlLength', 'httpBodyBytes', 'feedBodyBytes']) {
  ok(`单源 limits.${k} 是正数`, Number.isInteger(policy.limits?.[k]) && policy.limits[k] > 0)
}
ok(
  '两个响应体上限是有意差异（feed < 网页）',
  policy.limits.feedBodyBytes < policy.limits.httpBodyBytes,
  '若是有意统一，请连同 net_policy.rs 里 feed_body_bytes 的注释一起改，别只改数字',
)
ok(
  '股票行情域在允许外连的清单里',
  policy.connectOrigins.base.includes('https://push2.eastmoney.com'),
  'packages/engine/src/stock.ts 的 QUOTES_URL 就是这个域 —— 漏了它，桌面壳股票卡取数会被 CSP 实拦',
)

// ── 2. TS 侧：生成产物 ─────────────────────────────────────────────────────
const generated = read('packages/engine/src/netPolicy.generated.ts')
const expectNumbers = {
  FETCH_TIMEOUT_MS: policy.timeouts.fetchMs,
  DESKTOP_FETCH_TIMEOUT_MS: policy.timeouts.desktopFetchMs,
  AI_SUMMARIZE_TIMEOUT_MS: policy.timeouts.aiSummarizeMs,
  AI_PROBE_TIMEOUT_MS: policy.timeouts.aiProbeMs,
  AI_CONNECT_TIMEOUT_MS: policy.timeouts.aiConnectMs,
  MAX_URL_LENGTH: policy.limits.urlLength,
  MAX_HTTP_BODY_BYTES: policy.limits.httpBodyBytes,
  MAX_FEED_BODY_BYTES: policy.limits.feedBodyBytes,
}
for (const [name, value] of Object.entries(expectNumbers)) {
  const m = new RegExp(`export const ${name} = (\\d+)`).exec(generated)
  ok(
    `生成产物 ${name} 与单源一致`,
    m !== null && Number(m[1]) === value,
    m === null ? '生成产物里没有这个常量' : `生成产物是 ${m[1]}，单源是 ${value}（跑 node scripts/gen-net-policy.mjs）`,
  )
}
wired('http.ts 的 MAX_HTTP_URL 读单源', 'packages/engine/src/http.ts', 'MAX_HTTP_URL = MAX_URL_LENGTH')
wired('watch.ts 的 MAX_URL 读单源', 'packages/engine/src/watch.ts', 'MAX_URL = MAX_URL_LENGTH')
for (const f of ['src/vue/useRemote.ts', 'src/vue/useWeather.ts', 'src/vue/useUpdateCheck.ts']) {
  wired(`${f} 读单源的 FETCH_TIMEOUT_MS`, f, 'FETCH_TIMEOUT_MS')
  absent(`${f} 不再手抄 8000`, f, '8000')
}

// ── 3. Rust 侧 ─────────────────────────────────────────────────────────────
wired('net_policy.rs 内嵌单源 JSON', 'src-tauri/src/net_policy.rs', 'include_str!("../../net-policy.json")')
ok('net_policy.rs 在 lib.rs 里登记了模块', read('src-tauri/src/lib.rs').includes('mod net_policy;'))
for (const f of [
  'src-tauri/src/net.rs',
  'src-tauri/src/net/winhttp.rs',
  'src-tauri/src/feeds.rs',
  'src-tauri/src/ai/openai_compat.rs',
]) {
  wired(`${f} 引用 net_policy`, f, 'net_policy')
}
absent('net.rs 不再硬编码 1 MiB', 'src-tauri/src/net.rs', '1024 * 1024')
absent('net/winhttp.rs 不再硬编码 10s', 'src-tauri/src/net/winhttp.rs', '10_000')
absent('feeds.rs 不再硬编码 256 KiB', 'src-tauri/src/feeds.rs', '256 * 1024')
absent('openai_compat.rs 不再硬编码 120s', 'src-tauri/src/ai/openai_compat.rs', 'from_secs(120)')
absent('openai_compat.rs 不再硬编码 3s 探活', 'src-tauri/src/ai/openai_compat.rs', 'from_secs(3)')
absent('openai_compat.rs 不再硬编码 5s 连接', 'src-tauri/src/ai/openai_compat.rs', 'from_secs(5)')

// ── 4. CSP 侧 ──────────────────────────────────────────────────────────────
const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
const csp = conf.app?.security?.csp ?? ''
const devCsp = conf.app?.security?.devCsp ?? ''
const connectOf = (s) => /connect-src ([^;]*)/.exec(s)?.[1] ?? ''
const base = policy.connectOrigins.base
const dev = policy.connectOrigins.dev ?? []
const at = base.indexOf(policy.connectOrigins.devInsertAfter)
const devBase = at < 0 ? [...base, ...dev] : [...base.slice(0, at + 1), ...dev, ...base.slice(at + 1)]

ok(
  'tauri.conf.json 的 csp / connect-src 与单源逐字一致',
  connectOf(csp) === base.join(' '),
  `实际「${connectOf(csp)}」／期望「${base.join(' ')}」`,
)
ok(
  'tauri.conf.json 的 devCsp / connect-src 与单源逐字一致',
  connectOf(devCsp) === devBase.join(' '),
  `实际「${connectOf(devCsp)}」／期望「${devBase.join(' ')}」`,
)
ok('生产 CSP 的 connect-src 含股票行情域', connectOf(csp).includes('https://push2.eastmoney.com'))
ok('dev CSP 的 connect-src 含股票行情域', connectOf(devCsp).includes('https://push2.eastmoney.com'))
ok('生成脚本挂在 tauri 的 beforeDevCommand 上', (conf.build?.beforeDevCommand ?? '').includes('gen-net-policy.mjs'))
ok('生成脚本挂在 tauri 的 beforeBuildCommand 上', (conf.build?.beforeBuildCommand ?? '').includes('gen-net-policy.mjs'))

// ── 结论 ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`[net-policy-check] ${failures.length}/${checks} 项断言失败：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`[net-policy-check] ${checks}/${checks} 项断言通过：单源 net-policy.json → TS 生成产物 / Rust 消费点 / CSP 三侧一致`)
