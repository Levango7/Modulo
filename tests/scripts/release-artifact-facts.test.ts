/**
 * 「线上产物」这一维的判据测试（`scripts/release-artifact-facts.mjs`）。
 *
 * ## 为什么要有这条门
 * `docs/ARCHITECTURE.md:1642` 那句「当前线上发布产物是 `Modulo_x.y.z_x64-setup.exe`（sha256 …）」
 * 是**对外承诺**，而它在线上已经 0.8.1 的情况下停在 0.7.0 好几版，没有任何机器报过 ——
 * `docs:check` 只比 `<!-- facts -->` 行里"跑出来的数"，产物口径从来不属于任何一个维度。
 * 现在期望值取自 `release-manifest.json` 台账（台账那半边由 `release-manifest.mjs`
 * 与 GitHub 真实资产对账），于是链条是 文档 ⇐ 台账 ⇐ 线上，人不参与也不会漂。
 *
 * ## 为什么起子进程而不是 import
 * `tsconfig.json` 没有开 `allowJs`，`.mjs` 不能 import 进 `.ts` 做类型检查；
 * 而判据与 CLI 在同一个文件里，`--line-file` / `--ledger` 两张口打的就是门实际走的那条路径。
 * **不走 `docs-check.mjs`**：它一跑就把整个单测集跑一遍（它靠 vitest 的 json 拿实跑条数），
 * 用它来验判据等于在测试里递归跑测试。
 *
 * ## 判成败只看退出码
 * 不在输出文本里找"failed"这种关键词（那是我上一轮把 8 刀全读成"门没咬"的成因）。
 * 每条断言同时要求 `status` 是数字而不是 null —— 子进程被信号杀掉时 `status===null`，
 * 那种情况读成"没报错"就是假绿。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI = join(ROOT, 'scripts', 'release-artifact-facts.mjs')
const dir = mkdtempSync(join(tmpdir(), 'artifact-facts-'))

/** 真台账里 v0.8.1 那颗安装资产的 digest（剥掉 `sha256:` 之后的 64 位） */
const D = 'dc2f453ebede155c4e36f7cc15075098f4e4bc094ef1fe54f1c132079d7ebd21'
/** 上一版 0.7.0 的 —— 用来演"文档停在旧哈希" */
const OLD = '1e27d996f1e232b33f979192d295b0bf7e774d06676e378ed67de531844b5b5c'
const D10 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0010'

const setup = (releases: Record<string, unknown>) => {
  const p = join(dir, `ledger-${Object.keys(releases).join('_').replace(/[^\w.-]/g, '')}-${Math.random().toString(36).slice(2, 8)}.json`)
  writeFileSync(p, JSON.stringify({ updatedAt: '2026-10-15T00:00:00Z', releases }, null, 2))
  return p
}

const line = (name: string, body: string) => {
  const p = join(dir, `${name}.txt`)
  writeFileSync(p, body)
  return p
}

const rel = (tag: string, asset: string | null, digest: string | null, draft = false) => ({
  [tag]: {
    commit: '3c7988ed510e61be6e467d6b33855db67a31ba85',
    immutable: true,
    draft,
    assets: {
      'latest.json': 'sha256:'.padEnd(71, '0'),
      ...(asset && digest ? { [asset]: `sha256:${digest}` } : {}),
    },
  },
})

const run = (lineFile: string, ledgerFile?: string) => {
  const args = [CLI, '--line-file', lineFile]
  if (ledgerFile) args.push('--ledger', ledgerFile)
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  // 被信号杀掉 ≠ 通过：status 必须是数字
  expect(r.status, `子进程没正常退出：${out}`).not.toBeNull()
  return { code: r.status as number, out }
}

