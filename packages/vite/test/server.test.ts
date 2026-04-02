import { describe, it, expect, vi, afterEach } from 'vitest'
import { createIntrospectionServer, type IntrospectionServer } from '../src/server.js'
import WebSocket from 'ws'
import { createServer } from 'http'

describe('IntrospectionServer', () => {
  let httpServer: ReturnType<typeof createServer>
  let introspectionServer: IntrospectionServer

  afterEach(() => {
    introspectionServer?.shutdown()
    httpServer?.close()
  })

  it('accepts WebSocket connections on /__introspection', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})

    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects connections to other paths', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/other`)
    await new Promise<void>(resolve => ws.once('close', resolve))
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('registers a session when START_SESSION message is received', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))

    ws.send(JSON.stringify({ type: 'START_SESSION', sessionId: 'test-abc', testTitle: 'my test', testFile: 'foo.spec.ts' }))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(introspectionServer.getSession('test-abc')).toBeDefined()
    ws.close()
  })

  it('appends events to the correct session', async () => {
    httpServer = createServer()
    introspectionServer = createIntrospectionServer(httpServer, {})
    await new Promise<void>(resolve => httpServer.listen(0, resolve))
    const port = (httpServer.address() as { port: number }).port

    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))

    ws.send(JSON.stringify({ type: 'START_SESSION', sessionId: 'sess-1', testTitle: 't', testFile: 'f' }))
    ws.send(JSON.stringify({ type: 'EVENT', sessionId: 'sess-1', event: { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } } }))
    await new Promise(resolve => setTimeout(resolve, 20))

    const session = introspectionServer.getSession('sess-1')
    expect(session?.events).toHaveLength(1)
    expect(session?.events[0].type).toBe('mark')
    ws.close()
  })
})
