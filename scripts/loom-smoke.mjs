/**
 * 织布机运行时的**冒烟**（β3，Windows 进 CI 用的驱动）。
 *
 * 这件事为什么必须在 CI 里做：织布机（nexusloom）自己的 CI **只跑 Linux**，而 Modulo 分发的是
 * Windows 上的运行时。α 那轮已经踩过两条 Windows 专属的坑（管道默认 cp936 会坏 MCP 帧、
 * `mcp_server.py` 没有 `__main__` 入口 ⇒ 必须显式调 `run_mcp_server()`），所以这里不是「跑一下看看」，
 * 而是**每一次构建都要证一遍**：
 *   起 `python/python.exe run-mcp.py` → `initialize` 必须回 `protocolVersion` +
 *   `serverInfo{name:"loom"}` → `tools/list` 必须含 `generate_document`。
 * 任一不对即退出 1（CI 的红），不装绿。
 *
 * 用法：`node scripts/loom-smoke.mjs --runtime <解压后的运行时目录>`（默认 `%TEMP%/loom-smoke`）。
 * 退出码：0 = 通过；1 = 失败（带人话原因）。超时也按失败算（不静默挂住）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const root = resolve(
  args.includes('--runtime') ? args[args.indexOf('--runtime') + 1] : join(tmpdir(), 'loom-smoke'),
)
const python = join(root, 'python', 'python.exe')
const launcher = join(root, 'run-mcp.py')
const TIMEOUT_MS = Number(process.env.LOOM_SMOKE_TIMEOUT_MS ?? 45_000)

function fail(why) {
  console.error(`✗ loom-smoke：${why}`)
  process.exit(1)
}

if (!existsSync(python)) fail(`解释器不在：${python}（先下载并解压运行时，再跑这个脚本）`)
if (!existsSync(launcher)) fail(`启动 shim 不在：${launcher}（这是 β1 的 run-mcp.py，不是 run.py）`)

const child = spawn(python, ['-B', launcher], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
let stdout = ''
let stderr = ''
let finished = false
console.log(`[loom-smoke] 起 ${python}（cwd=${root}，超时 ${TIMEOUT_MS}ms）`)
child.stdout.on('data', (d) => {
  stdout += d.toString('utf8')
})
child.stderr.on('data', (d) => {
  stderr += d.toString('utf8')
})
child.on('error', (e) => fail(`启动失败：${e.message}`))
// 子进程先走 = 失败，不能等超时：unref 的 timer/poll 保不住事件循环，
// 没有这一条，python 一崩 node 会以退出码 0 静默「通过」（假绿）。
child.on('exit', (code, signal) => {
  if (finished) return
  fail(`MCP 子进程提前退出（code=${code} signal=${signal}）；stderr：${stderr.slice(-400) || '（空）'}；stdout：${stdout.slice(-200) || '（空）'}`)
})

const timer = setTimeout(() => {
  try { child.kill('SIGKILL') } catch { /* 已退出也要照样报超时 */ }
  fail(`等了 ${TIMEOUT_MS}ms 还没等到 initialize 应答（子进程被卡死了？stderr：${stderr.slice(-400)}`)
}, TIMEOUT_MS)
timer.unref()

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n')
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'modulo-loom-smoke', version: '1.0' },
  },
})
send({ jsonrpc: '2.0', method: 'notifications/initialized' })
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

const poll = setInterval(() => {
  // initialize 与 tools/list 是两件事：各自都要有，才算这条链通了
  const initOk = /"protocolVersion"\s*:\s*"2024-11-05"/.test(stdout) && /"name"\s*:\s*"loom"/.test(stdout)
  const toolsOk = /"generate_document"/.test(stdout)
  if (initOk && toolsOk) {
    finished = true
    clearInterval(poll)
    clearTimeout(timer)
    try { child.kill('SIGKILL') } catch { /* 已退出不影响判定 */ }
    const tools = [...stdout.matchAll(/"name"\s*:\s*"([a-z_]+)"/g)].map((m) => m[1])
    console.log(`✓ loom-smoke：initialize 回 protocolVersion 2024-11-05 + serverInfo loom；tools/list 含 generate_document（${[...new Set(tools)].join(', ')}）`)
    process.exit(0)
  }
  if (stdout.includes('"error"')) {
    finished = true
    clearInterval(poll)
    clearTimeout(timer)
    try { child.kill('SIGKILL') } catch { /* 已退出不影响判定 */ }
    fail(`MCP 回了错误帧：${stdout.slice(0, 400)}`)
  }
}, 200)
poll.unref()
