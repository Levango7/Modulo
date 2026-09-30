import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'

let server: PreviewServer | undefined

export async function setup(): Promise<void> {
  await build({ logLevel: 'warn' })
  server = await preview({ preview: { port: 0, host: '127.0.0.1' } })
  const addr = server.httpServer.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  process.env.MODULO_URL = `http://127.0.0.1:${port}`
}

export async function teardown(): Promise<void> {
  await server?.httpServer.close()
}
