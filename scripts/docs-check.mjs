/**
 * 核对文档里"当前规模"那几行数字。
 *
 * ## 为什么不扫全文
 * 早先那版想用正则扫 README 与 ARCHITECTURE 的全部句子，结果立刻有两个假阳性来源：
 * ARCHITECTURE §10 的实现状态表里记着 **历史**规模（87/87、93/93、41.0 kB），
 * §3.5 记着 A1/A2 的历史实验数字 —— 那些不是"当前"，它们本来就是历史记录。
 * 一条会误报的检查等于没有检查：人只会学会忽略它。
 *
 * 所以改成**显式认领**：只有行尾带 `<!-- facts -->` 的行才参与核对。
 * 想让某一行被机器守住，就在行尾加这个标记；历史数字不加，就永远不会被比。
 * 这条取舍本身也是项目的一条老教训的同款：判据要能证伪，不能靠人记。
 *
 * ## 它守住什么
 * 单测条数与文件数、E2E 条数、受测层分支覆盖率、构建产物体积、**版本号同源**。
 * 全部实跑，不接受任何"文档里写的"作为输入。
 * 其中覆盖率是**下限承诺**（`≥N%`）：同一份代码在不同 V8 / 平台间会差出 0.01 个百分点以上，
 * 等值核对会把环境抖动报成文档漂移（实测 CI 两次跑出 93.74 / 93.75，本机与 CI 的逐文件
 * 分支计数也不同）；其余维度的数字则要求逐字一致。
 *
 * 用法：
 *   node scripts/docs-check.mjs          # 核对，有对不上就 exit 1
 *   node scripts/docs-check.mjs --print  # 只打印事实，不核对
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const MARK = '<!-- facts -->';
const TARGETS = ['README.md', 'docs/ARCHITECTURE.md'];

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** 单测与属性测试：条数 + 测试**文件**数。走 vitest 自己的 json reporter，不数 `it(` 那种会漏的写法 */
function unitFacts() {
  const out = 'node_modules/.tmp/docs-check-vitest.json';
  sh(`npx vitest run --reporter=json --outputFile=${out}`);
  const raw = JSON.parse(readFileSync(resolve(root, out), 'utf8'));
  // 注意别用 numTotalTestSuites —— 那是 describe 块 + 文件的合计，与文档里"27 个文件"口径不同。
  // 文档写的是**文件数**，所以直接数 tests/ 下的 .test.ts。
  let files = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.test.ts')) files++;
    }
  };
  if (existsSync(resolve(root, 'tests'))) walk(resolve(root, 'tests'));
  return { tests: raw.numTotalTests, files };
}

/**
 * E2E 条数：数 `tests/e2e/*.spec.ts` 里的 `it(` 家族。
 * 之所以不用 vitest 跑一遍 —— 那要真起浏览器（40 秒+），而这里的职责是"数字对不对"，
 * 不是"测试过不过"；后者归 `npm run verify`。
 * 写法是 `\bit(\.<chain>)*\(`：`it.skipIf(skip)(` 这种带参数链的也要算进去。
 */
function e2eFacts() {
  const dir = resolve(root, 'tests/e2e');
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    n += (src.match(/\bit(?:\.[A-Za-z]+)*\s*\(/g) ?? []).length;
  }
  return n;
}

/** 分支覆盖率：读 v8 的 json-summary（`npm run cover:engine` 的产物）。
 *  注意这个数字是**受测层整体**（`src/engine/**` 全量 + vitest.config.ts 里 GATED_VUE_MODULES 那几个 vue 纯模块），
 *  不是"引擎单独"的覆盖率 —— 门禁 90% 卡的是这个合数。要拆开看请自己按路径聚合 coverage-summary.json。 */
function coverageFact() {
  const p = resolve(root, 'coverage/coverage-summary.json');
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const v = raw.total?.branches?.pct;
  return typeof v === 'number' ? v : null;
}