describe('台账里"哪个是线上最新"怎么定', () => {
  it('按 semver 三段数字取最大，而不是按台账键序', () => {
    const led = setup({ ...rel('v0.8.1', 'Modulo_0.8.1_x64-setup.exe', D), ...rel('v0.10.0', 'Modulo_0.10.0_x64-setup.exe', D10), ...rel('v0.9.0', 'Modulo_0.9.0_x64-setup.exe', OLD) })
    const lf = line('v-newest', '当前线上发布产物是 `Modulo_0.10.0_x64-setup.exe`')
    const r = run(lf, led)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('LATEST v0.10.0 Modulo_0.10.0_x64-setup.exe')
  })

  it('draft 的发布点不算线上', () => {
    const led = setup({ ...rel('v0.11.0', 'Modulo_0.11.0_x64-setup.exe', D10, true), ...rel('v0.8.1', 'Modulo_0.8.1_x64-setup.exe', D) })
    const lf = line('v-draft', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`')
    expect(run(lf, led).code).toBe(0)
  })

  it('不是 `vX.Y.Z` 的 tag 不参与（`v1`、`v0.8.1-rc1` 都不算一个发布点）', () => {
    const led = setup({
      ...rel('v0.8.1-rc1', 'Modulo_0.8.1-rc1_x64-setup.exe', D10),
      ...rel('v0.8.1', 'Modulo_0.8.1_x64-setup.exe', D),
      v1: { commit: 'x', immutable: false, draft: false, assets: { 'Modulo_1_x64-setup.exe': `sha256:${OLD}` } },
    })
    const lf = line('v-tagshape', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`')
    const r = run(lf, led)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toContain('LATEST v0.8.1 ')
  })

  it('台账空的或全是 draft → 判红，而不是"没东西可核所以过"', () => {
    for (const [name, body] of [
      ['v-empty', {}],
      ['v-aldraft', rel('v0.9.9', 'Modulo_0.9.9_x64-setup.exe', D, true)],
    ] as const) {
      const lf = line(name, '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`')
      const r = run(lf, setup(body))
      expect(r.code, r.out).toBe(1)
      expect(r.out).toContain('取不到可用的发布点')
    }
  })

  it('那一条里没有安装包资产 → 判红并说清是哪一条', () => {
    const led = setup({
      'v0.9.0': { commit: 'x', immutable: true, draft: false, assets: { 'latest.json': `sha256:${D}`, 'Modulo_0.9.0_x64-setup.exe.sig': `sha256:${OLD}` } },
    })
    const lf = line('v-noasset', '当前线上发布产物是 `Modulo_0.9.0_x64-setup.exe`')
    const r = run(lf, led)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('v0.9.0 这条台账里没有安装包')
  })
})

describe('一行的核对是存在式的', () => {
  const led = setup(rel('v0.8.1', 'Modulo_0.8.1_x64-setup.exe', D))

  it('当前安装包名 + 完整 64 位哈希 → 过', () => {
    const lf = line('ok-full', `**当前线上发布产物是 \`Modulo_0.8.1_x64-setup.exe\`**（NSIS，3 035 916 字节，\`sha256 ${D}\`）`)
    expect(run(lf, led).code).toBe(0)
  })

  it('简写 `前缀…后缀` 也算认领，对上就过', () => {
    const lf = line('ok-abbrev', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`，`sha256 dc2f453e…ebd21`')
    expect(run(lf, led).code).toBe(0)
  })

  it('大写哈希一样认（哈希的大小写不是判据）', () => {
    const lf = line('ok-upper', `当前线上发布产物是 \`Modulo_0.8.1_x64-setup.exe\`，sha256 ${D.toUpperCase()}`)
    expect(run(lf, led).code).toBe(0)
  })

  it('只给头的写法（`sha256 前缀…`）也要核 —— 否则整行只写前缀就能绕过', () => {
    const good = line('head-ok', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`，sha256 dc2f453e…')
    expect(run(good, led).code).toBe(0)
    const bad = line('head-bad', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`，sha256 deadbeefab…')
    const r = run(bad, led)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('与台账都对不上')
  })

  it('文档停在旧安装包名 → 判红，且 why 里给出台账认定的是哪一个', () => {
    // 这一格就是 §11.4 真实发生过的漂移：线上 0.8.1，文档写 0.7.0
    const lf = line('drift-name', '当前线上发布产物是 `Modulo_0.7.0_x64-setup.exe`（NSIS，3 031 110 字节，sha256 1e27d996f1e232b33f979192d295b0bf7e774d06676e378ed67de531844b5b5c）')
    const r = run(lf, led)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('Modulo_0.8.1_x64-setup.exe')
  })

  it('名字对、哈希是抄来的旧值 → 判红', () => {
    const lf = line('drift-hash', `当前线上发布产物是 \`Modulo_0.8.1_x64-setup.exe\`，sha256 ${OLD}`)
    const r = run(lf, led)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('与台账都对不上')
  })

  // 这一格是刻意与上一格**分开**的：名字旧、哈希却是新的。
  // 只测"名字旧 + 哈希也旧"的话，把名字核对整条放宽（M1 型变异）也不会让任何断言变红 ——
  // 因为哈希那半边还在报。判据的每一项都要有一格"只有它在起作用"的样本。
  it('名字是旧的而哈希是新的 → 仍判红（把名字核对单独隔离）', () => {
    const lf = line('name-only-stale', `上一版装完用的是 \`Modulo_0.7.0_x64-setup.exe\`，sha256 ${D}`)
    const r = run(lf, led)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('这一行没提到它')
  })

  it('同行里的历史版本与历史哈希不算账（留档不是现状）', () => {
    const lf = line(
      'history-ok',
      `当前线上发布产物是 \`Modulo_0.8.1_x64-setup.exe\`，sha256 ${D}；上一版 \`Modulo_0.7.0_x64-setup.exe\`（sha256 ${OLD}）、上上版 \`Modulo_0.4.0_x64-setup.exe\`（sha256 4658ada982c7e439…）都留档在此`,
    )
    expect(run(lf, led).code).toBe(0)
  })

  it('只点名安装包、没认领哈希 → 过（不逼每一行都写哈希）', () => {
    const lf = line('no-hash', '装完之后目录里那颗来自 `Modulo_0.8.1_x64-setup.exe`')
    expect(run(lf, led).code).toBe(0)
  })

  it('台账那一条没有 digest 而行认领了哈希 → 判红（无从核对不许说成通过）', () => {
    const led2 = setup({ 'v0.8.1': { commit: 'x', immutable: true, draft: false, assets: { 'Modulo_0.8.1_x64-setup.exe': null } } })
    const r = run(line('noledgerhash', `当前线上发布产物是 \`Modulo_0.8.1_x64-setup.exe\`，sha256 ${D}`), led2)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('GitHub 侧没给 digest')
  })
})

describe('台账读不到时的形状', () => {
  const lf = line('ledger-missing', '当前线上发布产物是 `Modulo_0.8.1_x64-setup.exe`')

  it('路径不存在 → 判红，并把路径写进结论', () => {
    const r = run(lf, join(dir, 'does-not-exist.json'))
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('does-not-exist.json')
  })

  it('台账不是合法 JSON → 判红并带"台账读不了"', () => {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ "releases": ')
    const r = run(lf, bad)
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('台账读不了')
  })

  it('用法错（没给 --line-file）→ exit 2，与"判红"分开', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(`${r.stderr}`).toContain('用法')
  })
})

/**
 * 接线自证。这两条防的是同一类事故：**门写了、测试也全绿，但它一行都没守着** ——
 * 上一轮 §11.4 那句就是因为没有任何维度认领它才漂了好几版。
 */
describe('这一维真的接在门上', () => {
  const arch = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8').split(/\r?\n/)
  const ledgerRaw = JSON.parse(readFileSync(join(ROOT, 'release-manifest.json'), 'utf8')) as {
    releases: Record<string, { draft?: boolean; assets: Record<string, string | null> }>
  }
  const tags = Object.keys(ledgerRaw.releases).filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && ledgerRaw.releases[t].draft !== true)
  const tuple = (t: string) => t.slice(1).split('.').map(Number)
  const newest = tags.reduce((a, b) => {
    const A = tuple(a)
    const B = tuple(b)
    for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i] ? a : b
    return a
  })
  const assetName = Object.keys(ledgerRaw.releases[newest].assets).find((n) => n.endsWith('_x64-setup.exe'))
  const digest = String(ledgerRaw.releases[newest].assets[assetName as string] ?? '').replace(/^sha256:/, '').toLowerCase()

  it('台账最新一条的 digest 是 64 位十六进制（不是就证明台账或这里的剥法变了形）', () => {
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true)
  })

  it('ARCHITECTURE 里带 `<!-- facts -->` 的行中，确实有一行提到台账认定的当前安装包', () => {
    const hit = arch.filter((l) => l.includes('<!-- facts -->') && assetName && l.includes(assetName))
    expect(hit.length, `没有任何标记行提到 ${assetName} —— 这一维等于零射程`).toBeGreaterThan(0)
  })

  it('拿仓库真台账核真那一行 → 必须过（门上线时现场就是绿的，不是"以后再修"）', () => {
    const idx = arch.findIndex((l) => l.includes('<!-- facts -->') && assetName && l.includes(assetName))
    expect(idx, `ARCHITECTURE 里找不到"带标记且提到 ${assetName}"的那一行`).toBeGreaterThanOrEqual(0)
    const r = run(line('wiring', arch[idx]), join(ROOT, 'release-manifest.json'))
    expect(r.code, r.out).toBe(0)
    expect(existsSync(CLI)).toBe(true)
  })
})
