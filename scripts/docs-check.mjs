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
 * 单测条数与文件数、**逐文件单测条数**、E2E 条数、受测层分支覆盖率、构建产物体积、
 * **注册表卡数**、**CI job 数**、**Rust 单测条数**、**版本号同源**。
 * 全部实跑或实读文件，不接受任何"文档里写的"作为输入。
 * 其中覆盖率是**下限承诺**（`≥N%`）：同一份代码在不同 V8 / 平台间会差出 0.01 个百分点以上，
 * 等值核对会把环境抖动报成文档漂移（实测 CI 两次跑出 93.74 / 93.75，本机与 CI 的逐文件
 * 分支计数也不同）；**JS / CSS 体积同理**：rolldown 两次构建差过 50 字节（217.63 vs 217.68），
 * 所以这两条按 ±1 kB 容差核对。其余数字（条数 / 文件数 / 版本号）要求逐字一致。
 *
 * 用法：
 *   node scripts/docs-check.mjs          # 核对，有对不上就 exit 1
 *   node scripts/docs-check.mjs --print  # 只打印事实，不核对
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

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
  return { tests: raw.numTotalTests, files, ...perFileFacts(raw) };
}

/**
 * 逐文件条数：给「`tests/vue/rowUnit.test.ts`（10 条）」这类**点名了证据文件**的声明用。
 *
 * 为什么单独做这一维：2026-10-09 复查时发现三处这类数字与实跑不符
 * （`CHANGELOG:28` 写 12 条实为 10、`ARCHITECTURE:1040` 写 7 条实为 8、
 * `ARCHITECTURE:496` 的总数 47 对但分解式只加到 46），**而没有任何一条断言会因此变红**。
 * 它们的共同点是"声明里就写着证据在哪"，本来就不该靠人记。
 *
 * 口径：**数 `it()` 家族，不是数 `it(` 字面量。** 后者是个陷阱 ——
 * `templates.test.ts` 用 `describe` 循环给每张模板生成 5 条，`grep 'it('` 只数得出 12 条，
 * 真值 47 条。所以这里读 vitest 自己的 json（下面复用同一次运行，不额外跑）。
 * pending / todo 也计入：文档写的是"有几条"，不是"跑了几条"，与 `e2eFacts()` 的口径一致。
 */
