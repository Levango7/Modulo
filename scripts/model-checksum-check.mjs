/**
 * 模型校验和的「出处台账」门禁（R-01 的分级版）。
 *
 * ## 它防的是什么
 *
 * 桌面壳运行时只会做一件事：下载 → 比 sha256 → 不符就丢弃拒装。它**不知道**那个
 * sha256 是从哪来的。这句话此前全靠 `asr_models.rs` 头注释里「取自官方 checksum.txt」
 * 撑着 —— 而注释撑不住两件事：
 *
 * 1. **上游会换包**。GitHub release 的资产是可以被重新上传的。今天对得上的 digest，
 *    明年可能悄悄变成另一个值，运行时那边表现为「校验失败、已丢弃」，用户重装三次
 *    也不会知道是上游动了。
 * 2. **有些制品压根没有官方校验源**。`speaker-segmentation-models` 这个 release
 *    2026-11-04 复测仍然 404（没有 `checksum.txt`），diarization 需要的 pyannote
 *    分包只能走自证基线（TOFU）。把这种值混进「官方基线」里不加标记，就是在假装
 *    一个不存在的信任根。
 *
 * ## 分级
 *
 * - `official-checksum-txt`：上游 release 的 `checksum.txt` 里有这一行，digest 照抄。
 * - `self-attested`：上游没有 `checksum.txt`，digest 由我们自己**两次以上独立传输**实测
 *   同值，并逐次记下 `at` / `machine` / `tool` / `bytes`。它是**可推翻**的：
 *   上游哪天补出 `checksum.txt`，以它为准。
 *
 * `self_attested_budget` 是例外包数的上限：想再加一个自证制品，必须先改这个数并重新拍板，
 * 而不是悄悄多一条记录。今天的答案是 **1**（只有 pyannote 分包）。
 *
 * ## 两种模式
 *
 * - **默认（CI 跑这个）**：不联网。查台账自身的诚实度 + 与代码/文档的接线一致性。
 * - `--fetch`：额外把每个 release 的 `checksum.txt` 拉下来，按上面「分级」逐条比对，
 *   输出 `DRIFT  <file>  <state>` 机读行。上游换包 / 补出官方校验和 / 撤掉校验和，
 *   都在这里红。这条腿**不进 CI**（CI 不该把结论挂在别人的网络上），要手动或在
 *   复核时跑：`node scripts/model-checksum-check.mjs --fetch`。
 *
 * 测试缝：`MODELS_CK_LEDGER` 换台账路径、`MODELS_CK_FIXTURE_DIR` 用本地目录冒充
 * 「release 的 checksum.txt」（目录里没有该 release 的 `.txt` = 该 release 没有校验文件）。
 * 有了这两条，判据里每一种形状都能离线复现，不用真下载 216MB，也不用等上游哪天配合。
 *
 * 退出码档位与桌面探针一致：0 全绿 / 1 有断言红 / 2 压根没跑起来（台账读不到或坏 JSON）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
const SCHEMA = 'modulo.model-checksums.v1'
const TRUST_OFFICIAL = 'official-checksum-txt'
const TRUST_SELF = 'self-attested'
const HEX64 = /^[0-9a-f]{64}$/

const failures = []
let checks = 0
/** 漂移腿的机读结论，`--fetch` 才有内容 */
const drift = []

function ok(name, cond, detail = '') {
  checks++
  if (cond) return
  failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
}

function failEarly(msg) {
  console.error(`[model-checksum-check] ${msg}`)
  process.exit(2)
}

// ── 1. 台账读得到才算开始跑（读不到是「没跑」，不是「通过」）────────────────
const ledgerPath = process.env.MODELS_CK_LEDGER ?? join(root, 'model-checksums.json')
if (!existsSync(ledgerPath)) failEarly(`台账不存在：${ledgerPath}`)
let ledger
try {
  ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
} catch (e) {
  failEarly(`台账不是合法 JSON：${ledgerPath}（${e.message}）`)
}
const artifacts = Array.isArray(ledger.artifacts) ? ledger.artifacts : null
if (!artifacts) failEarly('台账里没有 artifacts 数组')

ok('台账 schema 是认领的那一版', ledger.schema === SCHEMA, `实际 ${JSON.stringify(ledger.schema)}`)

