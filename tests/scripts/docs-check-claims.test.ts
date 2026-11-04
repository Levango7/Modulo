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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

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

/**
 * 版本号九处的读数与判据（`--version-places <目录>`）。
 *
 * ## 为什么起子进程跑这张口而不是 import
 * 同本文件开头那条理由：`tsconfig.json` 没开 `allowJs`，`.mjs` 进不了 `.ts` 的类型检查；
 * 而这张口就是 `docs-check.mjs` 实际走的那条路径。
 *
 * ## 它钉住的两个失效形状（2026-11-05 实测在 master 上就是红的）
 * 1. **同一份文件里只读到一个副本**：`package-lock.json` 里有**三格**属于我们自己的版本号 ——
 *    顶层 `version`、`packages[""]`（根包条目）、`packages["packages/engine"]`（workspace 里
 *    `@levango7/engine` 那一格，与 `packages/engine/package.json` 是两个独立副本）。
 *    老名录一条 `['package-lock.json', /^\s*"version"…/m]` 靠 `match` 取第一个匹配，
 *    于是永远只看到顶层。实测 master：顶层 `0.8.10`、根包条目 `0.8.4`，差六个发布版而门绿。
 * 2. **读不到的那一处被 `filter` 掉**：老判据 `versions.filter((v) => v.version)` 之后再比大小，
 *    于是"某一处文件改名 / 正则漂了"会让那一格静默消失，剩下的照样同号 ⇒ 绿。
 *    名录少一处＝那一处从此没人守，而它看起来一直在跑。
 *
 * ## 第三格是修完前两格之后才发现的（这一段用例存在的理由）
 * 名录先只补到 `packages[""]`（八处）就准备收工，是并行会话报的切版落点数「9 处」与本门数出的
 * 「8 处」对不上，翻上一版切版提交 `e0d155f` 的说明才看清：那一笔写的是「lock 根条目 +
 * `packages/engine` 条目」两格，也就是说 engine 那格一直在**手工清单**上、只是没有门。
 * 逐 tag 实测：engine 格与顶层不同值的有 5 个（`v0.4.0` 停在 0.3.0、`v0.5.0`→`v0.7.0` 停在 0.4.0、
 * `v0.8.5` 停在 0.8.4；另 4 个早期 tag 那格还不存在），根包条目不同值的有 9 个。
 * ⇒ **同一种失效形状在同一次修复里剩了一份**，所以下面专门给它三条用例：只漂它、它被删、
 * 以及"它与 `packages/engine/package.json` 是两个副本，只改一个必须红"。
 *
 * 判成败只看退出码：**0 = 九处同值且都读得到 / 1 = 有红 / 2 = 压根没跑**（目录都不存在）。
 * 每条 `it` 单独给 20s：本文件每条都要起 node 子进程。
 */
