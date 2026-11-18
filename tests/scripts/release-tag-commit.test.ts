/**
 * `scripts/release-tag-commit.mjs` 的判据测试。
 *
 * ## 这条门要挡住的是什么
 * 2026-11-17 凌晨，PR #311 的 `verify` 报「`v0.8.4` tag 指向的 commit 变了」，日志里
 * 写着「现在 master」—— 而远端 `v0.8.4^{}` 解引用就是台账记的 `2f96593`，**tag 一个字没动**。
 *
 * 根因：旧写法拿 `r.target_commitish` 当 commit 的初值，而 GitHub 上**所有** tag 的这个
 * 字段都是分支名字符串 `"master"`；真正的 sha 靠再查 `git/ref/tags/<tag>` 解引用，
 * 那一步 `.catch(() => null)` 一吞，`"master"` 就被当成 commit 去比台账 ⇒ 必然报「变了」。
 *
 * 所以这里每一条断言都对着"假红是怎么来的"：
 * - **读不到 ⇒ null**（不许有初值兜底）；
 * - **读不到 ⇒ unreadable**（不许并进 changed，也不许并进 ok）；
 * - **annotated tag 的 tag 对象查不到 ⇒ null**（不许回落到 tag 对象的 sha，那也不是 commit）。
 *
 * ## 为什么起子进程而不是 import
 * `tsconfig.json` 没开 `allowJs`，`.mjs` 进不了 `.ts` 的类型检查 —— 与
 * `docs-check-claims.test.ts` / `release-artifact-facts.test.ts` 同一个理由。
 *
 * 代价是每条断言一次 `node` 冷启动（本机 1.3–2.2 s），默认 5 s 超时对「一条用例打三次
 * 子进程」是不够的 —— 所以每个 `it` 都显式写 `20_000`，与本仓既有脚本测试同口径。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const SCRIPT = resolve(ROOT, 'scripts/release-tag-commit.mjs')

/** 打一张口，返回 `{ status, out }`。status 为 null（没跑起来）本身就是断言失败。 */
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
  expect(r.status, `子进程没跑起来：${r.error?.message ?? r.stderr}`).not.toBeNull()
  return { status: r.status as number, out: r.stdout ?? '' }
}

const commitOfRef = (ref: unknown) => {
  const { status, out } = run(['--commit-of-ref', JSON.stringify(ref)])
  expect(status).toBe(0)
  return (JSON.parse(out) as { commit: string | null }).commit
}

const commitOfTagRef = (ref: unknown, tagObj: unknown) => {
  const { status, out } = run([
    '--commit-of-tag-ref',
    '--ref',
    JSON.stringify(ref),
    '--tag-obj',
    JSON.stringify(tagObj),
  ])
  expect(status).toBe(0)
  return (JSON.parse(out) as { commit: string | null }).commit
}

const judge = (tag: string, ledger: string, live: string | null) => {
  const { status, out } = run(['--judge', '--tag', tag, '--ledger', ledger, '--live', live ?? 'none'])
  const v = JSON.parse(out) as { code: string; note: string | null }
  // 退出码与 code 必须一致：0 只有 ok，changed / unreadable 都是 1
  expect(status, `code=${v.code} 的退出码不对`).toBe(v.code === 'ok' ? 0 : 1)
  return v
}

const SHA = '2f9659314a725d5285bd4d17bdf06a0b753094e0'
const OTHER = 'de5a50018e8ab2097a0b7db187a4e75af14315d6'

describe('从 ref 解引用 commit：读不到就是 null，不许有初值兜底', () => {
  it('轻量 tag：object.type=commit 时直接用它的 sha', () => {
    expect(commitOfRef({ object: { type: 'commit', sha: SHA } })).toBe(SHA)
  }, 20_000)

  it('annotated tag：object.sha 是 tag 对象，commit 要从 tag 对象里取', () => {
    expect(commitOfTagRef({ object: { type: 'tag', sha: 'tagobj' } }, { object: { type: 'commit', sha: SHA } })).toBe(SHA)
  }, 20_000)

  it('annotated tag 但 tag 对象读不到 ⇒ null（不许回落到 tag 对象自己的 sha）', () => {
    // 旧写法这里是 `commit = t?.object?.sha ?? commit` —— 回落到的就是那个"上一手"，
    // 也就是 target_commitish。这条用例钉住"没有上一手"。
    expect(commitOfTagRef({ object: { type: 'tag', sha: 'tagobj' } }, null)).toBeNull()
  }, 20_000)

  it('ref 读不到（API 抖动被 catch 成 null）⇒ null，而不是字符串 "master"', () => {
    expect(commitOfRef(null)).toBeNull()
  }, 20_000)

  it('ref 存在但没有 object ⇒ null（半截响应同样不许兜底）', () => {
    expect(commitOfRef({})).toBeNull()
    expect(commitOfRef({ object: {} })).toBeNull()
    expect(commitOfRef({ object: { type: 'weird', sha: SHA } })).toBeNull()
  }, 20_000)
})

describe('比对分三档：读不到 ≠ 变了，也 ≠ 没变', () => {
  it('相等 ⇒ ok，且不产生任何 note（不制造噪声）', () => {
    const v = judge('v0.8.4', SHA, SHA)
    expect(v.code).toBe('ok')
    expect(v.note).toBeNull()
  }, 20_000)

  it('都读到了但不等 ⇒ changed，文案点明是 tag 被改指', () => {
    const v = judge('v0.8.4', SHA, OTHER)
    expect(v.code).toBe('changed')
    expect(v.note).toContain('tag 指向的 commit 变了')
    expect(v.note).toContain(SHA)
    expect(v.note).toContain(OTHER)
  }, 20_000)

  it('读不到 ⇒ unreadable，且**明说不能判变了**（这就是那起假红的病根）', () => {
    const v = judge('v0.8.4', SHA, null)
    expect(v.code).toBe('unreadable')
    expect(v.note).toContain('读不到')
    expect(v.note).toContain('不能判「变了」')
    // 反向断言：这条 note 里绝不能出现"变了"的结论式表述
    expect(v.note).not.toContain('tag 指向的 commit 变了')
  }, 20_000)

  it('空串与空 sha 也算读不到（不许被 `!==` 判成"变了"）', () => {
    expect(judge('v0.8.4', SHA, '').code).toBe('unreadable')
  }, 20_000)
})

describe('台账回写：读不到就不许写', () => {
  it('真 sha 允许写，null / 空串不许', () => {
    // canUpdateLedger 与 judgeCommit 同源，用 --judge 的三档反证它在 --update 里的用法：
    // null 时是 unreadable，而 --update 见到 unreadable 会整批拒绝（见 release-manifest.mjs）
    expect(judge('v0.8.4', SHA, null).code).toBe('unreadable')
    expect(judge('v0.8.4', SHA, SHA).code).toBe('ok')
  }, 20_000)
})

describe('用法错判 2，不判"通过"', () => {
  it('什么都不给 ⇒ 2', () => {
    expect(run([]).status).toBe(2)
  }, 20_000)

  it('--commit-of-ref 给非法 JSON ⇒ 2', () => {
    expect(run(['--commit-of-ref', '{not json']).status).toBe(2)
  }, 20_000)
})
