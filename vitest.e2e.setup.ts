import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'

let server: PreviewServer | undefined

export async function setup(): Promise<void> {
  // E2E 要测的就是**要发出去的那颗包**，所以构建期间显式用 production：
  // vitest 把进程的 NODE_ENV 设成 test，vite 会把它原样烤进产物 —— Vue 走 dev 运行时，
  // 包体 +23%（163.98 → 201.74 kB），还会覆盖掉 `npm run build` 的生产 dist
  // （docs-check 量到的就是这份 dist）。构建完还原，别污染 vitest 自己的环境。
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  await build({ logLevel: 'warn' })
  if (prev === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = prev
  server = await preview({ preview: { port: 0, host: '127.0.0.1' } })
  const addr = server.httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.MODULO_URL = `http://127.0.0.1:${port}`
}

export async function teardown(): Promise<void> {
  await server?.httpServer.close()
}
