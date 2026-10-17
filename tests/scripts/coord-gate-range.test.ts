/**
 * 判据 2「未登记改动」的 **range 口径**测试。
 *
 * 为什么要在**夹具仓库**里跑：这一条读的是 `git diff <range>`，而 range 的形状取决于
 * 真实提交历史（本分支几笔提交、`origin/master` 指向哪、`COORD_BASE` 给不给）。
 * 在真仓里造不出这个形状 —— 造出来就是把别人的历史弄乱。所以这里建一个临时 git 仓、
 * 把门脚本**复制**进去：门的 `root` 是按脚本自身位置算的（`import.meta.url`），
 * 于是它读的就是夹具仓的 git，与真仓的 `cwd` 无关。
 *
 * 值班的缺陷（2026-10-17）：`origin/master...HEAD` 挂了 `ci ? … : null`，
 * **本机跑这道门时它被跳过、直接落到 `HEAD~1...HEAD`** —— 只看最后一个提交。
 * 于是一个分支里前面几笔真改了产品面、最后一笔只碰文档时，**本机绿、CI 红**。
 *
 * **射程自证（这个文件的重点）**：下面第 1 条断言「本机默认口径下必须红」，
 * 第 2 条**在同一份夹具上**用 `COORD_BASE=HEAD~1` 复现旧口径、断言「不红」。
 * 一红一绿都出自同一份历史 ⇒ 结论确实由 **range 选择**驱动，
 * 而不是夹具里别的东西碰巧让它红（那种红会在把旧口径放回去之后依旧红，测试就成了摆设）。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 门脚本按**本测试文件自己**的位置算，不按 cwd（vitest 的 cwd 会随跑法变） */
const GATE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/coord-gate.mjs')

/** 夹具板子：两张表都给全，免得判据 1/5 的噪声混进断言 */
const BOARD = `# 协调板（夹具）

## 作业面登记

| 时间 | Agent | 在做什么 | 会改的文件 | 请勿动 | 状态 |
|------|-------|----------|-----------|--------|------|
| 10-17 03:00 | fixture | 基线行 | \`src/\` | — | ✅ done |

## 机器资源认领

| 资源 | 独占性 | 认领人 | 时间 | 状态 | 备注 |
|------|--------|--------|------|------|------|
| \`port:9999\` | 可共享 | — | — | ✅ 已释放 | |

## 交接记录

（夹具）
`

const sh = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

interface Fixture {
  dir: string
  base: string
}

/**
 * 造一个夹具仓：`base` 提交含板子 + 门脚本 + 一个产品面文件。
 * `refs/remotes/origin/master` 指到 `base` —— 这就是判据 2 的 range 起点。
 */
const newRepo = (withOrigin = true): Fixture => {
  const dir = mkdtempSync(join(tmpdir(), 'coord-range-'))
  sh(dir, 'init', '-q')
  // 不依赖 `init.defaultBranch` 配置：显式把 HEAD 指到 master（判据 3 只跳过 master）
  sh(dir, 'symbolic-ref', 'HEAD', 'refs/heads/master')
  sh(dir, 'config', 'user.email', 'fixture@example.com')
  sh(dir, 'config', 'user.name', 'fixture')
  for (const d of ['scripts', 'docs', 'src']) mkdirSync(join(dir, d), { recursive: true })
  copyFileSync(GATE_SRC, join(dir, 'scripts', 'coord-gate.mjs'))
  writeFileSync(join(dir, 'docs', 'AGENT-COORD.md'), BOARD, 'utf8')
  writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 1\n', 'utf8')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'base')
  const base = sh(dir, 'rev-parse', 'HEAD')
  if (withOrigin) sh(dir, 'update-ref', 'refs/remotes/origin/master', base)
  return { dir, base }
}

const commit = (dir: string, files: Record<string, string>, msg: string): void => {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text, 'utf8')
  }
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', msg)
}

/**
 * 跑门。**显式清掉 `CI`**：不清的话 CI 上那条旧写法本来就启用，
 * 测试会变成「在 CI 上永远绿、在本机红」的假守护 —— 这个文件要抓的正是本机那一侧。
 */
