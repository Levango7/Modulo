#!/usr/bin/env node
/**
 * release-gate.mjs —— 发版门禁：**CI 没绿，不许发**。
 *
 * ## 为什么有这个东西
 * 2026-10-04 复核 Modulo 时实跑发现的事实（`Levango7/Modulo`）：
 *
 *   tag v0.4.0    CI: failure (10:00:12)     Release: 10:00:50   相差 38 秒
 *   tag v0.3.0    CI: success (05:10:08)     Release: 05:10:11   相差  3 秒
 *
 * 五次发版里唯一一次红灯的那次，是**运气**——前四次也都没等 CI，只是恰好都绿。
 * 真正的病根不是"人没看 CI"，是**发版链路与 CI 之间没有依赖关系**：
 * tag 一推、Release 一建就完事，CI 挂在旁边观察，对结果没有否决权。
 *
 * 这在流程文档里通常写成一句"发版前请确认 CI 通过"。**人手写的纪律撑不过一次赶时间。**
 * 所以把它变成一个必须退出非零的判据。
 *
 * ## 判定规则（按顺序，命中即退出非零）
 * 1. 取该 tag / sha 对应的 CI run（GitHub Actions API，含 tag push 触发的那些）
 * 2. **有 run 但还在跑 / 排队** → 失败（"还没出结论"不等于"通过"）
 * 3. **没有任何 run** → 失败（没跑过就不能发；也可能是 workflow 没监听 tag）
 * 4. 有 run 且 conclusion 不是 success → 失败，并逐个 job/step 打印失败位置
 *
 * ## 用法
 *   node release-gate.mjs --repo owner/name --tag v0.4.0
 *   node release-gate.mjs --repo owner/name --sha 9ef9304
 *   node release-gate.mjs --repo owner/name --tag v0.4.0 --allow-pending   # 演练用，别用在真发版
 *   npm run release:gate -- --tag v0.8.1     # 等价写法；CI 里 --repo 可省（读 GITHUB_REPOSITORY）
 *
 * 环境：GITHUB_TOKEN（可选；公开仓库不传也能查，有 token 才有 60 req/h → 5000 req/h）
 *
 * ## 接在哪（2026-10-12 入库时才真的接上）
 *
 * 入库前这个脚本只躺在会话目录里 —— 那是「**门禁脚本存在 ≠ 门禁在跑**」，等于没接进流程。
 * 现在它是 `ci.yml` 里 `release` job 的**第一步**（排在 `npm ci` 与出包之前）：
 * 不绿就整条发布链红掉，`npm publish` 根本跑不到（npm 同名同版本只能发一次，
 * 发错版本比发不出去更难收拾）。
 *
 * 放最前面的另一个理由是省 runner：出安装包要 30+ 分钟，不该让一次注定失败的发版占满它。
 *
 * ### 自指问题（不处理的话这道门会永远红）
 *
 * `release` job 由 **tag push** 触发，而 tag push 同样会触发一次本仓库的 CI workflow，
 * 那条 run 的 `head_sha` 就是这个 tag 指向的 commit —— **它自己此刻正在跑**。
 * 按第 2 条规则（还在跑 → 失败），它会判自己没绿，于是发版永远红。
 * 所以用 `GITHUB_RUN_ID` 把**当前这条 run 排除掉**，只看别人（分支 push / PR）跑出来的结论。
 *
 * ### 与「同一提交两条 run」的关系
 *
 * 本仓库一个 commit 会同时触发 `push` + `pull_request` 两条 run，规矩是**两条都绿才算过**。
 * 这里没有按事件类型挑挑拣拣，两条都会被纳入判定：任一条红、或任一条还在跑 → 失败。与规矩一致。
 */

