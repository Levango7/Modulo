/**
 * 「认领数字」判据的整位数测试（`scripts/docs-check-claims.mjs`）。
 *
 * ## 为什么要有这条门
 * 2026-10-16 一轮门禁变异抽查里实测到的洞：`docs:check` 那 6 条 `re` 型规则
 * （单测条数 / 单测文件数 / E2E 条数 / 注册表卡数 / CI job 数 / Rust 单测条数）
 * 把认领写成"行里**某处**出现 54 后接单位"，于是真值 54 时「**154 种卡**」判**通过** ——
 * 少一位/多一位这类**慢性漂移**整个落在射程外，而那正是这道门该看住的东西。
 * 现场证据是我自己撞出来的：伪造行写「CI 99994 个 job」，真值 4，门没归因这一维
 * （`4 个 job` 是 `99994 个 job` 的子串）；换成 99991 才咬住。
 *
 * ## 为什么起子进程而不是 import
 * `tsconfig.json` 没开 `allowJs`，`.mjs` 不能 import 进 `.ts` 做类型检查 ——
 * 与 `release-artifact-facts.test.ts` 同一个理由，判据与 CLI 在同一个文件里，
 * 打的这张口就是门实际走的那条路径。
 *
 * **不走 `docs-check.mjs`**：它一跑就把整个单测集跑一遍（实跑条数就是从那儿取的），
 * 用它来验判据等于在测试里递归跑测试。
 *
 * ## 判成败只看退出码
 * 0 = 这行算认领了该数，1 = 不算，2 = 用法错。同时要求 `status` 是数字而不是 null ——
 * 子进程被信号杀掉时 `status===null`，那种情况读成"没报错"就是假绿。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const SCRIPT = resolve(ROOT, 'scripts/docs-check-claims.mjs')

/** 打一张口，返回退出码（null = 没跑起来，判探针坏而不是判通过） */
const claim = (args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
  expect(r.status, `子进程没跑起来：${r.error?.message ?? r.stderr}`).not.toBeNull()
  return r.status as number
}

const accepted = (digits: string, unit: string, line: string, prefix?: string) =>
  expect(claim(['--digits', digits, '--unit', unit, '--line', line, ...(prefix ? ['--prefix', prefix] : [])]), `${digits} / ${line}`).toBe(0)
const rejected = (digits: string, unit: string, line: string, prefix?: string) =>
  expect(claim(['--digits', digits, '--unit', unit, '--line', line, ...(prefix ? ['--prefix', prefix] : [])]), `${digits} / ${line}`).toBe(1)

describe('认领数字的判据要卡住整位数', () => {
  // 每条 `it` 单独给 20s：这个文件**每条都要起 node 子进程**（18 次 spawn，隔离跑 2.7s），
  // 在全量 87 个文件并发时撞过默认 `testTimeout` 5000 —— 与 `engine-package.test.ts`
  // 那条目录扫描同一类问题。放宽的是**预算**，不是断言。
  it('正确写法都算认领（裸数、成对强调、带"个"、Rust 前缀）', () => {
    accepted('54', '种卡', '- **54 种卡片**：时钟 / 待办 / 便签')
    accepted('54', '种卡', '注册表 **54** 种卡')
    accepted('86', '(?:个)?文件', '规模数字集中在这一行 —— `tests/` 下 **86 个文件**')
    accepted('86', '(?:个)?文件', 'tests 86 文件')
    accepted('4', '个\\s*job', 'CI **4 个 job** 全绿')
    accepted('41', '条', '另有 Rust 单测 **41** 条', 'Rust[^\\n]{0,8}单测\\s*')
  }, 20_000)

  it('多一位的错值不许混过去（本轮修掉的那个洞）', () => {
    rejected('54', '种卡', '注册表 154 种卡')
    rejected('54', '种卡', '注册表 **154** 种卡')
    rejected('4', '个\\s*job', 'CI 14 个 job 全绿')
    rejected('41', '条', 'Rust 单测 141 条', 'Rust[^\\n]{0,8}单测\\s*')
  }, 20_000)

  it('少一位与右邻多位同样不认领（旧写法本来就咬得住，钉住别退回去）', () => {
    rejected('54', '种卡', '注册表 5 种卡')
    rejected('54', '种卡', '注册表 540 种卡')
    rejected('540', '种卡', '注册表 54 种卡')
  }, 20_000)

  it('Rust 那条不认领前端的条数（前缀不匹配就不是这个维度）', () => {
    rejected('41', '条', '前端单测 1390 条', 'Rust[^\\n]{0,8}单测\\s*')
  }, 20_000)

  it('用法错与坏输入判 2，不判"通过"', () => {
    expect(claim(['--digits', '54', '--unit', '种卡'])).toBe(2)
    expect(claim(['--digits', '五十四', '--unit', '种卡', '--line', '54 种卡'])).toBe(2)
  }, 20_000)

  it('射程自证：同一条判据在"真值"与"真值 +1"上必须一个 0 一个 1', () => {
    const line = '注册表 54 种卡'
    expect(claim(['--digits', '54', '--unit', '种卡', '--line', line])).toBe(0)
    expect(claim(['--digits', '55', '--unit', '种卡', '--line', line])).toBe(1)
  }, 20_000)
})

