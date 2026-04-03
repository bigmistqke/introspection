import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createIntrospectionServer, type IntrospectionServer } from '../src/server.js'
import { rpc, expose } from '@bigmistqke/rpc/websocket'
import type { IntrospectionServerMethods, PlaywrightClientMethods, OnErrorSnapshot } from '@introspection/types'
import WebSocket from 'ws'
import { createServer, type Server } from 'http'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

async function startServer(config = {}) {
  const httpServer = createServer()
  const introspectionServer = createIntrospectionServer(httpServer, config)
  await new Promise<void>(resolve => httpServer.listen(0, resolve))
  const port = (httpServer.address() as { port: number }).port
  return { httpServer, introspectionServer, port }
}

async function connectClient(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
  await new Promise<void>(resolve => ws.once('open', resolve))
  const server = rpc<IntrospectionServerMethods>(ws)
  return { ws, server }
}

describe('IntrospectionServer', () => {
  let httpServer: Server
  let introspectionServer: IntrospectionServer
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'introspect-server-'))
  })
  afterEach(async () => {
    introspectionServer?.shutdown()
    httpServer?.close()
    await rm(tmpDir, { recursive: true })
  })

  it('accepts WebSocket connections on /__introspection', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const ws = new WebSocket(`ws://localhost:${port}/__introspection`)
    await new Promise<void>(resolve => ws.once('open', resolve))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects connections to other paths', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const ws = new WebSocket(`ws://localhost:${port}/other`)
    await new Promise<void>(resolve => ws.once('close', resolve))
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('registers a session when startSession is called', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const { ws, server } = await connectClient(port)

    await server.startSession({ id: 'test-abc', testTitle: 'my test', testFile: 'foo.spec.ts' })

    expect(introspectionServer.getSession('test-abc')).toBeDefined()
    ws.close()
  })

  it('appends events to the correct session', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const { ws, server } = await connectClient(port)

    await server.startSession({ id: 'sess-1', testTitle: 't', testFile: 'f' })
    await server.event('sess-1', { id: 'e1', type: 'mark', ts: 0, source: 'agent', data: { label: 'hi' } })

    const session = introspectionServer.getSession('sess-1')
    expect(session?.events).toHaveLength(1)
    expect(session?.events[0].type).toBe('mark')
    ws.close()
  })

  it('requestSnapshot calls takeSnapshot on the playwright proxy and stores the result', async () => {
    const mockSnapshot: OnErrorSnapshot = {
      ts: 0, trigger: 'manual', url: 'http://test', dom: '<html/>',
      scopes: [], globals: {}, plugins: {},
    }
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const { ws, server } = await connectClient(port)

    await server.startSession({ id: 'snap-sess', testTitle: 't', testFile: 'f' })
    // Register takeSnapshot on the client side (simulates Playwright process)
    expose<PlaywrightClientMethods>(
      { takeSnapshot: vi.fn().mockResolvedValue(mockSnapshot) },
      { to: ws },
    )

    // requestSnapshot awaits the full round-trip (server → client takeSnapshot → server stores → responds)
    await server.requestSnapshot('snap-sess', 'manual')

    expect(introspectionServer.getSession('snap-sess')?.snapshot).toEqual(mockSnapshot)
    ws.close()
  })

  it('endSession writes a trace file and removes the session', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const { ws, server } = await connectClient(port)

    await server.startSession({ id: 'end-sess', testTitle: 'my test', testFile: 'foo.spec.ts' })
    // endSession awaits writeTrace before responding — no setTimeout needed
    await server.endSession('end-sess', { status: 'passed', duration: 100 }, tmpDir, 0)

    expect(introspectionServer.getSession('end-sess')).toBeUndefined()
    const { readdir } = await import('fs/promises')
    const files = await readdir(tmpDir)
    expect(files.some(f => f.endsWith('.trace.json'))).toBe(true)
    ws.close()
  })

  it('endSession deletes the session even when writeTrace fails', async () => {
    ;({ httpServer, introspectionServer } = await startServer())
    const port = (httpServer.address() as { port: number }).port
    const { ws, server } = await connectClient(port)

    await server.startSession({ id: 'err-sess', testTitle: 't', testFile: 'f' })
    // Pass an unwritable path to force a failure in writeTrace
    await server.endSession('err-sess', { status: 'passed', duration: 0 }, '/dev/null/invalid-path', 0)

    // Session must be deleted despite the error (finally block)
    expect(introspectionServer.getSession('err-sess')).toBeUndefined()
    ws.close()
  })
})
