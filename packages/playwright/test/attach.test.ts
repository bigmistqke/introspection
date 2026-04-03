import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @introspection/vite/snapshot
const mockTakeSnapshot = vi.fn().mockResolvedValue({
  ts: 1, trigger: 'manual', url: 'http://localhost/', dom: '', scopes: [], globals: {}, plugins: {},
})
vi.mock('@introspection/vite/snapshot', () => ({
  takeSnapshot: (...args: unknown[]) => mockTakeSnapshot(...args),
}))

// Mock @bigmistqke/rpc/websocket — factory must use only vi.fn() (no module-level variable refs)
vi.mock('@bigmistqke/rpc/websocket', () => ({
  rpc: vi.fn(),
  expose: vi.fn(),
}))

// Mock ws — add addEventListener to satisfy WebSocketLike
const mockWsClose = vi.fn()
vi.mock('ws', () => ({
  default: class MockWS {
    readyState = 1
    close = mockWsClose
    once(event: string, cb: () => void) {
      if (event === 'open') Promise.resolve().then(cb)
      else if (event === 'close') mockWsClose.mockImplementationOnce(() => cb())
    }
    on() {}
    addEventListener() {}
  },
}))

import { attach } from '../src/attach.js'
import { rpc, expose } from '@bigmistqke/rpc/websocket'

describe('attach()', () => {
  let serverProxy: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    serverProxy = {
      startSession: vi.fn().mockResolvedValue(undefined),
      event: vi.fn().mockResolvedValue(undefined),
      endSession: vi.fn().mockResolvedValue(undefined),
      requestSnapshot: vi.fn().mockResolvedValue(undefined),
    }
    vi.mocked(rpc).mockReturnValue(serverProxy as any)
    mockWsClose.mockReset()
    mockTakeSnapshot.mockResolvedValue({
      ts: 1, trigger: 'manual', url: 'http://localhost/', dom: '', scopes: [], globals: {}, plugins: {},
    })
  })

  afterEach(() => { vi.clearAllMocks() })

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

  it('calls startSession with correct params', async () => {
    const { page } = makeFakePage()
    await attach(page as never, { ...baseOpts, sessionId: 'sess-abc', testTitle: 'test title' })
    expect(serverProxy.startSession).toHaveBeenCalledWith({
      id: 'sess-abc', startedAt: expect.any(Number), label: 'test title',
    })
  })

  it('mark() fires an event with type mark', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-mark' })
    handle.mark('step 1', { extra: true })
    expect(serverProxy.event).toHaveBeenCalledWith(
      'sess-mark',
      expect.objectContaining({ type: 'mark', data: expect.objectContaining({ label: 'step 1' }) }),
    )
  })

  it('snapshot() calls requestSnapshot with manual trigger', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-snap' })
    await handle.snapshot()
    expect(serverProxy.requestSnapshot).toHaveBeenCalledWith('sess-snap', 'manual')
  })

  it('expose is called with a takeSnapshot function', async () => {
    const { page } = makeFakePage()
    await attach(page as never, baseOpts)
    expect(vi.mocked(expose)).toHaveBeenCalled()
    const methods = vi.mocked(expose).mock.calls[0][0] as any
    expect(typeof methods.takeSnapshot).toBe('function')
  })

  it('detach() calls endSession, cdp.detach, and closes WS', async () => {
    const { page, cdp } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach' })
    await handle.detach()
    expect(serverProxy.endSession).toHaveBeenCalledWith(
      'sess-detach', '/tmp/introspect', 0,
    )
    expect(cdp.detach).toHaveBeenCalledOnce()
    expect(mockWsClose).toHaveBeenCalledOnce()
  })

  it('detach() emits playwright.result event then calls endSession', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-end' })
    await handle.detach({ status: 'failed', duration: 500, error: 'oops' })
    const resultEvt = vi.mocked(serverProxy.event).mock.calls.find(
      ([, evt]) => (evt as { type: string }).type === 'playwright.result'
    )
    expect(resultEvt).toBeDefined()
    expect((resultEvt![1] as { data: Record<string, unknown> }).data.status).toBe('failed')
    expect(serverProxy.endSession).toHaveBeenCalled()
  })

  it('detach() without result emits no playwright.result event', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-noend' })
    await handle.detach()
    const resultEvt = vi.mocked(serverProxy.event).mock.calls.find(
      ([, evt]) => (evt as { type: string }).type === 'playwright.result'
    )
    expect(resultEvt).toBeUndefined()
  })
})
