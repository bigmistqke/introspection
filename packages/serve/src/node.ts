import { createServer, type Server } from 'http'
import { createNodeAdapter } from '@introspection/read/node'
import { createHandler } from './index.js'
import type { NodeServeOptions } from './types.js'

export { type NodeServeOptions } from './types.js'

export function serve(options: NodeServeOptions): Server {
  const { port, host = '0.0.0.0', directory, prefix } = options
  const adapter = createNodeAdapter(directory)
  const handler = createHandler({ adapter, prefix })

  const server = createServer(async (req, res) => {
    const request = {
      url: req.url ?? '',
    }
    const response = await handler(request)

    if (response === null) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    const body = response.body
    if (body) {
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        res.write(Buffer.from(chunk))
      }
    }
    res.end()
  })

  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Serving introspection traces at http://${host}:${actualPort}${prefix ?? '/_introspect'}`)
  })

  return server
}
