/**
 * 探针启动前那道「目标调试口能不能绑」的判据（`scripts/desktop-probe.mjs` 的 `--preflight-only`）。
 *
 * 为什么起子进程而不是 import：探针是一跑就会 spawn 应用、写 `evidence/`、按结论 `process.exit`
 * 的**可执行门**，import 进来等于在单测里真跑一遍全套检查。这里只跑启动前那一段（`--preflight-only`），
 * 配一个注入缝（`PROBE_PRECHECK_FORCE`）把「外部现况」换成固定值 —— 与 `coord-gate-resources.test.ts`
 * 同一条路子。
 *
 * 起因（2026-11-02 切 0.8.10）：沿用 `PROBE_PORT=9333` 落进本机系统保留段，WebView2 绑不上调试口时
 * **不报错、只是不启用远调**，探针把环境问题报成「等不到 tauri.localhost 的页面」，同一颗好包连红两轮 0/2。
 * 保留段还会轮换（同一天 9276–9375 → 3999–4098 / 5762–5861 / 11317–11416），所以用例**不能**靠
 * "本机恰好在保留段里"起红 —— 四类答案（FREE / IN_USE / BLOCKED / UNKNOWN）各给一条断言。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 路径按**测试文件自己**的位置算，不按 cwd —— vitest 的 cwd 会随跑法变（单跑、全量、CI）
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO, 'scripts', 'desktop-probe.mjs')

type Run = { code: number; out: string }

// 用 spawnSync 而不是 execFileSync：处置那几行是走 stderr 的，execFileSync **成功时只回 stdout**，
// stderr 直接丢了 —— 用例会以为"文案没写"（本轮第一次跑就是这么误红的）。
const runCli = (args: string[], env: Record<string, string> = {}): Run => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const runPreflight = (env: Record<string, string> = {}) => runCli(['--preflight-only'], env)

/** 占住/放掉一个临时端口：用例自己制造「被占」与「空闲」，不依赖这台机器上碰巧有什么 */
const withPort = async <T>(fn: (port: number) => Promise<T> | T): Promise<T> => {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as { port: number }).port
  await new Promise<void>((r) => s.close(() => r()))
  return fn(port)
}

// 每条都起一次 node 子进程：全量跑时机器被别的用例挤满，默认 5s 会不够（本轮就红过一次），
// 单跑 6/6 绿、全量 7.2s 超时 —— 所以显式给到与 spawnSync 同档的 30s。
const TIMEOUT = 30_000

// stdout 第一行是机读 JSON，之后（非 FREE 时）stderr 才是给人看的处置
const verdictOf = (out: string) =>
  JSON.parse(out.trim().split('\n').find((l) => l.startsWith('{')) as string) as { port: number; verdict: string }

describe('探针启动前：调试口能不能绑', () => {
  it('空闲口 → FREE、退出码 0，且只打一行 JSON（不跑任何检查）', async () => {
    await withPort((port) => {
      const r = runPreflight({ PROBE_PORT: String(port) })
      expect(r.code).toBe(0)
      expect(verdictOf(r.out)).toEqual({ port, verdict: 'FREE', detail: '' })
      // 启动前这一段不该产出 PASS/FAIL —— 否则说明它把整套检查也跑了一遍
      expect(r.out).not.toContain('PASS')
      expect(r.out).not.toContain('FAIL')
    })
  }, TIMEOUT)

  it('被占的口 → IN_USE、退出码 2，文案指向「已经有进程听着」', async () => {
    const s = createServer()
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    const port = (s.address() as { port: number }).port
    try {
      const r = runPreflight({ PROBE_PORT: String(port) })
      expect(r.code).toBe(2)
      expect(verdictOf(r.out).verdict).toBe('IN_USE')
      expect(r.out).toContain('EADDRINUSE')
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  }, TIMEOUT)

  it('保留段（注入 EACCES）→ BLOCKED、退出码 2，文案给出处置且与 IN_USE 不是同一句', () => {
    const r = runPreflight({
      PROBE_PORT: '4000',
      PROBE_PRECHECK_FORCE: JSON.stringify({ verdict: 'BLOCKED', detail: 'EACCES' }),
    })
    expect(r.code).toBe(2)
    expect(verdictOf(r.out).verdict).toBe('BLOCKED')
    // 处置三件必须都在：保留段成因、现查命令、换号手段
    expect(r.out).toContain('保留段')
    expect(r.out).toContain('netsh int ipv4 show excludedportrange')
    expect(r.out).toContain('PROBE_PORT')
    // 反例：不能与「被占用」共用一句 —— 那正是这一笔要拆开的东西
    expect(r.out).not.toContain('EADDRINUSE')
  }, TIMEOUT)

  it('查不出来（注入 UNKNOWN）→ 不拦（退出码 0），但如实说「没查出来」', () => {
    const r = runPreflight({
      PROBE_PORT: '4000',
      PROBE_PRECHECK_FORCE: JSON.stringify({ verdict: 'UNKNOWN', detail: 'EPERM' }),
    })
    expect(r.code).toBe(0)
    expect(verdictOf(r.out).verdict).toBe('UNKNOWN')
    expect(r.out).toContain('没查出来')
    expect(r.out).toContain('EPERM')
  }, TIMEOUT)

  it('注入缝给了垃圾 → 落回真查，不把坏输入当成 UNKNOWN', async () => {
    await withPort((port) => {
      for (const bad of ['{not json', JSON.stringify({ verdict: 'NOPE' })]) {
        const r = runPreflight({ PROBE_PORT: String(port), PROBE_PRECHECK_FORCE: bad })
        expect(r.code).toBe(0)
        expect(verdictOf(r.out).verdict).toBe('FREE')
      }
    })
  }, TIMEOUT)

  it('真跑模式：口绑不上时**不 spawn 应用**就退出（不等 30 秒、不把原因指错）', () => {
    // MODULO_EXE 指一个不存在的路径：如果 preflight 排在 EXE 处理之后，这里会先报别的
    const r = runCli([], {
      MODULO_EXE: join(REPO, 'no-such-modulo.exe'),
      PROBE_PORT: '4000',
      PROBE_PRECHECK_FORCE: JSON.stringify({ verdict: 'BLOCKED', detail: 'EACCES' }),
    })
    expect(r.code).toBe(2)
    expect(r.out).toContain('PREFLIGHT')
    expect(r.out).toContain('保留段')
    // 一条检查都没跑：既没 PASS/FAIL，也没有 STALE-NOTE（EXE 那段没走到）
    expect(r.out).not.toContain('PASS')
    expect(r.out).not.toContain('FAIL')
    expect(r.out).not.toContain('STALE-NOTE')
  }, TIMEOUT)
})
