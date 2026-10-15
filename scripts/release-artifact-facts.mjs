/**
 * 「当前线上发布产物」这类口径的判据 —— **期望值从 `release-manifest.json` 台账取，不写在文档里**。
 *
 * 为什么要有这个文件：`docs/ARCHITECTURE.md:1642` 那句「当前线上发布产物是
 * `Modulo_0.8.1_x64-setup.exe` / sha256 …」是**对外承诺**，而它此前长期停在 0.7.0（线上是 0.8.1），
 * `docs:check` 一个字都没报 —— 因为产物口径不是"跑出来的数"，没有一条规则认领过它。
 * 台账那一侧已经有 `release-manifest.mjs` 把它与 GitHub 真实资产对账（tag / 资产 digest / immutable），
 * 所以把文档钉在台账上 = 间接钉在 GitHub 上，中间不需要任何人再抄一遍。
 *
 * 判据是**存在式**而不是"行里最后一个数"：那一行同时写着 0.7.0 / 0.4.0 / … 的历史数字，
 * 那些是**留档**、不该拿来比（比了就是误报，而一条会误报的门等于没有门）。
 * 所以只要求：① 行里出现台账认定的当前安装包名；② 行里若认领了 sha256，**至少一条**对得上。
 *
 * 没覆盖到什么也说清楚：**字节数**不在本门范围内 —— 台账里只存 `assets{name: digest}`，
 * 没有 size 字段。要让字节数也被守着，得先给台账加一列（那是另一个 agent 写的门禁的 schema），
 * 不该在这笔里顺手改。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 仓库根按**本文件自己的位置**算，不按 cwd —— 从测试里起子进程、从 CI、从本机跑，cwd 三种写法都有。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** GitHub 的 digest 形如 `sha256:<64hex>`；剥掉前缀并统一小写，非 64 位十六进制一律视为没有 */
export function normDigest(raw) {
  if (typeof raw !== 'string') return null;
  const body = raw.trim().replace(/^sha256:/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(body) ? body : null;
}

/**
 * 台账里"当前线上"那一条：按 semver 取最大、跳过 draft。
 *
 * 为什么不看 `dist-tags.latest` 也不看台账里的顺序：那是 **npm 包**的口径，而且台账的键序是
 * 生成时顺带写下的，不是承诺。按 tag 的三段数字排序才是"哪个版本最新"这件事的定义。
 */
export function pickLatestRelease(manifest) {
  const rows = Object.entries(manifest?.releases ?? {})
    .map(([tag, rec]) => ({ tag, rec, m: /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) }))
    .filter((r) => r.m && r.rec && r.rec.draft !== true);
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const A = a.m.slice(1).map(Number);
    const B = b.m.slice(1).map(Number);
    for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return B[i] - A[i];
    return 0;
  });
  const { tag, rec } = rows[0];
  const asset = Object.keys(rec.assets ?? {}).find((n) => /_x64-setup\.exe$/.test(n)) ?? null;
  return {
    tag,
    version: tag.replace(/^v/, ''),
    asset,
    digest: asset ? normDigest(rec.assets[asset]) : null,
  };
}

/** 行里"认领了某个 sha256"的形状：完整 64 位、`前缀…后缀` 简写，或 `sha256 前缀…` 只给头 */
export function hashClaims(line) {
  const out = [];
  for (const m of line.matchAll(/\b[0-9a-fA-F]{64}\b/g)) out.push({ kind: 'full', value: m[0].toLowerCase() });
  for (const m of line.matchAll(/\b([0-9a-fA-F]{6,16})…([0-9a-fA-F]{4,16})\b/g)) {
    out.push({ kind: 'abbrev', head: m[1].toLowerCase(), tail: m[2].toLowerCase() });
  }
  // `sha256 4658ada982c7e439…` 这种只给头的写法（§11.4 的历史那几段在用）。
  // 它必须算一条认领：否则"整行只写了个前缀哈希"就能绕过核对。
  // 后面紧跟十六进制的那种是 `前缀…后缀` 的左半，已被上一条吃掉，用负向前瞻排除掉。
  for (const m of line.matchAll(/\bsha256\s+([0-9a-fA-F]{6,16})…(?![0-9a-fA-F])/g)) {
    out.push({ kind: 'head', head: m[1].toLowerCase() });
  }
  return out;
}

