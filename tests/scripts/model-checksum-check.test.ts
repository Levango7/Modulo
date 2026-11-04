/**
 * 模型校验和台账那道门（`scripts/model-checksum-check.mjs`）的判据。
 *
 * 为什么起子进程：这道门是**会按结论 `process.exit` 的可执行门**（0 全绿 / 1 有红 / 2 压根没跑），
 * import 进来既拿不到退出码也会被它的 `process.exit` 打断单测进程。路子与
 * `desktop-probe-preflight.test.ts` 一致：真跑 CLI + 注入缝换输入。
 *
 * 两条注入缝：
 * - `MODELS_CK_LEDGER` —— 换台账文件（每条红判据都用自己的坏样本复现，不依赖"这台机器上碰巧没坏"）；
 * - `MODELS_CK_FIXTURE_DIR` —— 用本地目录冒充各 release 的 `checksum.txt`
 *   （目录里没有 `<release>.txt` = 该 release 没有校验文件；再放一个 `<release>.ERR` = 那次请求失败）。有了它，"上游换包 / 上游补出
 *   官方校验和 / 上游撤掉校验和 / 请求本身失败" 四种上游形状都能离线复现，不用真下 216MB，也不用等上游哪天配合。
 *
 * 背景（2026-11-04 复测）：`speaker-segmentation-models` 至今没有 `checksum.txt`，
 * diarization 要用的 pyannote 分包只能自证；其余四件都有官方行，逐条按**完整文件名**对过。
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO, 'scripts', 'model-checksum-check.mjs')
const REAL_LEDGER = join(REPO, 'model-checksums.json')
const SELF_FILE = 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
const SEG_RELEASE = 'speaker-segmentation-models'

// 每条都起一个 node 子进程：全量跑时机器被别的用例挤满，默认 5s 会不够（同档的探针用例就红过）
const TIMEOUT = 30_000

type Run = { code: number; out: string }

// spawnSync 而不是 execFileSync：红项清单走 stderr，execFileSync 成功时只回 stdout（处置文案会丢）
const run = (env: Record<string, string> = {}, args: string[] = []): Run => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const ledgerOf = () => JSON.parse(readFileSync(REAL_LEDGER, 'utf8')) as any

/** 把改过的台账落到临时文件，返回路径（用例只改一个维度，其余保持真台账的样子） */
const putLedger = (name: string, mutate: (l: any) => void): string => {
  const l = ledgerOf()
  mutate(l)
  const p = join(tmpdir(), `modulo-ck-${name}-${process.pid}.json`)
  writeFileSync(p, JSON.stringify(l, null, 2), 'utf8')
  return p
}

/**
 * 造一个"上游"目录：每个 release 一份 checksum.txt，内容 = 台账里那些官方行。
 * 默认**不给**自证那个 release 的文件（照今天的实情：它压根没有官方校验和）。
 * `drop` 里的 release 不给文件，`extra[release]` 追加原始行。
 */
