import { createServer, type Server } from 'http'
import { createHandler, type NodeServeOptions } from './index.js'

export { type NodeServeOptions } from './index.js'

export function serve(options: NodeServeOptions): Server {
  const { port, host = '0.0.0.0', ...handlerOptions } = options
  const handler = createHandler(handlerOptions)

  const server = createServer((req, res) => {
    const request = {
      url: req.url ?? '',
      headers: req.headers as Record<string, string>,
    }
    const response = handler(request)
    
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
    if (body instanceof ReadableStream) {
      const reader = body.getReader()
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            res.end()
            return
          }
          res.write(Buffer.from(value))
          pump()
        })
      }
      pump()
    } else if (body) {
      res.end(body)
    } else {
      res.end()
    }
  })

  server.listen(port, host, () => {
    console.log(`Serving introspection traces at http://${host}:${port}${handlerOptions.prefix ?? '/_introspect'}`)
  })

  return server
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options: NodeServeOptions = {
    directory: '.introspect',
    port: 3456,
    prefix: '/_introspect',
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-d' || arg === '--directory') {
      options.directory = args[++i]
    } else if (arg === '-p' || arg === '--port') {
      options.port = parseInt(args[++i], 10)
    } else if (arg === '--prefix') {
      options.prefix = args[++i]
    } else if (arg === '--streaming') {
      options.streaming = true
    } else if (arg === '--host') {
      options.host = args[++i]
    }
  }

  serve(options)
}