import { createConnection } from 'net'

export interface LiveClient {
  eval(expression: string): Promise<unknown>
  close(): void
}

export async function connectToSocket(socketPath: string): Promise<LiveClient> {
  const socket = createConnection(socketPath)

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => clearTimeout(timer)
    socket.once('connect', () => { cleanup(); resolve() })
    socket.once('error', (err) => { cleanup(); reject(err) })
    timer = setTimeout(() => reject(new Error(`No active session — start Vite and run attach(page) in a test (socket: ${socketPath})`)), 2000)
  })

  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let buffer = ''

  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as { id: string; result?: unknown; error?: string }
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result)
        }
      } catch { /* ignore */ }
    }
  })

  return {
    eval(expression) {
      const id = Math.random().toString(36).slice(2)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        socket.write(JSON.stringify({ id, type: 'eval', expression }) + '\n')
        setTimeout(() => { pending.delete(id); reject(new Error('eval timed out')) }, 10000)
      })
    },
    close: () => socket.destroy(),
  }
}
