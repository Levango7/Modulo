import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 引擎包「发得出去吗」—— 把 npm 发包里机器能核的部分钉住。
 *
 * ## 为什么值得单独一个门禁
 *
 * 这个包在 **2026-10-09 之前从没发出去过**，所以此前所有配置错误都是**不可见**的：
 * 没人 `npm install` 它，也就没人会报错。仓库内一律走**别名直接吃源码**
 * （`vite.config.ts` / `vitest.config.ts` / `tsconfig.json` 三处），`packages/engine/dist/` 平时根本没人看。
 * 也就是说：单测全绿、E2E 全绿、`docs:check` 全绿，同时**打出来的包可以是坏的**。
 *
 * 真正发出去以后，配置错了的代价才出现：用户装到一个缺东西的包、或者发布半路失败
 * （而且 `npm publish` 不可撤回 —— 同名同版本发过就永远发不了第二次）。
 *
 * ## 这个门禁是被一次真实事故逼出来的
 *
 * 2026-10-09 把包名从 `@modulo/engine` 改成 `@levango7/engine`（`@modulo` 这个作用域
 * 在 npm 上已被别人注册）。改名时全仓做了文本替换，**但别名用的不是纯文本** ——
 * `vite.config.ts` / `vitest.config.ts` 里写的是**转义过的正则**：
 *
 * ```ts
 * { find: /^@modulo\/engine$/, replacement: … }
 * ```
 *
 * `@modulo\/engine` 中间那个反斜杠让纯文本替换一条都没命中，于是**两处别名悄悄留在了旧名字上**。
 * 当时 980 条单测、23 条 E2E、typecheck、`docs:check` **没有任何一条会因此变红**
 * （vite/tsconfig 的别名解析发生在构建期，而当时没人重跑构建）。
 * 所以下面第 2 组判据是**逐处点名**的，不是"扫一遍看有没有旧名"——
 * 光扫旧名的话，把别名整个删掉也是绿的。
 */

const ROOT = resolve(__dirname, '../..')
const ENGINE_PKG = resolve(ROOT, 'packages/engine/package.json')

type EnginePkg = {
  name?: string
  private?: boolean
  type?: string
  sideEffects?: boolean
  files?: string[]
  main?: string
  types?: string
  exports?: Record<string, Record<string, string>>
  scripts?: Record<string, string>
  publishConfig?: { access?: string }
}

const engine = JSON.parse(readFileSync(ENGINE_PKG, 'utf8')) as EnginePkg
const name = engine.name ?? ''

/** 包里出现的任何 `@scope/engine` 写法（把正则里的 `\/` 也归一化后再找，见文件头那段） */
const specifiersIn = (text: string) => [
  ...new Set([...text.replace(/\\\//g, '/').matchAll(/@[A-Za-z0-9._-]+\/engine/g)].map((m) => m[0])),
]

/**
 * 只从**别名定义处**取写法，不扫整份文件。
 *
 * 第一版是直接对文件全文跑 `specifiersIn`，变异自检时露了馅：把别名那两行**整行删掉**，
 * 文件里那句提到包名的注释仍然让「找到了 1 处」通过 —— 判据挂在了"文件里出现过这个名字"，
 * 而不是"别名指向这个名字"。**一条能被注释满足的判据，管不住别名。**
 */
const aliasSpecifiersIn = (text: string) => {
  const bodies = [...text.matchAll(/find:\s*\/([^\n]+?)\/\s*,\s*replacement/g)].map((m) => m[1])
  return [...new Set(bodies.flatMap((b) => specifiersIn(b)))]
}

/** 源码里的**导入写法**（不是任意文本 —— 注释里写旧名讲历史是正当的，导入里写旧名不是） */
const importSpecifiersIn = (text: string) => {
  const out: string[] = []
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]/g, /\bvi\.mock\s*\(\s*['"]([^'"]+)['"]/g]) {
    for (const m of text.matchAll(re)) out.push(m[1])
  }
  return out.filter((s) => /^@[A-Za-z0-9._-]+\/engine(\/|$)/.test(s))
}

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') walk(p, out)
    } else out.push(p)
  }
  return out
}

