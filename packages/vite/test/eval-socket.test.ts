import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  it('exposes resolve() when resolveFrame is provided', async () => {
    const resolvedFrame = { functionName: 'fn', file: 'src/app.ts', line: 10, column: 5 }
    const resolveFrame = vi.fn().mockResolvedValue(resolvedFrame)

    const sock = createEvalSocket(join(dir, '.socket'), () => [], resolveFrame)
    const client = await connectToSocket(join(dir, '.socket'))

    const typeResult = await client.eval('typeof resolve')
    expect(typeResult).toBe('function')

    const fakeFrame = { functionName: 'fn', file: 'dist/app.js', line: 1, column: 0 }
    const resolved = await client.eval(`resolve(${JSON.stringify(fakeFrame)})`)
    expect(resolveFrame).toHaveBeenCalledWith(fakeFrame)
    expect(resolved).toEqual(resolvedFrame)

    client.close()
    await sock.shutdown()
  })

  it('resolve() is absent when resolveFrame is not provided', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))

    const result = await client.eval('typeof resolve')
    expect(result).toBe('undefined')

    client.close()
    await sock.shutdown()
  })

  it('awaits Promise results from evaluated expressions', async () => {
    const sock = createEvalSocket(join(dir, '.socket'), () => [])
    const client = await connectToSocket(join(dir, '.socket'))

    const result = await client.eval('Promise.resolve(42)')
    expect(result).toBe(42)

    client.close()
    await sock.shutdown()
  })
})
