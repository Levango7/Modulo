import { describe, expect, it } from 'vitest'
import { resolveGroup, SETTINGS_GROUPS, visibleGroups } from '../../src/vue/settingsNav'

/**
 * 设置分组表（F-10）。钉的是"导航自己不会骗人"的那几条：
 * 组数、桌面/网页的差异、以及**任何坏 id 都必须落到一个真存在的组**。
 */

describe('分组表本身', () => {
  it('七组，顺序固定（外观 / 版面与方案 / 数据 / 提醒 / 桌面 / 实验室 / 关于）', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(['appearance', 'layout', 'data', 'reminders', 'desktop', 'lab', 'about'])
  })

  it('id 两两不同（撞了就是两个导航项指向同一块内容）', () => {
    const ids = SETTINGS_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每组都有标题与一句说明 —— 空标签在侧栏里就是一个点不动的死项', () => {
    for (const g of SETTINGS_GROUPS) {
      expect(g.title.trim(), `${g.id} 缺标题`).not.toBe('')
      expect(g.hint.trim(), `${g.id} 缺说明`).not.toBe('')
    }
  })

  it('桌面专属有两组：「桌面」与「实验室」（F-12 的 AI 配置要 Rust 出口与凭据库）', () => {
    expect(SETTINGS_GROUPS.filter((g) => g.desktopOnly).map((g) => g.id)).toEqual(['desktop', 'lab'])
  })
})

describe('当前平台看得到哪些组', () => {
  it('桌面七组，一个字不少', () => {
    expect(visibleGroups(true).map((g) => g.id)).toEqual(['appearance', 'layout', 'data', 'reminders', 'desktop', 'lab', 'about'])
  })

  it('网页版五组：没有「桌面」与「实验室」，其余顺序不变', () => {
    const ids = visibleGroups(false).map((g) => g.id)
    expect(ids).not.toContain('desktop')
    expect(ids).not.toContain('lab')
    expect(ids).toEqual(['appearance', 'layout', 'data', 'reminders', 'about'])
    // 顺序按「整张表去掉桌面组」来比，而不是另抄一份期望数组
    expect(ids).toEqual(SETTINGS_GROUPS.filter((g) => !g.desktopOnly).map((g) => g.id))
  })
})

describe('无效的组 id 一律落到一个真存在的组', () => {
  it('已知 id 命中它自己', () => {
    expect(resolveGroup('data', true).id).toBe('data')
    expect(resolveGroup('about', false).id).toBe('about')
  })

  it('未知 id / 空串 / null / undefined 都回第一组', () => {
    for (const bad of ['nope', '', null, undefined, 'DESKTOP']) {
      expect(resolveGroup(bad, true).id).toBe('appearance')
    }
  })

  it('网页版点到「桌面」这个 id：回第一组，而不是渲染一个不存在的面板', () => {
    expect(resolveGroup('desktop', false).id).toBe('appearance')
    // 同一个 id 在桌面版是合法的 —— 这条对照证明上面不是因为「desktop 永远不合法」
    expect(resolveGroup('desktop', true).id).toBe('desktop')
  })
})
