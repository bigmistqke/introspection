import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'

export interface FixtureServer {
  server: Server
  url: string
  respond(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void): void
  close(): Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()

  const server = createServer((req, res) => {
    const handler = handlers.get(req.url ?? '/')
    if (handler) return handler(req, res)
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body>fixture</body></html>')
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`

  return {
    server, url,
    respond(path, handler) { handlers.set(path, handler) },
    async close() { await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
