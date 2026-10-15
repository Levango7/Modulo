/**
 * 判据 5「机器资源撞车」的门禁测试。
 *
 * 为什么起子进程而不是 import：`coord-gate.mjs` 是一跑就会读 git、写 stdout、按结论
 * `process.exit(1)` 的**可执行门**，import 进来就等于在单测里真跑一遍全部判据。
 * 这里用 `--resources-only` 只跑判据 5，加上三个注入缝（板子路径 / 冻结时间 / 端口现查结果），
 * 于是每一条断言都在任何机器上算得出同一个数 —— 包括 CI 那台 Linux。
 *
 * 测试自己也在防一件事：**别把"没跑"读成"通过"**。所以下面既断言红，也断言
 * 「绿的那两种含义」（表缺失 vs 真的没人认领）输出不同 —— 判据 5 最容易自欺的地方就在这。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 门的路径按**测试文件自己**的位置算，不按 cwd —— vitest 的 cwd 会随跑法变（单跑这个文件、
// 全量跑、CI 上跑），而 `resolve('.')` 一变就变成"门不存在"，那种红跟判据一点关系都没有。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GATE = join(ROOT, 'scripts', 'coord-gate.mjs')
/** 冻在 10-15 12:00：夹具里 `10-15 09:00` 是 3 小时（新鲜），`10-13 12:00` 是 48 小时（陈旧） */
const NOW = '2026-10-15T12:00:00'
const dir = mkdtempSync(join(tmpdir(), 'coord-gate-fixtures-'))

type Row = { res: string; kind: string; who?: string; time?: string; status: string; note?: string }

const board = (rows: Row[]): string => `
## 机器资源认领

| 资源 | 独占性 | 认领人 | 时间 | 状态 | 备注 |
|------|--------|--------|------|------|------|
${rows
  .map(
    (r) =>
      `| \`${r.res}\` | ${r.kind} | ${r.who ?? '—'} | ${r.time ?? '—'} | ${r.status} | ${r.note ?? ''} |`,
  )
  .join('\n')}

