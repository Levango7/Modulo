/**
 * 「注册面 == 调用点面」一致性门禁（F-11②）。
 *
 * ## 它防的是什么
 *
 * 桌面壳的 IPC 面由 `src-tauri/src/lib.rs` 的 `generate_handler![...]` 逐条登记。
 * webview 里的**任何**内容都能 invoke 面里的每一条命令 —— 包括被 XSS 改掉的内容。
 * 所以一条命令要是没有前端调用点，它就不是"功能"，而是"自己等着被触发的开关"：
 * 它做的事（落盘、发请求、截屏、读键）只由"被注册"这一件事授权，与用户界面再无关系。
 *
 * 这件事真发生过：Phase 3「后端先建」时，AI 十条、截图五条、`proc_list` 共 16 条
 * 命令随施工顺序先进了注册面，前端卡从未动工 —— 注册面空转了好几个版本，直到
 * F-11 把判据写成「要么有调用点、要么删除」（docs/design/FUNCTIONAL-SPEC.md）。
 * 注释维系同源没有任何机器保证，这个脚本把判据变成红的：
 *
 * - **注册了却没有调用点** → 红（接线，或者从 `generate_handler!` 撤注册 —— 撤注册
 *   不删代码：Rust 模块与单测保留，挂 `#[allow(dead_code)]` 等接线的 PR，回注册是一行）。
 * - **前端调用了却没注册** → 红（线上必报「找不到命令」，是死调用）。
 * - **E2E 桩实现了未注册的命令** → 红（桩在替不存在的 Rust 命令作答，测试结果无效）。
 *
 * ## 认法（刻意写在这里，省得后人猜）
 *
 * - 注册面：`generate_handler![...]` 块里每条路径的**末段**（`storage::read_doc` → `read_doc`）。
 *   块里的 `//` 注释先剥掉 —— 注释里举例的命令名不算注册（本脚本的注释自己就会提到
 *   命令名，不剥会把脚本自己绕进去）。
 * - 调用点：`src/` 下的 `invoke('x')` / `invoke<T>('x')` / `call<T>('x')`，**点号开头的不算**
 *   （`bridge.call('notify')` 是扩展卡的宿主桥，不是 Tauri IPC）。`tests/` 与桩不算调用点
 *   —— 测试调用的不是用户界面。
 * - 桩面：`tests/e2e/tauri-stub.js` 里的 `case 'x':`。
 *
 * 脚本只读文件，不改任何东西 —— 修漂移的正道是接线或撤注册，不是改这个脚本。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const rel = (p) => relative(root, p)

const failures = []
let checks = 0
function ok(name, cond, detail = '') {
  checks++
  if (cond) return
  failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
}

/** 剥块注释（非贪婪，容忍跨行）。**保留换行** —— 后面要报行号，注释整段塌掉会让行号错位。 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 剥行注释：只在**没有被引号包住**的区间里认 `//`（Rust/TS 的 `https://` 都在引号里）。 */
function stripLineComment(line) {
  let inS = false
  let inD = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      i++ // 跳过转义字符，引号状态不变
      continue
    }
    if (ch === "'" && !inD) inS = !inS
    else if (ch === '"' && !inS) inD = !inD
    else if (!inS && !inD && ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

// ── 1. 注册面：generate_handler! 的每条路径末段 ─────────────────────────────
const lib = stripBlockComments(read('src-tauri/src/lib.rs'))
const handler = /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/.exec(lib)
ok('能解析 generate_handler! 块', !!handler, 'lib.rs 里的 invoke_handler 块找不到或括号不配对')

const registered = new Set()
if (handler) {
  for (const line of handler[1].split('\n')) {
    const code = stripLineComment(line).trim()
    const m = /^([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)\s*(?:,|$)?/.exec(code)
    if (m) registered.add(m[1].split('::').pop())
  }
}
ok('注册面非空（≥ 30 条）', registered.size >= 30, `实际解析到 ${registered.size} 条`)
for (const canary of ['read_doc', 'write_doc', 'launch_target', 'webdav_probe', 'meeting_start']) {
  ok(`哨兵 ${canary} 在注册面`, registered.has(canary), '注册面解析可能坏了（lib.rs 改过 generate_handler! 的形状？）')
}

// ── 2. 调用点：src/ 下的 invoke/call，点号开头的不算 ────────────────────────
const CALL = /(?<![\w.])(?:invoke|call)(?:<[\s\S]*?>)?\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g
const callPoints = new Map() // name → ['src/…:行']
function walk(dir, out) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (ent === 'node_modules' || ent === 'dist') continue
      walk(p, out)
      continue
    }
    if (/\.(ts|vue|js)$/.test(ent)) out.push(p)
  }
}
const srcFiles = []
walk(join(root, 'src'), srcFiles)
for (const f of srcFiles) {
  const text = stripBlockComments(readFileSync(f, 'utf8'))
  const lines = text.split('\n')
  // 行号要对回原文：剥块注释不改变行数（跨行注释的行仍在，只是被掏空）
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineComment(lines[i])
    for (const m of code.matchAll(CALL)) {
      const name = m[1]
      if (!callPoints.has(name)) callPoints.set(name, [])
      callPoints.get(name).push(`${rel(f)}:${i + 1}`)
    }
  }
}
ok('调用点扫描扫到了 src/ 里的文件', srcFiles.length > 10, `实际 ${srcFiles.length} 个文件`)

// ── 3. E2E 桩面：case 'x': 必须都在注册面里 ─────────────────────────────────
const stub = read('tests/e2e/tauri-stub.js')
const stubCases = [...stub.matchAll(/case\s+['"]([a-z_][a-z0-9_]*)['"]:/g)].map((m) => m[1])
ok('桩面非空', stubCases.length > 0, 'tauri-stub.js 里一个 case 都没解析到')

// ── 4. 两个方向都要一致 ──────────────────────────────────────────────────────
const unwired = [...registered].filter((n) => !callPoints.has(n)).sort()
ok(
  '注册的命令都有前端调用点（F-11②）',
  unwired.length === 0,
  unwired.length
    ? `${unwired.length} 条注册了但没有调用点：\n${unwired.map((n) => `  - ${n}`).join('\n')}\n  正道二选一：给它们接上前端调用点，或从 generate_handler! 撤注册（撤注册不删代码，模块挂 #[allow(dead_code)] 等接线）`
    : '',
)

const deadCalls = [...callPoints.keys()].filter((n) => !registered.has(n)).sort()
ok(
  '前端调用的命令都已注册（死调用）',
  deadCalls.length === 0,
  deadCalls.length
    ? `调了没注册的命令（线上必报「找不到命令」）：\n${deadCalls.map((n) => `  - ${n}（${callPoints.get(n).join(', ')}）`).join('\n')}`
    : '',
)

const phantomStub = stubCases.filter((n) => !registered.has(n)).sort()
ok(
  '桩实现的命令都在注册面里',
  phantomStub.length === 0,
  phantomStub.length ? `桩在替不存在的 Rust 命令作答：${phantomStub.join(', ')}` : '',
)

// ── 汇报 ────────────────────────────────────────────────────────────────────
console.log(`命令面一致性：注册 ${registered.size} 条 / 调用点 ${callPoints.size} 种 / 桩 ${stubCases.length} 条`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} 项不一致：`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${checks} 项判据全绿（F-11②：注册面 == 调用点面）`)
