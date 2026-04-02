import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the 'ws' module before importing attach
const mockWsSend = vi.fn()
const mockWsClose = vi.fn()
let wsOpenCallback: (() => void) | null = null

vi.mock('ws', () => {
  return {
    default: class MockWS {
      readyState = 1 // OPEN
      send = mockWsSend
      close = mockWsClose
      once(event: string, cb: () => void) {
        if (event === 'open') {
          // auto-resolve the open promise on next tick
          Promise.resolve().then(cb)
        }
      }
      on = vi.fn()
    }
  }
})

import { attach } from '../src/attach.js'

describe('attach()', () => {
  beforeEach(() => {
    mockWsSend.mockClear()
    mockWsClose.mockClear()
  })

  function makeFakePage() {
    return {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({}),
          on: vi.fn(),
          detach: vi.fn().mockResolvedValue(undefined),
        })
      }),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('returns an IntrospectHandle with page, mark, snapshot, detach', async () => {
    const fakePage = makeFakePage()
    const handle = await attach(fakePage as never, {
      viteUrl: 'ws://localhost:9999/__introspection',
      sessionId: 'test-sess',
      testTitle: 'my test',
      testFile: 'foo.spec.ts',
      workerIndex: 0,
      outDir: '/tmp/introspect',
    })
    expect(handle.page).toBeDefined()
    expect(typeof handle.mark).toBe('function')
    expect(typeof handle.snapshot).toBe('function')
    expect(typeof handle.detach).toBe('function')
    await handle.detach()
  })

  it('sends START_SESSION on connect', async () => {
    const fakePage = makeFakePage()
    await attach(fakePage as never, {
      viteUrl: 'ws://localhost:9999/__introspection',
      sessionId: 'sess-abc',
      testTitle: 'test title',
      testFile: 'x.spec.ts',
      workerIndex: 0,
      outDir: '/tmp',
    })
    const startMsg = mockWsSend.mock.calls.find(([msg]) => {
      try { return JSON.parse(msg).type === 'START_SESSION' } catch { return false }
    })
    expect(startMsg).toBeDefined()
    const parsed = JSON.parse(startMsg![0])
    expect(parsed.testTitle).toBe('test title')
    expect(parsed.sessionId).toBe('sess-abc')
  })

  it('mark() sends a mark event', async () => {
    const fakePage = makeFakePage()
    const handle = await attach(fakePage as never, {
      viteUrl: 'ws://localhost:9999/__introspection',
      sessionId: 'sess-mark',
      testTitle: 'mark test',
      testFile: 'x.spec.ts',
      workerIndex: 0,
      outDir: '/tmp',
    })
    mockWsSend.mockClear()
    handle.mark('step 1', { extra: true })
    expect(mockWsSend).toHaveBeenCalledOnce()
    const msg = JSON.parse(mockWsSend.mock.calls[0][0])
    expect(msg.event.type).toBe('mark')
  })
})
