import type { ServeOptions } from './types.js'
import { errorResponse } from './errors.js'

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  html: 'text/html',
  txt: 'text/plain',
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = path.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function createHandler(options: ServeOptions) {
  const { adapter, prefix = '/_introspect' } = options

  return async (request: { url: string }): Promise<Response | null> => {
    const url = request.url
    if (!url.startsWith(prefix)) return null

    const tail = url.slice(prefix.length).replace(/^\/+/, '')
    // tail is now "dirs/<sub>", "dirs", "dirs/", "file/<path>", or something else
    let verb: 'dirs' | 'file' | null = null
    let rest = ''
    if (tail === 'dirs' || tail === 'dirs/' || tail.startsWith('dirs/')) {
      verb = 'dirs'
      rest = tail === 'dirs' || tail === 'dirs/' ? '' : tail.slice('dirs/'.length)
    } else if (tail.startsWith('file/')) {
      verb = 'file'
      rest = tail.slice('file/'.length)
    } else {
      return errorResponse(404, { error: 'Not found' })
    }

    try {
      if (verb === 'dirs') {
        const dirs = await adapter.listDirectories(rest || undefined)
        return new Response(JSON.stringify(dirs), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // verb === 'file'
      if (!rest) return errorResponse(404, { error: 'Not found' })
      const bytes = await adapter.readBinary(rest)
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(rest),
          'Content-Length': String(bytes.byteLength),
        },
      })
    } catch (err) {
      if ((err as Error).name === 'TraversalError') {
        return errorResponse(403, { error: 'Forbidden' })
      }
      if (verb === 'file') {
        // Treat any read failure as not-found — adapters throw on missing files.
        return errorResponse(404, { error: 'Not found' })
      }
      return errorResponse(500, { error: (err as Error).message })
    }
  }
}
