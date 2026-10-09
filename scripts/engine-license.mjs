/**
 * 把仓库根的 `LICENSE` 拷进 `packages/engine/`，好让 `npm pack` / `npm publish` 能把它装进 tarball。
 *
 * ## 为什么需要这一步
 *
 * npm 有一条硬规则：**`LICENSE` 无论 `files` 怎么写都必进 tarball** —— 但前提是它**在包的目录下**。
 * 我们的许可证只有一处（仓库根），包在 `packages/engine/`，于是 2026-10-09 实测打出来的 tarball 里
 * **一个 LICENSE 文件都没有**，而 `package.json` 里写着 `"license": "Apache-2.0"`。
 *
 * 这不是洁癖：Apache-2.0 第 4 条要求分发时**随附许可证副本**。包发出去之前没人看得到这件事
 * （仓库内走源码消费，根本不经 tarball），所以它一直没暴露。
 *
 * ## 为什么不直接把 LICENSE 复制一份提交进 `packages/engine/`
 *
 * 那样就有两份许可证文本，改一处忘一处，而且"哪份是真的"从此说不清。这里保持**单一来源**
 * （仓库根那份），只在打包前同步一份出来；产物 `packages/engine/LICENSE` 在 `.gitignore` 里。
 *
 * 由 `packages/engine/package.json` 的 `prepack` 调用 —— `npm pack` 与 `npm publish` 都会先跑 prepack。
 */
import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const from = resolve(here, '..', 'LICENSE')
const to = resolve(here, '..', 'packages', 'engine', 'LICENSE')

if (!existsSync(from)) {
  // 没有源文件就要红：静默跳过等于"打出一个没带许可证的包"，而那正是这个脚本要修的事。
  console.error(`[engine-license] 找不到 ${from} —— 许可证是单一来源，缺了就不是"跳过"而是错`)
  process.exit(1)
}

copyFileSync(from, to)
console.log(`[engine-license] LICENSE → packages/engine/LICENSE（${from}）`)
