/**
 * 「release 的 tag 现在指向哪个 commit」的判定 —— `release-manifest.mjs` 的纯逻辑半。
 *
 * ## 为什么要单独成文件
 * 2026-11-17 凌晨实测的一起**假红**：PR #311 的 `verify` 报「`v0.8.4` tag 指向的 commit
 * 变了」，日志里写着「现在 master」。而远端 `v0.8.4^{}` 解引用就是台账记的 `2f96593`，
 * **tag 一个字都没动**。
 *
 * 根因在旧写法里：
 *
 * ```js
 * let commit = r.target_commitish            // ← 初值是它
 * const ref = await api(`.../git/ref/tags/${tag}`).catch(() => null)
 * if (ref?.object) { ... }                   // ← 读不到就保持初值
 * ```
 *
 * GitHub 上**所有** tag 的 `target_commitish` 都是字符串 `"master"`（那是"从哪个分支发的
 * release"，不是 commit sha）。所以 GitHub API 一抖动、`catch` 把错误吞成 `null`，
 * `"master"` 就被当成 commit 去跟台账里的 sha 比 —— 必然不等，必然报「变了」。
 * 脚本自己的注释还写着「读不到绝不能当成变了」，而 catch 恰恰这么干了。
 *
 * 这里的结论只有一条：**从来没读到 sha，就只能报「读不到」**。三档必须分开：
 * `ok` / `changed` / `unreadable` —— 「读不到」既不是"没变"，更不是"变了"。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从 `GET /git/ref/tags/<tag>` 的解引用结果里取 commit sha。
 *
 * `ref.object.type` 有两种：
 * - `commit` —— 轻量 tag，`object.sha` 就是 commit；
 * - `tag` —— annotated tag，`object.sha` 指向 tag 对象，得再查 `GET /git/tags/<sha>`
 *   才拿得到 commit（调用方把那一层结果作为 `tagObj` 传进来）。
 *
 * 两种情况都拿不到就返回 `null`。**不设任何默认值** —— 尤其不许回落到
 * `target_commitish`（见文件头，那是这起假红的根因）。
 */
export function commitOfRef(ref, tagObj) {
  if (!ref || !ref.object) return null;
  if (ref.object.type === 'commit') return ref.object.sha ?? null;
  if (ref.object.type === 'tag') return tagObj?.object?.sha ?? null;
  return null;
}

/**
 * 判定台账记的 commit 与现在读到的 commit 是否一致。返回 `{ code, note }`：
 *
 * - `ok` —— 相等，什么都不用说；
 * - `changed` —— 都读到了，但确实不等（这是真问题：tag 被改指）；
 * - `unreadable` —— **没读到**。单独一档，文案里明说「不等于变了」。
 *
 * 为什么 `unreadable` 不能并进 `changed`：并进去就等于「API 抖一下报一次 tag 被篡改」，
 * 报几次之后没人再信这道门；并进 `ok` 则相反 —— 真被改指时也看不见。两种合并都错。
 */
export function judgeCommit(tag, ledgerCommit, liveCommit) {
  if (typeof liveCommit !== 'string' || liveCommit.length === 0) {
    return {
      code: 'unreadable',
      note:
        `${tag}：远端读不到这个 tag 指向的 commit —— 只能判「读不到」，` +
        `**不能判「变了」**（没读到不等于变了，也不等于没变）。先重试，连续读不到再查 API 与权限`,
    };
  }
  if (liveCommit !== ledgerCommit) {
    return {
      code: 'changed',
      note: `${tag}：**tag 指向的 commit 变了**\n    台账 ${ledgerCommit}\n    现在 ${liveCommit}`,
    };
  }
  return { code: 'ok', note: null };
}

/** 台账回写（`--update`）只允许在真的读到 sha 时进行 —— 否则会把 `null` 写进台账。 */
export function canUpdateLedger(liveCommit) {
  return typeof liveCommit === 'string' && liveCommit.length > 0;
}

/**
 * 命令行口（给测试用，也给人自查一句判定）。
 *
 * 为什么要有这张口而不是让测试 `import`：`tsconfig.json` 没开 `allowJs`，
 * `.mjs` 进不了 `.ts` 的类型检查 —— 与 `docs-check-claims.mjs` / `release-artifact-facts.mjs`
 * 同一条理由。
 *
 *   node scripts/release-tag-commit.mjs --judge --tag v0.8.4 --ledger 2f96593 --live none
 *   node scripts/release-tag-commit.mjs --commit-of-ref '{"object":{"type":"commit","sha":"abc"}}'
 *
 * `--judge` 的退出码：0 = ok，1 = changed 或 unreadable（都算红），2 = 用法错。
 */
function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : argv[i + 1];
  };
  if (argv.includes('--commit-of-ref')) {
    const raw = get('--commit-of-ref');
    if (raw === null) {
      console.error('用法：--commit-of-ref <ref 的 JSON；读不到给 null>');
      return 2;
    }
    let ref = null;
    try {
      ref = JSON.parse(raw);
    } catch {
      console.error(`--commit-of-ref 要能 JSON.parse：${raw}`);
      return 2;
    }
    console.log(JSON.stringify({ commit: commitOfRef(ref, null) }));
    return 0;
  }
  if (argv.includes('--commit-of-tag-ref')) {
    // annotated tag 那条路：ref 与 tag 对象两个 JSON 一起给
    const refRaw = get('--ref');
    const tagRaw = get('--tag-obj');
    if (refRaw === null) {
      console.error('用法：--commit-of-tag-ref --ref <json|null> [--tag-obj <json|null>]');
      return 2;
    }
    let ref = null;
    let tagObj = null;
    try {
      ref = JSON.parse(refRaw);
      tagObj = tagRaw === null ? null : JSON.parse(tagRaw);
    } catch {
      console.error('--ref / --tag-obj 要能 JSON.parse');
      return 2;
    }
    console.log(JSON.stringify({ commit: commitOfRef(ref, tagObj) }));
    return 0;
  }
  if (argv.includes('--judge')) {
    const tag = get('--tag') ?? 'v0.0.0';
    const ledger = get('--ledger') ?? '';
    const liveRaw = get('--live');
    // `none` 是给 shell 传 null 的写法（命令行里没有 null 字面量）
    const live = liveRaw === null || liveRaw === 'none' ? null : liveRaw;
    const v = judgeCommit(tag, ledger, live);
    console.log(JSON.stringify(v));
    return v.code === 'ok' ? 0 : 1;
  }
  console.error('用法：--judge | --commit-of-ref | --commit-of-tag-ref（见文件头注释）');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
