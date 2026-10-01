import { describe, expect, it } from 'vitest'
import { DATA_KEYS, createFileStorage, hydrateData } from '../../src/vue/fileStorage'

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))

describe('桌面壳的数据落盘适配器', () => {
  it('get 读到 hydrate 的内容，set 立刻对镜像生效并异步写穿', async () => {
    const written: Array<[string, string]> = []
    const s = createFileStorage({ a: '1' }, async (n, c) => void written.push([n, c]))

    expect(s.get('a')).toBe('1')
    expect(s.get('missing')).toBeNull()

    s.set('a', '2')
    expect(s.get('a')).toBe('2') // 同步可读，不等磁盘
    await settle()
    expect(written).toEqual([['a', '2']])
  })

  it('写失败会挂在 error 上，之后同一 key 写成功会清掉', async () => {
    let fail = true
    const s = createFileStorage({}, async () => {
      if (fail) throw new Error('disk full')
    })

    s.set('k', 'v')
    await settle()
    expect(s.error.value).toContain('disk full')

    fail = false
    s.set('k', 'v2')
    await settle()
    expect(s.error.value).toBeNull()
  })

  /** Rust 侧同一个 key 用同一个临时文件名，两次写重叠就会落半份 JSON */
  it('同一个 key 的并发写被强制排队', async () => {
    let active = 0
    let peak = 0
    const s = createFileStorage({}, () => {
      active += 1
      peak = Math.max(peak, active)
      return new Promise<void>((r) =>
        setTimeout(() => {
          active -= 1
          r()
        }, 5),
      )
    })

    s.set('k', 'a')
    s.set('k', 'b')
    s.set('k', 'c')
    await settle(120)
    expect(peak).toBe(1)
  })

  it('一次写失败不会把后续写永久卡住', async () => {
    const done: string[] = []
    const s = createFileStorage({}, async (_n, c) => {
      if (c === 'bad') throw new Error('boom')
      done.push(c)
    })

    s.set('k', 'bad')
    s.set('k', 'good')
    await settle()
    expect(done).toEqual(['good'])
  })

  it('磁盘没有文件时回退到旧的 localStorage 并立刻迁移', async () => {
    const legacy: Record<string, string> = { [DATA_KEYS[0]]: '{"from":"localstorage"}' }
    const migrated: Array<[string, string]> = []
    const out = await hydrateData(
      async () => null,
      async (n, c) => void migrated.push([n, c]),
      (k) => legacy[k] ?? null,
    )

    expect(out[DATA_KEYS[0]]).toBe('{"from":"localstorage"}')
    expect(migrated).toEqual([[DATA_KEYS[0], '{"from":"localstorage"}']])
  })

  it('磁盘已有内容时以磁盘为准，不被旧 localStorage 覆盖', async () => {
    const out = await hydrateData(
      async () => '{"from":"disk"}',
      async () => {},
    )
    expect(out[DATA_KEYS[0]]).toBe('{"from":"disk"}')
  })

  it('读盘抛异常按"没有这个文件"处理，不能让应用起不来', async () => {
    const out = await hydrateData(async () => {
      throw new Error('EACCES')
    })
    expect(Object.keys(out).sort()).toEqual([...DATA_KEYS].sort())
    expect(Object.values(out).every((v) => v === null)).toBe(true)
  })
})
