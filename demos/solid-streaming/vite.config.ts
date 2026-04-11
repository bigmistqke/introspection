import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { readFileSync, readdirSync, existsSync, statSync, createReadStream } from 'fs'
import { join, resolve } from 'path'

function getLatestSession(directory: string) {
  if (!existsSync(directory)) return null

  const sessions = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      try {
        const meta = JSON.parse(readFileSync(join(directory, entry.name, 'meta.json'), 'utf-8'))
        return { id: entry.name, meta, startedAt: meta.startedAt as number }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.startedAt - a!.startedAt)

  return sessions[0] ?? null
}

function streamingPlugin() {
  const introspectDirectory = resolve('.introspect')

  return {
    name: 'streaming-introspect',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? ''

        // Serve a virtual session at /__introspect/stream/
        // - meta.json: real meta from latest session
        // - events.ndjson: empty (events come via SSE)
        // - assets/*: proxied from the real session

        if (url === '/__introspect/') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify(['stream']))
          return
        }

        const latest = getLatestSession(introspectDirectory)

        if (url === '/__introspect/stream/meta.json') {
          if (!latest) {
            response.writeHead(404)
            response.end('No sessions')
            return
          }
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ ...latest.meta, id: 'stream' }))
          return
        }

        if (url === '/__introspect/stream/events.ndjson') {
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          response.end('')
          return
        }

        if (url.startsWith('/__introspect/stream/assets/')) {
          if (!latest) {
            response.writeHead(404)
            response.end('No sessions')
            return
          }
          const assetPath = url.slice('/__introspect/stream/'.length)
          const filePath = join(introspectDirectory, latest.id, assetPath)

          if (!filePath.startsWith(introspectDirectory) || !existsSync(filePath)) {
            response.writeHead(404)
            response.end('Not found')
            return
          }

          const fileStat = statSync(filePath)
          const extension = filePath.split('.').pop()?.toLowerCase()
          const contentTypes: Record<string, string> = {
            json: 'application/json', png: 'image/png', html: 'text/html', txt: 'text/plain',
          }
          response.setHeader('Content-Type', contentTypes[extension ?? ''] ?? 'application/octet-stream')
          response.setHeader('Content-Length', fileStat.size)
          createReadStream(filePath).pipe(response)
          return
        }

        // SSE endpoint: replay events from the latest session
        if (url === '/events') {
          if (!latest) {
            response.writeHead(404)
            response.end('No sessions')
            return
          }

          const eventsPath = join(introspectDirectory, latest.id, 'events.ndjson')
          if (!existsSync(eventsPath)) {
            response.writeHead(404)
            response.end('No events')
            return
          }

          const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(line => line.trim())
          const events = lines.map(line => JSON.parse(line))

          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })

          let index = 0
          let closed = false

          function sendNext() {
            if (closed) return
            if (index >= events.length) {
              response.write('event: done\ndata: {}\n\n')
              return
            }

            const event = events[index]
            const nextEvent = events[index + 1]
            response.write(`data: ${JSON.stringify(event)}\n\n`)
            index++

            if (nextEvent) {
              const delay = (nextEvent.timestamp - event.timestamp) * 2
              setTimeout(sendNext, Math.max(delay, 30))
            } else {
              setTimeout(sendNext, 200)
            }
          }

          sendNext()
          request.on('close', () => { closed = true })
          return
        }

        next()
      })
    },
  } satisfies import('vite').Plugin
}

export default defineConfig({
  plugins: [solid(), streamingPlugin()],
})
