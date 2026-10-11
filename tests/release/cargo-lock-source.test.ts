import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Rust 侧依赖来源的门禁：`src-tauri/Cargo.lock` 里每个 `source` 必须指向官方 crates.io。
 *
 * ## 这条测试是为了什么而存在的
 *
 * npm 侧有 `lockfile-registry.test.ts` 守 `package-lock.json` 的 registry —— 起因是
 * 2026-10-06 发 0.7.0 时那 271 条 `resolved` 全被某台机器的全局 `~/.npmrc` 写成了
 * 国内镜像，于是 CI 一直在从第三方拉全部依赖。
 *
 * **Rust 侧一直没有对应物**：`Cargo.lock` 里 469 条 `source` 是干净的，但没有任何东西
 * 守着它别变脏。这条把两侧补齐 —— 同一种风险，不该只有一半有防线。
 *
 * ## 它挡的是什么（风险面要说清楚，别夸大）
 *
 * 1. **git 依赖**（`source = "git+https://…"`）—— git 源没有 crates.io 的 checksum，
 *    同一个 tag 随时可以被改指，而 `Cargo.lock` 记的是 rev 不是内容哈希。
 * 2. **自定义 registry** —— 与 npm 侧那条同源：来源一旦取决于某台机器的配置，
 *    CI 与本机就可能拉到不同的东西。
 *
 * ## 明确不挡的（别把这条当成了它没做的事）
 *
 * **镜像加速**。Cargo 的镜像走 `config.toml` 的 `[source.crates-io] replace-with`，
 * 那是**每台机器的本地配置**，不会改写 `Cargo.lock` 里的 `source` 值 ——
 * 也就是说这条守的是**锁文件内容**，不是"这台机器从哪儿下载"。
 * 想在 Rust 侧也把"从哪儿下载"钉住，得看 `~/.cargo/config.toml`，那不在本仓的管辖范围。
 *
 * 另：本仓是 `src-tauri` 单 crate，`Cargo.lock` 里**没有 source 的条目就是本仓成员**
 * （workspace 本地包），天然放行 —— 判据是"有 source 就必须是官方源"，不是"必须都有 source"。
 */

const ROOT = resolve(__dirname, '../..')
const LOCK = resolve(ROOT, 'src-tauri/Cargo.lock')

/** registry 索引（老写法）与稀疏索引（cargo 1.70+ 默认）都是官方源，等价放行 */
const OFFICIAL = ['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/']
/** 官方源的 host。别的 host 一律不收。 */
const OFFICIAL_HOSTS = ['github.com', 'index.crates.io']

const lock = readFileSync(LOCK, 'utf8')

interface Pkg {
  name: string
  version: string
  source: string | null
  checksum: string | null
}

/** 按 `[[package]]` 切块再逐块取字段 —— 比全局扫 `source = ` 更稳，能带上包名做失败信息 */
const pkgs: Pkg[] = lock
  .split(/^\[\[package\]\]$/m)
  .slice(1)
  .map((block) => {
    const field = (k: string) => new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm').exec(block)?.[1] ?? null
    return {
      name: field('name') ?? '<解析不出名字>',
      version: field('version') ?? '?',
      source: field('source'),
      checksum: field('checksum'),
    }
  })

/** 有 source = 从外部拉的；没有 = 本仓 workspace 成员 */
const external = pkgs.filter((p) => p.source !== null)

describe('Rust 依赖来源钉在官方 crates.io', () => {
  it('锁文件里每个 source 都指向官方源', () => {
    // 先确认这个测试没有因为解析方式变化而"空跑"。
    // 判据挂在不变量上而不是某一天的具体条目数：单 crate 的传递闭包必然远多于个位数，
    // 再点名认两个必然在场的包 —— 解析方式变了却刚好抽出非空的一小撮时，这里会红。
    expect(external.length, `解析出 ${external.length} 个外部包，太少说明解析坏了`).toBeGreaterThan(100)
    for (const must of ['tauri', 'serde']) {
      expect(
        external.some((p) => p.name === must),
        `${must} 没出现在解析结果里 —— 是解析方式变了，不是依赖没了`,
      ).toBe(true)
    }

    const bad = external
      .filter((p) => !OFFICIAL.includes(p.source as string))
      .map((p) => `${p.name}@${p.version} -> ${p.source}`)

    expect(bad, `这些包的 source 不是官方 crates.io：\n${bad.join('\n')}`).toEqual([])
  })

  it('一条 git 依赖都不许有', () => {
    const git = external
      .filter((p) => (p.source as string).startsWith('git+'))
      .map((p) => `${p.name}@${p.version} -> ${p.source}`)
    expect(git, `git 依赖没有 crates.io 的 checksum，且同一 tag 可被改指：\n${git.join('\n')}`).toEqual([])

    // 解析之外再对原文兜一遍：将来 Cargo.lock 格式变了、上面的切块解析失效时，
    // 这条仍会红，而不是静默变成"空跑"。
    expect(lock, '原文里出现了 git 依赖').not.toMatch(/^source\s*=\s*"git\+/m)
  })

  it('每个外部包都带 checksum（换源时的安全网）', () => {
    // 少了 checksum，上面两条即使全绿，也无法保证拉到的字节和当初锁的是同一份
    const missing = external.filter((p) => !p.checksum).map((p) => `${p.name}@${p.version}`)
    expect(missing, `这些包没有 checksum：\n${missing.join('\n')}`).toEqual([])
  })

  it('出现的 host 只有官方那两家', () => {
    // 单独把 host 抽出来数一遍：上面那条按完整前缀比对，这里按"出现了几个不同 host"兜底，
    // 免得将来出现第二种第三方地址、而前缀检查恰好漏掉某种写法
    const hosts = [...lock.matchAll(/^source\s*=\s*"(?:registry|sparse)\+https?:\/\/([^/"]+)/gm)].map((m) => m[1])
    const unknown = [...new Set(hosts)].filter((h) => !OFFICIAL_HOSTS.includes(h))
    expect(unknown, `锁文件里出现了非官方 host：${unknown.join(', ')}`).toEqual([])
    expect(hosts.length, '一条 source 都没抽到 —— 正则失效了').toBeGreaterThan(100)
  })
})
