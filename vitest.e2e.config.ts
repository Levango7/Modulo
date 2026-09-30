import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.spec.ts'],
    globalSetup: ['./vitest.e2e.setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
})
