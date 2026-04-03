import { createServer } from 'net'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { unlink } from 'fs/promises'
import { dirname } from 'path'
import { runInNewContext } from 'vm'
import type { Session } from './server.js'
import type { StackFrame } from '@introspection/types'

export interface EvalSocket {
  shutdown(): Promise<void>
}

export function createEvalSocket(
  socketPath: string,
  getSessions: () => Session[],
  resolveFrame?: (frame: StackFrame) => StackFrame | Promise<StackFrame>
): EvalSocket {
  mkdirSync(dirname(socketPath), { recursive: true })
  if (existsSync(socketPath)) unlinkSync(socketPath)

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
          const all = getSessions()
          const session = all[all.length - 1]
          const ctx: Record<string, unknown> = session
            ? { events: session.events, snapshot: session.snapshot ?? null, session: { id: session.id, label: session.label ?? null } }
            : { events: [], snapshot: null, session: null }
          if (resolveFrame) {
            ctx.resolve = (frame: unknown) => resolveFrame(frame as StackFrame)
          }
          try {
            const raw = runInNewContext(msg.expression, ctx)
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

  server.listen(socketPath)

  return {
    async shutdown() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      try { await unlink(socketPath) } catch { /* already gone */ }
    }
  }
}
