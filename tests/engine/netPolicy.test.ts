import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AI_CONNECT_TIMEOUT_MS,
  AI_PROBE_TIMEOUT_MS,
  AI_SUMMARIZE_TIMEOUT_MS,
  CONNECT_ORIGINS,
  CSP_CONNECT_SRC,
  DESKTOP_FETCH_TIMEOUT_MS,
  DEV_CSP_CONNECT_SRC,
  FETCH_TIMEOUT_MS,
  MAX_FEED_BODY_BYTES,
  MAX_HTTP_BODY_BYTES,
  MAX_URL_LENGTH,
  NET_POLICY_VERSION,
} from '@levango7/engine/netPolicy.generated'
import { MAX_HTTP_URL } from '@levango7/engine/http'
import { MAX_URL } from '@levango7/engine/watch'

/**
 * 网络策略单源（`net-policy.json`）→ 生成产物（`netPolicy.generated.ts`）的一致性。
 *
 * ## 为什么单独测这一层
 *
 * 这些数字此前散在六处，互相靠注释维系同源 —— 而注释维系同源的结果已经出过一次事：
 * `http.ts` 写「沿用 net.rs（1 MiB / **5s**）」，`net.rs` 实际是 10s。同一类漂移在 CSP 上
 * 还造成过一个**用户可见的 bug**：`connect-src` 漏了 `https://push2.eastmoney.com`
 * （`stock.ts` 的 `QUOTES_URL`），桌面壳里股票卡取数被实拦而网页版没有 CSP，于是长期没被发现。
 *
 * 这里直接读单源那份 JSON 与生成文件比对 —— 生成文件是**入库**的（引擎包要能独立构建），
 * 所以它有可能与单源漂移；漂移了就必须红，而不是等有人手抄时发现。
 * Rust 侧与 CSP 那一半由 `scripts/net-policy-check.mjs` 断言（CI 上跑）。
 */

const root = resolve(__dirname, '..', '..')
const policy = JSON.parse(readFileSync(resolve(root, 'net-policy.json'), 'utf8'))

describe('网络策略单源 → 生成产物', () => {
  it('生成文件里的每个数字都与 net-policy.json 逐字一致', () => {
    expect(NET_POLICY_VERSION).toBe(policy.version)
    expect(FETCH_TIMEOUT_MS).toBe(policy.timeouts.fetchMs)
    expect(DESKTOP_FETCH_TIMEOUT_MS).toBe(policy.timeouts.desktopFetchMs)
    expect(AI_SUMMARIZE_TIMEOUT_MS).toBe(policy.timeouts.aiSummarizeMs)
    expect(AI_PROBE_TIMEOUT_MS).toBe(policy.timeouts.aiProbeMs)
    expect(AI_CONNECT_TIMEOUT_MS).toBe(policy.timeouts.aiConnectMs)
    expect(MAX_URL_LENGTH).toBe(policy.limits.urlLength)
    expect(MAX_HTTP_BODY_BYTES).toBe(policy.limits.httpBodyBytes)
    expect(MAX_FEED_BODY_BYTES).toBe(policy.limits.feedBodyBytes)
  })

  it('URL 上限只有一个真源：http.ts 与 watch.ts 都读它', () => {
    // 这两处此前各写 300、靠注释「与 watch 同一 URL 上限（300）」维系同源。
    expect(MAX_HTTP_URL).toBe(MAX_URL_LENGTH)
    expect(MAX_URL).toBe(MAX_URL_LENGTH)
    expect(MAX_URL).toBe(300)
  })

  it('两个响应体上限是有意差异，不是笔误', () => {
    // feed（256 KiB）刻意小于网页（1 MiB）：feed 是用户订阅的第三方全文，
    // 一次刷新可能解析几十份；统一成同一个数会把峰值内存抬四倍。
    expect(MAX_FEED_BODY_BYTES).toBeLessThan(MAX_HTTP_BODY_BYTES)
    expect(MAX_HTTP_BODY_BYTES / MAX_FEED_BODY_BYTES).toBe(4)
  })

  it('股票行情的域必须在允许外连的清单里（②号 bug 的回归钉）', () => {
    // packages/engine/src/stock.ts 的 QUOTES_URL 就是这个域。它曾漏在两条 CSP 之外，
    // 桌面壳里股票卡取数被 CSP 实拦 —— 网页版没有 CSP，所以一直没人发现。
    expect(CONNECT_ORIGINS).toContain('https://push2.eastmoney.com')
    expect(CSP_CONNECT_SRC).toContain('https://push2.eastmoney.com')
    expect(DEV_CSP_CONNECT_SRC).toContain('https://push2.eastmoney.com')
  })

  it('dev CSP 多放行的只有 vite 自己的端口，生产 CSP 里不该有 localhost', () => {
    expect(DEV_CSP_CONNECT_SRC).toContain('ws://localhost:1430')
    expect(DEV_CSP_CONNECT_SRC).toContain('http://localhost:1430')
    expect(CSP_CONNECT_SRC).not.toContain('localhost:1430')
    // dev 是生产的超集：少一条都会让开发态莫名其妙地连不上。
    for (const origin of CONNECT_ORIGINS) {
      expect(DEV_CSP_CONNECT_SRC).toContain(origin)
    }
  })

  it('生成的 connect-src 与单源清单逐字一致（顺序也算）', () => {
    expect(CSP_CONNECT_SRC).toBe(policy.connectOrigins.base.join(' '))
  })
})