function claimMatches(claim, digest) {
  if (claim.kind === 'full') return claim.value === digest;
  if (claim.kind === 'head') return digest.startsWith(claim.head);
  return digest.startsWith(claim.head) && digest.endsWith(claim.tail);
}

/**
 * 一行文档 vs 台账认定的当前产物。返回 `{ ok, why }`，`why` 要能直接照着改 ——
 * 与本仓其它门一样，报"期望是什么、哪儿对不上"，不报"格式不对"。
 */
export function checkArtifactLine(line, rel) {
  if (!rel) {
    return { ok: false, why: '台账里取不到可用的发布点（`releases` 是空的、全是 draft，或 tag 不是 `vX.Y.Z`）' };
  }
  if (!rel.asset) {
    return { ok: false, why: `${rel.tag} 这条台账里没有安装包（资产名不以 \`_x64-setup.exe\` 结尾）` };
  }
  if (!line.includes(rel.asset)) {
    return { ok: false, why: `台账认定线上最新是 \`${rel.asset}\`（${rel.tag}），这一行没提到它 —— 发版之后产物口径没跟着改` };
  }
  const claims = hashClaims(line);
  if (!claims.length) return { ok: true }; // 只点名安装包、没认领哈希：没有可核的声明
  if (!rel.digest) {
    return { ok: false, why: `\`${rel.asset}\` 在台账里没有 sha256（GitHub 侧没给 digest？），而这行认领了哈希` };
  }
  return claims.some((c) => claimMatches(c, rel.digest))
    ? { ok: true }
    : {
        ok: false,
        why: `这行认领的 sha256 与台账都对不上（台账：\`${rel.asset}\` = ${rel.digest.slice(0, 8)}…${rel.digest.slice(-5)}）`,
      };
}

/**
 * 读台账并取当前发布点。路径由调用方给（`docs-check.mjs` 用它的 `process.cwd()` 口径），
 * 也可用 `DOCS_RELEASE_MANIFEST` 指到别处 —— 那是给测试留的缝：
 * 「发了 0.8.2 而文档还写 0.8.1」这一格只能靠换一份台账来演，不能靠改真台账。
 *
 * 台账读不到时**把原因带回来**而不是当成"没有产物"：静默跳过就是把无从核对说成通过。
 */
export function latestArtifact(path) {
  if (!path) return { rel: null, why: '没有给台账路径' };
  if (!existsSync(path)) return { rel: null, why: `找不到台账文件 ${path}` };
  try {
    return { rel: pickLatestRelease(JSON.parse(readFileSync(path, 'utf8'))), why: null };
  } catch (e) {
    return { rel: null, why: `台账读不了：${e.message}` };
  }
}

/**
 * CLI —— 给测试与人工复算用的"同一张口"：
 *   node scripts/release-artifact-facts.mjs --line-file <装着待核那一行的文件> [--ledger <台账路径>]
 * 打印 `LATEST` 与 `VERDICT`，红时 exit 1。
 *
 * 为什么要这张口：`docs-check.mjs` 一跑就把整个单测集跑一遍（它靠 vitest 的 json 拿实跑条数），
 * 用它来验"这条判据咬不咬得住"等于在测试里递归跑测试。判据与 CLI 都在这个文件里，
 * 于是测试打的和门用的是同一份代码 —— 不是另一份"看起来等价"的复刻。
 */
function main(argv) {
  const get = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
  };
  const linePath = get('--line-file');
  if (!linePath) {
    console.error('用法：--line-file <装着待核那一行的文件> [--ledger <台账路径>]');
    return 2;
  }
  if (!existsSync(linePath)) {
    console.error(`读不到待核文件 ${linePath}`);
    return 2;
  }
  const ledger = get('--ledger', resolve(ROOT, 'release-manifest.json'));
  const { rel, why } = latestArtifact(ledger);
  console.log(`LEDGER ${ledger}`);
  if (why) {
    console.log(`VERDICT RED ${why}`);
    return 1;
  }
  console.log(
    `LATEST ${rel?.tag ?? '-'} ${rel?.asset ?? '-'} ${rel?.digest ? `${rel.digest.slice(0, 8)}…${rel.digest.slice(-5)}` : '-'}`,
  );
  // 折成一行：判据是**行级**的，而夹具里为了可读可能把它写成多行
  const r = checkArtifactLine(readFileSync(linePath, 'utf8').replace(/\r?\n/g, ' '), rel);
  console.log(r.ok ? 'VERDICT OK' : `VERDICT RED ${r.why}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
