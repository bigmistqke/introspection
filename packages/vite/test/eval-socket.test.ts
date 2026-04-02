import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEvalSocket } from '../src/eval-socket.js'
import { connectToSocket } from '../../cli/src/socket-client.js'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Session } from '../src/server.js'

describe('EvalSocket', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-eval-')) })
  afterEach(async () => { await rm(dir, { recursive: true }) })

  function sessions(events: unknown[] = []): () => Session[] {
    return () => [{
      id: 'sess-1', testTitle: 'my test', testFile: 'foo.spec.ts',
      startedAt: Date.now(), events: events as never, ws: null as never,
    }]
  }

  it('evaluates a simple expression and returns the result', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions([
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } },
    ]))
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(1)
    client.close()
    await sock.shutdown()
  })

  it('evaluates an expression that accesses event properties', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions([
      { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'checkpoint' } },
    ]))
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events[0].data.label')).toBe('checkpoint')
    client.close()
    await sock.shutdown()
  })

  it('returns an error for an invalid expression', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), sessions())
    const client = await connectToSocket(join(dir, '.socket'))
    await expect(client.eval('!!!invalid syntax(((')).rejects.toThrow()
    client.close()
    await sock.shutdown()
  })

  it('returns empty context when no sessions exist', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))
    expect(await client.eval('events.length')).toBe(0)
    client.close()
    await sock.shutdown()
  })

  it('shutdown removes the socket file', async () => {
    const { existsSync } = await import('fs')
    const socketPath = join(dir, '.socket')
    const sock = createEvalSocket(socketPath, () => [])
    await sock.shutdown()
    expect(existsSync(socketPath)).toBe(false)
  })
})
