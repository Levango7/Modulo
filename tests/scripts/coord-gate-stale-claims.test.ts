/**
 * 判据 1「陈旧认领」的门禁测试。
 *
 * 单开一个文件：`coord-gate-row-split.test.ts` 测的是**把一行切成列**，
 * `coord-gate-resources.test.ts` 测的是**判据 5 的撞车规则**；判据 1 自己的规则
 * （什么时候报陈旧、读不出时间时报不报）此前没有任何文件正面测过 —— 只有一个
 * 「48 小时必报」的顺带断言藏在切分测试里。
 *
 * 2026-11-05 这一笔补的是**读不出时间的那一支**：此前 `claimAgeHours` 返回 null 时
 * 直接 `continue`，于是时间格写成 `昨天` / `10-27 05:1x` 这类形状，这一行就永远
 * 躲开陈旧告警（板上实测 161 个时间格里 69 个读不出，判据 1 对它们永久失明）。
 *
 * 测试自己防两件事：
 *   ① **别把"没跑"读成"通过"** —— 每条先断言门跑起来了（输出里有判据 1 的抬头），
 *      再看报没报；
 *   ② **红绿两侧都要有样本** —— 只测"脏时间会报"证明不了"✅ done 不会被误报"，
 *      而误报会让板子上永远挂一条关不掉的警告（本仓规矩：那比没有警告更糟）。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 路径按**测试文件自己**的位置算，不按 cwd（理由同另外两个门禁测试文件）
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GATE = join(ROOT, 'scripts', 'coord-gate.mjs')
/** 冻在 10-15 12:00：`10-13 12:00` 是 48 小时（陈旧），`10-15 09:00` 是 3 小时（新鲜） */
const NOW = '2026-10-15T12:00:00'
const dir = mkdtempSync(join(tmpdir(), 'coord-gate-stale-'))

/** 一行六列板行。状态格直接以「进行中」开头，免得被 emoji 的 UTF-16 长度干扰 */
const row = (time: string, status: string, agent = 'agent-X'): string =>
  `| ${time} | ${agent} | 夹具认领 | \`src/vue/notes.ts\` | 无 | ${status} |`

const board = (...rows: string[]): string =>
  `# 夹具\n\n| 时间 | Agent | 在做什么 | 会改的文件 | 请勿动 | 状态 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n## 下一节\n`

/**
 * 真跑那道门（不能 import，理由见另外两个文件头）。`COORD_BASE=HEAD` 让判据 2 的
 * range 变成空改动从而不红 —— 不能用 `no-coord-gate`，那个阀连判据 1 一起跳过。
 */
const run = (text: string): { code: number; out: string } => {
  const file = join(dir, `board-${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(file, text, 'utf8')
  try {
    const out = execFileSync('node', [GATE], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 150_000,
      env: {
        ...process.env,
        COORD_BOARD: file,
        COORD_NOW: NOW,
        COORD_PORT_OWNER: '{}',
        COORD_BASE: 'HEAD',
      },
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

// 每条都要起一个 node 子进程跑整道门，而门的耗时**随本地分支数线性涨**（判据 3 逐分支
// `rev-parse` / `rev-list`，外加一次 `ls-remote --tags` 的网络往返）。2026-11-05 本机全量
// 并发下实测：单条最慢 **60.1 s** 顶穿子进程预算被 SIGTERM，于是"门没跑完"读成"测试红"
// —— 同一次全量里这 5 条各自都过（2187 passed 含本文件），单文件单跑 5/5 绿（8–10 s/条），
// 所以红在负载不在判据。照 `coord-gate-row-split.test.ts` 与 PR #99 的先例：**放宽的是
// 预算不是断言**，五条 `expect` 一字未动；真要让门快下来是删本地死分支（判据 3 存在的
// 意义就是它们），别替它做这件事。
// 同款脆弱性仍在 `coord-gate-row-split.test.ts`（子进程 60 s / describe 90 s，本轮实测该
// 文件四条合计 81 s，已贴预算）—— 本笔不动别人的测试文件，如实登记在此。
describe(
  '判据 1：陈旧认领',
  { timeout: 300_000 },
  () => {
    it('读不出时间 + 进行中 → 警告，文案与判据 5 对齐并点名那一行', () => {
      const { out } = run(board(row('昨天', '进行中（夹具）')))
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      expect(out).toContain('不是 `MM-DD HH:mm`')
      expect(out).toContain('agent-X')
      // 读不出来不是"不老"：必须明说陈旧告警对这一行等于不存在
      expect(out).toContain('读不出来不是不老')
    })

    it('读不出时间但已经 ✅ done → 不报（绿侧：别把做完的行也催一遍）', () => {
      const { out } = run(board(row('昨天', '✅ done（夹具）')))
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      expect(out).not.toContain('不是 `MM-DD HH:mm`')
    })

    it('形状近似但读不出（`10-27 05:1x`）→ 同样报（射程：不是只认「昨天」这种明显文本）', () => {
      const { out } = run(board(row('10-27 05:1x', '进行中（夹具）')))
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      expect(out).toContain('不是 `MM-DD HH:mm`')
    })

    it('时间可解析且未超 24 小时 → 不报（绿侧：新鲜行不该有噪声）', () => {
      const { out } = run(board(row('10-15 09:00', '进行中（夹具）')))
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      expect(out).not.toContain('不是 `MM-DD HH:mm`')
      expect(out).not.toContain('小时没动')
    })

    it('时间可解析且超过 24 小时 → 仍报陈旧（防这次改动把原有规则改坏）', () => {
      const { out } = run(board(row('10-13 12:00', '进行中（夹具）')))
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      expect(out).toContain('已挂 48 小时')
    })
  },
)
