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
  const digits = get('--digits');
  const unit = get('--unit');
  const line = get('--line');
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
