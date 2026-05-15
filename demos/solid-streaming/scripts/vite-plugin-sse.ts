import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, watch as fsWatch } from 'fs'
import { resolve, join } from 'path'
import type { Plugin } from 'vite'

export interface IntrospectionServeSSEOptions {
  directory?: string
  /** URL path under which the SSE endpoint is mounted. Default '/__introspect/stream'. */
  prefix?: string
}

/**
 * Demo-local Vite plugin: serves Server-Sent Events tailing of `events.ndjson`
 * for the solid-streaming demo. Mounted alongside `introspectionServe()`.
 *
 *   GET <prefix>/<runId>/<sessionId>/events
 *
 * Sends every existing line of `<runId>/<sessionId>/events.ndjson` as an SSE
 * `data:` frame, then watches the file and sends new lines as they're written.
 * This logic used to live in @introspection/serve's createHandler; it moved
 * here when createHandler became a generic StorageAdapter transport (no
 * filesystem code, no fs.watch).
 */
export function introspectionServeSSE(options?: IntrospectionServeSSEOptions): Plugin {
  const prefix = options?.prefix ?? '/__introspect/stream'
  let resolvedDirectory: string

  return {
    name: 'introspection-serve-sse',

    configResolved(config) {
      resolvedDirectory = options?.directory
        ? resolve(options.directory)
        : resolve(config.root, '.introspect')
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith(prefix + '/')) return next()

        const tail = url.slice(prefix.length + 1)
        // Match: <runId>/<sessionId>/events
        const match = tail.match(/^([^/]+)\/([^/]+)\/events(?:\?.*)?$/)
        if (!match) return next()
        const [, runId, sessionId] = match

        const eventsPath = join(resolvedDirectory, runId, sessionId, 'events.ndjson')
        if (!existsSync(eventsPath)) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        // Send the existing content as SSE frames.
        const initial = readFileSync(eventsPath, 'utf-8')
        let position = statSync(eventsPath).size
        for (const line of initial.split('\n').filter((l) => l.trim())) {
          res.write(`data: ${line}\n\n`)
        }

        // Tail the file with fs.watch.
        const sendNew = () => {
          try {
            const stat = statSync(eventsPath)
            if (stat.size <= position) return
            const fd = openSync(eventsPath, 'r')
            const buffer = Buffer.alloc(stat.size - position)
            readSync(fd, buffer, 0, buffer.length, position)
            closeSync(fd)
            position = stat.size
            for (const line of buffer.toString('utf-8').split('\n').filter((l) => l.trim())) {
              res.write(`data: ${line}\n\n`)
            }
          } catch { /* file deleted or changed during read */ }
        }
        const watcher = fsWatch(eventsPath, (eventType) => {
          if (eventType === 'change') sendNew()
        })

        req.on('close', () => watcher.close())
      })
    },
  }
}
