#!/usr/bin/env node
// 协调板登记门禁
//
// 为什么要有这道门：2026-10-08 一天内三次差点永久丢失工作 —— agent 用
// `git reset --hard` 抹掉提交又删掉分支（14 文件 516 行，三个提交从未进过 master），
// 靠 reflog 侥幸捞回；另一次 719 行的分支只在本地。当时板上 `进行中` 一栏是空的，
// 别人无从判断那批改动是"在制品"还是"已提交残留"，只能靠翻进程命令行猜。
//
// 「动文件前先登记」写在 AGENT-COORD.md 里已经一天，但它是纸面约定，机器不查。
// 这道门把它变成会红的检查。
//
// 四条判据（按严重程度）：
//   1. 陈旧认领：状态还是 `进行中` 且超过 24 小时没动 → 警告。逼人回来关掉，
//      否则「进行中」永远有行，下一个人永远不敢动这个仓库。
//   2. 未登记改动：本次提交动了「产品面」文件（src/ packages/ src-tauri/ tests/ scripts/）
//      但既没碰 AGENT-COORD.md、也不在板上任何一行声明的范围里 → 失败。
//      **看的是「本分支相对 master 的全部提交」**（`origin/master...HEAD`），
//      不是「最后一个提交」—— 只看最后一笔会让本机与 CI 口径分叉（2026-10-17 修，见该处注释）。
//   3. 锚点缺失：本地存在但远端没有的分支，若其提交不在 master 上 → 警告。
//      这条是给 `anchor/<x>` 规矩兜底的：锚点 tag 只在本地，一样会丢。
//      **2026-10-09 补**：锚点在**本地与远端都在**时不再报警 —— 此前不管在不在都催人重打，
//      于是每轮都多出一条永远消不掉的「请打锚点」。判据应是"远端有没有那一份"。
//   4. **临时脚本进了版本库**：被 git 跟踪的 `tmp-*` → 失败（2026-10-10 加）。
//      判据是"在索引里"，不是"磁盘上有"；且**不受逃生阀影响**，理由见判据 4 处注释。
//   5. **机器资源撞车**（2026-10-15 加）：两条都在有效期内的「进行中」认领了同一条
//      机器资源 → 失败；把**钉死在配置里、不能各用各的**那条资源登记成「编号」可并行 → 失败。
//      抓的是 git 管不到的那一半：判据 2 的「会改的文件」列串行化了**文件**，而端口、
//      `%APPDATA%`、`HKCU` 键、全局热键、Release/npm 这些**跨 worktree 共享同一台机器**。
//      不受逃生阀影响（同上一条的理由：那是两个人的既成事实，不是"这次要不要登记"）。
//      详见文件末尾判据 5 处的注释 —— 陈旧降级、实占核对的三态、以及为什么缺表要报警。
//
// 第 2 条会误伤：单agent 的小修（改个 typo）本来就不必登记。给逃生阀：
// 提交信息或 PR 标题里写 `no-coord-gate` 就跳过，理由要自己写清楚。
// 宁可让人显式写一句理由，也不要一条永远绿的检查。
//
// 跑法：`node scripts/coord-gate.mjs`（全部判据）；`--resources-only` 只跑判据 5，
// 便于人先自查资源撞没撞、也便于测试起子进程时不必带上 git 那几条的噪声。

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 板子路径可换：判据 5 的测试要喂夹具，而夹具不能写进 `docs/`（那是会被别人读到的真板子） */
const BOARD = resolve(root, process.env.COORD_BOARD ?? 'docs/AGENT-COORD.md');
const STALE_HOURS = 24;
/** 状态位写在「状态」列开头，解释跟在后面 —— 判「进行中」只看这一小段（理由见判据 1 处注释） */
const STATUS_HEAD_CHARS = 10;
/** 时间能冻住：陈旧与撞车都按「认领挂了几小时」判，测试不能依赖跑它的机器几点钟 */
const NOW = process.env.COORD_NOW ? Date.parse(process.env.COORD_NOW) : Date.now();

// stderr 收进管道：下面大量用 try/catch 探测「这个 ref 存不存在」，
// `git rev-parse --verify` 失败时本来就会往 stderr 吐 fatal: Needed a single revision，
// 直接漏到输出里像是出了错。
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const ci = !!process.env.CI;
const bypass = process.argv.includes('--bypass') || /no-coord-gate/.test(process.env.COMMIT_MESSAGE || '');
/** 只跑判据 5：让人开工前先自查资源撞没撞，也让测试起子进程时不带上 git 那几条的噪声 */
const ONLY_RES = process.argv.includes('--resources-only');