const runGate = (dir: string, env: Record<string, string> = {}): { code: number; out: string } => {
  const clean: NodeJS.ProcessEnv = { ...process.env, COORD_PORT_OWNER: '{}', ...env }
  delete clean.CI
  if (!('COORD_BASE' in env)) delete clean.COORD_BASE
  try {
    const out = execFileSync('node', [join(dir, 'scripts', 'coord-gate.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: clean,
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

/** 判据 2 失败信息的指纹（措辞取自门脚本自身，改门时这里会一起红） */
const UNREGISTERED = '个产品面文件，但没碰'

/* 预算为什么给到 describe 级（每条断言的成本 =「建一个临时 git 仓（约 8 次 git 调用）
   + 两笔提交 + 起一个 node 子进程跑整道门」）：
   隔离跑本文件 4 条共 7.2 s（2.3 / 1.8 / 1.7 / 1.4 s），**远低于**全量并发下的耗时 ——
   2026-10-17 走 `docs-check`（它内部自己起一轮 vitest）时本机 80+ 个 node 进程在跑，
   同样 4 条实测 **21.7 / 8.9 / 6.9 / 6.6 s**，默认 `testTimeout` 5000 直接全挂，
   而报出来的现象是「单测没全绿」，跟断言对错完全无关（把人往错方向带）。
   4 条成本同质、挂哪条只是调度运气，所以预算给 describe、**不给某一条 `it`**。
   口径照 2026-10-16 PR #99 / PR #101 立的先例：**放宽的是预算不是断言**，
   且 **`vitest.config.ts` 全局不动**（全局放宽等于拆铰链 —— 别的测试超时就该红）。
   取 40 s 而不是 20 s：实测峰值 21.7 s 已经顶到 20 s 边上，20 s 会变成"偶尔红一次"，
   而这种间歇性红最后一定会被当成噪声忽略掉。 */
describe('判据 2 的 range 口径（本机与 CI 必须同口径）', { timeout: 40_000 }, () => {
  it('本分支第一笔改了产品面、最后一笔只碰文档 → 本机默认口径下必须红', () => {
    const { dir } = newRepo()
    commit(dir, { 'src/app.ts': 'export const a = 1\n' }, 'feat: 改产品面（**没带板行**）')
    commit(dir, { 'docs/readme.md': '文档\n' }, 'docs: 只碰文档')

    const { code, out } = runGate(dir)
    expect(code, `期望判据 2 报红，实际输出：\n${out}`).toBe(1)
    expect(out).toContain(UNREGISTERED)
    expect(out).toContain('src/app.ts')
  })

  it('射程自证：同一份夹具上把 range 缩回 HEAD~1（旧的本机口径）→ 不红', () => {
    const { dir } = newRepo()
    commit(dir, { 'src/app.ts': 'export const a = 1\n' }, 'feat: 改产品面（**没带板行**）')
    commit(dir, { 'docs/readme.md': '文档\n' }, 'docs: 只碰文档')

    const { code, out } = runGate(dir, { COORD_BASE: 'HEAD~1' })
    expect(code, `旧口径下不该报判据 2，实际输出：\n${out}`).toBe(0)
    expect(out).not.toContain(UNREGISTERED)
  })

  it('本分支里碰过板子 → 不判未登记（range 取并集，任一提交带板行即可）', () => {
    const { dir } = newRepo()
    commit(
      dir,
      { 'src/app.ts': 'export const a = 1\n', 'docs/AGENT-COORD.md': `${BOARD}\n<!-- 补一行 -->\n` },
      'feat: 改产品面 + 同笔登记',
    )
    commit(dir, { 'docs/readme.md': '文档\n' }, 'docs: 只碰文档')

    const { code, out } = runGate(dir)
    expect(code, `带了板行不该报判据 2，实际输出：\n${out}`).toBe(0)
    expect(out).not.toContain(UNREGISTERED)
  })

  it('本机没有 origin/master（裸仓 / 未 fetch）→ 退回 head~1 而不是崩', () => {
    const { dir } = newRepo(false)
    commit(dir, { 'src/app.ts': 'export const a = 1\n' }, 'feat: 改产品面（最后一笔就是它）')

    const { code, out } = runGate(dir)
    expect(code, `退回 HEAD~1 后最后一笔就是产品面，应当红；实际输出：\n${out}`).toBe(1)
    expect(out).toContain(UNREGISTERED)
  })
})
