import { defineConfig } from 'vitest/config'

/**
 * 两条覆盖门禁，圈的是两层不同的东西。
 *
 * ① `src/engine/**` 分支 ≥90（§8 验收第 5 条）。以前这条只写在文档里，谁也没测过。
 *    引擎是「纯函数、必须可测」的那一层，所以门禁卡死。
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

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', ...GATED_VUE_MODULES],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 90 },
    },
  },
})