## 下一节
`
// 表后面必须再来一个标题：判据 5 靠「下一个标题」切段，少了它就把尾巴当表读

const claim = (res: string, extra: Partial<Row> = {}): Row => ({
  res,
  kind: '独占',
  who: 'agent-A',
  time: '10-15 09:00',
  status: '进行中',
  ...extra,
})

const run = (
  text: string | null,
  env: Record<string, string> = {},
): { code: number; out: string } => {
  const file = join(dir, `board-${Math.random().toString(36).slice(2)}.md`)
  if (text !== null) writeFileSync(file, text, 'utf8')
  try {
    const out = execFileSync('node', [GATE, '--resources-only'], {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COORD_BOARD: file, COORD_NOW: NOW, COORD_PORT_OWNER: '{}', ...env },
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

describe('判据 5：机器资源撞车', () => {
  it('两条新鲜认领同一条资源 → 红，并把两条都点名', () => {
    const r = run(
      board([claim('port:9333'), claim('port:9333', { who: 'agent-B', time: '10-15 10:30' })]),
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('认领了同一条机器资源')
    expect(r.out).toContain('agent-A')
    expect(r.out).toContain('agent-B')
  })

  it('资源 id 用反引号包（本板的行文风格）不影响比对', () => {
    // 门按字面匹配的话，第一版就把每一行都判成「不合规矩」，人们会为了过门改写法而不是改行为
    expect(run(board([claim('port:9333')])).code).toBe(0)
  })

  it('独占性列的装饰（**独占**（钉死））仍算同一档', () => {
    const r = run(board([claim('port:9333', { kind: '**独占**（钉死）' }), claim('port:9333', { who: 'B' })]))
    expect(r.code).toBe(1)
  })

  it('一条已释放 → 不阻塞（认领过但不占着，不是撞车）', () => {
    const r = run(board([claim('port:9333'), claim('port:9333', { who: 'B', status: '已释放', time: '10-13 12:00' })]))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('认领了同一条机器资源')
  })

  it('陈旧那条（>24h）退出比对：只警告，不锁死这条资源', () => {
    const r = run(board([claim('port:9333', { time: '10-13 12:00' }), claim('port:9333', { who: 'B' })]))
    expect(r.code).toBe(0)
    expect(r.out).toContain('已挂 48 小时')
    expect(r.out).toContain('不再参与撞车比对')
  })

  it('时间写脏 → 警告，但仍按新鲜参与比对（写脏日期绕不过门）', () => {
    const r = run(board([claim('port:9333', { time: '昨天' }), claim('port:9333', { who: 'B', time: '10-15' })]))
    expect(r.code).toBe(1)
    expect(r.out).toContain('不是 `MM-DD HH:mm`')
  })

  it('钉死资源登记成「编号」→ 红（换号并行不了，动的是 CSP 不是启动参数）', () => {
    const r = run(board([claim('port:1430', { kind: '编号' })]))
    expect(r.code).toBe(1)
    expect(r.out).toContain('钉死在配置里')
  })

  it('钉死资源登记成「独占」→ 不报这一条', () => {
    const r = run(board([claim('port:1430', { kind: '独占' })]))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain('钉死在配置里')
  })

  it('HKCU 与 appdata 也在钉死清单里（10-15 那次 %TEMP% 事故的根因）', () => {
    for (const res of ['registry:HKCU\\Software\\Modulo', 'appdata:app.modulo']) {
      const r = run(board([claim(res, { kind: '编号' })]))
      expect(r.code, `${res} 被登记成编号却没报错 —— PINNED 是不是漏了这一条？`).toBe(1)
    }
  })

  it('资源列不合规矩 → 警告并明说"这行从比对里消失了"', () => {
    const r = run(board([claim('1430'), claim('随便写的东西')]))
    expect(r.code).toBe(0)
    expect(r.out).toContain('不合规矩')
    expect(r.out.split('不合规矩').length - 1).toBe(2)
  })

  it('独占性写成别的词 → 警告（那一列决定怎么判，写错等于没登记）', () => {
    const r = run(board([claim('port:9333', { kind: '都行' })]))
    expect(r.out).toContain('只认「独占」或「编号」')
  })

  it('表整张缺失 → 警告「一行都没跑」，与「没人认领」输出必须不同', () => {
    const noSection = run('# 板子\n\n## 作业面登记\n\n| a | b |\n')
    expect(noSection.code).toBe(0)
    expect(noSection.out).toContain('一行都没跑')
    const emptySection = run(board([]))
    expect(emptySection.out).not.toContain('一行都没跑')
    // 这条断言才是重点：两种"绿"被区分开了
    expect(noSection.out).not.toBe(emptySection.out)
  })

  it('板子文件不存在 → 也警告，不静默绿', () => {
    const r = run(null)
    expect(r.out).toContain('找不到协调板')
  })

  it('端口现查：被外部进程占着 → 警告（"能连上就算我的"那条假阳的成因）', () => {
    const r = run(
      board([claim('port:9223')]),
      { COORD_PORT_OWNER: JSON.stringify({ '9223': { pid: 21624, name: 'CatPawAI', cmd: 'F:\\Program Files\\CatPawAI\\CatPawAI.exe' } }) },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('外部进程')
    expect(r.out).toContain('PID 21624')
  })

  it('端口现查：命令行里有 Modulo 路径 → 报「像是本仓现场」而不是警告', () => {
    const r = run(
      board([claim('port:9333')]),
      { COORD_PORT_OWNER: JSON.stringify({ '9333': { pid: 7, name: 'modulo', cmd: 'F:\\Nexus\\Modulo\\src-tauri\\target\\release\\modulo.exe' } }) },
    )
    expect(r.out).toContain('像是本仓现场')
    expect(r.out).not.toContain('外部进程')
  })

  it('端口现查：没人听 → 现查播报，不是警告也不是红', () => {
    const r = run(board([claim('port:9333')]), { COORD_PORT_OWNER: JSON.stringify({ '9333': null }) })
    expect(r.code).toBe(0)
    expect(r.out).toContain('现在没人听')
    expect(r.out).not.toContain('⚠')
  })

  it('COORD_PORT_OWNER 不是合法 JSON → 明说跳过，不猜', () => {
    const r = run(board([claim('port:9333')]), { COORD_PORT_OWNER: '{不是 json' })
    expect(r.out).toContain('不是合法 JSON')
  })

  it('CI 上不做实占核对：如实打印跳过，绝不报「空闲」', () => {
    // 这条是防假绿的核心：Linux runner 上读不到 owning PID，
    // 把它当"端口没人用"会让下一个人以为安全 —— 而无从核对和空闲在输出里必须长得不一样。
    const r = run(board([claim('port:9333')]), { CI: '1', COORD_PORT_OWNER: '' })
    expect(r.out).toContain('实占核对跳过')
    expect(r.out).toContain('没在这台机器上核对过')
    expect(r.out).not.toContain('现在没人听')
  })

  it('端口号不是纯数字 → 不拼进命令，并警告', () => {
    const r = run(board([claim('port:1430; rm -rf')]))
    expect(r.out).toContain('不是纯数字')
  })

  it('--resources-only 只跑判据 5：不带 git 那几条的噪声', () => {
    const r = run(board([claim('port:9333')]))
    expect(r.out).toContain('只跑判据 5')
    expect(r.out).not.toContain('临时脚本')
    expect(r.out).not.toContain('拿不到本次提交的改动清单')
  })
})
