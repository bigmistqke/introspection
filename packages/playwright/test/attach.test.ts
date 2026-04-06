import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '../src/attach.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'introspect-pw-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function makeFakePage() {
  const cdpListeners: Record<string, (params: unknown) => void> = {}
  const mockCdp = {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn((event: string, cb: (params: unknown) => void) => { cdpListeners[event] = cb }),
    detach: vi.fn().mockResolvedValue(undefined),
  }
  return {
    page: {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(mockCdp) }),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue('http://localhost/'),
    } as never,
    cdp: mockCdp,
    trigger: (event: string, params: unknown) => cdpListeners[event]?.(params),
  }
}

describe('attach()', () => {
  it('returns IntrospectHandle with page, mark, snapshot, detach', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir, testTitle: 'test' })
    expect(handle.page).toBeDefined()
    expect(typeof handle.mark).toBe('function')
    expect(typeof handle.snapshot).toBe('function')
    expect(typeof handle.detach).toBe('function')
    await handle.detach()
  })

  it('creates session directory with meta.json and events.ndjson', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir, testTitle: 'my test' })
    await handle.detach()
    const entries = await readdir(dir)
    expect(entries.length).toBe(1) // one session dir
    const sessionDir = join(dir, entries[0])
    const meta = JSON.parse(await readFile(join(sessionDir, 'meta.json'), 'utf-8'))
    expect(meta.label).toBe('my test')
    expect(meta.endedAt).toBeDefined()
    const ndjson = await readFile(join(sessionDir, 'events.ndjson'), 'utf-8')
    expect(typeof ndjson).toBe('string')
  })

  it('mark() appends a mark event to events.ndjson', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    handle.mark('step 1', { extra: true })
    await new Promise(r => setTimeout(r, 10)) // let async write settle
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const mark = events.find((e: { type: string }) => e.type === 'mark')
    expect(mark).toBeDefined()
    expect(mark.data.label).toBe('step 1')
  })

  it('detach() writes playwright.result event when result is passed', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    await handle.detach({ status: 'failed', error: 'assertion failed' })
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const result = events.find((e: { type: string }) => e.type === 'playwright.result')
    expect(result).toBeDefined()
    expect(result.data.status).toBe('failed')
  })

  it('Network.requestWillBeSent appends network.request event', async () => {
    const { page, trigger } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    trigger('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: '/api/test', method: 'GET', headers: {} },
      timestamp: 100,
    })
    await new Promise(r => setTimeout(r, 10))
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const req = events.find((e: { type: string }) => e.type === 'network.request')
    expect(req).toBeDefined()
    expect(req.data.url).toBe('/api/test')
  })

  it('Runtime.exceptionThrown appends js.error event', async () => {
    const { page, cdp, trigger } = makeFakePage()
    cdp.send.mockImplementation((method: string) => {
      if (method === 'DOM.getDocument') return Promise.resolve({ root: { nodeId: 1 } })
      if (method === 'DOM.getOuterHTML') return Promise.resolve({ outerHTML: '<html/>' })
      return Promise.resolve({})
    })
    const handle = await attach(page, { outDir: dir })
    trigger('Runtime.exceptionThrown', {
      timestamp: 200,
      exceptionDetails: {
        text: 'TypeError',
        exception: { description: 'TypeError: oops' },
        stackTrace: { callFrames: [] },
      },
    })
    await new Promise(r => setTimeout(r, 50))
    await handle.detach()
    const entries = await readdir(dir)
    const ndjson = await readFile(join(dir, entries[0], 'events.ndjson'), 'utf-8')
    const events = ndjson.trim().split('\n').map(l => JSON.parse(l))
    const err = events.find((e: { type: string }) => e.type === 'js.error')
    expect(err).toBeDefined()
    expect(err.data.message).toBe('TypeError: oops')
  })

  it('does not create a .socket file inside session directory', async () => {
    const { existsSync } = await import('fs')
    const { page } = makeFakePage()
    const handle = await attach(page, { outDir: dir })
    const entries = await readdir(dir)
    const socketPath = join(dir, entries[0], '.socket')
    expect(existsSync(socketPath)).toBe(false)
    await handle.detach()
  })
})
