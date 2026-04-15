import { resolve } from 'path'
import { createHandler } from '@introspection/serve'
import type { Plugin } from 'vite'

export interface IntrospectionServeOptions {
  directory?: string
  prefix?: string
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
      const handler = createHandler({
        directory: resolvedDirectory,
        prefix,
      })

      server.middlewares.use((req, res, next) => {
        const request = { url: req.url ?? '' }
        const response = handler(request)
        if (response === null) return next()

        res.statusCode = response.status
        response.headers.forEach((value, key) => {
          res.setHeader(key, value)
        })

        const body = response.body
        if (body) {
          for await (const chunk of body) {
            res.write(Buffer.from(chunk))
          }
        }
        res.end()
      })
    },
  }
}