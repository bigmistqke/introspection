import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createEvalSocket } from '../src/eval-socket.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-eval-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function connectToSocket(socketPath: string) {
  const { createConnection } = await import('net')
  const socket = await new Promise<import('net').Socket>((resolve, reject) => {
    let attempts = 0
    const tryConnect = () => {
      const conn = createConnection(socketPath)
      conn.once('connect', () => resolve(conn))
      conn.once('error', () => {
        conn.destroy()
        if (++attempts < 20) setTimeout(tryConnect, 10)
        else reject(new Error(`Could not connect to ${socketPath}`))
      })
    }
    tryConnect()
  })
  let buf = ''
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>()
  socket.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
      const msg: { id: string; result?: unknown; error?: string } = JSON.parse(line)
      const p = pending.get(msg.id); if (!p) continue; pending.delete(msg.id)
      if (msg.error !== undefined) p.reject(new Error(msg.error)); else p.resolve(msg.result)
    }
  })
  return {
    eval(expr: string): Promise<unknown> {
      return new Promise((res, rej) => {
        const id = Math.random().toString(36).slice(2)
        pending.set(id, { resolve: res, reject: rej })
        socket.write(JSON.stringify({ id, type: 'eval', expression: expr }) + '\n')
      })
    },
    close() { socket.destroy() },
  }
}

async function writeNdjson(path: string, events: unknown[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''))
}

describe('createEvalSocket', () => {
  it('evaluates a simple expression against ndjson events', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } },
    ])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    client.close()
    await sock.shutdown()
  })

  it('accesses event properties', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'checkpoint' } },
    ])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events[0].data.label')).toBe('checkpoint')
    client.close()
    await sock.shutdown()
  })

  it('returns error for invalid expression', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    await expect(client.eval('!!!invalid(((')).rejects.toThrow()
    client.close()
    await sock.shutdown()
  })

  it('returns empty events when ndjson is empty', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(0)
    client.close()
    await sock.shutdown()
  })

  it('reads updated events on subsequent queries', async () => {
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [{ id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'a' } }])
    const sock = createEvalSocket(join(dir, '.socket'), ndjsonPath)
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    // append another event
    await writeNdjson(ndjsonPath, [
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'a' } },
      { id: 'e2', type: 'mark', ts: 1, source: 'agent', data: { label: 'b' } },
    ])
    expect(await client.eval('events.length')).toBe(2)
    client.close()
    await sock.shutdown()
  })

  it('shutdown removes the socket file', async () => {
    const { existsSync } = await import('fs')
    const ndjsonPath = join(dir, 'events.ndjson')
    await writeNdjson(ndjsonPath, [])
    const socketPath = join(dir, '.socket')
    const sock = createEvalSocket(socketPath, ndjsonPath)
    await sock.shutdown()
    expect(existsSync(socketPath)).toBe(false)
  })
})
