import { existsSync } from 'node:fs'

/**
 * 跨平台找本机 Chrome（E2E 共用）。CI 上 Chromium 在 `/usr/bin/google-chrome`，
 * 本机在 Program Files —— 早先这段逻辑只长在 `layout.spec.ts` 里，新写的 E2E 文件
 * 直接抄了 Windows 路径，CI 上就是 "Browser was not found"（2026-10-13 实际踩到）。
 * 抽出来共用：新加的 E2E 一律从这里取路径并 `it.skipIf(!EXE)`。
 */
export function chromePath(): string | undefined {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p as string))
}
