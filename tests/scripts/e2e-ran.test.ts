/**
 * 「E2E 真跑了」判据（`scripts/e2e-ran.mjs`）的测试。
 *
 * 为什么起子进程而不是 import：那个脚本本身是个**可执行门**（按结论 `process.exit`），
 * 且它的价值全在退出码上 —— import 进来测返回值就测不到"门会不会红"这件事。
 *
 * 为什么每条红都要断言**输出里的病因**：这条门最危险的失败形态是「红了但看不出为什么」，
 * 或者更糟 —— 「读不到报告也算通过」。所以下面既断言红，也断言红的时候把话说清楚了。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 门的路径按**测试文件自己**的位置算，不按 cwd —— vitest 的 cwd 会随跑法变（单跑 / 全量 / CI），
// 一变就变成"门不存在"，那种红跟判据一点关系都没有。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GATE = join(ROOT, 'scripts', 'e2e-ran.mjs')
const dir = mkdtempSync(join(tmpdir(), 'e2e-ran-fixtures-'))
const SPECS = join(dir, 'e2e')
mkdirSync(SPECS, { recursive: true })
// 静态条数 = 3：两个文件里各写 it / it.skipIf 家族，`chrome.ts` 那种没有 it 的文件混进去也不该被数
writeFileSync(join(SPECS, 'a.spec.ts'), "describe('a', () => { it('一', () => {}); it.skipIf(true)('二', () => {}) })\n")
writeFileSync(join(SPECS, 'b.spec.ts'), "it('三', () => {})\n")
writeFileSync(join(SPECS, 'chrome.ts'), 'export const x = 1\n')

/** 造一份 vitest json 报告；`skipped` 里给标题就造 pending 用例 */
function report(tag: string, opts: { total: number; pending?: string[]; failed?: string[] }) {
  const results = []
  for (const title of opts.pending ?? []) {
    results.push({ title, status: 'pending' })
  }
  for (const title of opts.failed ?? []) {
    results.push({ title, status: 'failed' })
  }
  const p = join(dir, `${tag}.json`)
  writeFileSync(
    p,
    JSON.stringify({
      numTotalTests: opts.total,
      numPendingTests: (opts.pending ?? []).length,
      numFailedTests: (opts.failed ?? []).length,
      testResults: [{ name: join(SPECS, 'a.spec.ts'), assertionResults: results }],
    }),
  )
  return p
}

function run(extra: string[]): { code: number; out: string } {
  const base = ['--specs', SPECS]
  try {
    const out = execFileSync(process.execPath, [GATE, ...base, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('E2E 真跑了判据', () => {
  it('三条全执行、零跳过 → 绿，并打出条数', () => {
    const r = run(['--report', report('ok', { total: 3 })])
    expect(r.code).toBe(0)
    expect(r.out).toContain('3/3')
  })

  it('有一条被 skipIf 静默跳过 → 红，且把跳过的用例名打出来', () => {
    const r = run(['--report', report('pending', { total: 3, pending: ['二'] })])
    expect(r.code).toBe(1)
    expect(r.out).toContain('被跳过')
    expect(r.out).toContain('二')
  })

  it('实跑条数少于源码静态数 → 红，报"有 spec 没跑到"', () => {
    const r = run(['--report', report('short', { total: 2 })])
    expect(r.code).toBe(1)
    expect(r.out).toContain('没跑到')
  })

  it('有条目失败 → 红', () => {
    const r = run(['--report', report('failed', { total: 3, failed: ['三'] })])
    expect(r.code).toBe(1)
    expect(r.out).toContain('失败')
  })

  it('报告不存在 → 红（不许把"没跑"读成"通过"）', () => {
    const r = run(['--report', join(dir, '不存在.json')])
    expect(r.code).toBe(1)
    expect(r.out).toContain('拒绝假装通过')
  })

  it('报告是坏 JSON → 红', () => {
    const p = join(dir, 'broken.json')
    writeFileSync(p, '{ not json')
    const r = run(['--report', p])
    expect(r.code).toBe(1)
    expect(r.out).toContain('读不出 JSON')
  })

  it('E2E 目录不存在 → 用法错（2），不当成通过也不当成"测试没通过"', () => {
    const r = run(['--specs', join(dir, '不存在'), '--report', report('ok2', { total: 3 })])
    expect(r.code).toBe(2)
    expect(r.out).toContain('无从核对')
  })
})
