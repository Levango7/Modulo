/**
 * 生成 / 校验 `release-manifest.json` —— 每个发布点的**出处台账**。
 *
 * ## 为什么要有这个文件
 *
 * 三道门各管一段，互相不能替代：
 *
 * 1. `v*` tag 的 ruleset（禁删、禁改指）—— 挡住「tag 被强推改指」。
 * 2. release 的 `immutable`（仓库级开关）—— 挡住「资产被换掉」。
 * 3. **本文件 + 这道校验** —— 挡住「上面两道门被人拆掉或改弱了」。
 *
 * 第 3 条不是凑数：本项目已经**真的发生过**第 1 类事故 —— 一条 tag ruleset 被创建后
 * 因为判断错误又删掉，中间一段时间 `v*` tag 是完全敞开的，而仓库里没有任何东西会报警。
 * 一道能被悄悄拆掉的门，等于没有门。这道校验存在的意义就是**让门自己也被门管**。
 *
 * 它还钉住了「tag 指向的 commit」这件事：ruleset 只保证「不许改」，不保证「改之前是对的」。
 * 没有台账的话，一个从一开始就指错的 tag 永远查不出来。
 *
 * ## 两种用法
 *
 * ```
 * node scripts/release-manifest.mjs --update    # 发版后跑，重写台账（唯一会改文件的方式）
 * node scripts/release-manifest.mjs             # 校验，不改任何东西（CI 跑这个）
 * ```
 *
 * `--update` 刻意做成**唯一**的写入口：台账被谁改、什么时候改，都要能一眼看出来是发版流程
 * 干的，而不是某次手滑顺手编辑的。
 *
 * ## 为什么校验要读 GitHub API
 *
 * 因为要验的是「远端现在是什么样」，而台账只是「我们以为它是什么样」。
 * 只比对本地的两份文件，那是拿记录验记录，等于没验。
 *
 * 需要 `GITHUB_TOKEN`（CI 里自动有；本机跑校验时设一个 PAT 也行）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = process.env.GH_REPO ?? 'Levango7/Modulo'
const MANIFEST = resolve(process.cwd(), 'release-manifest.json')
const TAG_RE = /^v\d+\.\d+\.\d+$/
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

/** 远端真实状态：tag → commit、release 是否不可变、每个资产的 sha256 */
const collect = async () => {
  const releases = await api(`/repos/${REPO}/releases?per_page=100`)
  const out = {}
  for (const r of releases) {
    if (!TAG_RE.test(r.tag_name)) continue
    // 解引用到 commit：annotated tag 的 object.sha 指向 tag 对象，不是 commit
    let commit = r.target_commitish
    const ref = await api(`/repos/${REPO}/git/ref/tags/${r.tag_name}`).catch(() => null)
    if (ref?.object) {
      if (ref.object.type === 'commit') commit = ref.object.sha
      else if (ref.object.type === 'tag') {
        const t = await api(`/repos/${REPO}/git/tags/${ref.object.sha}`).catch(() => null)
        commit = t?.object?.sha ?? commit
      }
    }
    const assets = {}
    for (const a of r.assets ?? []) {
      // digest 形如 "sha256:..."；没有它就说明 GitHub 侧没给，这本身就是一条要报的账
      assets[a.name] = a.digest ?? null
    }
    out[r.tag_name] = { commit, immutable: r.immutable === true, draft: r.draft === true, assets }
  }
  return out
}

/**
 * 列出 ruleset。**必须逐个再 GET 一次**，而且**读不到与不存在要分开报**。
 *
 * 两个坑，都踩过：
 *
 * 1. `GET /repos/{o}/{r}/rulesets`（列表）返回的每一项里 `conditions` 与 `rules`
 *    都是**空对象** —— 字段存在但没内容，看起来像「这条规则没有 conditions，也没有 rules」。
 *    按它判断会得出「没有 tag ruleset」的**误报**，而实际上门好好地在那儿。
 *    `GET /repos/{o}/{r}/rulesets/{id}`（单个）才给完整内容。
 *
 * 2. **「读不到」绝不能当成「不存在」。** 权限不足、API 变更、网络抖动都会让请求失败；
 *    把它当成「门没了」就是**诬告** —— 而这道校验的价值恰恰在于它平时是绿的，
 *    乱报一次就会让人开始忽略它，那道门也就白设了。所以读不到时单列一条，并提示 token 权限。
 */
