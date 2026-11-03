/**
 * 探针「应用压根起不来」那一档的退出形状（`scripts/desktop-probe.mjs`）。
 *
 * 为什么单独一个文件：§12.53 那组管的是**spawn 之前**那道端口预检，这一组管的是**决定要 spawn 之后**
 * 进程创建失败。两种都是"没跑成"，但报错的人不同、修法也不同。
 *
 * 起因（2026-11-03，做完端口预检那笔顺手实测到的相邻缺陷，先前就有）：`MODULO_EXE` 指到不存在的路径时，
 * `warnIfStale` 只打一句 `STALE-NOTE` 就继续往下走，随后 `spawn` 发出没人接的 `'error'` 事件 ⇒
 * Node 抛未处理异常，**整屏堆栈 + 退出码 1**，看着像探针自己坏了（而 1 这一档在本仓的含义是"有检查红"）。
 *
 * spawn 失败有两种形状，都实测钉住（本机 node v26.8.2）：路径不存在 / 是目录 ⇒ `'error'` 事件 `ENOENT`；
 * 路径存在但不可执行 ⇒ **同步抛** `EFTYPE`。用例不起应用、不碰用户数据，也不需要注入缝 —— 三种形状都是真跑的。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO, 'scripts', 'desktop-probe.mjs')

const TIMEOUT = 30_000

// spawnSync 而不是 execFileSync：处置走 stderr，execFileSync 成功时只回 stdout（与 §12.53 那组同一个理由）
const runProbe = (env: Record<string, string>) => {
  const at = Date.now()
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, elapsed: Date.now() - at }
}

// 端口预检在这组里不是主角，注入成 FREE，用例就不受本机保留段轮换的影响
const FREE = { PROBE_PRECHECK_FORCE: JSON.stringify({ verdict: 'FREE', detail: '' }) }

/** 三条共同的判据：干净退出 2（前置不成立），而不是崩堆栈，也不是"有检查红"的 1 */
const expectCleanGiveUp = (r: { code: number; out: string; elapsed: number }) => {
  expect(r.code).toBe(2)
  expect(r.out).not.toContain('Unhandled')
  expect(r.out).not.toContain('at ChildProcess')
  // 一条检查都没跑：结果行的形状是行首 `PASS  ` / `FAIL  `（`desktop-probe.mjs:38`），
  // 不能直接查子串 'FAIL' —— 自家那句 `SPAWN-FAIL` 里就带着它
  expect(r.out).not.toMatch(/^(PASS|FAIL)  /m)
  // 进程压根没创建 ⇒ 不该白等 30 秒的窗口循环（实测 ~0.5s 就退）
  expect(r.elapsed).toBeLessThan(20_000)
}

describe('探针起不来时：干净退出，不崩堆栈', () => {
  it('二进制不存在 → STALE-NOTE 之后直接退，不再 spawn', () => {
    const r = runProbe({ MODULO_EXE: join(REPO, 'no-such-modulo.exe') })
    expect(r.out).toContain('STALE-NOTE')
    expect(r.out).toContain('没有可探测的二进制')
    // 关键的反例：以前这里会跟着 spawn 一起崩
    expect(r.out).not.toContain('SPAWN-FAIL')
    expectCleanGiveUp(r)
  })

  it('路径是个目录（spawn 发 ENOENT 事件）→ SPAWN-FAIL 带错误码，退 2', () => {
    const r = runProbe({ ...FREE, MODULO_EXE: 'tests' })
    expect(r.out).toContain('SPAWN-FAIL')
    expect(r.out).toContain('ENOENT')
    expect(r.out).toContain('进程压根没创建')
    expectCleanGiveUp(r)
  })

  it('路径存在但不可执行（spawn 同步抛 EFTYPE）→ 同样收成 SPAWN-FAIL，退 2', () => {
    const r = runProbe({ ...FREE, MODULO_EXE: 'package.json' })
    expect(r.out).toContain('SPAWN-FAIL')
    expect(r.out).toContain('EFTYPE')
    expectCleanGiveUp(r)
  })
})
