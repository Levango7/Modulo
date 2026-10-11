import { describe, expect, it } from 'vitest'
import { MAX_CMD_LABEL, MAX_CMD_TEXT, normalizeCommand, normalizeCmdLabel, sanitizeCommands } from '../../packages/engine/src/commands'

describe('normalizeCommand', () => {
  it('去空白；空串拒收', () => {
    expect(normalizeCommand('  ls -la  ')).toBe('ls -la')
    expect(normalizeCommand('   ')).toBeNull()
  })
  it('截长到上限；**保留多行**（管道/脚本贴进来是常态）', () => {
    const long = 'x'.repeat(MAX_CMD_TEXT + 10)
    expect(normalizeCommand(long)).toHaveLength(MAX_CMD_TEXT)
    expect(normalizeCommand('a\nb\nc')).toBe('a\nb\nc')
  })
})

describe('normalizeCmdLabel', () => {
  it('有名字用名字；空名用命令首行兜底', () => {
    expect(normalizeCmdLabel('  重启服务 ', 'x')).toBe('重启服务')
    expect(normalizeCmdLabel('', 'kubectl get pods\n# 注释')).toBe('kubectl get pods')
  })
  it('名字截短到上限', () => {
    expect(normalizeCmdLabel('x'.repeat(MAX_CMD_LABEL + 5), 'ls')).toHaveLength(MAX_CMD_LABEL)
  })
})

describe('sanitizeCommands：清洗整份名单', () => {
  it('丢坏条目（空命令 / 非字符串）、保留合法的', () => {
    const out = sanitizeCommands([
      { label: '好', cmd: 'ls -la' },
      { label: '坏', cmd: '   ' },
      { label: 42, cmd: 7 },
      { label: '也好', cmd: 'git status' },
    ])
    expect(out.map((c) => c.label)).toEqual(['好', '也好']) // 坏条目被丢掉；按名字 zh-Hans 排序
  })
  it('同名同命令去重；id 冲突自动改写保证唯一', () => {
    const out = sanitizeCommands([
      { id: 'c1', label: '重启', cmd: 'reboot' },
      { id: 'c1', label: '重启', cmd: 'reboot' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('c1')
  })
  it('截长到上限；空输入给空表', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ label: `第${i}条`, cmd: `cmd-${i}` }))
    expect(sanitizeCommands(many)).toHaveLength(80)
    expect(sanitizeCommands([])).toEqual([])
  })
})