/** 产品面：动了这些就算"在改这个项目"，而不是"改文档/改配置" */
const PRODUCT = /^(src\/|packages\/[^/]+\/src\/|src-tauri\/src\/|tests\/|scripts\/)/;

const errors = [];
const warns = [];
/** 判据 5 的现查播报：既不是警告也不是失败，只是「这台机器此刻看到什么」 */
const notes = [];

/**
 * 把一行 Markdown 表格切成单元格 —— **只认未转义的竖线**。
 *
 * 为什么不能直接 `line.split('|')`：单元格里可以写转义竖线 `\|`（渲染出来是 `|`，
 * 不是列分隔），天真切分会把它当成一列，于是**门读到的表和人看到的表不是同一张**。
 * 2026-10-26 实证：`docs/AGENT-COORD.md` 有 7 条老行的单元格里含未转义/已转义混用的
 * 竖线（如 L312 的 `run\|effect\|wait`），天真切分把「会改的文件」那一列读成 `effect`、
 * 把「状态」读成「请勿动」那一列 —— 判据 1 的陈旧告警与判据 2 的文件范围都是从这
 * 几个列号取的，列号一歪，这两条判据就在看错的地方做判断。
 *
 * 返回形状与 `split('|')` **一致**（首个 `|` 前是空串、末尾 `|` 后也是空串），
 * 所以调用处「列号 = 显示列号 + 1」的旧约定不变。单元格内容不还原 `\|` —— 门只拿它
 * 做子串比对，还原了反而会让「这一格写着什么」和板上原文对不上。
 */
const splitRow = (line) => line.split(/(?<!\\)\|/).map((c) => c.trim());

/**
 * 认领时间（`MM-DD HH:mm`）挂了几小时；形状不对返回 null —— **不猜**。
 *
 * 跨年与时区那一段是从判据 1 原样搬出来的。老写法见到 `then > now` 就扣一年，于是
 * **2026-10-10 在 CI 上真报过一次「进行中已挂 8752 小时」** —— 那条认领是 6 分钟前登记的：
 * 板上写的是本地时间（UTC+8），而 runner 跑 UTC，8 小时差被扣成了 8752 小时。
 * 判法是「扣一年后**更接近现在**才扣」，半年为界 —— 正常认领不会跨这么久。
 *
 * 搬成函数是为了让判据 5 复用**同一条**陈旧口径。两处各写一遍迟早分叉，
 * 而这一整个 session 在修的就是「两侧判据分叉」那一类病（`watch.ts` 与 `net.rs` 那次）。
 */
const claimAgeHours = (time, now = NOW) => {
  const m = /^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m) return null;
  const [, mo, d, hh, mm] = m.map(Number);
  const then = new Date(now);
  then.setMonth(mo - 1, d);
  then.setHours(hh, mm, 0, 0);
  if (then > now) {
    const back = new Date(then);
    back.setFullYear(back.getFullYear() - 1);
    if (Math.abs(now - back.getTime()) < Math.abs(now - then.getTime())) {
      then.setFullYear(then.getFullYear() - 1);
    }
  }
  return (now - then.getTime()) / 3_600_000;
};

/** ref 存不存在：用 `--quiet` + 退出码，避免 fatal 漏到 stderr */
const revExists = (ref) => {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
};

/**
 * 远端 tag 清单：查一次缓存起来（一次 `ls-remote`，后续都走缓存）。
 *
 * 返回 `undefined` = 还没查过；`null` = 查不到（离线 / 没配远端）；`Set` = 查到了。
 * 三个状态必须分开：查不到时既不能把已受保护的分支报成未受保护，也不能假装它有 ——
 * 不猜，如实说（与判据 2「拿不到就不猜」同一条原则）。
 */