/** 构建体积：量 dist/assets 下真实产物的字节数（kB = /1000，与文档里现有写法一致） */
function bundleFacts() {
  const dir = resolve(root, 'dist/assets');
  if (!existsSync(dir)) return null;
  let js = 0;
  let css = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (!statSync(p).isFile()) continue;
    if (f.endsWith('.js')) js += statSync(p).size;
    else if (f.endsWith('.css')) css += statSync(p).size;
  }
  return { jsKB: +(js / 1000).toFixed(2), cssKB: +(css / 1000).toFixed(2) };
}

const facts = { ...unitFacts(), e2e: e2eFacts(), coverage: coverageFact(), ...(bundleFacts() ?? {}) };

/**
 * 版本号同源：版本现在散在 7 个文件里（抽 `@modulo/engine` 包之后又多一处），
 * 人手同步必然漂 —— 历史上就漂过一次（CHANGELOG 0.1.0：「版本号三处不一致」）。
 * 这里逐个读出来比，加一处只需往 VERSION_PLACES 里加一条。
 */
const VERSION_PLACES = [
  ['package.json', /"version":\s*"([^"]+)"/],
  ['package-lock.json', /^\s*"version":\s*"([^"]+)"/m],
  ['src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m],
  ['src-tauri/Cargo.lock', /name = "modulo"\nversion = "([^"]+)"/],
  ['src-tauri/tauri.conf.json', /"version":\s*"([^"]+)"/],
  ['src/vue/useBackup.ts', /APP_VERSION\s*=\s*'([^']+)'/],
  ['packages/engine/package.json', /"version":\s*"([^"]+)"/],
];

function versionFacts() {
  return VERSION_PLACES.map(([file, re]) => {
    const p = resolve(root, file);
    if (!existsSync(p)) return { file, version: null };
    const m = readFileSync(p, 'utf8').match(re);
    return { file, version: m ? m[1] : null };
  });
}

const versions = versionFacts();

if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ ...facts, versions }, null, 2));
  process.exit(0);
}

/**
 * 标记行里认领的数字 —— 判据是"**这一行里该维度的最后一个数字**是不是实跑值"。
 *
 * 为什么不用「关键词后面 N 字内找数字」：调那个 N 是个无底洞。README 里
 * 「引擎分支覆盖 ≥90%（`npm run cover:engine`，当前 92.30%）」关键词与数字之间隔了 20 多字，
 * 而同一条规则在 ARCHITECTURE 那行只隔 3 字 —— 一个 N 要同时伺候两种写法，只能放到 40 以上，
 * 放到那么大就必然吃到邻近的别的数字。改成"同行同维度的最后一个数字"就没有这个 tuning 问题。
 *
 * `kw` 是"这一行确实在谈这个维度"的判据，**必须要求该维度以可认领的形式出现**：
 * 比如 E2E 那条要 `E2E ... N 条`，而不是行里随便提一句 E2E（README 里
 * 「E2E 里用 rAF 采样」是描述做法，不是在声明有 19 条）。所以 E2E 的 kw 自带"条"字要求。
 *
 * 另一个细节：强调是**成对**的 `**312**`，包裹写 `(?:\*\*)?` 而不是 `\*\*?` ——
 * 后者是"一个星号、可选第二个"，对 `**312**` 永远不匹配（害我把三处正确数字报成红）。
 */