function perFileFacts(raw) {
  const perFile = {};
  for (const suite of raw.testResults ?? []) {
    const rel = relative(root, suite.name).replace(/\\/g, '/');
    perFile[rel] = (perFile[rel] ?? 0) + (suite.assertionResults?.length ?? 0);
  }
  return { perFile };
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

/**
 * 注册表卡数：数 `src/vue/cardRegistry.ts` 里**顶层**的 `id:`。
 * 只数顶层：每个 variant 也带 `id:`，但它们写在同一行的 `variants: [{ id: ... }]` 里，
 * 按「行首四个空格」筛就只剩卡的条目。口径与 `docs/CARD-CATALOG.md` 的「注册表 N」一致。
 * 为什么要数它：README 那句「N 种卡」是人抄的，加了三批卡之后仍写着 38 —— 而注册表已经 41。
 */
function registryFacts() {
  const p = resolve(root, 'src/vue/cardRegistry.ts');
  if (!existsSync(p)) return { cards: null };
  return { cards: (readFileSync(p, 'utf8').match(/^ {4}id: '/gm) ?? []).length };
}

/**
 * CI 的 job 数：读 `.github/workflows/ci.yml` 中 `jobs:` 段里两空格缩进的键。
 * 「CI 两个 job」这种**结构**数字比规模数字更容易烂 —— 加一个 job 是看不见的改动，
 * 而 README 是读者的第一现场。
 */
function ciJobFacts() {
  const p = resolve(root, '.github/workflows/ci.yml');
  if (!existsSync(p)) return { jobs: null };
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return { jobs: null };
  let jobs = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s#]/.test(lines[i])) break; // 顶格 ⇒ jobs 段结束
    if (/^ {2}[\w-]+:\s*$/.test(lines[i])) jobs++;
  }
  return { jobs };
}

/**
 * Rust 单测条数：`#[test]` 减去 `#[ignore]`，**两个都按行首锚定数**。
 *
 * 锚定不是洁癖：注释里会提到这两个属性（`web.rs:146`、`release_signature.rs:8` 各一处），
 * 不锚定就会数出 ignored=3、于是给出 15 条，而 CI 的 `cargo test` 实跑 17 条 ——
 * 又是本项目反复踩的那类「把旁白算进正文」。
 *
 * 必须扣：`tests/release_signature.rs` 那条是**发布门禁**，CI 上没有安装包产物、默认不跑，
 * 而文档报的是 `cargo test` 实际执行的条数。不扣就和 CI 的输出对不上。
 * 不递归、只走 `src-tauri/src` 与 `src-tauri/tests` 两个目录，也**绝不进 `src-tauri/target/`**
 * （那底下有依赖源码副本，数进来会大一个数量级）。
 */
function rustFacts() {
  let tests = 0;
  let ignored = 0;
  for (const dir of [resolve(root, 'src-tauri/src'), resolve(root, 'src-tauri/tests')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.rs')) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      tests += (src.match(/^\s*#\[test\]/gm) ?? []).length;
      ignored += (src.match(/^\s*#\[ignore\b/gm) ?? []).length;
    }
  }
  return { rust: tests - ignored, rustIgnored: ignored };
}

const facts = {
  ...unitFacts(),
  e2e: e2eFacts(),
  coverage: coverageFact(),
  ...(bundleFacts() ?? {}),
  ...registryFacts(),
  ...ciJobFacts(),
  ...rustFacts(),
};

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
  {
    // 逐文件单测条数：只核对**紧跟测试文件路径后的那个数**，真值取自 `facts.perFile`。
    //
    // 两处收紧都是刻意的，各有来历：
    //   1. **窗口只给 6 个字符**。`ARCHITECTURE:441` 那行在路径之后隔 7 个字写的是
    //      「这里原来写「10 条」」—— 那是**历史**数。窗口再宽一格就会把历史数当成
    //      当前声明报错，而本文件开头写得很清楚：一条会误报的检查等于没有检查。
    //   2. **认不出就跳过、不报错**。同一行里常有「8 张 × 5 条」这种与文件无关的数字，
    //      硬要凑一个数只会拿别人的数来比。
    //
    // 代价：「18 条单测覆盖（`…/schemes.test.ts`）」这种**数字在路径前**的写法守不住。
    // 宁可少守一处，也不要一条会误报的门。
    //
    // 同理，**CHANGELOG 刻意不在 TARGETS 里**：发布说明里的「新增 N 条单测」描述的是
    // 当时那一刻（实测 `CHANGELOG:1014` 的 37 条就是准确的 —— 那版只有 6 张模板），
    // 拿今天的文件去比对它是必然的误报。
    key: '逐文件单测条数',
    kw: /tests\/[\w./-]*\.test\.ts/,
    custom: (line) => {
      const claims = [...line.matchAll(/(tests\/[\w./-]*\.test\.ts)[^\d\n]{0,6}(\d+)\s*条/g)];
      if (!claims.length) return { ok: true }; // 点名了文件但没写条数 —— 没有可核的声明
      for (const [, rel, n] of claims) {
        const real = facts.perFile?.[rel];
        // 拿不到就不猜：报"查不到"比拿一个错的数字去比更诚实（与 coord-gate 同一条原则）
        if (real === undefined) {
          return { ok: false, why: `行里点名的 \`${rel}\` 在实跑结果里找不到（改名 / 删除 / 没跑到？）` };
        }
        if (real !== Number(n)) {
          return { ok: false, why: `\`${rel}\` 实跑 ${real} 条，这行写的是 ${n} 条` };
        }
      }
      return { ok: true };
    },
  },
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
  {
    // 体积有 ±1 kB 容差：rolldown 两次构建的产物差过 50 字节（非确定性），精确比对会永久飘红。
    // 行里可以有多个 kB 数（本体的 + gzip 的），任何一个落在容差内即通过。
    key: 'JS 体积',
    kw: /\bJS\b[^\n]{0,20}kB/,
    want: () => facts.jsKB?.toFixed(2) ?? '?',
    tolKb: 1,
  },
  {
    key: 'CSS 体积',
    kw: /CSS[^\n]{0,20}kB/,
    want: () => facts.cssKB?.toFixed(2) ?? '?',
    tolKb: 1,
  },
  {
    // 产品规模的门面数字。README 那句曾长期写 38，而注册表已经 41 —— 加卡的人不会想起改它，
    // 而没有一条断言会因此变红。
    key: '注册表卡数',
    kw: /\d+\s*种卡/,
    want: () => String(facts.cards),
    re: (v) => new RegExp(`(?:\\*\\*)?${v}(?:\\*\\*)?\\s*种卡`),
  },
  {
    key: 'CI job 数',
    kw: /\d+\s*个\s*job/,
    want: () => String(facts.jobs),
    re: (v) => new RegExp(`(?:\\*\\*)?${v}(?:\\*\\*)?\\s*个\\s*job`),
  },
  {
    // 「Rust 单测 N 条」的写法要连着 Rust 才算这个维度，否则 ARCHITECTURE 那行里的
    // 「前端单测 870 条」会被误判成 Rust 的数。注意这条与上面「单测条数」可以同处一行：
    // 两者的判据都是"行里得出现实跑值"，所以一行同时认领两个维度时，两个数都得写对。
    key: 'Rust 单测条数',
    kw: /Rust[^\n]{0,8}单测[^\n]{0,10}条/,
    want: () => String(facts.rust),
    re: (v) => new RegExp(`Rust[^\\n]{0,8}单测\\s*(?:\\*\\*)?${v}(?:\\*\\*)?\\s*条`),
  },
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
      // 体积类规则走 ±1 kB 容差：行里任意一个 kB 数落在容差内即通过（gzip 的数也在同一行）
      if (rule.tolKb) {
        const nums = [...line.matchAll(/([\d.]+)\s*kB/g)].map((m) => Number(m[1]));
        const measured = facts[rule.key === 'JS 体积' ? 'jsKB' : 'cssKB'];
        const hit = measured !== null && nums.some((n) => Math.abs(n - measured) <= rule.tolKb);
        if (!hit) {
          bad++;
          console.error(`✗ ${file}:${i + 1} · ${rule.key}\n    这行认领的 ${rule.key} 与实跑 ${rule.want()} kB 差超过 ${rule.tolKb} kB\n    ${line.trim().slice(0, 110)}`);
        }
        continue;
      }
      // 下限型规则（覆盖率）走自己的判据：看"实测够不够"，不是"数字是否逐字相同"
      if (rule.floor) {
        const r = rule.floor(line);
        if (!r.ok) {
          bad++;
          console.error(`✗ ${file}:${i + 1} · ${rule.key}\n    ${r.why}（实测 ${rule.want()}%）\n    ${line.trim().slice(0, 110)}`);
        }
        continue;
      }
      if (rule.custom) {
        const r = rule.custom(line);
        if (!r.ok) {
          bad++;
          console.error(
            `✗ ${file}:${i + 1} · ${rule.key}\n    ${r.why}\n    ${line.trim().slice(0, 110)}`,
          );
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

console.log(
  `实跑事实：${facts.tests} 单测 / ${facts.files} 文件 · E2E ${facts.e2e} 条 · 受测层分支覆盖 ${facts.coverage?.toFixed(2) ?? '?'}%` +
    `${facts.jsKB ? ` · JS ${facts.jsKB} kB` : ''} · ${facts.cards} 种卡 · CI ${facts.jobs} 个 job` +
    ` · Rust ${facts.rust} 单测（另有 ${facts.rustIgnored} 条 #[ignore]，CI 不跑）` +
    ` · 版本 ${[...versionSet][0] ?? '?'}（${versions.length} 处同源）`,
);
if (bad) {
  console.error(`\n${bad} 处对不上。改文档或改代码都算修，但别让两个数字长期各说各话。`);
  process.exit(1);
}
console.log('标记行的数字与实跑一致。');