let remoteTags;
const remoteHasTag = (name) => {
  if (remoteTags === undefined) {
    try {
      remoteTags = new Set(
        git('ls-remote', '--tags', 'origin')
          .split('\n')
          .filter(Boolean)
          // `ls-remote --tags` 对附注 tag 会多给一行 `<sha>\trefs/tags/<name>^{}`
          .map((l) => (l.split('\t')[1] ?? '').replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')),
      );
    } catch {
      remoteTags = null;
    }
  }
  return remoteTags === null ? null : remoteTags.has(name);
};

// ── 判据 3：只在本地、没推远端的分支 ──────────────────────────────────────
//
// 这里刻意**不用**「分支与 master 的 diff 是否为空」来判价值：master 一直在往前走，
// 任何旧分支跟它比都有差异（今天实测`release/0.7.1` 差 1761 行，内容其实早入库了），
// 拿这个当判据只会满屏假阳性 —— 等于把刚写进 AGENT-COORD.md 的那个坑又踩一遍。
//
// 只盯真正有风险的那一类：**提交只活在本地对象库**。已推远端的分支本身就是锚点，
// 它有没有合不该由这道门来管（那是 PR 的事）。
if (!bypass && !ONLY_RES) {
  let locals = [];
  try {
    locals = git('branch', '--format=%(refname:short)').split('\n').filter(Boolean);
  } catch { /* 不是 git 仓库就跳过这条 */ }

  for (const b of locals) {
    if (b === 'master' || b.startsWith('gh-pages')) continue;
    let pushed = false;
    try { git('rev-parse', '--verify', `origin/${b}`); pushed = true; } catch { /* 远端没有 */ }
    if (pushed) continue;

    // 本地独有分支：用「领先 master 几个提交」是安全的 —— 它没被合并过（否则早推远端了）
    let ahead = 0;
    try { ahead = Number(git('rev-list', '--count', `origin/master..${b}`) || '0'); } catch { continue; }
    if (ahead === 0) continue;

    const head = git('rev-parse', '--short', b);
    const anchor = `anchor/${b.replace(/\//g, '-')}`;

    // 先看锚点。这条判据的立意是"锚点 tag 只在本地，一样会丢"，所以真正的判据是
    // **远端有没有那一份**，不是"有没有打过锚点"。
    //
    // 2026-10-09 修：此前不管锚点在不在都照样报警，于是 `docs/coord-registration-rule`
    // 每轮都报一条「打锚点：`anchor/docs-coord-registration-rule`」—— 而那个 tag 双端都在。
    // **永远消不掉的警告比没有警告更糟**：警告一多，真信号就被淹了。
    if (revExists(`refs/tags/${anchor}`)) {
      const onRemote = remoteHasTag(anchor);
      if (onRemote === true) continue; // 双端都有 → 受保护，不报警
      if (onRemote === false) {
        warns.push(
          `本地分支 \`${b}\`（${head}）有锚点 \`${anchor}\`，但**远端没有** ——\n` +
            `      它和"没打锚点"是同一种风险：只活在本地对象库。推上去：git push origin ${anchor}`,
        );
        continue;
      }
      // onRemote === null：读不到远端 —— 不猜，如实说
      warns.push(
        `本地分支 \`${b}\`（${head}）有锚点 \`${anchor}\`，但读不到远端 tag 清单，\n` +
          `      无法确认远端有没有 —— 手动补推：git push origin ${anchor}`,
      );
      continue;
    }

    warns.push(
      `本地分支 \`${b}\`（${head}）领先 master ${ahead} 个提交，**远端没有**，也没打锚点 ——\n` +
        `      git gc 一跑就可能永久没了。打锚点：git tag ${anchor} ${head}`,
    );
  }
}

// ── 判据 1：陈旧认领 ──────────────────────────────────────────────────────
if (!ONLY_RES && existsSync(BOARD)) {
  const board = readFileSync(BOARD, 'utf8');
  const now = NOW;
  for (const line of board.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = splitRow(line);
    // | 时间 | Agent | 在做什么 | 会改的文件 | 请勿动 | 状态 |
    if (cols.length < 7) continue;
    // 注意 cols[0] 是首个 `|` 之前的空串，所以列号整体 +1。
    // （这里曾用解构 `const [time, agent, , files, , status] = cols` 写错过一格：
    //   time 拿到的是空串、status 拿到的是「请勿动」列，于是判据静默失效。）
    const time = cols[1];
    const agent = cols[2];
    const files = cols[4];
    const status = cols[6];
    // 只认"状态位写在开头"，不认"在后面的解释里提到这三个字"。
    //
    // 2026-10-09：把一条陈旧认领改成「⏹ 陈旧关闭（……不再占着「进行中」）」之后，
    // 门照样报 —— 判据是按原文子串匹配的，把这三个字写进解释里会让它自己再报一遍，
    // 而且从输出里看不出为什么。状态位都在开头（前面最多有个 ⚠️ / ✅ 之类的标记），
    // 取开头一小段判断就够，也容得下「⚠️ 进行中（…）」「仍在进行中」这类写法。
    if (!status.slice(0, STATUS_HEAD_CHARS).includes('进行中')) continue;

    // 时间形如 `10-03 23:45`（今年，按最近的过去推断年份；跨年与时区那段的理由见 `claimAgeHours`）
    const hours = claimAgeHours(time, now);
    if (hours === null) continue;
    if (hours > STALE_HOURS) {
      warns.push(
        `板上「进行中」已挂 ${Math.floor(hours)} 小时没动（${time} · ${agent}）：\n` +
          `      会改的文件：${(files || '').slice(0, 80)}\n` +
          `      那个 agent 早就没了 —— 去把它改成 ✅ done，别让"进行中"永远有行。`,
      );
    }
  }
}

// ── 判据 2：本次提交动了产品面但没登记 ────────────────────────────────────
if (!bypass && !ONLY_RES) {
  let changed = [];
  let messages = '';
  // 浅克隆下 HEAD~1 / origin/master 可能不存在 —— 拿不到就跳过这条判据，不猜
  //
  // **2026-10-17 修一致性问题**：`origin/master...HEAD` 此前挂了 `ci ? … : null`，
  // 于是**本机跑这道门时它被跳过、直接落到 `HEAD~1...HEAD`** —— 只看**最后一个提交**。
  // 本机一个分支连写两三笔时，只要**最后那笔**碰了板子，前面几笔真改了产品面也不会红；
  // 而同一棵树推到 CI 却会红（CI 上这个 range 是启用的，`COORD_BASE` 之外就靠它）。
  // **两侧口径不一致的代价是"本机绿、CI 红"**，这正是本 session 在修的同一类病。
  // 现在两侧同用 `origin/master...HEAD`（`A...B` = merge-base(A,B) 到 B，
  // 只含**自己这一侧**的提交，不把 master 的改动算进来）。
  // 本机若没有 `origin/master`（裸仓 / 未 fetch）→ `git diff` 抛错 → 照旧退到 `HEAD~1...HEAD`。
  for (const range of [
    process.env.COORD_BASE && `${process.env.COORD_BASE}...HEAD`,
    'origin/master...HEAD',
    'HEAD~1...HEAD',
  ].filter(Boolean)) {
    try {
      changed = git('diff', '--name-only', range).split('\n').filter(Boolean);
      if (!changed.length) continue;
      // 逃生阀要读**提交信息本身**，不能读环境变量 —— CI 里拿不到调用者的 COMMIT_MESSAGE，
      // 那样这道门在 CI 上就成了没有出口的死门。
      try { messages = git('log', '--format=%B', range); } catch { messages = ''; }
      break;
    } catch { /* 试下一个范围 */ }
  }

  // 逃生阀必须是**独占一行、且带理由**的形式：`no-coord-gate: <为什么不必登记>`。
  // 刻意不匹配裸关键词 —— 写 commit message 时只要"提到"这两个字就会放行，
  // 而解释这道门怎么用的时候必然会提到它。那样这道门就成了摆设。
  if (/^no-coord-gate:\s*\S/m.test(messages)) {
    console.log('  提交信息里有 `no-coord-gate: 理由`，判据 2 跳过');
  } else {
    const touchedProduct = changed.filter((f) => PRODUCT.test(f));
    const touchedBoard = changed.includes('docs/AGENT-COORD.md');
    if (touchedProduct.length && !touchedBoard) {
      errors.push(
        `本次提交动了 ${touchedProduct.length} 个产品面文件，但没碰 docs/AGENT-COORD.md：\n` +
          touchedProduct.slice(0, 8).map((f) => `      ${f}`).join('\n') +
          `\n  按 AGENT-COORD.md 的规矩，动文件前要在板上登记一行（含会改哪些文件），` +
          `\n  完成后改成 ✅ done 并带上 PR 号。` +
          `\n  确实不必登记（单 agent 小修）？在提交信息里写 no-coord-gate 并说明理由。`,
      );
    } else if (!changed.length) {
      warns.push('拿不到本次提交的改动清单（浅克隆？），判据 2 跳过 —— 不猜。');
    }
  }
}

// ── 判据 4：临时脚本进了版本库 ──────────────────────────────────────────
//
// 约定（AGENT-COORD.md「约定」一节）：临时脚本统一 `tmp-*.mjs`，**跑完即删，不 commit**。
// 它破过一次，而且是我破的：一个别的会话留在磁盘上的**未跟踪** `tmp-shot.ps1`，
// 被一句 `git add -A` 带进了提交 `b4cc3d9`，之后用了两笔提交才挪出去（PR #35 做的还是空改动 ——
// `git rm --cached` 之后又把同一个路径写进了 `git add`，一删一加互相抵消；#36 才真删）。
//
// 判据是**被 git 跟踪**，不是"磁盘上有"：
//   · 磁盘上未跟踪的 `tmp-*` 是别人正在用的探针（写这条时主工作树里就有四个），
//     报它等于满屏假阳性 —— 而假阳性一多，真信号就没人看了；
//   · 一旦进了索引，它就落在**每一个人的 checkout** 里，而且 `git add -A` 会一路带着它走。
// 所以读 `git ls-files`（索引），不读磁盘。
//
// 这条**刻意不进 `if (!bypass)`**：`no-coord-gate` 逃生阀的语义是"这次改动不必登记"，
// 而"临时脚本已经在版本库里"是既成事实，与登记与否无关。让它被逃生阀放行 = 又一道死门。
if (!ONLY_RES) {
  let tracked = [];
  try {
    tracked = git('ls-files').split('\n').filter(Boolean);
  } catch { /* 不是 git 仓库，这条无从谈起 */ }

  const trackedTmp = tracked.filter((f) => f.split('/').pop().startsWith('tmp-'));
  if (trackedTmp.length) {
    errors.push(
      `有 ${trackedTmp.length} 个临时脚本被 git 跟踪了：\n` +
        trackedTmp.slice(0, 10).map((f) => `      ${f}`).join('\n') +
        `\n  约定是「临时脚本 \`tmp-*\`，跑完即删，不 commit」—— 进了版本库它就在每个人的 checkout 里，` +
        `\n  而且 \`git add -A\` 会一路带着它走（**这个坑已经踩过一次**）。` +
        `\n  挪出索引、**磁盘文件原样保留**：\n` +
        trackedTmp.map((f) => `      git rm --cached ${f}`).join('\n') +
        `\n  注意别把那些路径再写进任何 \`git add\` —— 一删一加会互相抵消，看着像做了、其实没有。`,
    );
  }
}

// ── 判据 5：机器资源撞车 ──────────────────────────────────────────────────
//
// 判据 2 用「会改的文件」列串行化了**文件**，但有一整类共享状态 git 管不到：
// 两个 worktree 各有各的 `src/`，却共用**同一台机器**上的端口、`%APPDATA%`、`HKCU` 键、
// 全局热键，以及 Release / npm / tag 这种**发出去收不回来**的东西。
//
// 动机是 2026-10-15 的三条实测：① `HKCU\Software\Modulo\Modulo` 的默认值记着某次
// `/D=<临时目录>` 试验装留下的路径，**卸载器不清它**，于是后一次「默认安装」被直接拽进
// `%TEMP%`，连开始菜单快捷方式一起指进临时目录 —— 谁都没改过文件，撞的纯粹是注册表；
// ② `:9223` 被另一个应用（CatPawAI，PID 21624）占着，探针连过去读到了**别人的**页面，
// 判据「能连上就算我的」当场假阳；③ 驱动真二进制跑 UI 的那一轮把用户自己的皮肤与待办
// 改写了 —— 因为它写的是 `%APPDATA%\app.modulo`，不是某个 worktree 里的副本。
//
// 四种形状，红与「只是让人看见」分得很清：
//   · 两条**都在有效期内**的「进行中」认领同一条资源 → **红**。唯一真正阻塞的形状：
//     两个人正要去占同一个东西，谁先到谁就把对方的现场改了。
//   · 把**钉死资源**登记成「编号」（以为能各用各的）→ **红**。`port:1430` 被三处钉死：
//     `vite.config.ts` 的 server/preview、`tauri.conf.json` 的 `devUrl`、以及 devCSP 里那条
//     `ws://localhost:1430`。换端口不是加个参数，是改安全策略 —— 让人这样登记等于埋一条必红的路。
//   · 认领挂过 `STALE_HOURS` → **警告**并**退出撞车比对**。不这样处理的话，一条没人关的
//     行会永久锁住这台机器上的那条资源；判据 1 早就写过这个教训（「进行中永远有行，
//     下一个人永远不敢动这个仓库」）。永远消不掉的阻塞比没有阻塞更糟。
//   · 资源表整张缺失 → **警告**。缺表时这条判据一行都不跑，绿得和「没人认领」**一模一样**，
//     而「门禁脚本存在 ≠ 门禁在跑」这个坑在 `#26` 身上真发生过一次（脚本入库了，CI 从来没调它）。
//
// 和判据 4 一样**不进 `if (!bypass)`**：`no-coord-gate` 的语义是"这次改动不必登记"，
// 而"两个人认领了同一条端口"是既成事实，与登记与否无关。让它被逃生阀放行 = 又一道死门。
const RESOURCE_HEADING = /^#{2,3}[^\n]*机器资源认领[^\n]*$/m;
/** 资源 id 必须长这样：`种类:名字`。自由文本没法判「是不是同一条」，所以不合规矩的行单独报警 */
const RESOURCE_ID = /^(port|hotkey|dir|appdata|registry|irreversible):(\S.*)$/i;
/** 钉死在配置里、不能靠换号并行的那几条 —— 出处见上面第二条 */
const PINNED = ['port:1430', 'registry:hkcu\\software\\modulo', 'appdata:app.modulo'];
/** 认领表 6 列：| 资源 | 独占性 | 认领人 | 时间 | 状态 | 备注 |（`cols[0]` 是行首 `|` 前的空串） */
const RESOURCE_COLS = 8;

/**
 * 现查「这个端口此刻被谁听着」。**只在 Windows 本机跑**：
 * Linux/CI 上要么没权限读 owning PID、要么这台机器上根本没有那些进程 ——
 * 那种情况如实报「无从核对」，绝不报「空闲」（把无从核对说成空闲，就是假绿）。
 *
 * 端口号必须先过 `/^\d{1,5}$/` 才拼进 PowerShell 命令：这张表是**别的会话写的文本**，
 * 门不许把板上的内容当代码执行。
 */
const ownerOfPorts = (ports) => {
  const out = new Map();
  if (!ports.length) return out;
  // 这道守卫**必须在任何分支之前**：板子是别的会话写的文本，门不许把它当代码拼进命令。
  // 放在后面（比如放在 PowerShell 那一段里）的话，走注入缝或 CI 分支时这条守卫等于没写。
  const safe = ports.filter((p) => /^\d{1,5}$/.test(String(p)));
  if (safe.length !== ports.length) {
    warns.push('有认领项的端口号不是纯数字，那几条没做实占核对 —— 板上的文本绝不当代码拼进命令。');
  }
  if (!safe.length) return out;
  const injected = process.env.COORD_PORT_OWNER;
  if (injected) {
    // 测试与离线核对的缝：喂一张 {"1430":{"pid":1,"name":"node","cmd":"…"}}，值为 null 表示「没人听」。
    // 有了它，这条判据的比对逻辑能在任何机器上被测到，而不是只有作者那台 Windows 上才算得出。
    let map = {};
    try {
      map = JSON.parse(injected);
    } catch {
      warns.push('`COORD_PORT_OWNER` 不是合法 JSON，实占核对整条跳过 —— 不猜。');
      return out;
    }
    for (const p of safe) out.set(p, map[String(p)] ?? null);
    return out;
  }
  if (ci || process.platform !== 'win32') {
    notes.push(`实占核对跳过（CI=${ci ? '是' : '否'} · 平台=${process.platform}）—— 端口占用没在这台机器上核对过。`);
    return out;
  }
  // 一次 PowerShell 查完所有端口：每起一个 powershell.exe 实测要 1.3–2.0 秒（含 CLR 启动），
  // 逐端口起进程会把这道门拖成几十秒 —— 判据 5 的注释里那条「采样太慢」的教训是同一笔账。
  const ps =
    `$o=@();foreach($p in ${safe.map((x) => Number(x)).join(',')}){` +
    '$c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue;' +
    'if(-not $c){$o+="$p|free|"};' +
    '$c|ForEach-Object{$i=$_.OwningProcess;' +
    '$w=Get-CimInstance Win32_Process -Filter "ProcessId=$i" -ErrorAction SilentlyContinue;' +
    '$n=(Get-Process -Id $i -ErrorAction SilentlyContinue).ProcessName;' +
    '$l=if($w){($w.CommandLine -replace "[|`\r`\n]"," ").Substring(0,[Math]::Min(120,$w.CommandLine.Length))}else{""};' +
    '$o+="$p|$i|$n|$l"}};$o'
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [p, a, b, c] = line.split('|');
      if (!/^\d+$/.test(p)) continue;
      const port = String(Number(p));
      if (a === 'free') out.set(port, null);
      else out.set(port, { pid: a, name: b || '', cmd: c || '' });
    }
  } catch {
    notes.push('实占核对没跑成（PowerShell 起不来或超时）—— 端口占用没核对，别据此判「空闲」。');
  }
  return out;
};

