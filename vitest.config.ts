import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 两条覆盖门禁，圈的是两层不同的东西。
 *
 * ① `packages/engine/src/**` 分支 ≥90（§8 验收第 5 条）。以前这条只写在文档里，谁也没测过。
 *    引擎是「纯函数、必须可测」的那一层，所以门禁卡死。2026-10-03 抽成 `@modulo/engine` 包之后
 *    路径从 `src/engine/**` 挪到这里 —— 门禁跟着资产走，不是跟着目录名走。
 *
 * ② `src/vue/**` 里**可单测的那几个纯模块** 分支 ≥90。这一条是 2026-10-03 补的：
 *    原来只有引擎有门禁，于是 `keyboard.ts`（键盘意图判定）、`backup.ts`（备份包解析）
 *    这种"判定逻辑"跟 DOM 胶水混在同一个目录里，也一样没有防线。
 *    **只圈下面列出的文件**，不圈整个 `src/vue` —— `useCanvasDrag` / `useFocusTrap` /
 *    `useBackup` 这些要真 DOM 与真事件，属于 E2E 的地盘（§10.3 的 19 条），
 *    把它们塞进单测门禁只会逼人写假测试。
 *
 * 余量故意不大：以后往这几个文件加带分支而没测到的代码，CI 就该红 ——
 * 处理方式是补用例，不是调低阈值。
 */
const GATED_VUE_MODULES = ['src/vue/appearance.ts', 'src/vue/backup.ts', 'src/vue/cardData.ts', 'src/vue/chord.ts', 'src/vue/keyboard.ts', 'src/vue/store.ts']

/** 仓库内按源码解析引擎包（与 vite.config.ts 同一条约定） */
const engineSrc = join(dirname(fileURLToPath(import.meta.url)), 'packages/engine/src')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@modulo\/engine$/, replacement: join(engineSrc, 'index.ts') },
      { find: /^@modulo\/engine\//, replacement: `${engineSrc}/` },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', ...GATED_VUE_MODULES],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 90 },
    },
  },
})

