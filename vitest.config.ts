import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    /**
     * §8 验收第 5 条：引擎分支覆盖 ≥90%。以前这条只是写在文档里，没测过。
     * 只圈 src/engine —— 那才是「纯函数、必须可测」的那一层；适配层要真浏览器才能测，走 E2E。
     */
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 90 },
    },
  },
})