describe(`引擎包发布配置（${name}）`, () => {
  it('包名是发布名，且显式声明 public（scoped 包默认 restricted）', () => {
    expect(name).toMatch(/^@[a-z0-9][a-z0-9._-]*\/engine$/)
    // scoped 包的默认可见性是 restricted：免费账号不写这一行，`npm publish` 会在上传后
    // 被服务端拒（402 Payment Required）。写在这里是为了让它成为仓库的一部分，而不是"发布时记得加参数"。
    expect(engine.publishConfig?.access, 'publishConfig.access 必须是 public').toBe('public')
    // `private: true` 会让 npm 直接拒绝发布 —— 根 package.json 有（那是应用），这个包不能有
    expect(engine.private ?? false).toBe(false)
  })

  it('四处引用都写同一个名字（逐处点名，防空跑）', () => {
    // 判据形状：先要求每一处**确实**指向引擎（否则整段删掉也能「通过」），再要求指向的就是那一个名字。

    // tsconfig.json：`paths` 的键
    const ts = JSON.parse(read('tsconfig.json')) as { compilerOptions?: { paths?: Record<string, string[]> } }
    const pathKeys = Object.keys(ts.compilerOptions?.paths ?? {}).filter((k) => k.includes('/engine'))
    expect(pathKeys.length, 'tsconfig.json 的 paths 里没有引擎映射 —— 是删了，不是"一致"').toBeGreaterThan(0)
    expect([...new Set(pathKeys.map((k) => k.replace(/\/\*$/, '')))], 'tsconfig paths 的写法与发布名不一致').toEqual([
      name,
    ])

    // vite / vitest：别名定义那条 `find:` 正则（**不看注释** —— 第一版就是被注释骗过去的）
    for (const f of ['vite.config.ts', 'vitest.config.ts']) {
      const found = aliasSpecifiersIn(read(f))
      expect(found.length, `${f} 里没有别名定义 —— 是删了，不是"一致"`).toBeGreaterThan(0)
      expect(found, `${f} 的别名与发布名 ${name} 不一致`).toEqual([name])
    }

    // 根 package.json 的依赖键与三条脚本：上面几条只能证明"别名指向正确的名字"，
    // 证明不了脚本确实在用它（比如脚本里干脆不写 workspace 目标）
    const root = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    expect(Object.keys(root.dependencies ?? {}), '根依赖里没有这个包 —— workspace 链接就建不起来').toContain(name)
    for (const s of ['engine:build', 'engine:pack', 'engine:publish']) {
      expect(root.scripts?.[s], `根 package.json 缺 ${s}`).toContain(name)
    }
  })

  it('src/ 与 tests/ 的导入里没有别的 @x/engine 写法', () => {
    // 这一条是上一条的兜底：上面只点数了四个文件，源码里若有第三个名字
    // （比如某个文件直接 `from '@modulo/engine/air'`），它不会出现在那四个文件里。
    // 只看**导入**、不看任意文本：注释里写旧名讲历史是正当的（引擎自己的源码就没人扫）。
    const self = resolve(__dirname, 'engine-package.test.ts')
    const offenders: string[] = []

    for (const file of [...walk(resolve(ROOT, 'src')), ...walk(resolve(ROOT, 'tests'))]) {
      if (file === self) continue
      if (!/\.(ts|vue|mts)$/.test(file)) continue
      for (const spec of importSpecifiersIn(readFileSync(file, 'utf8'))) {
        if (spec !== name && !spec.startsWith(`${name}/`)) {
          offenders.push(`${file.slice(ROOT.length + 1)} -> ${spec}`)
        }
      }
    }

    expect(offenders, `这些地方的导入不等于发布名（改名的漏网之鱼）：\n${offenders.join('\n')}`).toEqual([])
  })

  it('发布的入口与内容都对得上（只发 dist，不发源码）', () => {
    expect(engine.type, 'ESM 包必须是 type: module').toBe('module')
    // sideEffects:false 是给打包器看的：没有它，消费者那边的 tree-shaking 会整包留下
    expect(engine.sideEffects, 'sideEffects 必须是 false，否则消费方摇不掉').toBe(false)

    expect(engine.files ?? [], 'files 只该有 dist 与 README —— 源码留在仓库里').toEqual(['dist', 'README.md'])
    expect(engine.main).toBe('./dist/index.js')
    expect(engine.types).toBe('./dist/index.d.ts')

    // exports 的每一档都要同时给 types 与 default，两个字段都必须在 dist/ 下
    const maps = Object.values(engine.exports ?? {})
    expect(maps.length, 'exports 一段都没有').toBeGreaterThan(0)
    for (const m of maps) {
      expect(Object.keys(m).sort()).toEqual(['default', 'types'])
      for (const v of Object.values(m)) expect(v.startsWith('./dist/')).toBe(true)
    }
  })

  it('prepack 会先同步 LICENSE 再构建', () => {
    // 两件事，缺一不可：
    // ① 没有 build，`npm publish` 打出去的是**没有 dist 的空包**（prepack 是唯一的构建入口）；
    // ② 没有 license 同步，打出去的包里**一个许可证文件都没有** —— npm 只自动带上
    //    「包目录下」的 LICENSE，而我们的许可证单一来源在仓库根（Apache-2.0 第 4 条要求随附副本）。
    //    2026-10-09 实测：修之前打出来的 tarball 里确实没有 LICENSE。
    const prepack = engine.scripts?.prepack ?? ''
    expect(prepack, 'prepack 里没有构建').toMatch(/npm run build/)
    expect(prepack, 'prepack 里没有许可证同步').toMatch(/license:sync/)

    const sync = engine.scripts?.['license:sync'] ?? ''
    expect(sync, 'license:sync 没有指向那个脚本').toContain('scripts/engine-license.mjs')
    expect(existsSync(resolve(ROOT, 'scripts/engine-license.mjs')), 'scripts/engine-license.mjs 不存在').toBe(true)
    expect(existsSync(resolve(ROOT, 'LICENSE')), '仓库根的 LICENSE 不见了 —— 它是唯一来源').toBe(true)

    // 同步产物是生成物，不该进 git
    expect(read('.gitignore'), 'packages/engine/LICENSE 应被忽略（它是生成物）').toContain('packages/engine/LICENSE')
  })
})
