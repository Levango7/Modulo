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
// 三条判据（按严重程度）：
//   1. 陈旧认领：状态还是 `进行中` 且超过 24 小时没动 → 警告。逼人回来关掉，
//      否则「进行中」永远有行，下一个人永远不敢动这个仓库。
//   2. 未登记改动：本次提交动了「产品面」文件（src/ packages/ src-tauri/ tests/ scripts/）
//      但既没碰 AGENT-COORD.md、也不在板上任何一行声明的范围里 → 失败。
//   3. 锚点缺失：本地存在但远端没有的分支，若其提交不在 master 上 → 警告。
//      这条是给 `anchor/<x>` 规矩兜底的：锚点 tag 只在本地，一样会丢。
//      **2026-10-09 补**：锚点在**本地与远端都在**时不再报警 —— 此前不管在不在都催人重打，
//      于是每轮都多出一条永远消不掉的「请打锚点」。判据应是"远端有没有那一份"。
//
// 第 2 条会误伤：单agent 的小修（改个 typo）本来就不必登记。给逃生阀：
// 提交信息或 PR 标题里写 `no-coord-gate` 就跳过，理由要自己写清楚。
// 宁可让人显式写一句理由，也不要一条永远绿的检查。

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = resolve(root, 'docs/AGENT-COORD.md');
const STALE_HOURS = 24;
/** 状态位写在「状态」列开头，解释跟在后面 —— 判「进行中」只看这一小段（理由见判据 1 处注释） */
const STATUS_HEAD_CHARS = 10;

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

/** 产品面：动了这些就算"在改这个项目"，而不是"改文档/改配置" */
const PRODUCT = /^(src\/|packages\/[^/]+\/src\/|src-tauri\/src\/|tests\/|scripts\/)/;

const errors = [];
const warns = [];

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
if (!bypass) {
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
if (existsSync(BOARD)) {
  const board = readFileSync(BOARD, 'utf8');
  const now = Date.now();
  for (const line of board.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
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

    // 时间形如 `10-03 23:45`（今年，按最近的过去推断年份）
    const m = /^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(time || '');
    if (!m) continue;
    const [, mo, d, hh, mm] = m.map(Number);
    const then = new Date(now);
    then.setMonth(mo - 1, d);
    then.setHours(hh, mm, 0, 0);
    if (then > now) then.setFullYear(then.getFullYear() - 1); // 跨年
    const hours = (now - then.getTime()) / 3_600_000;
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
if (!bypass) {
  let changed = [];
  let messages = '';
  // 浅克隆下 HEAD~1 / origin/master 可能不存在 —— 拿不到就跳过这条判据，不猜
  for (const range of [
    process.env.COORD_BASE && `${process.env.COORD_BASE}...HEAD`,
    ci ? 'origin/master...HEAD' : null,
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

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log('协调板登记门禁');
console.log(`  陈旧认领阈值：${STALE_HOURS} 小时`);
if (bypass) console.log('  已按 --bypass / no-coord-gate 跳过判据 1-3');

for (const w of warns) console.log(`\n⚠ 警告\n  · ${w}`);
for (const e of errors) console.log(`\n✗ 失败\n  · ${e}`);

if (errors.length) {
  console.log(`\n判据未通过：${errors.length} 项失败、${warns.length} 项警告`);
  process.exit(1);
}
console.log(`\n判据通过：${warns.length} 项警告${warns.length ? '（不阻塞）' : ''}`);