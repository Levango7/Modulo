import { describe, expect, it } from 'vitest'
import { barFrac, formatSize, netRate, pickDisk } from '../../packages/engine/src/sysmon'

describe('formatSize：字节的人话化', () => {
  it('0 与坏值给 0 B；1KB 以下原样', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(-5)).toBe('0 B')
    expect(formatSize(Number.NaN)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
  })
  it('逐级换算，大数保留整数位', () => {
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(1024 * 1024 * 1.5)).toBe('1.5 MB')
    expect(formatSize(1024 ** 3 * 3)).toBe('3 GB')
    expect(formatSize(1024 ** 4 * 5)).toBe('5 TB')
  })
  it('超过 TB 停在 TB（10 PB 级不再换单位）', () => {
    expect(formatSize(1024 ** 5 * 7)).toContain('TB')
  })
})

describe('netRate：相邻采样差分', () => {
  it('正常差分：2 秒收 2KB → 1024 B/s', () => {
    expect(netRate(1000, 3048, 2000)).toBe(1024)
  })
  it('dt ≤ 0 或坏值给 0（不出现 NaN 速率）', () => {
    expect(netRate(1000, 2000, 0)).toBe(0)
    expect(netRate(Number.NaN, 2000, 1000)).toBe(0)
  })
  it('计数器回绕（重启网卡后 cur < prev）如实给 0，不出现负速率', () => {
    expect(netRate(9000, 100, 2000)).toBe(0)
  })
})

describe('pickDisk：选展示盘', () => {
  it('空表给 null（界面显示没探到，不编）', () => {
    expect(pickDisk([])).toBeNull()
  })
  it('Windows 盘符优先、最短挂载点（系统盘）胜出', () => {
    const disks = [
      { mount: 'D:\\data', used: 1, total: 10 },
      { mount: 'C:\\', used: 2, total: 20 },
      { mount: 'E:\\', used: 3, total: 30 },
    ]
    expect(pickDisk(disks)?.mount).toBe('C:\\')
  })
  it('没有盘符形状时退最大的一块', () => {
    const disks = [
      { mount: '/mnt/a', used: 1, total: 10 },
      { mount: '/mnt/b', used: 2, total: 50 },
    ]
    expect(pickDisk(disks)?.mount).toBe('/mnt/b')
  })
})

describe('barFrac：填充比例', () => {
  it('正常比例、四舍五入 3 位', () => {
    expect(barFrac(50, 200)).toBe(0.25)
    expect(barFrac(1, 3)).toBe(0.333)
  })
  it('cap 在 1：100.4% 的 CPU 不撑破条', () => {
    expect(barFrac(100.4, 100)).toBe(1)
  })
  it('max ≤ 0 / 负值 / 坏值给 0', () => {
    expect(barFrac(10, 0)).toBe(0)
    expect(barFrac(-3, 100)).toBe(0)
    expect(barFrac(Number.NaN, 100)).toBe(0)
  })
})