// ── 2. 逐条内部诚实 ────────────────────────────────────────────────────────
const ids = artifacts.map((a) => a.id)
const files = artifacts.map((a) => a.file)
ok('每条记录有 id 且不重名', ids.every(Boolean) && new Set(ids).size === ids.length)
ok(
  '每条记录有文件名且不重名',
  files.every(Boolean) && new Set(files).size === files.length,
  '重名意味着两条记录在说同一个制品，digest 谁说了算没人知道',
)
ok('wired 是真布尔', artifacts.every((a) => typeof a.wired === 'boolean'))
ok('release 都非空', artifacts.every((a) => typeof a.release === 'string' && a.release.length > 0))
ok(
  'digest 都是 64 位小写 hex',
  artifacts.every((a) => typeof a.sha256 === 'string' && HEX64.test(a.sha256)),
  '截断值 / 大写 / 空串在这里红 —— 运行时拿它当唯一判据，坏一个字符就是"永远校验失败"',
)

const official = artifacts.filter((a) => a.trust === TRUST_OFFICIAL)
const selfAttested = artifacts.filter((a) => a.trust === TRUST_SELF)
ok(
  'trust 只有已认领的两档',
  official.length + selfAttested.length === artifacts.length,
  `出现第三档：${artifacts.filter((a) => a.trust !== TRUST_OFFICIAL && a.trust !== TRUST_SELF).map((a) => JSON.stringify(a.trust))}`,
)

for (const a of official) {
  ok(
    `${a.file} 的官方行逐字对得上（文件名 + 制表符 + digest）`,
    a.official_line === `${a.file}\t${a.sha256}`,
    '上游 checksum.txt 里 campplus 有三行，"看着像"的那行是另一款文件 —— 必须按完整文件名对行',
  )
  ok(`${a.file} 的 checksum_url 指向它声明的 release`, a.checksum_url === `${RELEASE_BASE}/${a.release}/checksum.txt`)
  ok(`${a.file} 的 source_url 指向它声明的 release`, a.source_url === `${RELEASE_BASE}/${a.release}/${a.file}`)
  ok(
    `${a.file} 记了核过的日期`,
    typeof a.checked_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.checked_at),
    `实际 ${JSON.stringify(a.checked_at)}`,
  )
}

for (const a of selfAttested) {
  const m = Array.isArray(a.measurements) ? a.measurements : []
  ok(
    `${a.file} 有 ≥2 次独立实测`,
    m.length >= 2,
    `只有 ${m.length} 次 —— TOFU 的下限是两次独立传输同值，一次等于"我看见的就是真的"`,
  )
  ok(
    `${a.file} 每次实测都记全了 at/machine/tool/bytes/sha256`,
    m.every(
      (x) =>
        typeof x?.at === 'string' &&
        typeof x?.machine === 'string' &&
        typeof x?.tool === 'string' &&
        Number.isInteger(x?.bytes) &&
        typeof x?.sha256 === 'string',
    ),
    '少任何一栏，这条基线就没法被别人复算',
  )
  ok(
    `${a.file} 各次实测的 digest 全等于基线`,
    m.length > 0 && m.every((x) => x.sha256 === a.sha256),
    '实测值与基线不同 ⇒ 包在动，这就不是一条基线而是两次不同的包',
  )
  ok(
    `${a.file} 各次实测的字节数全一致`,
    m.length > 0 && new Set(m.map((x) => x.bytes)).size === 1,
  )
  ok(`${a.file} 用了 ≥2 种工具复算`, Array.isArray(a.cross_checked_by) && a.cross_checked_by.length >= 2)
  ok(`${a.file} 写清了为什么只能自证`, typeof a.why_self_attested === 'string' && a.why_self_attested.length > 0)
  ok(`${a.file} 写清了可推翻条件`, typeof a.overturnable === 'string' && a.overturnable.length > 0)
  ok(`${a.file} 不该有官方行`, a.official_line === undefined, '自证记录里冒出 official_line ⇒ 上游已经发布，该改判')
}

