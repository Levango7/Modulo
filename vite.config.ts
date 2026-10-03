import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
  server: { port: 1430 },
  preview: { port: 1430 },
})
