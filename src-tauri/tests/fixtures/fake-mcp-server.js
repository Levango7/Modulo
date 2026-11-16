#!/usr/bin/env node
// 假 MCP stdio server：只给 `ai/mcp/client_tests.rs` 的四条真子进程用例用。
//
// 为什么不用 Rust 里的 mock：这四条要验的正是「真起进程、真写管道、真收 EOF、真超时后
// kill」—— 换成替身就只剩自证。脚本放在 `tests/fixtures/` 下：Cargo 只把 `tests/*.rs`
// 当集成测试，子目录里的 `.js` 不会被收集；根目录 `tests/**/*.test.ts` 的条数统计也不受影响。
//
// 模式（argv 里的 `--mode=`）：
//   counter=<file>  每收到一行 initialize 就往 <file> append 一行 init，然后正常回 result
//   ok              正常回 initialize / tools/list（tools/list 给空清单）
//   hang            读到行也不回，挂住等父进程杀
//   eof             读到第一行（initialize）后立刻退出，制造 EOF
//   garbage         对 initialize 回一行非 JSON 文本
//
// 协议取 `state.rs` 的固定 id：initialize 的 id 是数字 1，回包必须带同一个 id 与 jsonrpc 2.0。

// 注意：仓根 `package.json` 是 `"type": "module"`，这里必须用 ESM import —— 写 `require`
// 会当场 `ReferenceError: require is not defined in ES module scope`（本机踩过）。

import fs from 'node:fs'
import readline from 'node:readline'

const arg = process.argv.slice(2).find((a) => a.startsWith('--mode=')) || '--mode=ok'
const spec = arg.slice('--mode='.length)
const eq = spec.indexOf('=')
const mode = eq === -1 ? spec : spec.slice(0, eq)
const counterFile = eq === -1 ? '' : spec.slice(eq + 1)

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

rl.on('line', (line) => {
  if (mode === 'hang') return // 一个字节都不回，等父进程的超时把它杀掉
  if (mode === 'eof') process.exit(0) // 已经读到 initialize ⇒ 父进程写成功了，现在退出制造 EOF

  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return // 父进程只会写合法 JSON；读不懂就当噪声，别把测试本身搞崩
  }

  if (msg.method === 'initialize') {
    if (mode === 'garbage') {
      process.stdout.write('not json\n')
      return
    }
    if (mode === 'counter') fs.appendFileSync(counterFile, 'init\n')
    reply(msg.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-mcp', version: '0.0.0' },
    })
    return
  }
  if (msg.method === 'tools/list') {
    reply(msg.id, { tools: [] })
  }
})