// 例外包数是**棘轮**：加一条自证记录必须先动 self_attested_budget 并重新拍板。
ok(
  `自证例外条数等于声明的预算（现 ${ledger.self_attested_budget}）`,
  selfAttested.length === ledger.self_attested_budget,
  `台账里实际 ${selfAttested.length} 条 / 预算 ${JSON.stringify(ledger.self_attested_budget)} —— 新增自证制品不许悄悄进`,
)

// ── 3. 与代码的接线 ────────────────────────────────────────────────────────
const modelsRs = read('src-tauri/src/meeting/asr_models.rs')
const trustRs = read('src-tauri/src/meeting/model_trust.rs')
const modRs = read('src-tauri/src/meeting/mod.rs')
const asrRs = read('src-tauri/src/meeting/asr.rs')
const errorsRs = read('src-tauri/src/meeting/asr_errors.rs')

// 这四条按**行**判，且**剥掉注释行**：把那一行注释掉仍然含同一个子串，
// 纯 `includes` 的子串判据会被"注释掉的代码"骗成假绿
// —— M2 变异实测到了：`// pub mod model_trust;` 当时照样通过。
const lineHas = (text, needle) =>
  text.split(/\r?\n/).some((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && l.includes(needle))

ok(
  'model_trust.rs 编译期内嵌了这份台账',
  lineHas(trustRs, 'include_str!("../../../model-checksums.json")'),
  '不内嵌 ⇒ 台账与 Rust 常量的对账用例根本没在读这份文件',
)
ok('model_trust 模块登记进了 meeting/mod.rs', lineHas(modRs, 'pub mod model_trust;'))
for (const a of artifacts) {
  const inModels = modelsRs.includes(a.file)
  const inTrust = trustRs.includes(a.file)
  ok(
    `${a.file} 在 Rust 侧有对应的 ModelSpec`,
    a.wired ? inModels : inTrust,
    a.wired ? '已接线的制品应当在 asr_models.rs' : '未接线的制品应当在 model_trust.rs',
  )
}
ok(
  '下载清单仍是三件（首次运行体积没被未接线的制品顶大）',
  /pub fn all\(\) -> \[ModelSpec; 3\]/.test(modelsRs),
  'all() 的件数变了就要重测下载量并回写文档的体积红线',
)
ok('分级有运行消费者：报错文案带得出基线出处', lineHas(asrRs, 'spec.trust.label()'))
ok('校验失败文案真的把出处打出来', lineHas(errorsRs, '基线出处：{trust}'))

// ── 4. 与文档的接线（例外必须点名，不能只写在代码注释里）────────────────────
const arch = read('docs/ARCHITECTURE.md')
ok('ARCHITECTURE.md 点名了这份台账', arch.includes('model-checksums.json'))
for (const a of selfAttested) {
  ok(`ARCHITECTURE.md 点名了自证例外 ${a.file}`, arch.includes(a.file))
}

// ── 5. 漂移腿（默认不跑；--fetch 或给了 fixture 才跑）───────────────────────
const fixtureDir = process.env.MODELS_CK_FIXTURE_DIR ?? ''
const doFetch = process.argv.includes('--fetch') || fixtureDir !== ''

/** 取某个 release 的 checksum.txt 文本；拿不到校验文件返回 null（不是"空文件"） */
async function checksumOf(release) {
  if (fixtureDir !== '') {
    // fixture 缝也留"取不到"那一支：目录里放一个 `<release>.ERR` 就等于那次请求失败了，
    // 这样"网络挂了"与"上游没这个文件"两种形状都能离线钉住（不然前者只能靠真网络运气）。
    const errPath = join(fixtureDir, `${release}.ERR`)
    if (existsSync(errPath)) return `__ERR__ ${readFileSync(errPath, 'utf8').trim() || 'fetch failed'}`
    const p = join(fixtureDir, `${release}.txt`)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
  try {
    const resp = await fetch(`${RELEASE_BASE}/${release}/checksum.txt`, {
      redirect: 'follow',
    })
    if (resp.status === 404) return null
    if (!resp.ok) return `__ERR__ HTTP ${resp.status}`
    return await resp.text()
  } catch (e) {
    return `__ERR__ ${e.message}`
  }
}

/** checksum.txt 里按**完整文件名**取那一行的 digest；没有这行返回 undefined */
function listedSha(text, file) {
  for (const line of text.split(/\r?\n/)) {
    const [name, sha] = line.split('\t')
    if (name === file) return sha?.trim()
  }
  return undefined
}

if (doFetch) {
  const releases = [...new Set(artifacts.map((a) => a.release))]
  for (const release of releases) {
    const text = await checksumOf(release)
    if (typeof text === 'string' && text.startsWith('__ERR__')) {
      const why = text.replace('__ERR__', '').trim()
      // 逐件打一条 UNREACHABLE：这一轮**试过**，不能一条结论都不打（0 行会被读成"没这个 release"）
      for (const a of artifacts.filter((x) => x.release === release)) drift.push(`${a.file}  UNREACHABLE`)
      ok(
        `release ${release} 的 checksum.txt 取回来了`,
        false,
        `${why} —— 取不到不等于没漂移，所以这条判据是红的而不是静默跳过。` +
          '本机 node 直连 GitHub 会抖（本轮实测：同一批文件 curl 全通、node fetch 四条全挂）；' +
          '改用 curl 落盘各 release 的 checksum.txt 再把 MODELS_CK_FIXTURE_DIR 指过去，走的是同一条判据。',
      )
      continue
    }
    for (const a of artifacts.filter((x) => x.release === release)) {
      const upstream = text === null ? undefined : listedSha(text, a.file)
      if (a.trust === TRUST_SELF) {
        if (text === null) {
          drift.push(`${a.file}  STILL-NONE`)
          ok(`自证基线 ${a.file}：上游仍无 checksum.txt，分级仍成立`, true)
        } else if (upstream === undefined) {
          drift.push(`${a.file}  NOT-LISTED`)
          ok(`自证基线 ${a.file}：官方文件里没有这行`, true)
        } else if (upstream === a.sha256) {
          drift.push(`${a.file}  PROMOTABLE`)
          ok(
            `自证基线 ${a.file}：上游已发布官方行且与基线一致`,
            false,
            `该改判 ${TRUST_OFFICIAL}（并重新核 self_attested_budget）—— 保留自证标签会让例外条数虚高`,
          )
        } else {
          drift.push(`${a.file}  OVERTURNED`)
          ok(
            `自证基线 ${a.file}：与上游官方行不符`,
            false,
            `基线 ${a.sha256}／上游 ${upstream} —— 上游重新打过包或我们抄错。重新实测、更新 measurements，并在文档留痕。`,
          )
        }
      } else {
        if (text === null) {
          drift.push(`${a.file}  GONE`)
          ok(
            `官方基线 ${a.file}：release ${release} 的 checksum.txt 还在`,
            false,
            '404 ⇒ 官方分级不再成立，这一条要么改判要么换制品，不许照旧',
          )
        } else if (upstream === undefined) {
          drift.push(`${a.file}  NOT-LISTED`)
          ok(
            `官方基线 ${a.file}：checksum.txt 里有这一行`,
            false,
            '上游把该资产从 release 里摘了或改了名 ⇒ 官方出处不成立，先核实再动 digest',
          )
        } else {
          drift.push(`${a.file}  ${upstream === a.sha256 ? 'MATCH' : 'DRIFT'}`)
          ok(
            `官方基线 ${a.file}：上游值与台账一致`,
            upstream === a.sha256,
            upstream === a.sha256 ? '' : `台账 ${a.sha256}／上游 ${upstream} —— 上游换包了。运行时会拒装新包，先重新实测再改基线，别直接抄上游新值。`,
          )
        }
      }
    }
  }
}

// ── 结论 ───────────────────────────────────────────────────────────────────
for (const d of drift) console.log(`DRIFT  ${d}`)
if (!doFetch) console.log('DRIFT-SKIP  漂移腿没跑（默认离线）。复核请跑 node scripts/model-checksum-check.mjs --fetch')

if (failures.length > 0) {
  console.error(`[model-checksum-check] ${failures.length}/${checks} 项断言失败：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  `[model-checksum-check] ${checks}/${checks} 项断言通过：${artifacts.length} 条制品基线（官方 ${official.length}／自证 ${selfAttested.length}）+ ${drift.length ? `漂移腿 ${drift.length} 条结论` : '离线未跑漂移腿'}`,
)
