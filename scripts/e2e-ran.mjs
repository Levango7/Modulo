/**
 * 「E2E 真跑了」判据 —— 从 vitest 的 json 报告核对**执行条数**，而不是核对环境。
 *
 * ## 为什么需要它
 * `tests/e2e/*.spec.ts` 一律是 `skipIf(!EXE)` 形状（`EXE = chromePath()`）：Chrome 找不到时
 * 整段 `describe` 静默跳过，而 job 照样全绿。2026-10-19 04:0x 的 run 39004860377 就是这么
 * 绿了十分多钟 —— 两条 E2E 与拖拽预算一步都没跑。**「没测」不许冒充「测过」。**
 *
 * ## 为什么不满足于 `test -f "$CHROME_PATH"`
 * 那条断言（2026-10-20 加的）只证明**那个文件在**，证不了 **spec 真的跑了**：
 *   · 新 spec 换一种守卫（`skipIf(!process.env.X)`、`describe.skip`）它管不着；
 *   · `chromePath()` 的候选表不止一条，CHROME_PATH 指的未必是它最后选中的那条；
 *   · 路径拼错 / 报告没生成，job 也不会红。
 * 代理判据只能证明「我以为的条件成立」，不能证明「被测的东西被测了」。这里直接读**执行结果**：
 * 实跑条数必须等于源码里静态数出来的 `it` 家族条数，且 `skipped = 0`、`failed = 0`。
 *
 * ## 判据
 *   1. 报告读得到、解得开（否则 exit 1，绝不把"读不到"当"没问题"）
 *   2. `numTotalTests` == 静态条数（`tests/e2e` 下所有 .ts 里 `it` 家族的个数，
 *      与 `scripts/docs-check.mjs` 的 `e2eFacts()` 同一个正则 —— 两条门数同一件事不许两种口径）
 *   3. `numPendingTests` == 0（把跳过的用例名逐个打出来，好定位是哪条守卫）
 *   4. `numFailedTests` == 0
 *
 * 用法：
 *   node scripts/e2e-ran.mjs                                # 读默认报告
 *   node scripts/e2e-ran.mjs --report <path> --specs <dir>   # 注入缝（测试用）
 * 退出码：0 通过 / 1 不通过 / 2 用法错。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2eItCount } from './docs-check-claims.mjs';

function argOf(argv, flag, dflt) {
  // 取**最后一次**出现：同名的后一个参数覆盖前一个（命令行的一般直觉），
  // 也让测试可以「先给默认目录、再用 --specs 覆盖成不存在的目录」而不用改调用方式。
  const i = argv.lastIndexOf(flag);
  return i < 0 ? dflt : argv[i + 1];
}

/** 静态条数：与 `docs-check` 共用 `e2eItCount()`（剥注释后数 `it` 家族）—— 同一件事不许两种口径 */
function staticCount(dir) {
  if (!existsSync(dir)) return null;
  let n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    n += e2eItCount(readFileSync(join(dir, f), 'utf8'));
  }
  return n;
}

function main(argv) {
  const report = resolve(argOf(argv, '--report', 'node_modules/.tmp/e2e-vitest.json'));
  const specs = resolve(argOf(argv, '--specs', 'tests/e2e'));

  const want = staticCount(specs);
  if (want === null) {
    console.error(`✗ 找不到 E2E 目录 ${specs} —— 静态条数无从核对（拒绝假装通过）`);
    return 2;
  }
  if (!existsSync(report)) {
    console.error(`✗ 没有 E2E 报告 ${report} —— 也就是说没有证据证明跑过（拒绝假装通过）`);
    return 1;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(report, 'utf8'));
  } catch (err) {
    console.error(`✗ 报告读不出 JSON（${report}）：${err?.message ?? err}`);
    return 1;
  }

  const total = raw.numTotalTests ?? 0;
  const pending = raw.numPendingTests ?? 0;
  const failed = raw.numFailedTests ?? 0;

  // 跳过的用例名逐个打出来：光说"跳了 3 条"没法定位是哪条守卫
  const skipped = [];
  for (const suite of raw.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status === 'pending' || t.status === 'skipped' || t.status === 'todo') {
        skipped.push(`${(suite.name ?? '').split(/[\\/]/).pop()} :: ${t.title}`);
      }
    }
  }

  const bad = [];
  if (total !== want) bad.push(`实跑 ${total} 条，源码里静态数是 ${want} 条 —— 有 spec 没跑到`);
  if (pending !== 0) {
    bad.push(`有 ${pending} 条被跳过（skipIf 静默跳过不许冒充通过）：\n    ${skipped.slice(0, 10).join('\n    ')}`);
  }
  if (failed !== 0) bad.push(`有 ${failed} 条失败`);

  if (bad.length) {
    console.error('✗ E2E 没有真的全跑完：');
    for (const b of bad) console.error(`  · ${b}`);
    return 1;
  }
  console.log(`✓ E2E 真跑了：${total}/${want} 条全执行、0 跳过、0 失败`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