describe('版本号九处：读数、三份副本、读不到必须响', () => {
  const V = '1.2.3'

  type Files = Record<string, string>

  /** 造一棵最小仓树（九处都在、同值），`mutate` 用来摆出各形状的坏样本 */
  function fixture(name: string, mutate?: (f: Files) => void): string {
    const dir = mkdtempSync(join(tmpdir(), `vp-${name}-`))
    const files: Files = {
      'package.json': JSON.stringify({ name: 'modulo', version: V }),
      // 刻意在 packages 里塞一条 `9.9.9` 的第三方条目：按结构读只点我们自己的那两格
      // （`packages[""]` 与 `packages["packages/engine"]`），任何"扫到第一个 version"的写法都会被勾走。
      'package-lock.json': JSON.stringify(
        {
          name: 'modulo',
          version: V,
          lockfileVersion: 3,
          packages: {
            '': { name: 'modulo', version: V },
            'packages/engine': { name: '@levango7/engine', version: V },
            'node_modules/decoy': { version: '9.9.9' },
          },
        },
        null,
        2,
      ),
      'src-tauri/Cargo.toml': `[package]\nname = "modulo"\nversion = "${V}"\n`,
      'src-tauri/Cargo.lock': `version = 3\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n\n[[package]]\nname = "modulo"\nversion = "${V}"\n`,
      'src-tauri/tauri.conf.json': JSON.stringify({ productName: 'Modulo', version: V }),
      'src/vue/useBackup.ts': `export const APP_VERSION = '${V}'\n`,
      'packages/engine/package.json': JSON.stringify({ name: '@levango7/engine', version: V }),
    }
    if (mutate) mutate(files)
    for (const [rel, text] of Object.entries(files)) {
      const p = join(dir, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text)
    }
    return dir
  }

  const read = (dir: string) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--version-places', dir], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `子进程没跑起来：${r.error?.message ?? r.stderr}`).not.toBeNull()
    return { status: r.status as number, json: JSON.parse(r.stdout) as {
      places: Array<{ label: string; file: string; version: string | null; why: string | null }>
      unreadable: Array<{ label: string; why: string }>
      distinct: string[]
      ok: boolean
    } }
  }

  it('九处同值 ⇒ 0（绿侧样本：判据必须能绿，否则任何红都读不出意思）', () => {
    const { status, json } = read(fixture('ok'))
    expect(status).toBe(0)
    expect(json.places).toHaveLength(9)
    expect(json.distinct).toEqual([V])
  }, 20_000)

  it('名录点名了 lock 的三格（结构断言：谁把其中一条删了，这条当场红，而不是静默缩成八处）', () => {
    const { json } = read(fixture('roster'))
    const lockLabels = json.places.filter((p) => p.file === 'package-lock.json').map((p) => p.label)
    expect(lockLabels).toHaveLength(3)
    expect(lockLabels.join('\n')).toMatch(/packages\[""\]/)
    expect(lockLabels.join('\n')).toMatch(/packages\["packages\/engine"\]/)
    // 九处一个都不能少：这条钉的是**名录本身**，上面那些钉的是各处的值
    expect(json.places).toHaveLength(9)
  }, 20_000)

  it('只漂 lock 的根包条目 ⇒ 1（master 今天的形状，老门看不见的那一格）', () => {
    const dir = fixture('inner-drift', (f) => {
      const lock = JSON.parse(f['package-lock.json'])
      lock.packages[''].version = '0.8.4'
      f['package-lock.json'] = JSON.stringify(lock, null, 2)
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.distinct.sort()).toEqual(['0.8.4', V])
    // 点名要用整格路径：`label.includes('packages')` 在补了 engine 那格之后会同时命中两条（假绿）
    expect(json.places.find((p) => p.label.includes('packages[""]'))).toMatchObject({ version: '0.8.4' })
    expect(json.places.find((p) => p.label.includes('packages["packages/engine"]'))).toMatchObject({ version: V })
  }, 20_000)

  it('只漂 lock 的 engine 格 ⇒ 1（`v0.8.5` 的形状：那一笔手工清单漏了这一格）', () => {
    const dir = fixture('engine-drift', (f) => {
      const lock = JSON.parse(f['package-lock.json'])
      lock.packages['packages/engine'].version = '0.8.4'
      f['package-lock.json'] = JSON.stringify(lock, null, 2)
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.distinct.sort()).toEqual(['0.8.4', V])
    expect(json.places.find((p) => p.label.includes('packages["packages/engine"]'))).toMatchObject({ version: '0.8.4' })
  }, 20_000)

  it('lock 的 engine 格与 packages/engine/package.json 是两个副本：只改一个 ⇒ 1', () => {
    // 这一条钉的是"两个独立副本"这件事本身：切版时改了 `packages/engine/package.json`
    // 却忘了跑 `npm install --package-lock-only`，两格就会各说各话 —— 老门只看得到后一个文件。
    const dir = fixture('engine-two-copies', (f) => {
      f['packages/engine/package.json'] = JSON.stringify({ name: '@levango7/engine', version: '1.2.4' })
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    // `sort()` 是字典序：`1.2.3` 排在 `1.2.4` 前（上一条用例的 `0.8.4` 恰好在前，别照抄形状）
    expect(json.distinct.sort()).toEqual([V, '1.2.4'])
    expect(json.places.find((p) => p.label === 'packages/engine/package.json → version')).toMatchObject({
      version: '1.2.4',
    })
    expect(json.places.find((p) => p.label.includes('packages["packages/engine"]'))).toMatchObject({ version: V })
  }, 20_000)

  it('lock 的 engine 格被删 ⇒ 该处「读不到」判红（`v0.4.0` 之前那格还不存在，同样不许静默跳过）', () => {
    const dir = fixture('engine-gone', (f) => {
      const lock = JSON.parse(f['package-lock.json'])
      delete lock.packages['packages/engine'].version
      f['package-lock.json'] = JSON.stringify(lock, null, 2)
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    const gone = json.unreadable.find((p) => p.label.includes('packages["packages/engine"]'))
    expect(gone?.why).toBe('这一格读不到值')
    // 老判据在这里会 filter 掉这一处，剩下八处同号 ⇒ 绿
    expect(json.distinct).toEqual([V])
  }, 20_000)

  it('只漂 lock 的顶层 ⇒ 1（两格各自被读，不是"取第一个匹配"）', () => {
    const dir = fixture('outer-drift', (f) => {
      const lock = JSON.parse(f['package-lock.json'])
      lock.version = '2.0.0'
      f['package-lock.json'] = JSON.stringify(lock, null, 2)
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.distinct.sort()).toEqual([V, '2.0.0'])
  }, 20_000)

  it('lock 的顶层那一格被删 ⇒ 该处「读不到」判红（老写法会静默拿根包条目顶上、照样绿）', () => {
    const dir = fixture('outer-gone', (f) => {
      const lock = JSON.parse(f['package-lock.json'])
      delete lock.version
      f['package-lock.json'] = JSON.stringify(lock, null, 2)
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    const gone = json.unreadable.find((p) => p.label.includes('顶层'))
    expect(gone?.why).toBe('这一格读不到值')
    // 老判据在这里会怎么做：filter 掉这一处，剩下七处全是 1.2.3 ⇒ size 1 ⇒ 绿。
    expect(json.distinct).toEqual([V])
  }, 20_000)

  it('lock 不是合法 JSON ⇒ 三格都读不到并判红（「查不到」绝不冒充「通过」）', () => {
    const dir = fixture('bad-json', (f) => {
      f['package-lock.json'] = '{"version": "1.2.3",,,'
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    const lockPlaces = json.unreadable.filter((p) => p.label.startsWith('package-lock.json'))
    expect(lockPlaces).toHaveLength(3)
    expect(lockPlaces[0].why).toBe('不是合法 JSON')
  }, 20_000)

  it('九处里少一个文件 ⇒ 判红（名录少一处就等于那一处从此没人守）', () => {
    const dir = fixture('file-gone', (f) => {
      delete f['src-tauri/tauri.conf.json']
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.unreadable).toEqual([expect.objectContaining({ file: 'src-tauri/tauri.conf.json', why: '文件不存在' })])
  }, 20_000)

  it('Cargo.lock 里 modulo 那格改了名 ⇒ 读不到并判红（正则漂了必须响，不能返回"下一个像的"）', () => {
    const dir = fixture('renamed', (f) => {
      f['src-tauri/Cargo.lock'] = f['src-tauri/Cargo.lock'].replace('name = "modulo"', 'name = "modulo-desktop"')
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.unreadable[0]).toMatchObject({ file: 'src-tauri/Cargo.lock', why: '这一格读不到值' })
  }, 20_000)

  it('九处全是第三方 decoy 的版本也不抽（按结构点名取，不扫"第一个 version"）', () => {
    // decoy 那格 `9.9.9` 就在 lock 的 packages 里；上面所有绿样本都没把它算进 distinct。
    const { json } = read(fixture('decoy'))
    expect(json.distinct).not.toContain('9.9.9')
  }, 20_000)

  it('APP_VERSION 用双引号也读得到（放宽**读法**，不放宽判据）', () => {
    const dir = fixture('dq', (f) => {
      f['src/vue/useBackup.ts'] = `export const APP_VERSION = "${V}"\n`
    })
    expect(read(dir).status).toBe(0)
  }, 20_000)

  it('九处一个都不在 ⇒ 1（空集合不是「通过」）', () => {
    const dir = fixture('all-gone', (f) => {
      for (const k of Object.keys(f)) delete f[k]
    })
    const { status, json } = read(dir)
    expect(status).toBe(1)
    expect(json.distinct).toEqual([])
    expect(json.unreadable).toHaveLength(9)
    expect(json.ok).toBe(false)
  }, 20_000)

  it('射程自证：同一份样本，改前 0 / 改后 1，差的只有 lock 里那一格', () => {
    const before = read(fixture('range-before'))
    const after = read(
      fixture('range-after', (f) => {
        const lock = JSON.parse(f['package-lock.json'])
        lock.packages[''].version = '0.0.1'
        f['package-lock.json'] = JSON.stringify(lock, null, 2)
      }),
    )
    expect(before.status).toBe(0)
    expect(after.status).toBe(1)
  }, 20_000)

  it('真仓这一笔改完之后九处同源（活断言：现值锁在测试里，下次切版漏一格当场红）', () => {
    const { status, json } = read(ROOT)
    // 期望值从 `package.json` 现读，不写死版本号 —— 写死会把"下次切版"变成一次红，
    // 而这条用例要守的是**九处一致**，不是某一个号。
    const want = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
    expect(json.places.map((p) => `${String(p.version)}  ${p.label}`).join('\n'), `退出码 ${status}`).toMatch(
      new RegExp(`^${want.replace(/\./g, '\\.')}`),
    )
    expect(json.places.every((p) => p.version === want)).toBe(true)
    expect(status).toBe(0)
  }, 20_000)

  it('接线：docs-check 用共用名录，且不再自带一份（两份真值迟早各说各话）', () => {
    const src = readFileSync(join(ROOT, 'scripts/docs-check.mjs'), 'utf8')
    expect(src).toMatch(/^import \{[^}]*versionPlaces[^}]*\} from '\.\/docs-check-claims\.mjs'/m)
    expect(src).not.toMatch(/const VERSION_PLACES\s*=\s*\[/)
    expect(src).not.toMatch(/function versionFacts/)
    // 「读不到」这一支必须真的有消费者，否则抽了个没人调的函数
    expect(src).toMatch(/versionVerdict\(versions\)/)
    expect(src).toMatch(/verdict\.unreadable/)
  }, 20_000)

  it('目录压根不存在 ⇒ 2（没跑起来不算绿，也不算"九处都读不到"）', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--version-places', join(tmpdir(), 'vp-没有这个目录-')], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(r.status).toBe(2)
  }, 20_000)
})
