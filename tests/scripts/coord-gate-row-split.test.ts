/**
 * 协调板**表格行切分**的门禁测试。
 *
 * 为什么单开一个文件：门读板子的第一件事是「把一行切成列」，判据 1（陈旧认领）与判据 5
 * （资源撞车）都从**固定列号**取值（时间=1 / 会改的文件=4 / 状态=6）。列号一歪，两条判据
 * 就在看错的地方做判断 —— 而它俩各自那个文件测的是**判据本身的规则**，不该顺带背这一段。
 *
 * 2026-10-26 实证：`docs/AGENT-COORD.md` 有 7 条老行的单元格里含竖线（如 L312 的
 * `run\|effect\|wait`、L286 状态格里 `⏳ 进行中… \| ✅ done…`）。门用 `line.split('|')`
 * 天真切分，于是把「会改的文件」读成 `effect`、「状态」读成「请勿动」那一列 ——
 * **人看到的表和门看到的表不是同一张**。修法是切分只认未转义竖线（`splitRow`）。
 *
 * 测试自己也在防两件事：
 *   ① **别把"没跑"读成"通过"** —— 每条都断言门真的报了那条陈旧告警（含 `进行中已挂`），
 *      再看它报出来的「会改的文件」是哪一格；
 *   ② **断言要有射程** —— 第二条把 `\|` 换回裸 `|`，门必须读歪（拿不到 `paletteIndex.ts`），
 *      否则第一条的绿说明不了任何事。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 路径按**测试文件自己**的位置算，不按 cwd（vitest 的 cwd 会随跑法变）
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GATE = join(ROOT, 'scripts', 'coord-gate.mjs')
const BOARD = join(ROOT, 'docs', 'AGENT-COORD.md')
/** 冻在 10-15 12:00：夹具里 `10-13 12:00` 是 48 小时（陈旧），必定触发判据 1 */
const NOW = '2026-10-15T12:00:00'
const dir = mkdtempSync(join(tmpdir(), 'coord-gate-row-'))

/** 一行六列板行；`esc=true` 把单元格里的竖线写成转义的 `\|`（Markdown 里渲染成 `|`，不是列分隔） */
const row = (esc: boolean): string => {
  const p = esc ? '\\|' : '|'
  return (
    `| 10-13 12:00 | agent-X | **批 2：命令总线**（表字段 scope/when/binding/run${p}effect${p}wait）` +
    ' | `src/vue/paletteIndex.ts`、`src/vue/commands.ts` | `packages/engine/**` 零改动 | ⏳ 进行中（夹具行） |'
  )
}

const board = (r: string): string =>
  `# 夹具\n\n| 时间 | Agent | 在做什么 | 会改的文件 | 请勿动 | 状态 |\n|---|---|---|---|---|---|\n${r}\n\n## 下一节\n`

/**
 * 真跑那道门（不能 import，理由见 `coord-gate-resources.test.ts` 文件头）。
 * `COORD_BASE=HEAD` 让判据 2 的range 变成 `HEAD...HEAD`（空改动）从而不红 —— 不能用
 * `no-coord-gate` 逃生阀，那个阀**连判据 1 一起跳过**（门自己会打印「已按 --bypass /
 * no-coord-gate 跳过判据 1-3」），本文件要测的正是判据 1，跳了就只剩一条空转的绿。
 */
const run = (text: string): { code: number; out: string } => {
  const file = join(dir, `board-${Math.random().toString(36).slice(2)}.md`)
  writeFileSync(file, text, 'utf8')
  try {
    const out = execFileSync('node', [GATE], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
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

// 每条都要起一个 node 子进程跑整道门（本机实测 500–680 ms/条冷启动），全量跑时 vitest
// 并发起几十个 worker 会把其中某一条顶穿默认 5000ms —— 照 2026-10-16 PR #99 那条先例：
// **放宽的是预算不是断言**，给到整个 describe。
describe(
  '协调板行的切分只认未转义竖线',
  () => {
    it('转义竖线不当列分隔：门读到的「会改的文件」是完整那一格', () => {
      const { out } = run(board(row(true)))
      // 先证明门跑起来了（否则"空输出"会一路绿灯），再看它取的是哪一格
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      // 判据 1 的告警两行：首行「已挂 N 小时没动」、次行「会改的文件：…」。
      // **把这两行并起来当唯一断言**，是为了让"门压根没报"也红在**目标断言**上 ——
      // 分开写成「先断言报了、再断言报对」，变异（把 splitRow 改回天真切分）会红在前一条，
      // 那说明不了"取列"这段有没有被看住。
      const warn = out
        .split('\n')
        .filter((l) => l.includes('小时没动') || l.includes('会改的文件'))
        .join('\n')
      expect(warn, `门没为这条认领告警，或读到的不是「会改的文件」那一格：\n${out}`).toContain(
        'paletteIndex.ts',
      )
    })

    it('射程自检：同一行把 \\| 写回裸 |，门就读不到这条「进行中」了', () => {
      const { out } = run(board(row(false)))
      // 先证明门确实跑完了，否则"什么都没报"和"没跑到"是同一种绿
      expect(out, '门没跑起来').toContain('陈旧认领阈值')
      // 裸竖线被当列分隔 ⇒ 「状态」这一格落到了「请勿动」那列上（本夹具是 `packages/engine/** 零改动`），
      // 于是这条还挂在「进行中」的认领**门根本看不见** —— 这正是天真切分的真实代价：
      // 判据 1 的"陈旧告警"对这样的行是哑的。
      expect(out).not.toContain('小时没动')
      expect(out).not.toContain('paletteIndex.ts')
    })

    it('真板子每张表列数一致（块内每行未转义竖线数相同）', () => {
      const lines = readFileSync(BOARD, 'utf8').split('\n')
      const blocks: string[][] = []
      let cur: string[] = []
      for (const l of lines) {
        if (l.startsWith('|')) {
          cur.push(l)
          continue
        }
        if (cur.length) {
          blocks.push(cur)
          cur = []
        }
      }
      if (cur.length) blocks.push(cur)

      const pipes = (l: string): number => l.split(/(?<!\\)\|/).length - 1
      expect(blocks.length, '板子里一张表都没读到，这条自检就成了空转').toBeGreaterThan(4)
      const bad: string[] = []
      for (const b of blocks) {
        const want = pipes(b[0])
        for (const [i, l] of b.entries()) {
          if (pipes(l) !== want) bad.push(`${b[0].slice(0, 30)}… 第 ${i + 1} 行：${pipes(l)} ≠ ${want}`)
        }
      }
      expect(bad, '单元格里写了未转义的竖线 —— 写成 \\|').toEqual([])
    })

    it('源码自检：切表格行走 splitRow，不再有天真的 split(\'|\')', () => {
      const src = readFileSync(GATE, 'utf8')
      expect(src).toContain('const splitRow =')
      // 判据 1 与判据 5 各一处
      expect(src.match(/splitRow\(line\)/g)?.length ?? 0).toBe(2)
      // 曾经出事的那两种写法：`line.split('|').map(...)` / `board.split(...)` 里的同类
      expect(src).not.toMatch(/\.split\('\|'\)\.map/)
    })
  },
  30_000,
)
