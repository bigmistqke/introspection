import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

function sseReplayPlugin() {
  return {
    name: 'sse-replay',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/events') return next()

        // Find the latest session and stream its events
        const directory = resolve('.introspect')
        if (!existsSync(directory)) {
          response.writeHead(404)
          response.end('No .introspect directory found')
          return
        }

        const sessions = readdirSync(directory, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => {
            try {
              const meta = JSON.parse(readFileSync(join(directory, entry.name, 'meta.json'), 'utf-8'))
              return { id: entry.name, startedAt: meta.startedAt as number }
            } catch {
              return { id: entry.name, startedAt: 0 }
            }
          })
          .sort((a, b) => b.startedAt - a.startedAt)

        if (sessions.length === 0) {
          response.writeHead(404)
          response.end('No sessions found')
          return
        }

        const sessionId = sessions[0].id
        const eventsPath = join(directory, sessionId, 'events.ndjson')
        if (!existsSync(eventsPath)) {
          response.writeHead(404)
          response.end('No events.ndjson found')
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
      })
    },
  } satisfies import('vite').Plugin
}

export default defineConfig({
  plugins: [solid(), introspectionServe(), sseReplayPlugin()],
})
