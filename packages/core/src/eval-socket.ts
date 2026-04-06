import { createServer } from 'net'
import { existsSync, unlinkSync, symlinkSync } from 'fs'
import { unlink, readFile, symlink } from 'fs/promises'
import { runInNewContext } from 'vm'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

// Unix domain socket paths have an OS-level length limit (104 on macOS, 108 on Linux).
// When the requested path exceeds this limit, we create the socket at a shorter path
// in the system temp dir and symlink the requested path to it.
const SOCKET_PATH_MAX = 100 // conservative limit

function resolveSocketPath(requestedPath: string): { actual: string; usesSymlink: boolean } {
  if (requestedPath.length <= SOCKET_PATH_MAX) {
    return { actual: requestedPath, usesSymlink: false }
  }
  const hash = createHash('sha1').update(requestedPath).digest('hex').slice(0, 12)
  const actual = join(tmpdir(), `introspect-${hash}.socket`)
  return { actual, usesSymlink: true }
}

export interface EvalSocket {
  shutdown(): Promise<void>
}

export function createEvalSocket(socketPath: string, ndjsonPath: string): EvalSocket {
  const { actual, usesSymlink } = resolveSocketPath(socketPath)

  if (existsSync(actual)) unlinkSync(actual)
  if (usesSymlink && existsSync(socketPath)) unlinkSync(socketPath)

  const server = createServer((conn) => {
    let buffer = ''
    conn.on('data', async (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id: string; type: string; expression: string }
          if (msg.type !== 'eval') continue
          let events: unknown[] = []
          try {
            const raw = await readFile(ndjsonPath, 'utf-8')
            events = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
          } catch { /* file may not exist yet */ }
          try {
            const raw = runInNewContext(msg.expression, { events })
            const result = raw != null && typeof raw.then === 'function' ? await raw : raw
            conn.write(JSON.stringify({ id: msg.id, result: result ?? null }) + '\n')
          } catch (err) {
            conn.write(JSON.stringify({ id: msg.id, error: String(err) }) + '\n')
          }
        } catch { /* malformed line */ }
      }
    })
    conn.on('error', () => { /* client disconnected */ })
  })

  server.listen(actual)

  if (usesSymlink) {
    // Create symlink after listen so the socket file exists; ignore errors (race-safe)
    server.once('listening', () => {
      try { symlinkSync(actual, socketPath) } catch { /* non-fatal */ }
    })
  }

  return {
    async shutdown() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try { await unlink(actual) } catch { /* already gone */ }
      if (usesSymlink) {
        try { await unlink(socketPath) } catch { /* already gone */ }
      }
    }
  }
}
