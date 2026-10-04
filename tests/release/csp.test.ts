import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * tauri.conf.json 的 CSP 门禁。
 *
 * ## 这条测试是为了什么而存在的
 *
 * 2026-10-05 发布 0.5.0 前跑真机探针，49 项里 9 项红：最小化 / 最大化 / 关闭 / 全局热键
 * 全部**静默失效**。根因是这个文件里的 `connect-src` 被手写成了一串域名列表，
 * **漏掉了 Tauri 自己的 IPC 源**（`ipc:` / `http://ipc.localhost`）。
 *
 * Tauri v2 的行为是：**只要你显式写了 CSP，它就不再往里注入必需的那些源**。
 * 于是 `http://ipc.localhost/read_doc` 被自己的 CSP 拦掉，控制台报一句
 * "IPC custom protocol failed, Tauri will now use the postMessage interface instead"，
 * 之后所有窗口控制命令（它们都走 IPC）就都没了动静 ——
 * 不报错、不抛异常，探针只能看到"点了没反应"。
 *
 * 这种坑靠人记得加 `ipc:` 是不现实的：改 CSP 时手上没有报错线索，
 * 而症状（窗口按钮不响应）离原因（一行配置里的两个词）非常远。
 * 所以这里把它钉死：**将来任何人重写 CSP，少一个源这条就红。**
 */

const CONF = resolve(__dirname, '../../src-tauri/tauri.conf.json')
const conf = JSON.parse(readFileSync(CONF, 'utf8')) as {
  app: { security: { csp: string; devCsp: string } }
}

/** 取某个指令的取值列表，例如 connect-src */
function directive(csp: string, name: string): string[] {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp)
  return (m?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
}

const API_DOMAINS = [
  'https://api.github.com',
  'https://api.open-meteo.com',
  'https://air-quality-api.open-meteo.com',
  'https://open.er-api.com',
  'https://hacker-news.firebaseio.com',
]

describe('tauri.conf.json 的 CSP', () => {
  it('**connect-src 必须含 Tauri 的 IPC 源**，否则窗口控制命令静默失效', () => {
    // 漏掉任意一个的表现完全一样：IPC 被拦 → 降级 postMessage → 按钮点了没反应
    for (const [which, csp] of [
      ['csp', conf.app.security.csp],
      ['devCsp', conf.app.security.devCsp],
    ] as const) {
      const src = directive(csp, 'connect-src')
      expect(src, `${which} 的 connect-src 里没有 ipc:`).toContain('ipc:')
      expect(src, `${which} 的 connect-src 里没有 http://ipc.localhost`).toContain('http://ipc.localhost')
    }
  })

  it('联网卡的五个域名仍在（改 CSP 时别顺手删掉）', () => {
    for (const [which, csp] of [
      ['csp', conf.app.security.csp],
      ['devCsp', conf.app.security.devCsp],
    ] as const) {
      const src = directive(csp, 'connect-src')
      for (const d of API_DOMAINS) expect(src, `${which} 少了 ${d}`).toContain(d)
      expect(src, `${which} 少了 'self'`).toContain("'self'")
    }
  })

  it('devCsp 额外放行 vite 的 dev server 与 HMR socket', () => {
    const src = directive(conf.app.security.devCsp, 'connect-src')
    expect(src).toContain('http://localhost:1430')
    expect(src).toContain('ws://localhost:1430')
  })

  it('生产 CSP **不放行** dev server —— 否则发布版也能连本机开发端口', () => {
    const src = directive(conf.app.security.csp, 'connect-src')
    expect(src).not.toContain('http://localhost:1430')
    expect(src).not.toContain('ws://localhost:1430')
  })

  it('两套 CSP 都必须有 default-src，否则 CSP 本身是空的', () => {
    for (const [which, csp] of [
      ['csp', conf.app.security.csp],
      ['devCsp', conf.app.security.devCsp],
    ] as const) {
      expect(directive(csp, 'default-src').length, `${which} 缺 default-src`).toBeGreaterThan(0)
      expect(directive(csp, 'connect-src').length, `${which} 缺 connect-src`).toBeGreaterThan(0)
    }
  })
})