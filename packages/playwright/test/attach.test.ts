import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @introspection/vite/snapshot before importing attach
const mockTakeSnapshot = vi.fn().mockResolvedValue({ ts: 1, trigger: 'manual', url: 'http://localhost/', dom: '', scopes: [], globals: {}, plugins: {} })
vi.mock('@introspection/vite/snapshot', () => ({
  takeSnapshot: (...args: unknown[]) => mockTakeSnapshot(...args),
}))

// Mock the 'ws' module before importing attach
const mockWsSend = vi.fn()
const mockWsClose = vi.fn()
const mockWsMessageHandlers: ((data: Buffer) => void)[] = []

vi.mock('ws', () => {
  return {
    default: class MockWS {
      readyState = 1 // OPEN
      send = mockWsSend
      close = mockWsClose
      once(event: string, cb: () => void) {
        if (event === 'open') {
          Promise.resolve().then(cb)
        } else if (event === 'close') {
          // auto-resolve close when ws.close() is called
          mockWsClose.mockImplementationOnce(() => cb())
        }
      }
      on(event: string, cb: (data: Buffer) => void) {
        if (event === 'message') mockWsMessageHandlers.push(cb)
      }
    }
  }
})

import { attach } from '../src/attach.js'

describe('attach()', () => {
  beforeEach(() => {
    mockWsSend.mockReset()
    mockWsClose.mockReset()
    mockTakeSnapshot.mockReset()
    mockTakeSnapshot.mockResolvedValue({ ts: 1, trigger: 'manual', url: 'http://localhost/', dom: '', scopes: [], globals: {}, plugins: {} })
    mockWsMessageHandlers.length = 0
  })

  function makeFakePage() {
    const mockCdp = {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      detach: vi.fn().mockResolvedValue(undefined),
    }
    return {
      page: {
        context: () => ({ newCDPSession: vi.fn().mockResolvedValue(mockCdp) }),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('http://localhost/'),
      },
      cdp: mockCdp,
    }
  }

  const baseOpts = {
    viteUrl: 'ws://localhost:9999/__introspection',
    sessionId: 'test-sess',
    testTitle: 'my test',
    testFile: 'foo.spec.ts',
    workerIndex: 0,
    outDir: '/tmp/introspect',
  }

  it('returns an IntrospectHandle with page, mark, snapshot, detach', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, baseOpts)
    expect(handle.page).toBeDefined()
    expect(typeof handle.mark).toBe('function')
    expect(typeof handle.snapshot).toBe('function')
    expect(typeof handle.detach).toBe('function')
    await handle.detach()
  })

  it('sends START_SESSION on connect', async () => {
    const { page } = makeFakePage()
    await attach(page as never, { ...baseOpts, sessionId: 'sess-abc', testTitle: 'test title' })
    const startMsg = mockWsSend.mock.calls.find(([msg]) => {
      try { return JSON.parse(msg).type === 'START_SESSION' } catch { return false }
    })
    expect(startMsg).toBeDefined()
    const parsed = JSON.parse(startMsg![0])
    expect(parsed.testTitle).toBe('test title')
    expect(parsed.testFile).toBe('foo.spec.ts')
    expect(parsed.sessionId).toBe('sess-abc')
  })

  it('mark() sends a mark event', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-mark' })
    mockWsSend.mockClear()
    handle.mark('step 1', { extra: true })
    expect(mockWsSend).toHaveBeenCalledOnce()
    const msg = JSON.parse(mockWsSend.mock.calls[0][0])
    expect(msg.event.type).toBe('mark')
    expect(msg.event.data.label).toBe('step 1')
  })

  it('snapshot() sends SNAPSHOT_REQUEST', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-snap' })
    mockWsSend.mockClear()
    await handle.snapshot()
    expect(mockWsSend).toHaveBeenCalledOnce()
    const msg = JSON.parse(mockWsSend.mock.calls[0][0])
    expect(msg.type).toBe('SNAPSHOT_REQUEST')
    expect(msg.sessionId).toBe('sess-snap')
    expect(msg.trigger).toBe('manual')
  })

  it('handles TAKE_SNAPSHOT: calls takeSnapshot and sends SNAPSHOT', async () => {
    const { page } = makeFakePage()
    await attach(page as never, { ...baseOpts, sessionId: 'sess-snap2' })
    mockWsSend.mockClear()

    // Simulate the Vite server sending a TAKE_SNAPSHOT message
    expect(mockWsMessageHandlers.length).toBeGreaterThan(0)
    const payload = Buffer.from(JSON.stringify({ type: 'TAKE_SNAPSHOT', trigger: 'manual' }))
    await mockWsMessageHandlers[0](payload)

    expect(mockTakeSnapshot).toHaveBeenCalledOnce()
    expect(mockWsSend).toHaveBeenCalledOnce()
    const msg = JSON.parse(mockWsSend.mock.calls[0][0])
    expect(msg.type).toBe('SNAPSHOT')
    expect(msg.sessionId).toBe('sess-snap2')
    expect(msg.snapshot).toBeDefined()
  })

  it('detach() sends END_SESSION, calls cdp.detach(), and closes WS', async () => {
    const { page, cdp } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach' })
    mockWsSend.mockClear()
    await handle.detach()
    const endMsg = mockWsSend.mock.calls.find(([msg]) => {
      try { return JSON.parse(msg).type === 'END_SESSION' } catch { return false }
    })
    expect(endMsg).toBeDefined()
    const endParsed = JSON.parse(endMsg![0])
    expect(endParsed.sessionId).toBe('sess-detach')
    expect(endParsed.result).toEqual({ status: 'passed' })
    expect(cdp.detach).toHaveBeenCalledOnce()
    expect(mockWsClose).toHaveBeenCalledOnce()
  })

  it('detach() forwards result to END_SESSION', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach-result' })
    mockWsSend.mockClear()
    await handle.detach({ status: 'failed', duration: 1234, error: 'AssertionError' })
    const endMsg = mockWsSend.mock.calls.find(([msg]) => {
      try { return JSON.parse(msg).type === 'END_SESSION' } catch { return false }
    })
    expect(endMsg).toBeDefined()
    const parsed = JSON.parse(endMsg![0])
    expect(parsed.result).toEqual({ status: 'failed', duration: 1234, error: 'AssertionError' })
  })

  it('detach() defaults result to passed when called without args', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach-default' })
    mockWsSend.mockClear()
    await handle.detach()
    const endMsg = mockWsSend.mock.calls.find(([msg]) => {
      try { return JSON.parse(msg).type === 'END_SESSION' } catch { return false }
    })
    const parsed = JSON.parse(endMsg![0])
    expect(parsed.result).toEqual({ status: 'passed' })
  })
})