const argv = process.argv.slice(2)
const arg = (k, def = null) => {
  const i = argv.indexOf('--' + k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const has = (k) => argv.includes('--' + k)

// `--repo` 在 GitHub Actions 里能自己取到，所以调用点可以省；手写就有漏写的一天。
// `--tag` / `--sha` **刻意不兜底**：CI 里的 `GITHUB_REF_NAME` 在分支推送时是分支名，
// 拿分支名当 tag 去查必然查不到，而按本门的规矩「查不到 = 不许发」—— 那会变成一条
// 永远红的门。所以它必须由调用方显式给，显式给错就红在明处。
const repo = arg('repo') || process.env.GITHUB_REPOSITORY || null
const tag = arg('tag')
const sha = arg('sha')
const allowPending = has('allow-pending')

if (!repo || (!tag && !sha)) {
  console.error('用法: node release-gate.mjs --repo owner/name (--tag v0.4.0 | --sha abc1234)')
  process.exit(2)
}

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'release-gate' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${res.statusText}`)
  return res.json()
}

async function resolveSha() {
  if (sha) return sha
  // annotated tag 的 ref.object.type 是 'tag'，得再解一层拿到 commit sha
  const ref = await api(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`)
  if (ref.object.type === 'commit') return ref.object.sha
  const inner = await api(`/repos/${repo}/git/tags/${ref.object.sha}`)
  return inner.object.sha
}

function line(sym, text) {
  console.log(`${sym} ${text}`)
}

let targetSha
try {
  targetSha = await resolveSha()
} catch (e) {
  line('✗', `解析 ${tag || sha} 失败：${e.message}`)
  process.exit(2)
}
line('·', `仓库 ${repo} · ${tag ? `tag ${tag}` : `sha ${sha}`}`)
line('·', `commit ${targetSha}`)

// 拉该 commit 的全部 workflow run（tag push 触发的 run 的 head_sha 就是这个 commit）
let runsRes
try {
  runsRes = await api(`/repos/${repo}/actions/runs?head_sha=${targetSha}&per_page=20`)
} catch (e) {
  line('✗', `查该 commit 的 CI run 失败：${e.message}`)
  line(' ', '拿不到结论就不许发 —— 这道门不认"大概是绿的"这种推断。')
  process.exit(2)
}

// 见头部「自指问题」：tag push 触发的这条 run 就是 release job 自己，此刻必然还在跑，
// 不排除它的话这道门会永远红。排除后只看别人跑出来的结论。
const selfRunId = process.env.GITHUB_RUN_ID || ''
const runs = (runsRes.workflow_runs || [])
  .filter((r) => r.name === 'CI' || r.name === 'Build')
  .filter((r) => !(selfRunId && String(r.id) === String(selfRunId)))

if (runs.length === 0) {
  line('✗', '该 commit 没有任何名为 CI/Build 的 workflow run。')
  line(' ', '两种可能：workflow 没监听 tag 推送，或者它压根没跑。两种都不该发版。')
  if (selfRunId) line(' ', `（已排除当前这条 run #${selfRunId} —— 它自己正在跑，不算结论。）`)
  process.exit(1)
}

const pending = runs.filter((r) => r.status !== 'completed')
const red = runs.filter((r) => r.status === 'completed' && r.conclusion !== 'success')

for (const r of runs) {
  const mark = r.status !== 'completed' ? '…' : r.conclusion === 'success' ? '✓' : '✗'
  line(mark, `${r.name} · ${r.event} · ${r.status} · ${r.conclusion ?? '—'} · ${r.html_url}`)
}

if (pending.length > 0) {
  if (!allowPending) {
    line('✗', `${pending.length} 条 CI 还在跑 —— "还没出结论"不等于"通过"。等它跑完再发。`)
    line(' ', '确认要放过这一次（演练用）就加 --allow-pending。')
    process.exit(1)
  }
  line('·', '--allow-pending：本次放过未完成的 CI（别把这行留在真发版流程里）')
}

if (red.length > 0) {
  line('✗', `${red.length} 条 CI 是红的 —— 不许发版。`)
  for (const r of red) {
    let jobs = []
    try {
      jobs = (await api(`/repos/${repo}/actions/runs/${r.id}/jobs`)).jobs || []
    } catch {
      /* 拿不到 job 细节不影响判定 */
    }
    for (const j of jobs) {
      if (j.conclusion === 'success') continue
      line(' ', `job ${j.name} → ${j.conclusion}`)
      for (const st of j.steps || []) if (st.conclusion === 'failure') line(' ', `  ✗ step: ${st.name}`)
    }
  }
  process.exit(1)
}

line('✓', 'CI 全绿，可以发版。')
process.exit(0)
