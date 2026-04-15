import { existsSync, readdirSync, readFileSync, statSync, createReadStream } from 'fs'
import { resolve, join } from 'path'
import type { ServeOptions, SessionMeta } from './types.js'
import { errorResponse, ERROR_SESSION_NOT_FOUND, ERROR_ASSET_NOT_FOUND, ERROR_STREAMING_NOT_ENABLED } from './errors.js'

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  png: 'image/png',
  jpg: 'image/jpeg',
  html: 'text/html',
  txt: 'text/plain',
}

export function createHandler(options: ServeOptions) {
  const { directory, prefix = '/_introspect', streaming = false } = options
  const resolvedDirectory = resolve(directory)

  return (request: { url: string; headers?: Record<string, string> }): Response | null => {
    const url = request.url
    if (!url.startsWith(prefix)) return null

    const path = url.slice(prefix.length)

    if (path === '' || path === '/') {
      if (!existsSync(resolvedDirectory)) {
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
      }
      const entries = readdirSync(resolvedDirectory, { withFileTypes: true })
      const sessions = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      return new Response(JSON.stringify(sessions), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const segments = path.split('/').filter(Boolean)
    const sessionId = segments[0]
    const remainder = segments.slice(1).join('/')

    if (!sessionId) {
      return errorResponse(400, { error: 'Missing session ID' })
    }

    const sessionDir = join(resolvedDirectory, sessionId)
    const resolvedSessionDir = resolve(sessionDir)

    if (!resolvedSessionDir.startsWith(resolvedDirectory)) {
      return errorResponse(403, { error: 'Forbidden' })
    }

    if (!existsSync(sessionDir)) {
      return errorResponse(404, ERROR_SESSION_NOT_FOUND)
    }

    if (remainder === 'meta.json') {
      const metaPath = join(sessionDir, 'meta.json')
      if (!existsSync(metaPath)) {
        const meta: SessionMeta = { id: sessionId }
        return new Response(JSON.stringify(meta), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      return new Response(JSON.stringify({ ...meta, id: sessionId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (remainder === 'events.ndjson') {
      const eventsPath = join(sessionDir, 'events.ndjson')
      if (!existsSync(eventsPath)) {
        return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      if (streaming) {
        return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      const stat = statSync(eventsPath)
      const stream = createReadStream(eventsPath)
      return new Response(stream as unknown as ReadableStream<Uint8Array>, {
        headers: { 'Content-Type': 'application/x-ndjson', 'Content-Length': String(stat.size) },
      })
    }

    if (remainder === 'events' && streaming) {
      const eventsPath = join(sessionDir, 'events.ndjson')
      if (!existsSync(eventsPath)) {
        return new Response('', { 
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } 
        })
      }
      const encoder = new TextEncoder()
      
      const stream = new ReadableStream({
        start(controller) {
          const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(l => l.trim())
          let index = 0
          const sendNext = () => {
            if (index >= lines.length) {
              controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
              controller.close()
              return
            }
            const event = lines[index]
            controller.enqueue(encoder.encode(`data: ${event}\n\n`))
            index++
            setTimeout(sendNext, 10)
          }
          sendNext()
        }
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    if (remainder === 'events' && !streaming) {
      return errorResponse(400, ERROR_STREAMING_NOT_ENABLED)
    }

    if (remainder.startsWith('assets/')) {
      const assetPath = join(sessionDir, remainder)
      const resolvedAssetPath = resolve(assetPath)
      
      if (!resolvedAssetPath.startsWith(resolvedSessionDir)) {
        return errorResponse(403, { error: 'Forbidden' })
      }
      
      if (!existsSync(assetPath)) {
        return errorResponse(404, ERROR_ASSET_NOT_FOUND)
      }

      const stat = statSync(assetPath)
      const extension = assetPath.split('.').pop()?.toLowerCase()
      const contentType = CONTENT_TYPES[extension ?? ''] ?? 'application/octet-stream'
      const stream = createReadStream(assetPath)
      
      return new Response(stream as unknown as ReadableStream<Uint8Array>, {
        headers: { 'Content-Type': contentType, 'Content-Length': String(stat.size) },
      })
    }

    return errorResponse(404, { error: 'Not found' })
  }
}