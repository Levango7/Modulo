import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 安装包必须带 sherpa 的 4 个运行时 DLL（2026-10-22 的真实事故）。
 *
 * v0.8.4 的 NSIS 安装包装完只有一个 `modulo.exe` + `uninstall.exe`，而 exe **静态依赖**
 * `sherpa-onnx-c-api.dll` —— 用户装完双击就是 `0xC0000135`（DLL 未找到），应用根本起不来。
 * 本机探针实测：缺 DLL 时 0/2；把 4 个 DLL 放到 exe 旁边后 55/55。
 *
 * 这条测试守的是**打包配置的形状**（真正的产物断言在 release job 的 7z 内容门禁里）：
 * - `bundle.resources` 必须把 4 个 DLL 映射到**安装根目录**（裸文件名，不是子目录）；
 * - 两个会出包的 job 都必须先把 DLL 复制进 `src-tauri/sherpa-dlls/`（resources 的源）；
 * - release job 必须保留"解包核对"那一步 —— 少了它，配置对但产物缺文件就没人发现。
 */

const ROOT = resolve(__dirname, '../..')
const DLLS = ['sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll']

const conf = JSON.parse(readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')) as {
  bundle: { resources?: Record<string, string> }
}
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('安装包内容：sherpa DLL 必须打进去', () => {
  it('bundle.resources 把 4 个 DLL 映射到安装根目录（裸文件名）', () => {
    const res = conf.bundle.resources ?? {}
    for (const d of DLLS) {
      expect(res[`sherpa-dlls/${d}`], `${d} 没在 bundle.resources 里`).toBe(d)
    }
  })

  it('两个出包 job 都先把 DLL 复制进 src-tauri/sherpa-dlls（resources 的源目录）', () => {
    // desktop（--no-bundle）与 release（真打包）各一处；少一处时配置会在那条腿上找不到源文件
    const copies = [...ci.matchAll(/src-tauri\/sherpa-dlls/g)].length
    expect(copies, 'ci.yml 里复制步骤不足两处（desktop + release）').toBeGreaterThanOrEqual(2)
    expect(ci).toContain('SHERPA_ONNX_LIB_DIR')
  })

  it('release job 保留"安装包内容门禁"（7z 解包核对），且缺 7z 时拒绝空跑', () => {
    expect(ci).toContain('安装包内容门禁（4 个 sherpa DLL 必须在包里）')
    expect(ci).toContain('7-Zip\\7z.exe')
    expect(ci).toContain('拒绝空跑')
    for (const d of DLLS) expect(ci, `门禁清单里没有 ${d}`).toContain(d)
  })
})