{
  if (!existsSync(BOARD)) {
    warns.push(`找不到协调板 ${BOARD} —— 资源撞车这条**一行都没跑**，它的绿不代表没人撞车。`);
  } else {
    const boardText = readFileSync(BOARD, 'utf8');
    const head = RESOURCE_HEADING.exec(boardText);
    if (!head) {
      warns.push(
        '板上没有「机器资源认领」这张表 —— 判据 5 一行都没跑。\n' +
          '      它的绿和「没人认领资源」是同一种输出，而这两种意思完全不同（见判据 5 注释第四条）。',
      );
    } else {
      const rest = boardText.slice(head.index + head[0].length);
      const nextHead = /^#{2,3}\s/m.exec(rest);
      const section = nextHead ? rest.slice(0, nextHead.index) : rest;
      const claims = [];
      for (const line of section.split('\n')) {
        if (!line.startsWith('|')) continue;
        const cols = splitRow(line);
        if (cols.length < RESOURCE_COLS) continue;
        const resRaw = cols[1];
        if (!resRaw || resRaw === '资源' || /^:?-{2,}:?$/.test(resRaw)) continue; // 表头与分隔行
        // 剥掉 markdown 代码串的引号：这张表的行文风格是** everywhere** 用反引号包标识符
        // （「作业面登记」整张都是），门要是按字面匹配，第一条就把每一行都判成「不合规矩」，
        // 于是所有人都得为了过门去改写法 —— 那种门会被绕过，而不是被遵守。
        const res = resRaw.replace(/^`+|`+$/g, '').trim();
        // 「独占性」只看开头那个词，和判据 1 只看状态位开头同一套路子：
        // `**独占**（钉死）`、`独占（跨仓）` 都是**同一档**，装饰与补语不该让整行失效。
        // 但只剥装饰，不猜意思 —— `可共享`、`都行` 这类仍然报警，那一列决定撞车怎么判。
        const kindHead = cols[2].replace(/[*`]/g, '').trim();
        const kind = /^(独占|编号)/.exec(kindHead)?.[1] ?? kindHead;
        const who = cols[3];
        const time = cols[4];
        const status = cols[5];
        const doing = status.slice(0, STATUS_HEAD_CHARS).includes('进行中');
        const idMatch = RESOURCE_ID.exec(res);
        if (!idMatch) {
          warns.push(
            `资源表这行的「资源」列不合规矩：\`${res}\`（${who || '无认领人'}）——\n` +
              `      必须是 \`port:|hotkey:|dir:|appdata:|registry:|irreversible:名字\`，\n` +
              `      否则没法判「是不是同一条资源」，这一条就从比对里消失了（这正是假绿的一种）。`,
          );
          continue;
        }
        if (!/^(独占|编号)$/.test(kind)) {
          warns.push(
            `资源表 \`${res}\` 的「独占性」列写的是 \`${kind}\`，只认「独占」或「编号」——\n` +
              `      这一列决定撞车怎么判，写错了整行等于没登记。`,
          );
          continue;
        }
        const key = res.toLowerCase().replace(/\s+/g, '');
        const hours = claimAgeHours(time);
        claims.push({ res, kind, who, time, status, doing, key, hours });
      }

      const timed = claims.filter((c) => c.doing && c.hours === null);
      for (const c of timed) {
        warns.push(
          `资源表 \`${c.res}\` 的「时间」列 \`${c.time}\` 不是 \`MM-DD HH:mm\` ——\n` +
            `      没法算它挂了多久，陈旧降级用不上。这条**仍然按新鲜参与撞车比对**：\n` +
            `      反过来做（读不出时间就当陈旧、退出比对）等于给「想绕过撞车」留了一条写脏日期的路。`,
        );
      }
      const freshOf = (c) => c.doing && (c.hours === null || c.hours <= STALE_HOURS);
      const staleOf = (c) => c.doing && c.hours !== null && c.hours > STALE_HOURS;

      for (const c of claims.filter(staleOf)) {
        warns.push(
          `资源表里 \`${c.res}\` 的认领（${c.time} · ${c.who}）已挂 ${Math.floor(c.hours)} 小时 ——\n` +
            `      它不再参与撞车比对（免得一条没人关的行永久锁住这台机器上的资源），\n` +
            `      但请把它改成「已释放」，别人看不出那条端口/键到底还归不归你。`,
        );
      }

      // 撞车：同一资源上 ≥2 条新鲜认领
      const byKey = new Map();
      for (const c of claims.filter(freshOf)) {
        const arr = byKey.get(c.key) ?? [];
        arr.push(c);
        byKey.set(c.key, arr);
      }
      for (const [, arr] of byKey) {
        if (arr.length < 2) continue;
        errors.push(
          `${arr.length} 条「进行中」认领了同一条机器资源 \`${arr[0].res}\`：\n` +
            arr.map((c) => `      ${c.time} · ${c.who} · 独占性=${c.kind} · ${c.status}`).join('\n') +
            `\n  机器上那一条只有一个 —— 谁先到谁就把对方的现场改了：端口被抢是连到别人的窗口，\n` +
            `      \`%APPDATA%\` 被抢是改用户自己的数据，\`HKCU\` 被抢会污染后一次安装，\n` +
            `      Release / npm 抢了收不回来。\n` +
            `  要么错峰，要么把「状态」改成「已释放」再动。`,
        );
      }

      // 钉死资源被登记成「编号」
      for (const c of claims.filter((x) => x.doing && PINNED.includes(x.key) && x.kind === '编号')) {
        errors.push(
          `\`${c.res}\`（${c.who}）登记成了「编号」，但它**钉死在配置里**，换号并行不了：\n` +
            `      \`port:1430\` 同时写在 vite server/preview、tauri.conf.json 的 devUrl 与 devCSP 的 ws:// 白名单里，\n` +
            `      换端口要动的是安全策略，不是启动参数。这一条要么改登记成「独占」，要么整条别占。`,
        );
      }

      const ports = [...new Set(claims.filter(freshOf).map((c) => c.key).filter((k) => k.startsWith('port:')).map((k) => k.slice(5)))];
      const owners = ownerOfPorts(ports);
      for (const [port, owner] of owners) {
        const claimers = claims.filter((c) => freshOf(c) && c.key === `port:${port}`);
        const who = claimers.map((c) => c.who).join(' / ') || '（没人认领）';
        // 只分三种，且**偏向报警**：判成「本仓现场」而其实是别人的程序，比反过来危险得多
        // —— 前者会让下一个人继续以为那条端口是安全的。判据是命令行里看得见 Modulo 的路径，
        // 不是「端口能连上」；后者今晚就在 :9223 上假阳过一次（连上去读到的是 CatPawAI 的页面）。
        const mine = owner && /[/\\]modulo[/\\]/i.test(owner.cmd || '');
        if (owner === null) {
          notes.push(`:${port} 现在没人听（认领人：${who}）—— 起了没绑上，或者那轮已经收了。`);
        } else if (mine) {
          notes.push(`:${port} 命令行里看得到 Modulo 的路径，像是本仓现场（PID ${owner.pid} · ${owner.name}）· 认领人：${who}`);
        } else {
          warns.push(
            `:${port} 被**外部进程**占着（PID ${owner.pid} · ${owner.name || '?'} · ${(owner.cmd || '命令行读不到').slice(0, 80)}…），\n` +
              `      而认领它的是「${who}」—— 探针/E2E 连上去会读到**别人的**页面，还看不出来。\n` +
              `      换个号（探针走 PROBE_PORT=9333，E2E 走 MODULO_URL）或先把那条认领改成「已释放」。\n` +
              `      2026-10-15 实测：:9223 被 CatPawAI（PID 21624）占着，探针自检那条就是这么抓出来的。`,
          );
        }
      }
    }
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log(ONLY_RES ? '协调板登记门禁 —— 只跑判据 5（机器资源撞车）' : '协调板登记门禁');
console.log(`  陈旧认领阈值：${STALE_HOURS} 小时 · 板子：${BOARD}`);
if (bypass) console.log('  已按 --bypass / no-coord-gate 跳过判据 1-3（**判据 4、5 不受逃生阀影响**，理由见各自注释）');

for (const n of notes) console.log(`\n· 现查\n  ${n}`);
for (const w of warns) console.log(`\n⚠ 警告\n  · ${w}`);
for (const e of errors) console.log(`\n✗ 失败\n  · ${e}`);

if (errors.length) {
  console.log(`\n判据未通过：${errors.length} 项失败、${warns.length} 项警告`);
  process.exit(1);
}
console.log(`\n判据通过：${warns.length} 项警告${warns.length ? '（不阻塞）' : ''}${notes.length ? ` · ${notes.length} 条现查` : ''}`);