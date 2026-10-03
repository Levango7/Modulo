/**
 * 生成更新清单 `latest.json` —— Tauri updater 拉取的端点文件。
 *
 * 为什么单独有这一步：`tauri build` 只产签名（`.sig`），**不产清单**。清单里的
 * `url` 指向 GitHub Release 资产、`notes` 来自本次发布说明，只有发布流程自己知道。
 *
 * 用法：
 *   node scripts/make-latest-json.mjs [--notes-file <md>] [--url <installer-url>] [--out <path>]
 *
 * 自检（宁可不发，也别发一个"谁都装不上"的更新）：
 * - 没 `.sig` 直接失败 —— 说明构建时没设 `TAURI_SIGNING_PRIVATE_KEY`；
 * - `.sig` 里没有 `version:` 也直接失败 —— 应用里开着 `requireSignedVersion`（防降级），
 *   没有版本绑定的签名会被客户端拒绝。判定口径与插件一致：trusted comment 是 tab 分隔的
 *   `key:value`（`tauri-plugin-updater` 的 `signed_version()` 就是这么切的）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const arg = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const root = resolve(process.cwd())
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const installer = `Modulo_${version}_x64-setup.exe`
const sigPath = resolve(root, `src-tauri/target/release/bundle/nsis/${installer}.sig`)

if (!existsSync(sigPath)) {
  console.error(`✗ 找不到 ${sigPath}`)
  console.error('  先带签名环境变量重跑构建：TAURI_SIGNING_PRIVATE_KEY=<私钥路径或内容> npm run tauri:build')
  process.exit(1)
}

const signature = readFileSync(sigPath, 'utf8').trim()
const decoded = Buffer.from(signature, 'base64').toString('utf8')
const trustedLine = decoded.split('\n').find((l) => l.startsWith('trusted comment:')) ?? ''
const signedVersion = trustedLine
  .slice('trusted comment:'.length)
  .trimStart()
  .split('\t')
  .find((f) => f.startsWith('version:'))
  ?.slice('version:'.length)
  .trim()

if (!signedVersion) {
  console.error('✗ 签名里没有 version: 绑定 —— tauri.conf.json 开着 requireSignedVersion，这种包客户端会拒收')
  console.error('  多半是签名时没走 tauri build（手工 signer sign 默认不带版本）。升级 CLI 或确认构建走的是 npm run tauri:build')
  process.exit(1)
}
if (signedVersion !== version) {
  console.error(`✗ 签名绑的是 ${signedVersion}，而 package.json 是 ${version} —— 两处说的不是同一个版本`)
  process.exit(1)
}

const notesFile = arg('--notes-file')
const notes = notesFile ? readFileSync(resolve(root, notesFile), 'utf8') : ''
const url = arg('--url', `https://github.com/Levango7/Modulo/releases/download/v${version}/${installer}`)
const out = resolve(root, arg('--out', `src-tauri/target/release/bundle/nsis/latest.json`))

const manifest = {
  version,
  // 会被客户端读进设置页显示，截一刀别让整篇 changelog 全塞进去
  notes: notes.slice(0, 2000),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url },
  },
}

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`✓ 已写出 ${out}`)
console.log(JSON.stringify({ version: manifest.version, signedVersion, url, sigLen: signature.length }))
