import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「行里认领了 N 条 / N 个文件 / N 种卡」这类声明的**整数逐字一致**判据。
 *
 * 为什么要单独抽出来：2026-10-16 一轮变异抽查实测，旧写法
 * `new RegExp(String(v) + '\\s*种卡')` 在真值 54 时把「**154 种卡**」判成通过 ——
 * 未锚定的正则只要求"某处出现 54 后接单位"，于是「少一位 / 多一位」这类**慢性漂移**
 * 整个落在射程外，而这正是这道门本来看住的东西。
 *
 * 收口办法是在数字**左侧**加一道 `(?<!\d)`：数字前面不许再粘一位数字。
 * 右侧不需要类似的处理 —— 每条规则都紧跟单位（`条` / `文件` / `种卡` / `job`），
 * 「540 种卡」在真值 54 时本来就匹配不上（实测确认）。
 *
 * `**` 是**可选的成对强调**，写在锚点外侧：`**54** 种卡` 仍算认领，`**154** 种卡` 不算。
 *
 * @param digits  实跑真值（字符串形式的整数）
 * @param unit    单位部分的正则片段，如 `条`、`(?:个)?文件`、`个\\s*job`
 * @param prefix  可选：数字左侧必须先出现的那段（Rust 那条用来区分「Rust 单测 N 条」与前端条数）
 */
export function claimRe(digits, unit, prefix = '') {
  const bold = '(?:\\*\\*)?';
  return new RegExp(`${prefix}${bold}(?<!\\d)${digits}${bold}\\s*${unit}`);
}

/**
 * 「`CanvasEditor.vue` 834 → 677 行」「`ModuleLibrary.vue` 204 行」这类**点名了文件**的行数声明。
 *
 * 返回 `[{ rel, n }]`：rel = 行里写的相对路径，n = 认领的行数。`A → B 行` 取**最后一个数**（B）——
 * 箭头前是来路，不是声明，与「同行同维度的最后一个数字」同一口径。
 *
 * 窗口（路径 → 数字之间 ≤8 个非数字字符，容忍 `` ` `` 与 `**`）与「逐文件单测条数」同一条理由：
 * 窗口再宽就会把邻近的别的数当成声明。代价也同款：**历史数紧跟路径**的写法
 * （`CanvasEditor.vue 原来 834 行`）守不住、还会误报 —— 标记行里要写历史数，
 * 请把它写进箭头链（`834 → 677 行`）或离路径远一点。
 *
 * 数字右侧必须紧跟 `行`（≤4 个非数字字符，容忍空格与 `**`），否则不算这个维度的声明：
 * `rowUnit.ts` 到 309.28 kB` 里的 309 不是行数，`rowUnit.test.ts（10 条）` 也不是。
 */
export function fileLineClaims(line) {
  const out = [];
  const re = /([\w./-]+\.(?:vue|ts))`?[^\d\n]{0,8}(\d+)(?:\s*→\s*(\d+))?[^\d\n]{0,4}行/g;
  for (const m of line.matchAll(re)) {
    out.push({ rel: m[1], n: Number(m[3] ?? m[2]) });
  }
  return out;
}

/**
 * E2E 条数：数 `it` 家族（`it(` / `it.skipIf(skip)(` / `it.each(...)` 都算）。
 *
 * **为什么要先剥注释**（2026-10-25 撞到的真事）：`tests/e2e/chrome.ts` 的文件头注释里写着
 * 「新加的 E2E 一律从这里取路径并 `it.skipIf(!EXE)`」—— 旧写法把这句**注释**数成了一条测试，
 * 于是文档里长期写着「E2E 49 条」，而实际能跑的永远是 **48** 条（本机与 CI 都一致）。
 * 这是本文件开头批过的同一族病：**判据与它声明的语义不一致**（声明"E2E 条数"，
 * 实际数的是"出现 `it(` 的次数"），而它又不报错，看上去一直在守。
 *
 * 发现它的不是文档复核，是 2026-10-25 新加的「E2E 真跑了」门禁（`scripts/e2e-ran.mjs`）——
 * 它拿静态数跟实跑数对账，第一条红就是「实跑 48 条，源码里静态数是 49 条」。
 * 现在两边共用这一个函数：同一件事不许两种口径。
 *
 * 剥法：块注释 + **行首** 行注释。行注释要求 `//` 出现在行首空白之后 ——
 * 这样 `https://…` 这种出现在字符串中间的斜杠不会被误当注释起点。
 *
 * @param src 单个 spec 文件的源码
 */
export function e2eItCount(src) {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g, '$1');
  return (stripped.match(/\bit(?:\.[A-Za-z]+)*\s*\(/g) ?? []).length;
}

/**
 * 命令行口（给测试用，也给人自查一句写法）。
 *
 * 为什么要有这张口而不是让测试 `import`：`tsconfig.json` 没开 `allowJs`，
 * `.mjs` 进不了 `.ts` 的类型检查 —— 与 `release-artifact-facts.mjs` 同一个理由。
 * 判成败**只看退出码**：0 = 这行算认领了该数，1 = 不算，2 = 用法错。
 *
 *   node scripts/docs-check-claims.mjs --digits 54 --unit 种卡 --line '注册表 **54** 种卡'
 */
function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : argv[i + 1];
  };
  const line = get('--line');
  // 行数声明抽取口：打印 JSON（[{rel, n}]），给测试断言用 —— 与上面的 claimRe 口同款理由。
  if (argv.includes('--line-claims')) {
    if (line === null) {
      console.error('用法：--line-claims --line <整行文本>');
      return 2;
    }
    console.log(JSON.stringify(fileLineClaims(line)));
    return 0;
  }
  // E2E 条数口：打印单个 spec 文件的 `it` 家族条数（剥注释后），给测试断言用。
  // 为什么也做成 CLI 而不是让测试 import：同上（`tsconfig` 没开 `allowJs`）。
  if (argv.includes('--e2e-count')) {
    const file = get('--e2e-count');
    if (!file) {
      console.error('用法：--e2e-count <spec 文件路径>');
      return 2;
    }
    if (!existsSync(file)) {
      console.error(`读不到 ${file}`);
      return 2;
    }
    console.log(e2eItCount(readFileSync(file, 'utf8')));
    return 0;
  }
  const digits = get('--digits');
  const unit = get('--unit');
  if (!digits || !unit || line === null) {
    console.error('用法：--digits <实跑值> --unit <单位正则片段> --line <整行文本> [--prefix <正则片段>]');
    return 2;
  }
  if (!/^\d+$/.test(digits)) {
    console.error(`--digits 要是纯数字，收到的是 ${digits}`);
    return 2;
  }
  const re = claimRe(digits, unit, get('--prefix') ?? '');
  const hit = re.test(line);
  console.log(`${hit ? '认领' : '不认领'}（${re} ← ${JSON.stringify(line)}）`);
  return hit ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
