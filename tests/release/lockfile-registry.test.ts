import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 依赖来源的门禁：锁文件里的 271 个 `resolved` 必须全部指向官方 registry。
 *
 * ## 这条测试是为了什么而存在的
 *
 * 2026-10-06 发 0.7.0，第一次打 `v*` 标签时 CI 直接红在 `npm ci`：
 * 拉不到 `emoji-regex`。查下去根因在锁文件本身 ——
 * **271 条 `resolved` 全部是 `https://registry.npmmirror.com/`**。
 *
 * 那个地址不是仓库里写的，是某台机器的**全局 `~/.npmrc`** 把它设成了国内加速镜像，
 * 于是本机 `npm install` 写进锁文件的 tarball 地址全是这家镜像。仓库里没有任何东西
 * 记录这件事，`npm ci` 也不会报警 —— 它只是照着锁文件去下载。
 *
 * 于是**CI 在 GitHub runner 上，全部依赖都从这家第三方镜像下载**。这回只是 404；
 * 下一次可以是任意别的失效（镜像同步滞后、限流、某包干脆没有），而症状是
 * 「CI 随机变红、本机全好」，排查起来极贵。
 *
 * 所以要钉两件事，缺一不可：
 * 1. **锁文件里的地址** —— 已经改成官方源，这条测试守住它别被写回镜像；
 * 2. **`.npmrc` 存在且钉住官方源** —— 否则"用哪家 registry"取决于每台机器自己的全局
 *    配置，那是看不见的输入，下一次 `npm install` 就又把锁文件写脏了。
 *
 * 要装依赖加速请在**本机**用 `npm install --registry=...` 临时指定，别写回锁文件。
 *
 * ## 风险面要说清楚，别夸大
 *
 * 锁文件里每个包都带 `integrity`，字节被换 `npm ci` 会当场拒绝。所以这条守的是
 * **可用性与版本漂移**，不是任意代码注入 —— 上面那些风险指的是"镜像侧出问题"，
 * 不是"有人能悄悄塞代码进来"。把这一点写清楚，免得后来人以为这里挡的是后者。
 */

const ROOT = resolve(__dirname, '../..')
const LOCK = resolve(ROOT, 'package-lock.json')
const NPMRC = resolve(ROOT, '.npmrc')

const OFFICIAL = 'https://registry.npmjs.org/'

type LockPkg = { resolved?: string; integrity?: string; link?: boolean }

const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as {
  lockfileVersion?: number
  packages?: Record<string, LockPkg>
}

const pkgs = lock.packages ?? {}
/**
 * 只看**真正要下载的包**。
 * 判据是 `resolved` 是不是 http(s) URL，而不是"有没有 resolved"：workspace 软链条目
 * （`node_modules/@modulo/engine`）的 resolved 是相对路径 `packages/engine`、带 `link: true`、
 * 天然没有 integrity —— 把它们算进来会让下面两条永远红，而那不是问题所在。
 */
const downloaded = Object.entries(pkgs).filter(([, v]) => /^https?:\/\//.test(v.resolved ?? ''))

/** 直接依赖数：用来给下面那条"防空跑"的判据当分母，而不是写死某一个天的条目数 */
const directCount = (() => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length
})()

describe('依赖来源钉在官方 registry', () => {
  it('锁文件里每个 resolved 都指向官方 registry', () => {
    // 先确认这个测试没有因为解析方式变化而"空跑"。
    // 这里原先写的是 `> 200`，那是挂在**条目数**上的代理指标：2026-10-07 升 vitest 5 时
    // esbuild 整棵子树退出依赖图（连 25 条平台二进制一起消失，`npm ls esbuild` 已为空），
    // 可下载条目从 271 掉到 144 —— 树变小是合法变更，写死的下限却把它报成"测试空跑"。
    // 判据要挂在不变量上：传递闭包不可能比直接依赖更少，所以按直接依赖数兜底；
    // 再点名认几个必然在场的包，防止解析方式变了却刚好抽出非空的一小撮。
    expect(downloaded.length, `可下载条目(${downloaded.length})不该少于直接依赖数(${directCount})`).toBeGreaterThan(
      directCount,
    )
    for (const must of ['node_modules/vite', 'node_modules/vue', 'node_modules/vitest']) {
      expect(downloaded.some(([k]) => k === must), `${must} 没出现在解析结果里 —— 是解析方式变了，不是依赖没了`).toBe(true)
    }

    const bad = downloaded
      .filter(([, v]) => !(v.resolved as string).startsWith(OFFICIAL))
      .map(([name, v]) => `${name} -> ${v.resolved}`)

    expect(bad, `锁文件里这些包不是从官方 registry 下载的：\n${bad.join('\n')}`).toEqual([])
  })

  it('非官方 registry 一条都不许有（registry.npmmirror.com 这类）', () => {
    const raw = readFileSync(LOCK, 'utf8')
    // 单独把 host 抽出来数一遍：上面那条按前缀比对，这里按"出现了几个不同 host"兜底，
    // 免得将来出现第二种第三方地址而前缀检查恰好漏掉某种写法
    const hosts = [...raw.matchAll(/"resolved":\s*"https?:\/\/([^/]+)\//g)].map((m) => m[1])
    const distinct = [...new Set(hosts)]
    expect(distinct, `锁文件里出现了 ${distinct.length} 个不同 host`).toEqual(['registry.npmjs.org'])
  })

  it('每个要下载的包都带 integrity（换源时的安全网）', () => {
    // 少了 integrity，上面两条即使全绿，也无法保证下载到的字节和当初锁的是同一份
    const missing = downloaded.filter(([, v]) => !v.integrity).map(([name]) => name)
    expect(missing, `这些包没有 integrity：\n${missing.join('\n')}`).toEqual([])
  })

  it('.npmrc 存在且把 registry 钉在官方源', () => {
    const rc = readFileSync(NPMRC, 'utf8')
    const line = rc.split(/\r?\n/).find((l) => /^\s*registry\s*=/.test(l))
    expect(line, '.npmrc 里没有 registry= 这一行 —— 「用哪家 registry」又变回每台机器各自的全局配置了').toBeTruthy()
    expect(line!.replace(/\s*=\s*/, '=')).toBe(`registry=${OFFICIAL}`)
  })

  it('.npmrc 是自己提交的，不是靠某台机器的全局配置', () => {
    // 全局那份可能随时被改。这里只确认仓库里有这个文件，由 CI 的 git 检出带过去
    expect(readFileSync(NPMRC, 'utf8')).toContain('registry.npmjs.org')
  })
})