/**
 * 网络策略常量 —— **本文件由 `scripts/gen-net-policy.mjs` 从仓库根的 `net-policy.json` 生成，不要手改**。
 *
 * ## 为什么它是生成的而不是手写的
 *
 * 这些数字此前散在六处（引擎 `http.ts` / `watch.ts`、三个 `src/vue/use*.ts`、
 * Rust 的 `net.rs` / `feeds.rs` / `ai/openai_compat.rs`、以及 `tauri.conf.json` 的 CSP），
 * 互相靠注释维系同源 —— 而注释维系同源等于没有保证：
 * `http.ts` 曾写「响应上限与超时沿用 net.rs（1 MiB / 5s）」，而 `net.rs` 实际是 10s。
 * 同一类漂移在 CSP 上还造成过一个**用户可见的 bug**：`connect-src` 漏了
 * `https://push2.eastmoney.com`（`stock.ts` 的 `QUOTES_URL`），桌面壳里股票卡取数被实拦。
 *
 * 现在三侧同读 `net-policy.json`：引擎读本文件，Rust 读 `src-tauri/src/net_policy.rs`
 *（`include_str!` 同一份 JSON），CSP 的 `connect-src` 由同一份清单生成。
 * `scripts/net-policy-check.mjs` 断言三侧没有漂移。
 *
 * 改数字的**正确姿势**是改 `net-policy.json`，然后 `node scripts/gen-net-policy.mjs`。
 */

/** 单源 `net-policy.json` 的 `version`；单源换版时跟着动，便于对账 */
export const NET_POLICY_VERSION = 1

export const FETCH_TIMEOUT_MS = 8000
export const DESKTOP_FETCH_TIMEOUT_MS = 10000
export const AI_SUMMARIZE_TIMEOUT_MS = 120000
export const AI_PROBE_TIMEOUT_MS = 3000
export const AI_CONNECT_TIMEOUT_MS = 5000
export const MAX_URL_LENGTH = 300
export const MAX_HTTP_BODY_BYTES = 1048576
export const MAX_FEED_BODY_BYTES = 262144

/**
 * 允许外连的源清单（生产 CSP 的 `connect-src`）。
 *
 * `https://push2.eastmoney.com` 是 `stock.ts` 的行情接口 —— 它曾漏在这份清单之外，
 * 于是桌面壳里股票卡取数被 CSP 拦掉，而网页版没有 CSP，所以一直没人发现。
 */
export const CONNECT_ORIGINS: readonly string[] = ["'self'", "ipc:", "http://ipc.localhost", "https://api.github.com", "https://api.open-meteo.com", "https://air-quality-api.open-meteo.com", "https://open.er-api.com", "https://hacker-news.firebaseio.com", "https://push2.eastmoney.com"]

/** 只在 dev CSP 里额外放行的源（vite dev server 的 HMR 与自身端口），生产不该有 */
export const DEV_CONNECT_ORIGINS: readonly string[] = ["ws://localhost:1430", "http://localhost:1430"]

/** 生产 CSP 的 `connect-src` 段（生成 `tauri.conf.json` 的 `app.security.csp` 用） */
export const CSP_CONNECT_SRC = "'self' ipc: http://ipc.localhost https://api.github.com https://api.open-meteo.com https://air-quality-api.open-meteo.com https://open.er-api.com https://hacker-news.firebaseio.com https://push2.eastmoney.com"

/** dev CSP 的 `connect-src` 段（生成 `tauri.conf.json` 的 `app.security.devCsp` 用） */
export const DEV_CSP_CONNECT_SRC = "'self' ipc: http://ipc.localhost ws://localhost:1430 http://localhost:1430 https://api.github.com https://api.open-meteo.com https://air-quality-api.open-meteo.com https://open.er-api.com https://hacker-news.firebaseio.com https://push2.eastmoney.com"