const rulesets = async () => {
  let list
  try {
    list = await api(`/repos/${REPO}/rulesets`)
  } catch (e) {
    return { readable: false, reason: String(e.message ?? e), sets: [] }
  }
  const full = await Promise.all(
    list.map(async (s) => {
      try {
        return await api(`/repos/${REPO}/rulesets/${s.id}`)
      } catch {
        return s
      }
    }),
  )
  return { readable: true, reason: '', sets: full }
}

if (process.argv.includes('--update')) {
  const live = await collect()
  // **必须保留 legacyUnsignedTags**：这个字段是人写的（签名机制启用前发布的那些 tag），
  // --update 只该刷新可以从远端读出来的部分。第一版忘了保留，结果更新一次台账就把白名单
  // 整个抹掉，下一次校验立刻把 8 个历史 tag 全报成「未签名」—— 自己给自己造了一条假红。
  const prev = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, 'utf8')).legacyUnsignedTags
    : undefined
  const out = { updatedAt: new Date().toISOString(), releases: live }
  if (prev) out.legacyUnsignedTags = prev
  writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n')
  console.log(`已重写 ${Object.keys(live).length} 条发布记录 -> release-manifest.json${prev ? `（保留 ${prev.length} 条白名单）` : ''}`)
} else {
  const bad = []
  const note = (m) => bad.push(m)

  // 没 token 就**立刻停**：继续跑只会把「远端读不到」误报成「每个 release 都不见了」，
  // 一堆假错误会把真正的信号淹掉 —— 而这道校验最不能出的错就是自己假装通过或乱喊。
  if (!TOKEN) {
    console.error('发布点门禁不通过：\n')
    console.error('  · 没有 GITHUB_TOKEN / GH_TOKEN —— 读不到远端状态，这道校验等于空跑（拒绝假装通过）')
    process.exit(1)
  }

  // 远端整体读不到（仓库名错、token 无权、网络断）时，也要给一句人话而不是一段栈。
  // 这里的判据是「读不到」而不是「读到了但不对」—— 两者的处置完全不同。
  let live
  try {
    live = await collect()
  } catch (e) {
    console.error('发布点门禁不通过：\n')
    console.error(`  · 读不到远端 release：${String(e.message ?? e).slice(0, 200)}`)
    console.error('    （检查 GH_REPO 拼写与 token 权限；这不是「门没了」，是「查不到」）')
    process.exit(1)
  }

  // ---- 第 1 条：tag ruleset 还在不在、还是不是 active、规则有没有被削 ----
  const { readable, reason, sets } = await rulesets()
  if (!readable) {
    // 单列，且**不说「门没了」** —— 那是诬告。读者要能分清「查不到」与「确实没有」。
    note(`读不到 rulesets（${reason}）。可能是 token 权限不足，需要能读仓库设置。`)
  } else {
    const tagRule = sets.find(
      (s) => s.target === 'tag' && (s.conditions?.ref_name?.include ?? []).some((p) => /refs\/tags\/v\*$/.test(p)),
    )
    if (!tagRule) {
      note('**没有** 覆盖 refs/tags/v* 的 tag ruleset —— tag 可被强推改指与删除')
    } else {
      if (tagRule.enforcement !== 'active') note(`tag ruleset 的 enforcement 是 ${tagRule.enforcement}，不是 active`)
      const types = (tagRule.rules ?? []).map((r) => r.type)
      if (!types.includes('non_fast_forward')) note('tag ruleset 里没有 non_fast_forward —— tag 可被强推改指')
      if (!types.includes('deletion')) note('tag ruleset 里没有 deletion —— tag 可被删')
    }
  }

  // ---- 第 2 条：发布资产是否还锁着、digest 是否齐全 ----
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

  for (const [tag, rec] of Object.entries(manifest.releases ?? {})) {
    const now = live[tag]
    if (!now) { note(`${tag}：台账里有，但远端没有这个 release`); continue }

    if (now.commit !== rec.commit) {
      note(`${tag}：**tag 指向的 commit 变了**\n    台账 ${rec.commit}\n    现在 ${now.commit}`)
    }
    if (rec.assets) {
      for (const [name, digest] of Object.entries(rec.assets)) {
        if (!digest) { note(`${tag} / ${name}：台账里 digest 是空的，这条资产从来没被记过字节`); continue }
        const cur = now.assets[name]
        if (cur === undefined) note(`${tag} / ${name}：资产不见了`)
        else if (cur !== digest) note(`${tag} / ${name}：**字节变了**\n    台账 ${digest}\n    现在 ${cur}`)
      }
      for (const name of Object.keys(now.assets)) {
        if (!(name in rec.assets)) note(`${tag} / ${name}：台账里没有这个资产（有人加了？）`)
      }
    }
    // 台账更新之后发布的 release 必须是 immutable —— 那是「换不掉」的唯一保证
    if (!rec.immutable && now.immutable) {
      note(`${tag}：现在已不可变，但台账记的是「可改」—— 跑一次 --update 把台账对齐`)
    }
  }

  // ---- 第 3 条：台账覆盖了所有远端 release 吗 ----
  for (const tag of Object.keys(live)) {
    if (!(tag in (manifest.releases ?? {}))) note(`${tag}：远端有这个 release，但台账里没有 —— 跑一次 --update`)
  }

  // ---- 第 4 条：v* tag 是否已签名 ----
  // 用本地 git verify-tag，不依赖 GitHub API 的 verification 字段
  // （那个字段在公钥未注册时返回 null，无法区分签名/未签名）。
  // 公钥存 release-signing-key.pub（公钥本来就是公开的），CI 里配好 git 再逐个验。
  // legacyUnsignedTags 是「已知未签名」的白名单 —— 只列签名机制启用之前发布的那些。
  // 不在白名单里的 v* tag 必须已签名，否则这道门禁就是摆设。
  const { spawnSync } = await import('node:child_process')
  const pubKey = resolve(process.cwd(), 'release-signing-key.pub')
  const legacy = new Set(manifest.legacyUnsignedTags ?? [])
  const git = (args) => spawnSync('git', args, { encoding: 'utf8' })

// 让 git 用仓库里那份公钥验签（allowedSignersFile 的格式："<email> <pubkey>"）。
// 写在系统临时目录，**不写进仓库** —— 第一版写在仓库根目录，于是每次校验都留下一个
// `tmp-allowed-signers` untracked 文件：它会被误 add 进提交，也会让 git status 一直不干净。
const signersFile = join(tmpdir(), 'modulo-allowed-signers')
const pubRaw = readFileSync(pubKey, 'utf8').trim()
writeFileSync(signersFile, `* ${pubRaw}\n`)
  git(['config', 'gpg.format', 'ssh'])
  git(['config', 'gpg.ssh.allowedSignersFile', signersFile])

  const allTags = git(['tag', '-l', 'v*']).stdout.trim().split(/\r?\n/).filter(Boolean)
  const unsigned = []
  for (const t of allTags) {
    if (legacy.has(t)) continue
    const r = git(['verify-tag', t])
    if (r.status !== 0) unsigned.push(t)
  }
  if (unsigned.length) {
    note(`这些 v* tag 未签名：${unsigned.join(', ')}\n    发版时必须用 git tag -s（签名密钥见 release-signing-key.pub 的说明）`)
  }
  // 白名单里的旧 tag 只提示，不判失败 —— 它们发布于签名机制启用之前
  const legacyList = allTags.filter((t) => legacy.has(t))
  if (legacyList.length) {
    console.log(`  提示：${legacyList.length} 个旧 tag 未签名（签名机制启用前发布，已列入白名单）：${legacyList.join(', ')}`)
  }

  if (bad.length) {
    console.error('发布点门禁不通过：\n')
    for (const m of bad) console.error(`  · ${m}`)
    console.error(`\n共 ${bad.length} 条。若确认是有意改动（比如刚发完版），跑：node scripts/release-manifest.mjs --update`)
    process.exit(1)
  }
  console.log(`发布点门禁通过：${Object.keys(manifest.releases ?? {}).length} 个发布点，tag/资产字节/immutability 都对得上`)
}
