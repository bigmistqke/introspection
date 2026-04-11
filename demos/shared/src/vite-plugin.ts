import { existsSync, createReadStream, statSync, readdirSync } from 'fs'
import { resolve } from 'path'
import type { Plugin } from 'vite'

export interface IntrospectionServeOptions {
  /** Path to the .introspect directory. Defaults to `.introspect` relative to project root. */
  directory?: string
  /** URL prefix. Defaults to `/__introspect`. */
  prefix?: string
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  png: 'image/png',
  jpg: 'image/jpeg',
  html: 'text/html',
  txt: 'text/plain',
}

export function introspectionServe(options?: IntrospectionServeOptions): Plugin {
  const prefix = options?.prefix ?? '/__introspect'
  let resolvedDirectory: string

  return {
    name: 'introspection-serve',

    configResolved(config) {
      resolvedDirectory = options?.directory
        ? resolve(options.directory)
        : resolve(config.root, '.introspect')
    },

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(prefix)) return next()

        const relativePath = request.url.slice(prefix.length)

        // List sessions endpoint
        if (relativePath === '' || relativePath === '/') {
          if (!existsSync(resolvedDirectory)) {
            response.writeHead(200, { 'Content-Type': 'application/json' })
            response.end('[]')
            return
          }
          const entries = readdirSync(resolvedDirectory, { withFileTypes: true })
          const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify(directories))
          return
        }

        const filePath = resolve(resolvedDirectory, `.${relativePath}`)

        if (!filePath.startsWith(resolvedDirectory)) {
          response.statusCode = 403
          response.end('Forbidden')
          return
        }

        if (!existsSync(filePath)) {
          response.statusCode = 404
          response.end('Not found')
          return
        }

        const fileStat = statSync(filePath)
        const extension = filePath.split('.').pop()?.toLowerCase()

        response.setHeader('Content-Type', CONTENT_TYPES[extension ?? ''] ?? 'application/octet-stream')
        response.setHeader('Content-Length', fileStat.size)
        createReadStream(filePath).pipe(response)
      })
    },
  }
}