const RULES = [
  { key: '单测条数', kw: /单测[^\n]{0,24}条/, want: () => String(facts.tests), re: (v) => new RegExp(`(?:\\*\\*)?${v}(?:\\*\\*)?\\s*条`) },
  { key: '单测文件数', kw: /\d+\s*(?:个)?文件/, want: () => String(facts.files), re: (v) => new RegExp(`${v}\\s*(?:个)?文件`) },
  { key: 'E2E 条数', kw: /E2E[^\n]{0,12}条/, want: () => String(facts.e2e), re: (v) => new RegExp(`(?:\\*\\*)?${v}(?:\\*\\*)?\\s*条`) },
  {
    // 覆盖率是全表唯一一条**下限承诺**，不做等值核对：这个数会随环境与运行抖动
    // （实测 CI 两次跑出 93.74 / 93.75；本机 Node 26 与 CI Node 22 的 V8 对个别文件的分支计数
    // 也不同，如 serialize.ts 97.29 vs 97.22、validate.ts 89.36 vs 89.58）。行里可以有多个下限
    // （门禁 ≥90% 与现状 ≥93.7%），取最严的那条核对。
    key: '受测层分支覆盖',
    kw: /覆盖[^\n]{0,24}%/,
    want: () => facts.coverage?.toFixed(2) ?? '?',
    floor: (line) => {
      const floors = [...line.matchAll(/≥\s*(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
      if (!floors.length) return { ok: false, why: '这行在谈覆盖率，但没有 `≥N%` 的下限写法（覆盖率只按下限核对）' };
      if (facts.coverage === null) return { ok: false, why: '没有 coverage 数据 —— 先跑 `npm run cover:engine`' };
      const need = Math.max(...floors);
      return facts.coverage >= need
        ? { ok: true }
        : { ok: false, why: `低于这行认领的下限 ${need}%` };
    },
  },
  { key: 'JS 体积', kw: /\bJS\b[^\n]{0,20}kB/, want: () => facts.jsKB?.toFixed(2) ?? '?', re: (v) => new RegExp(`${v.replace('.', '\\.')}\\s*kB`) },
  { key: 'CSS 体积', kw: /CSS[^\n]{0,20}kB/, want: () => facts.cssKB?.toFixed(2) ?? '?', re: (v) => new RegExp(`${v.replace('.', '\\.')}\\s*kB`) },
];

let bad = 0;
for (const file of TARGETS) {
  const p = resolve(root, file);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.includes(MARK)) return;
    for (const rule of RULES) {
      // 一条标记行不必把所有维度都写上：行里没提这个维度就不判
      if (!rule.kw.test(line)) continue;
      // 下限型规则（覆盖率）走自己的判据：看"实测够不够"，不是"数字是否逐字相同"
      if (rule.floor) {
        const r = rule.floor(line);
        if (!r.ok) {
          bad++;
          console.error(`✗ ${file}:${i + 1} · ${rule.key}\n    ${r.why}（实测 ${rule.want()}%）\n    ${line.trim().slice(0, 110)}`);
        }
        continue;
      }
      const want = rule.want();
      if (!rule.re(want).test(line)) {
        bad++;
        console.error(`✗ ${file}:${i + 1} · ${rule.key}\n    这行认领了「${rule.key}」，但实跑是 ${want}\n    ${line.trim().slice(0, 110)}`);
      }
    }
  });
}

// 版本号同源：不一致就是发布事故的前一步（漏对齐一处 = 装完的人看到两套版本号）
const versionSet = new Set(versions.filter((v) => v.version).map((v) => v.version));
if (versionSet.size > 1) {
  bad++;
  console.error(`✗ 版本号不一致：${[...versionSet].join(' vs ')}`);
  for (const { file, version } of versions) console.error(`    ${version ?? '(读不到)'}  ${file}`);
}

console.log(`实跑事实：${facts.tests} 单测 / ${facts.files} 文件 · E2E ${facts.e2e} 条 · 受测层分支覆盖 ${facts.coverage?.toFixed(2) ?? '?'}%${facts.jsKB ? ` · JS ${facts.jsKB} kB` : ''} · 版本 ${[...versionSet][0] ?? '?'}（${versions.length} 处同源）`);
if (bad) {
  console.error(`\n${bad} 处对不上。改文档或改代码都算修，但别让两个数字长期各说各话。`);
  process.exit(1);
}
console.log('标记行的数字与实跑一致。');
