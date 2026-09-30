import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ENGINE_DIR = resolve(process.cwd(), 'src/engine')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? tsFiles(full) : full.endsWith('.ts') ? [full] : []
  })
}

/**
 * 引擎层必须是纯函数：不依赖框架、不碰 DOM。
 * 这条测试是分层约定的唯一执法者——破了它，引擎就没法脱离 UI 单测。
 */
describe('engine 纯度守卫', () => {
  const files = tsFiles(ENGINE_DIR)
  it('目录非空', () => {
    expect(files.length).toBeGreaterThan(0)
  })
  it.each(files.map((f) => [f]))('%s 不引用框架/DOM/宿主环境', (file) => {
    const src = readFileSync(file, 'utf8')
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(specs.filter((s) => /^(vue|@tauri|@vitejs|react)/.test(s))).toEqual([])
    expect(src.match(/\b(document|window|localStorage|navigator|process)\b/)).toBeNull()
  })
})
