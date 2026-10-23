import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 卸载器永远不许删用户数据（2026-10-23 交互升级实测撞到的事故路径）。
 *
 * Tauri 的 NSIS 卸载确认页有一颗「删除应用程序数据」勾选框，勾上会
 * `RmDir /r "$APPDATA\${BUNDLEID}"` 并删除 `HKCU\Software\Modulo\Modulo`。
 * 交互升级（双击安装包）会先走「卸载旧版本」分支，用户顺手勾上 → 版面与卡片内容全没。
 * 修法是 `NSIS_HOOK_PREUNINSTALL`：模板把它插在 Section Uninstall **第一行**，
 * 早于一切删除动作，所以在这里把状态清零即可。
 *
 * 这条测试守**接线**：配置指向钩子、宏体真的把状态清零、CI 里有编译级自检。
 * 自检本身的「反例 DELETE / 正例 KEEP」在 desktop job 里由 makensis 真编真跑。
 */

const ROOT = resolve(__dirname, '../..')
const conf = JSON.parse(readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')) as {
  bundle: { windows?: { nsis?: { installerHooks?: string } } }
}
const hooks = readFileSync(resolve(ROOT, 'src-tauri/nsis/hooks.nsh'), 'utf8')
const selftest = readFileSync(resolve(ROOT, 'src-tauri/nsis/hook-selftest.nsi'), 'utf8')
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('NSIS 卸载钩子：卸载器不删用户数据', () => {
  it('bundle.windows.nsis.installerHooks 指向钩子文件', () => {
    expect(conf.bundle.windows?.nsis?.installerHooks).toBe('nsis/hooks.nsh')
  })

  it('PREUNINSTALL 宏在删除动作之前把「删数据」状态清零', () => {
    expect(hooks, '宏名必须精确（模板用 !ifmacrodef NSIS_HOOK_PREUNINSTALL 判断）').toMatch(
      /!macro\s+NSIS_HOOK_PREUNINSTALL\b/,
    )
    const start = hooks.indexOf('!macro NSIS_HOOK_PREUNINSTALL')
    const end = hooks.indexOf('!macroend', start)
    expect(start, '找不到宏定义').toBeGreaterThanOrEqual(0)
    expect(end, '宏没有 !macroend').toBeGreaterThan(start)
    // 清零必须落在宏体里，而不是文件里随便哪里
    expect(hooks.slice(start, end)).toMatch(/StrCpy\s+\$DeleteAppDataCheckboxState\s+0/)
  })

  it('自检脚本复刻了模板判据，且带反例（不调钩子必须 DELETE）', () => {
    expect(selftest).toContain('!include "hooks.nsh"')
    expect(selftest).toContain('!insertmacro NSIS_HOOK_PREUNINSTALL')
    expect(selftest).toContain('withoutHook=')
    expect(selftest).toContain('withHook=')
    expect(selftest, '反例就是模板那条判据本身').toMatch(/DeleteAppDataCheckboxState\s*=\s*1/)
  })

  it('desktop job 用 makensis 真编真跑，红绿两个样本都要断言', () => {
    expect(ci).toContain('NSIS 卸载钩子自检')
    expect(ci).toContain('makensis')
    expect(ci).toContain('hook-selftest.nsi')
    expect(ci, '反例必须真的判 DELETE，否则这条门禁没有射程').toContain('withoutHook=DELETE')
    expect(ci).toContain('withHook=KEEP')
    expect(ci, '没有 makensis 时必须红，不能空跑').toContain('拒绝空跑')
  })
})
