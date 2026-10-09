import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * `@levango7/engine` 在仓库内按**源码**解析（应用与测试都走这条）；
 * 包对外的入口是 `dist/`（`packages/engine` 的 `build` 用 tsc 产出，`prepack` 会先构建）。
 * 同一条源码、两种消费方式 —— 改引擎不用先构建，编辑器直接跳到源码。
 */
const engineSrc = join(dirname(fileURLToPath(import.meta.url)), 'packages/engine/src')

/**
 * `base` 走环境变量，默认 '/'（根路径）。
 *
 * 为什么要有这一层：托管在子路径时（GitHub Pages 的 `/<repo>/`、EdgeOne Pages 的项目域）
 * 资源用绝对路径会 404，而这件事**只在部署之后才暴露** —— 本地 `vite preview` 永远是绿的。
 * 与其部署完再回来补，不如现在就把它变成配置。
 *
 * 托管在自定义域根路径时不用设这个变量。
 */
export default defineConfig({
  base: process.env.PUBLIC_BASE || '/',
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@levango7\/engine$/, replacement: join(engineSrc, 'index.ts') },
      { find: /^@levango7\/engine\//, replacement: `${engineSrc}/` },
    ],
  },
  server: { port: 1430 },
  preview: { port: 1430 },
})