/**
 * 「文件行数」抽取器（`fileLineClaims`）的口子测试。
 *
 * 为什么也走子进程：与上面同一条理由（`.mjs` 进不了 ts 类型检查）。
 * 新口 `--line-claims` 打印 JSON `[{rel, n}]`，判据断言直接比对这个数组。
 *
 * 三条边界各有来历（详见 `docs-check-claims.mjs` 的注释）：
 *   · `A → B 行` 取最后一个数 —— 箭头前是来路不是声明；
 *   · 右侧必须紧跟 `行` —— `309.28 kB`、`（10 条）`、`:334` 都不是行数；
 *   · 窗口 ≤8 字符 —— 路径与数字离得太远就不是这个维度的声明。
 */
describe('文件行数声明的抽取', () => {
  const claimsOf = (line: string): Array<{ rel: string; n: number }> => {
    const r = spawnSync(process.execPath, [SCRIPT, '--line-claims', '--line', line], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `子进程没跑起来：${r.error?.message ?? r.stderr}`).toBe(0)
    return JSON.parse(r.stdout)
  }

  it('箭头链取最后一个数，成对强调与反引号都容忍', () => {
    expect(claimsOf('`src/vue/components/CanvasEditor.vue` **834 → 677 行**，其余不变')).toEqual([
      { rel: 'src/vue/components/CanvasEditor.vue', n: 677 },
    ])
    expect(claimsOf('`src/vue/components/BatchActionBar.vue` 45 行')).toEqual([
      { rel: 'src/vue/components/BatchActionBar.vue', n: 45 },
    ])
  }, 20_000)

  it('一行多个声明逐个抽出', () => {
    expect(
      claimsOf('`src/vue/components/CanvasEditor.vue` **834 → 677 行**，`src/vue/components/ModuleLibrary.vue` 204 行、`src/vue/components/BatchActionBar.vue` 45 行。'),
    ).toEqual([
      { rel: 'src/vue/components/CanvasEditor.vue', n: 677 },
      { rel: 'src/vue/components/ModuleLibrary.vue', n: 204 },
      { rel: 'src/vue/components/BatchActionBar.vue', n: 45 },
    ])
  }, 20_000)

  it('不是行数声明的数字不抽（kB / 条 / 行号引用）', () => {
    expect(claimsOf('主包随新增的 `src/vue/rowUnit.ts` 到 309.28 kB')).toEqual([])
    expect(claimsOf('逐文件条数见 `tests/vue/rowUnit.test.ts`（10 条）')).toEqual([])
    expect(claimsOf('`CanvasEditor.vue:334` 直接 `store.cycleVariant`')).toEqual([])
  }, 20_000)

  it('离得太远的数字不算声明（窗口 8 字符）', () => {
    expect(claimsOf('`src/vue/App.vue` 与当初相比已经改了很多，现在是 640 行')).toEqual([])
  }, 20_000)
})

/**
 * E2E 条数的计数口径（`e2eItCount()`）。
 *
 * 来历：2026-10-25 新加的「E2E 真跑了」门禁第一条红就是
 * 「实跑 48 条，源码里静态数是 49 条」—— 多的那一条是 `tests/e2e/chrome.ts` 文件头注释里
 * 那句「新加的 E2E 一律从这里取路径并 `it.skipIf(!EXE)`」。也就是说文档里长期写着的
 * 「E2E 49 条」把一句**注释**算成了测试，而实际能跑的永远是 48 条。
 *
 * 这条测试钉的就是那个坑：注释里的 `it(` 不算、真注册的算、`describe(` 不算。
 */
describe('E2E 条数：剥掉注释再数 it 家族', () => {
  const countOf = (src: string): number => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-count-'))
    const f = join(dir, 'case.spec.ts')
    writeFileSync(f, src)
    const r = spawnSync(process.execPath, [SCRIPT, '--e2e-count', f], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `子进程没跑起来：${r.error?.message ?? r.stderr}`).toBe(0)
    return Number(r.stdout.trim())
  }

  it('块注释与行注释里的 it 不算（chrome.ts 那个坑的钉子）', () => {
    expect(
      countOf(`
/**
 * 抽出来共用：新加的 E2E 一律从这里取路径并 \`it.skipIf(!EXE)\`。
 */
// it('这行被注释掉了', () => {})
export const x = 1
`),
    ).toBe(0)
  }, 20_000)

  it('真注册的都算：it / it.skipIf(skip)( / it.each(...)(', () => {
    expect(
      countOf(`
describe('组', () => {
  it('裸 it', () => {})
  it.skipIf(!EXE)('带参数链', () => {})
  it.each([1, 2])('%s 表驱动', () => {})
})
`),
    ).toBe(3)
  }, 20_000)

  it('describe 不算 it（否则「文件里有两个 describe」会被数成两条测试）', () => {
    expect(countOf(`describe('只有组没有用例', () => {})`)).toBe(0)
  }, 20_000)

  it('行中的 // 不被当成注释起点（URL 里的斜杠不吃掉后面的代码）', () => {
    expect(countOf(`it('取 https://example.com 的页面', () => {})`)).toBe(1)
  }, 20_000)
})