const putFixtures = (
  name: string,
  opts: {
    drop?: string[]
    err?: string[]
    rewrite?: Record<string, (lines: string[]) => string[]>
    extra?: Record<string, string>
  } = {},
): string => {
  const dir = join(tmpdir(), `modulo-ck-fx-${name}-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // `<release>.ERR` = 那次请求失败（走 UNREACHABLE 那一支），与"没有校验文件"是两种形状
  for (const release of opts.err ?? []) {
    writeFileSync(join(dir, `${release}.ERR`), 'fetch failed', 'utf8')
  }
  const byRelease = new Map<string, string[]>()
  for (const a of ledgerOf().artifacts) {
    if (a.trust !== 'official-checksum-txt') continue
    const list = byRelease.get(a.release) ?? []
    list.push(a.official_line)
    byRelease.set(a.release, list)
  }
  for (const [release, lines] of byRelease) {
    if (opts.drop?.includes(release) || opts.err?.includes(release)) continue
    const final = opts.rewrite?.[release] ? opts.rewrite[release](lines) : lines
    writeFileSync(join(dir, `${release}.txt`), final.join('\n') + '\n', 'utf8')
  }
  for (const [release, text] of Object.entries(opts.extra ?? {})) {
    writeFileSync(join(dir, `${release}.txt`), text, 'utf8')
  }
  return dir
}

describe('模型校验和台账门：离线判据', () => {
  it('真台账 + 真代码 → 退出 0，且如实说漂移腿没跑', async () => {
    const r = run()
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/项断言通过/)
    // 默认离线 ⇒ 不许假装"上游没漂移"
    expect(r.out).toContain('DRIFT-SKIP')
    expect(r.out).not.toMatch(/^DRIFT  /m)
    expect(r.out).not.toContain('✗')
  }, TIMEOUT)

  it('台账文件读不到 → 退出码 2（这是"没跑"，不是"通过"）', () => {
    const r = run({ MODELS_CK_LEDGER: join(tmpdir(), 'modulo-ck-nope.json') })
    expect(r.code).toBe(2)
    expect(r.out).toContain('台账不存在')
    expect(r.out).not.toMatch(/项断言通过/)
  }, TIMEOUT)

  it('台账是坏 JSON → 退出码 2 并点名文件', () => {
    const p = join(tmpdir(), `modulo-ck-broken-${process.pid}.json`)
    writeFileSync(p, '{not json', 'utf8')
    const r = run({ MODELS_CK_LEDGER: p })
    expect(r.code).toBe(2)
    expect(r.out).toContain('不是合法 JSON')
  }, TIMEOUT)

  it('台账没有 artifacts 数组 → 退出码 2', () => {
    const p = join(tmpdir(), `modulo-ck-noarr-${process.pid}.json`)
    writeFileSync(p, JSON.stringify({ schema: 'modulo.model-checksums.v1' }), 'utf8')
    const r = run({ MODELS_CK_LEDGER: p })
    expect(r.code).toBe(2)
    expect(r.out).toContain('artifacts 数组')
  }, TIMEOUT)

  it('官方行抄成另一款文件的行 → 红（这一维是为 campplus 三行同族而设的）', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('line', (l) => {
        const a = l.artifacts.find((x: any) => x.id === 'vad')
        a.official_line = `silero_vad.onnx\t${a.sha256}`
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('逐字对得上')
  }, TIMEOUT)

  it('digest 被截断一位 → 红在"64 位小写 hex"', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('short', (l) => {
        l.artifacts.find((x: any) => x.id === 'asr').sha256 = '7305f790'
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('64 位小写 hex')
  }, TIMEOUT)

  it('自证基线只剩一次实测 → 红在「≥2 次独立实测」，且只红这一条', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('one-shot', (l) => {
        l.artifacts.find((x: any) => x.trust === 'self-attested').measurements.splice(1, 1)
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('≥2 次独立实测')
    // 只删一次实测不该连坐别的判据 —— 连坐了说明维度没分开，变异验证就失去指向
    expect(r.out.match(/✗/g)?.length).toBe(1)
  }, TIMEOUT)

  it('两次实测的 digest 不同 → 红（那就不是"同一个包实测两次"）', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('two-digests', (l) => {
        const m = l.artifacts.find((x: any) => x.trust === 'self-attested').measurements
        m[1].sha256 = 'b'.repeat(64)
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('各次实测的 digest 全等于基线')
  }, TIMEOUT)

  it('悄悄加第二条自证记录（不动预算）→ 红', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('budget', (l) => {
        const clone = structuredClone(l.artifacts.find((x: any) => x.trust === 'self-attested'))
        clone.id = 'diar-seg2'
        clone.file = 'another-no-checksum.tar.bz2'
        l.artifacts.push(clone)
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('自证例外条数等于声明的预算')
  }, TIMEOUT)

  it('把那条自证记录删掉（预算还写着 1）→ 也红', () => {
    // 棘轮必须是**双向**的：只拦"多"不拦"少"，就会出现"例外悄悄消失、预算却还挂在 1"
    // —— 那意味着台账在描述一个不存在的例外，或有人没拍板就撤了自证基线。
    const r = run({
      MODELS_CK_LEDGER: putLedger('budget-low', (l) => {
        l.artifacts = l.artifacts.filter((x: any) => x.trust !== 'self-attested')
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('自证例外条数等于声明的预算')
  }, TIMEOUT)

  it('两条记录共用一个 id → 红（重名的话 digest 谁说了算没人知道）', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('dup-id', (l) => {
        l.artifacts.find((x: any) => x.id === 'diar-emb').id = 'diar-seg'
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('每条记录有 id 且不重名')
  }, TIMEOUT)

  it('分级档位写成没认领过的值 → 红（不许用第三种标签绕过棘轮）', () => {
    const r = run({
      MODELS_CK_LEDGER: putLedger('tier', (l) => {
        l.artifacts.find((x: any) => x.trust === 'self-attested').trust = 'trusted-by-vibes'
      }),
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('trust 只有已认领的两档')
  }, TIMEOUT)
})

describe('模型校验和台账门：漂移腿（fixture 冒充上游）', () => {
  it('上游逐行对得上 → MATCH 且全绿', () => {
    const r = run({ MODELS_CK_FIXTURE_DIR: putFixtures('match') })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^DRIFT  sherpa-onnx-sense-voice\S+  MATCH$/m)
    expect(r.out).not.toContain('DRIFT-SKIP')
  }, TIMEOUT)

  it('上游重新打包（同文件名不同 digest）→ 红并拒绝"直接抄上游新值"', () => {
    const dir = putFixtures('drift', {
      rewrite: { 'asr-models': (lines) => lines.map((l) => (l.startsWith('silero_vad') ? `silero_vad.int8.onnx\t${'d'.repeat(64)}` : l)) },
    })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^DRIFT  silero_vad\.int8\.onnx  DRIFT$/m)
    expect(r.out).toContain('上游换包了')
    expect(r.out).toContain('别直接抄上游新值')
  }, TIMEOUT)

  it('上游把 checksum.txt 撤了 → 官方分级当场不成立', () => {
    const r = run({ MODELS_CK_FIXTURE_DIR: putFixtures('gone', { drop: ['asr-models'] }) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^DRIFT  silero_vad\.int8\.onnx  GONE$/m)
    expect(r.out).toContain('官方分级不再成立')
    // 只撤了一个 release ⇒ 另外三个 release 的结论照样打出来（不是整条腿提前退出）
    expect(r.out).toMatch(/^DRIFT  3dspeaker_speech_campplus\S+  MATCH$/m)
  }, TIMEOUT)

  it('上游把某款资产从清单里摘走（文件没这行）→ 红在「里有这一行」', () => {
    const dir = putFixtures('unlisted', {
      rewrite: { 'asr-models': (lines) => lines.filter((l) => !l.startsWith('silero_vad')) },
    })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^DRIFT  silero_vad\.int8\.onnx  NOT-LISTED$/m)
    expect(r.out).toContain('官方出处不成立')
  }, TIMEOUT)

  it('自证那个 release 补出官方行且与基线一致 → 红，要求改判官方', () => {
    const self = ledgerOf().artifacts.find((x: any) => x.trust === 'self-attested')
    const dir = putFixtures('promote', { extra: { [SEG_RELEASE]: `${self.file}\t${self.sha256}\n` } })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(new RegExp(`^DRIFT  ${SELF_FILE.replace(/[.]/g, '\\.')}  PROMOTABLE$`, 'm'))
    expect(r.out).toContain('该改判')
  }, TIMEOUT)

  it('补出的官方行与自证基线不同 → 红在「被推翻」，并要留痕', () => {
    const dir = putFixtures('overturn', { extra: { [SEG_RELEASE]: `${SELF_FILE}\t${'e'.repeat(64)}\n` } })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(new RegExp(`^DRIFT  ${SELF_FILE.replace(/[.]/g, '\\.')}  OVERTURNED$`, 'm'))
    expect(r.out).toContain('上游重新打过包或我们抄错')
  }, TIMEOUT)

  it('补出的官方文件里没有我们这个文件 → 不冤枉它（自证分级照样成立）', () => {
    const dir = putFixtures('other-line', { extra: { [SEG_RELEASE]: `something-else.tar.bz2\t${'a'.repeat(64)}\n` } })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(new RegExp(`^DRIFT  ${SELF_FILE.replace(/[.]/g, '\\.')}  NOT-LISTED$`, 'm'))
  }, TIMEOUT)

  it('今天的实情仍在：自证那个 release 没有 checksum.txt ⇒ STILL-NONE 且不红', () => {
    const r = run({ MODELS_CK_FIXTURE_DIR: putFixtures('reality') })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(new RegExp(`^DRIFT  ${SELF_FILE.replace(/[.]/g, '\\.')}  STILL-NONE$`, 'm'))
  }, TIMEOUT)

  it('取不到上游（请求失败）→ 红，且逐件打 UNREACHABLE 而不是静默跳过', () => {
    // 「查不到」被读成「没问题」是自动链上最危险的一种假绿，这一支必须有样本。
    // 本机实测过这个形状：node 直连 GitHub 四条 fetch 全挂，而同一批文件 curl 全通。
    const dir = putFixtures('unreachable', { err: ['asr-models'] })
    const r = run({ MODELS_CK_FIXTURE_DIR: dir })
    expect(r.code).toBe(1)
    expect(r.out).toContain('release asr-models 的 checksum.txt 取回来了')
    expect(r.out).toContain('取不到不等于没漂移')
    expect(r.out).toMatch(/^DRIFT  silero_vad\.int8\.onnx  UNREACHABLE$/m)
    expect(r.out).toMatch(/^DRIFT  sherpa-onnx-sense-voice\S+  UNREACHABLE$/m)
    // 只挂一个 release ⇒ 另两个 release 的结论照常打（不是整条腿提前退出）
    expect(r.out).toMatch(/^DRIFT  3dspeaker_speech_campplus\S+  MATCH$/m)
  }, TIMEOUT)
})
