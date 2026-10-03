import { describe, expect, it } from 'vitest'
import { parseRepo, repoApiUrl, repoPageUrl, repoPathOk } from '@modulo/engine/ghrepo'

/** 真夹具：2026-10-04 抓的 api.github.com/repos/Levango7/Modulo（截了卡上要用的字段） */
const REAL = {
  id: 1400331597,
  name: 'Modulo',
  full_name: 'Levango7/Modulo',
  private: false,
  description: 'A modular workspace app where the layout engine is the product. Vue 3 + TypeScript + Tauri 2.',
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  pushed_at: '2026-10-03T22:48:36Z',
  default_branch: 'master',
  language: 'TypeScript',
}

describe('parseRepo：真响应落进快照', () => {
  it('要用的六个字段逐项对', () => {
    const s = parseRepo(REAL, 7)
    expect(s).not.toBeNull()
    expect(s!.fullName).toBe('Levango7/Modulo')
    expect(s!.stars).toBe(0)
    expect(s!.issues).toBe(0)
    expect(s!.pushedAt).toBe('2026-10-03T22:48:36Z')
    expect(s!.language).toBe('TypeScript')
    expect(s!.description).toContain('layout engine is the product')
    expect(s!.fetchedAt).toBe(7)
  })

  it('GitHub 的错误体（{message:"Not Found"}）被拦住 —— 没有 full_name 就不认', () => {
    expect(parseRepo({ message: 'Not Found', documentation_url: 'https://…' }, 0)).toBeNull()
    expect(parseRepo({ full_name: '' }, 0)).toBeNull()
    expect(parseRepo(null, 0)).toBeNull()
  })

  it('计数字段坏掉按 0 处理（星级显示 0 好过显示 NaN）', () => {
    const s = parseRepo({ ...REAL, stargazers_count: -1, open_issues_count: 'x' }, 0)
    expect(s!.stars).toBe(0)
    expect(s!.issues).toBe(0)
  })
})

describe('repoPathOk / URL：严格形状，挡住把任意串拼进 URL', () => {
  it('合法：owner/name（点横线下划线都行）', () => {
    expect(repoPathOk('Levango7/Modulo')).toBe(true)
    expect(repoPathOk('a-b_c.d/e-f_g.h')).toBe(true)
    expect(repoPathOk('  Levango7/Modulo  ')).toBe(true)
  })

  it('非法：只有一段、三段、空格、斜杠开头、点开头', () => {
    expect(repoPathOk('Modulo')).toBe(false)
    expect(repoPathOk('a/b/c')).toBe(false)
    expect(repoPathOk('a b/c')).toBe(false)
    expect(repoPathOk('/Modulo')).toBe(false)
    expect(repoPathOk('../etc/passwd')).toBe(false)
    expect(repoPathOk('a/..')).toBe(false)
    expect(repoPathOk('')).toBe(false)
  })

  it('两个 URL：API 与网页版', () => {
    expect(repoApiUrl('Levango7/Modulo')).toBe('https://api.github.com/repos/Levango7/Modulo')
    expect(repoPageUrl('Levango7/Modulo')).toBe('https://github.com/Levango7/Modulo')
    expect(repoApiUrl('nope')).toBeNull()
    expect(repoPageUrl('a/b/c')).toBeNull()
  })
})
