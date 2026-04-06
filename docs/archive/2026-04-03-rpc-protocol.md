# Typed RPC Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled untyped WebSocket string protocol with `@bigmistqke/rpc/websocket`, giving all three participants (Vite server, Playwright process, browser page) compile-time-checked interfaces and fixing the `sessionId` routing bug in `BrowserAgent`.

**Architecture:** The Vite server calls `expose(serverMethods, { to: ws })` on every incoming WebSocket connection; both Playwright and browser clients call `rpc<IntrospectionServerMethods>(ws)` to get a typed proxy. The server also stores a `rpc<PlaywrightClientMethods>(ws)` proxy per session to call back for snapshot capture. Single `/__introspection` WebSocket endpoint is unchanged.

**Tech Stack:** `@bigmistqke/rpc@^0.1.6` (added to vite/playwright/browser packages), TypeScript, vitest, pnpm workspaces

---

## File Map

| File | Change |
|---|---|
| `packages/types/src/index.ts` | Add `IntrospectionServerMethods`, `PlaywrightClientMethods`, `BrowserClientMethods` |
| `packages/vite/package.json` | Add `@bigmistqke/rpc` to dependencies |
| `packages/vite/src/server.ts` | Replace `if/else` dispatch with `expose`; `Session.ws` → `Session.playwrightProxy` |
| `packages/vite/test/server.test.ts` | Rewrite tests to use `rpc` client; add `requestSnapshot` and `endSession` tests |
| `packages/playwright/package.json` | Add `@bigmistqke/rpc` to dependencies |
| `packages/playwright/test/attach.test.ts` | Rewrite to mock `@bigmistqke/rpc/websocket` instead of asserting raw JSON messages |
| `packages/playwright/src/attach.ts` | Replace all `ws.send(JSON.stringify(...))` with typed proxy calls; add `expose` for `takeSnapshot` |
| `packages/browser/package.json` | Add `@bigmistqke/rpc` to dependencies |
| `packages/browser/test/browser-agent.test.ts` | Rewrite to use new `BrowserAgent(sessionId, server)` constructor |
| `packages/browser/src/index.ts` | Replace `AgentTransport` with rpc proxy; fix `sessionId` routing bug; remove `START_SESSION` |

---

### Task 1: Add Protocol Types

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add the three protocol interfaces**

Open `packages/types/src/index.ts`. After the `IntrospectionPlugin` interface block (after the `}` closing line 172), add:

```ts
// ─── RPC Protocol interfaces ──────────────────────────────────────────────────

/** Methods the Vite server exposes — called by both Playwright and browser clients. */
export interface IntrospectionServerMethods {
  /** Called by Playwright to register a new test session. */
  startSession(params: { id: string; testTitle: string; testFile: string }): void
  /** Called by Playwright or browser to append an event to a session. */
  event(sessionId: string, event: TraceEvent): void
  /** Called by Playwright at test end to write the trace file and close the session. */
  endSession(sessionId: string, result: TestResult, outDir: string, workerIndex: number): void
  /** Called by Playwright to store an on-error snapshot for the session. */
  snapshot(sessionId: string, data: OnErrorSnapshot): void
  /** Called by browser (or handle.snapshot()) to trigger CDP snapshot capture on the Playwright side. */
  requestSnapshot(sessionId: string, trigger: OnErrorSnapshot['trigger']): void
}

/** Methods Playwright exposes — the server calls these to request snapshot capture. */
export interface PlaywrightClientMethods {
  takeSnapshot(trigger: OnErrorSnapshot['trigger']): OnErrorSnapshot
}

/** Browser connections expose no methods the server calls back on. */
export type BrowserClientMethods = Record<never, never>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @introspection/types exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add RPC protocol interfaces"
```

---

### Task 2: Update Vite Server

**Files:**
- Modify: `packages/vite/package.json`
- Modify: `packages/vite/src/server.ts`
- Modify: `packages/vite/test/server.test.ts`

**Context:** The current `server.ts` has a 60-line `if/else if` chain that string-matches `msg.type`. We replace it with a single `expose()` call. `Session.ws: WebSocket` (used only for sending `TAKE_SNAPSHOT`) becomes `Session.playwrightProxy: RPC<PlaywrightClientMethods>`. The existing server tests send raw JSON via `ws.send(JSON.stringify(...))` — those need to be rewritten to use `rpc<IntrospectionServerMethods>(ws)`.

A key advantage of the rpc approach: `await server.startSession(...)` resolves only after the server processes the call and sends a response — no more `setTimeout(resolve, 10)` polling.

- [ ] **Step 1: Add @bigmistqke/rpc dependency**

In `packages/vite/package.json`, add to `"dependencies"`:
```json
"@bigmistqke/rpc": "^0.1.6"
```

```bash
pnpm install
```

- [ ] **Step 2: Rewrite the server tests**

Replace `packages/vite/test/server.test.ts` entirely:

```ts
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
    const { port } = { port: (httpServer.address() as { port: number }).port }
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
```

- [ ] **Step 3: Run the tests — they must fail**

```bash
pnpm --filter @introspection/vite test
```

Expected: FAIL — the server still uses the old string protocol, so `rpc` calls won't be processed.

- [ ] **Step 4: Rewrite `packages/vite/src/server.ts`**

Replace the entire file:

```ts
import { WebSocketServer } from 'ws'
import { expose, rpc, type RPC } from '@bigmistqke/rpc/websocket'
import type { Server } from 'http'
import type {
  TraceEvent, IntrospectionConfig, TestResult, OnErrorSnapshot,
  IntrospectionServerMethods, PlaywrightClientMethods,
} from '@introspection/types'

export interface Session {
  id: string
  testTitle: string
  testFile: string
  startedAt: number
  events: TraceEvent[]
  playwrightProxy: RPC<PlaywrightClientMethods>
  bodyMap?: Map<string, string>
  snapshot?: OnErrorSnapshot
}

export interface IntrospectionServer {
  getSession(id: string): Session | undefined
  getSessions(): Session[]
  shutdown(): void
}

export function createIntrospectionServer(
  httpServer: Server,
  config: IntrospectionConfig,
  resolveFrame?: (frame: import('@introspection/types').StackFrame) => import('@introspection/types').StackFrame
): IntrospectionServer {
  const wss = new WebSocketServer({ noServer: true })
  const rejectWss = new WebSocketServer({ noServer: true })
  const sessions = new Map<string, Session>()

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/__introspection') {
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      rejectWss.handleUpgrade(req, socket as never, head, (ws) => {
        ws.close(1008, 'Path not found')
      })
    }
  })

  // Assumption: only the Playwright process calls startSession. Browser connections
  // also get a playwrightProxy created, but since they never call startSession,
  // the proxy is never stored and takeSnapshot is never invoked on it.
  wss.on('connection', (ws) => {
    const playwrightProxy = rpc<PlaywrightClientMethods>(ws)

    expose<IntrospectionServerMethods>({
      startSession({ id, testTitle, testFile }) {
        sessions.set(id, {
          id, testTitle, testFile,
          startedAt: Date.now(),
          events: [],
          playwrightProxy,
        })
      },

      event(sessionId, event) {
        const session = sessions.get(sessionId)
        if (!session) return
        let transformed: TraceEvent | null = event
        for (const plugin of config.plugins ?? []) {
          if (!transformed) break
          transformed = plugin.server?.transformEvent(transformed) ?? transformed
        }
        if (transformed && config.capture?.ignore?.includes(transformed.type)) {
          transformed = null
        }
        if (transformed) {
          if (transformed.type === 'js.error' && resolveFrame) {
            transformed = {
              ...transformed,
              data: { ...transformed.data, stack: transformed.data.stack.map(resolveFrame) },
            }
          }
          session.events.push(transformed)
        }
      },

      async endSession(sessionId, result, outDir, workerIndex) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          const { writeTrace } = await import('./trace-writer.js')
          await writeTrace(session, result, outDir, workerIndex)
        } catch (err) {
          console.error('[introspection] failed to write trace:', err)
        } finally {
          sessions.delete(sessionId)
        }
      },

      snapshot(sessionId, data) {
        const session = sessions.get(sessionId)
        if (session) session.snapshot = data
      },

      async requestSnapshot(sessionId, trigger) {
        const session = sessions.get(sessionId)
        if (!session) return
        try {
          session.snapshot = await session.playwrightProxy.takeSnapshot(trigger)
        } catch (err) {
          console.error('[introspection] snapshot request failed:', err)
        }
      },
    }, { to: ws })
  })

  return {
    getSession: (id) => sessions.get(id),
    getSessions: () => [...sessions.values()],
    shutdown: () => { wss.close(); rejectWss.close() },
  }
}
```

- [ ] **Step 5: Run tests — they must pass**

```bash
pnpm --filter @introspection/vite test
```

Expected: 6 tests, all pass. If `requestSnapshot` test is flaky, there may be a timing issue with the double round-trip — add a small `await new Promise(r => setTimeout(r, 20))` after `requestSnapshot` as a fallback.

- [ ] **Step 6: TypeScript check**

```bash
pnpm --filter @introspection/vite exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/vite/package.json packages/vite/src/server.ts packages/vite/test/server.test.ts
git commit -m "feat(vite): replace string protocol with @bigmistqke/rpc typed RPC"
```

---

### Task 3: Update Playwright Attach

**Files:**
- Modify: `packages/playwright/package.json`
- Modify: `packages/playwright/test/attach.test.ts`
- Modify: `packages/playwright/src/attach.ts`

**Context:** `attach.ts` currently sends `START_SESSION`, `EVENT`, `SNAPSHOT_REQUEST`, `END_SESSION` via raw `ws.send(JSON.stringify(...))` and receives `TAKE_SNAPSHOT` via `ws.on('message', ...)`. We replace all of this. The `expose<PlaywrightClientMethods>` call registers `takeSnapshot` so the server can call back. Note: `cdp` must be created before `expose` since the `takeSnapshot` closure uses it.

The existing 8 tests in `attach.test.ts` mock the `ws` module and assert on raw JSON messages — both the mock and the assertions must be replaced. The new tests mock `@bigmistqke/rpc/websocket` and assert that the rpc proxy methods are called with correct args.

- [ ] **Step 1: Add @bigmistqke/rpc dependency**

In `packages/playwright/package.json`, add to `"dependencies"`:
```json
"@bigmistqke/rpc": "^0.1.6"
```

```bash
pnpm install
```

- [ ] **Step 2: Rewrite `packages/playwright/test/attach.test.ts`**

Replace the entire file. The key change: mock `@bigmistqke/rpc/websocket` and assert that proxy methods are called with the right args — not that raw JSON messages are sent.

The mock WS class also needs `addEventListener` added (required by `@bigmistqke/rpc/websocket`'s `WebSocketLike`). Pattern: use `vi.mock` with a factory creating `vi.fn()`, then in `beforeEach` set up `rpc`'s return value to a fresh proxy object:

```ts
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
      id: 'sess-abc', testTitle: 'test title', testFile: 'foo.spec.ts',
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
      'sess-detach', { status: 'passed', duration: 0 }, '/tmp/introspect', 0,
    )
    expect(cdp.detach).toHaveBeenCalledOnce()
    expect(mockWsClose).toHaveBeenCalledOnce()
  })

  it('detach() forwards result to endSession', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, { ...baseOpts, sessionId: 'sess-detach-result' })
    await handle.detach({ status: 'failed', duration: 1234, error: 'AssertionError' })
    expect(serverProxy.endSession).toHaveBeenCalledWith(
      'sess-detach-result',
      { status: 'failed', duration: 1234, error: 'AssertionError' },
      '/tmp/introspect',
      0,
    )
  })

  it('detach() defaults result to passed when called without args', async () => {
    const { page } = makeFakePage()
    const handle = await attach(page as never, baseOpts)
    await handle.detach()
    expect(serverProxy.endSession).toHaveBeenCalledWith(
      expect.any(String), { status: 'passed', duration: 0 }, '/tmp/introspect', 0,
    )
  })
})
```

- [ ] **Step 3: Run tests — they must fail**

```bash
pnpm --filter @introspection/playwright test
```

Expected: FAIL — `attach.ts` still uses old `ws.send(JSON.stringify(...))` calls, not the rpc proxy.

- [ ] **Step 4: Rewrite `packages/playwright/src/attach.ts`**

Replace the entire file:

```ts
import { randomUUID } from 'crypto'
// @ts-expect-error Missing ws type declarations
import WebSocket from 'ws'
import { rpc, expose } from '@bigmistqke/rpc/websocket'
import type { Page } from '@playwright/test'
import type {
  IntrospectHandle, TraceEvent, TestResult,
  IntrospectionServerMethods, PlaywrightClientMethods,
} from '@introspection/types'
import { createPageProxy } from './proxy.js'
import { normaliseCdpNetworkRequest, normaliseCdpNetworkResponse, normaliseCdpJsError } from './cdp.js'
// @ts-expect-error Cannot resolve path to vite snapshot
import { takeSnapshot } from '@introspection/vite/snapshot'

export interface AttachOptions {
  viteUrl: string       // ws://localhost:<port>/__introspection
  sessionId: string
  testTitle: string
  testFile: string
  workerIndex: number
  outDir: string
}

function getViteUrl(): string {
  const port = process.env.VITE_PORT ?? '5173'
  return `ws://localhost:${port}/__introspection`
}

export async function attach(page: Page, opts?: Partial<AttachOptions>): Promise<IntrospectHandle> {
  const sessionId = opts?.sessionId ?? randomUUID()
  const viteUrl = opts?.viteUrl ?? getViteUrl()
  const testTitle = opts?.testTitle ?? 'unknown test'
  const testFile = opts?.testFile ?? 'unknown file'
  const outDir = opts?.outDir ?? '.introspect'
  const workerIndex = opts?.workerIndex ?? 0
  const startedAt = Date.now()

  // Connect to Vite plugin WS
  const ws = new WebSocket(viteUrl)
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => clearTimeout(timer)
    ws.once('open', () => { cleanup(); resolve() })
    ws.once('error', (err: any) => { cleanup(); reject(err) })
    timer = setTimeout(
      () => reject(new Error(`Could not connect to Vite introspection server at ${viteUrl}`)),
      3000,
    )
  })

  const server = rpc<IntrospectionServerMethods>(ws)

  // Open CDP session before expose so the takeSnapshot closure can use cdp
  const cdp = await page.context().newCDPSession(page)

  // Expose takeSnapshot so the server can call back to capture CDP state
  expose<PlaywrightClientMethods>({
    async takeSnapshot(trigger) {
      return takeSnapshot({
        cdpSession: {
          send: (method: string, params?: Record<string, unknown>) =>
            cdp.send(method as never, params as never),
        },
        trigger,
        url: await page.evaluate(() => location.href),
        callFrames: [],
        plugins: [],
      })
    },
  }, { to: ws })

  // Start session
  await server.startSession({ id: sessionId, testTitle, testFile })

  function sendEvent(event: Omit<TraceEvent, 'id' | 'ts'> & { id?: string; ts?: number }) {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return
    // fire-and-forget — CDP event handlers are synchronous and don't await
    server.event(sessionId, { id: randomUUID(), ts: Date.now() - startedAt, ...event } as TraceEvent)
  }

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Page.enable')

  cdp.on('Network.requestWillBeSent', (params) => {
    sendEvent(normaliseCdpNetworkRequest(params as never, sessionId, startedAt))
  })
  cdp.on('Network.responseReceived', (params) => {
    sendEvent(normaliseCdpNetworkResponse(params as never, sessionId, startedAt))
  })
  cdp.on('Runtime.exceptionThrown', (params) => {
    sendEvent(normaliseCdpJsError(params as never, sessionId, startedAt))
  })
  cdp.on('Page.navigatedWithinDocument', (params: { url: string }) => {
    sendEvent({ type: 'browser.navigate', source: 'cdp', data: { from: '', to: params.url } })
  })

  // Proxy page for playwright.action tracking
  const proxiedPage = createPageProxy(page, (evt) => sendEvent(evt as never))

  const handle: IntrospectHandle = {
    page: proxiedPage,
    mark(label, data) {
      sendEvent({ type: 'mark', source: 'agent', data: { label, extra: data } })
    },
    async snapshot() {
      await server.requestSnapshot(sessionId, 'manual')
    },
    async detach(result?: TestResult) {
      await server.endSession(
        sessionId,
        result ?? { status: 'passed', duration: 0 },
        outDir,
        workerIndex,
      )
      try { await cdp.detach() } catch { /* non-fatal: browser context may already be closed */ }
      await new Promise<void>((resolve) => {
        ws.once('close', resolve)
        ws.close()
      })
    },
  }

  return handle
}
```

- [ ] **Step 5: Run tests — they must pass**

```bash
pnpm --filter @introspection/playwright test
```

Expected: 8 tests, all pass.

- [ ] **Step 6: TypeScript check**

```bash
pnpm --filter @introspection/playwright exec tsc --noEmit
```

Expected: no errors. The two existing `@ts-expect-error` suppressions (for `ws` and `@introspection/vite/snapshot`) are kept as-is — they're pre-existing build-order issues unrelated to this change.

- [ ] **Step 7: Commit**

```bash
git add packages/playwright/package.json packages/playwright/test/attach.test.ts packages/playwright/src/attach.ts
git commit -m "feat(playwright): replace string protocol with @bigmistqke/rpc typed RPC"
```

---

### Task 4: Update BrowserAgent

**Files:**
- Modify: `packages/browser/package.json`
- Modify: `packages/browser/test/browser-agent.test.ts`
- Modify: `packages/browser/src/index.ts`

**Context:** `BrowserAgent` currently wraps a `AgentTransport { send(message: string): void }` interface and calls `ws.send(JSON.stringify({ type: 'EVENT', event }))` without `sessionId` (the routing bug). It also sends `START_SESSION` on open. We remove all of this: the constructor now takes a `sessionId` and an rpc server proxy. `emit()` calls `this.server.event(this.sessionId, full)` — `sessionId` is always present, bug fixed. `connect()` no longer sends `START_SESSION`.

The existing 4 tests use `new BrowserAgent({ send })` — they need to be rewritten for the new constructor.

- [ ] **Step 1: Add @bigmistqke/rpc dependency**

In `packages/browser/package.json`, add to `"dependencies"`:
```json
"@bigmistqke/rpc": "^0.1.6"
```

```bash
pnpm install
```

- [ ] **Step 2: Rewrite `packages/browser/test/browser-agent.test.ts`**

Replace the entire file:

```ts
import { describe, it, expect, vi } from 'vitest'
import { BrowserAgent } from '../src/index.js'

function makeMockServer() {
  return { event: vi.fn().mockResolvedValue(undefined) }
}

describe('BrowserAgent', () => {
  it('emit() calls server.event with sessionId and correct event shape', () => {
    const server = makeMockServer()
    const agent = new BrowserAgent('sess-1', server as any)
    agent.emit({ type: 'plugin.router', data: { route: '/home' } })
    expect(server.event).toHaveBeenCalledOnce()
    const [calledSessionId, calledEvent] = server.event.mock.calls[0]
    expect(calledSessionId).toBe('sess-1')
    expect(calledEvent.type).toBe('plugin.router')
    expect(calledEvent.source).toBe('plugin')
    expect(calledEvent.id).toBeTruthy()
  })

  it('registers and calls plugin setup', () => {
    const setup = vi.fn()
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'test', browser: { setup, snapshot: () => ({}) } })
    expect(setup).toHaveBeenCalledWith(agent)
  })

  it('collects plugin snapshot data', () => {
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'router', browser: { setup: vi.fn(), snapshot: () => ({ route: '/home' }) } })
    expect(agent.collectSnapshot()).toEqual({ router: { route: '/home' } })
  })

  it('collectSnapshot is non-fatal when a plugin snapshot throws', () => {
    const agent = new BrowserAgent('sess-1', makeMockServer() as any)
    agent.use({ name: 'bad', browser: { setup: vi.fn(), snapshot: () => { throw new Error('boom') } } })
    agent.use({ name: 'good', browser: { setup: vi.fn(), snapshot: () => ({ ok: true }) } })
    const snapData = agent.collectSnapshot()
    expect(snapData.bad).toBeUndefined()
    expect(snapData.good).toEqual({ ok: true })
  })
})
```

- [ ] **Step 3: Run tests — they must fail**

```bash
pnpm --filter @introspection/browser test
```

Expected: FAIL — `BrowserAgent` still uses the old `AgentTransport` constructor.

- [ ] **Step 4: Rewrite `packages/browser/src/index.ts`**

Replace the entire file:

```ts
// packages/browser/src/index.ts
// Note: uses crypto.randomUUID() (Web Crypto API) — available in all modern browsers and Node 19+.
// Do NOT import from Node's 'crypto' module — this bundle runs in the browser page.
import { rpc } from '@bigmistqke/rpc/websocket'
import type {
  BrowserAgent as IBrowserAgent, IntrospectionPlugin, PluginEvent,
  IntrospectionServerMethods,
} from '@introspection/types'

function makeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `evt-${crypto.randomUUID().slice(0, 8)}`
    : `evt-${Math.random().toString(36).slice(2, 10)}`
}

export class BrowserAgent implements IBrowserAgent {
  private plugins: IntrospectionPlugin[] = []

  constructor(
    private sessionId: string,
    private server: ReturnType<typeof rpc<IntrospectionServerMethods>>,
  ) {}

  use(plugin: IntrospectionPlugin): void {
    this.plugins.push(plugin)
    plugin.browser?.setup(this)
  }

  emit(event: Omit<PluginEvent, 'id' | 'ts' | 'source'>): void {
    const full: PluginEvent = { id: makeId(), ts: Date.now(), source: 'plugin' as const, ...event }
    // sessionId is always present — fixes the silent routing bug
    this.server.event(this.sessionId, full)
  }

  collectSnapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const plugin of this.plugins) {
      if (plugin.browser?.snapshot) {
        try { result[plugin.name] = plugin.browser.snapshot() } catch { /* non-fatal */ }
      }
    }
    return result
  }

  /**
   * Connect to the Vite introspection server from a browser page.
   *
   * BREAKING CHANGE from previous API:
   * - Was: connect(vitePort: number, sessionId, testTitle, testFile)
   * - Now: connect(url: string, sessionId: string)
   * - START_SESSION is no longer sent — the Playwright process owns session lifecycle.
   *   The Playwright attach() call must complete before this agent emits events.
   */
  static connect(url: string, sessionId: string): BrowserAgent {
    const ws = new (globalThis as never as { WebSocket: typeof WebSocket }).WebSocket(url)
    const server = rpc<IntrospectionServerMethods>(ws)
    return new BrowserAgent(sessionId, server)
  }
}
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm --filter @introspection/browser exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/browser/package.json packages/browser/test/browser-agent.test.ts packages/browser/src/index.ts
git commit -m "feat(browser): replace string protocol with @bigmistqke/rpc, fix sessionId routing bug"
```

---

### Task 5: Integration Check

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all 16 test files pass, 0 failures. Key files to watch:
- `packages/vite/test/server.test.ts` — 6 tests (rewritten)
- `packages/vite/test/eval-socket.test.ts` — 7 tests (unchanged, should still pass)
- `packages/plugin-webgl/test/plugin-webgl.test.ts` — 19 tests (unchanged)

- [ ] **Step 2: TypeScript check all packages**

```bash
pnpm --filter './packages/**' exec tsc --noEmit
```

Expected: no errors across all packages.

- [ ] **Step 3: Commit only if adjustments were needed**

If step 1 or 2 required any fixes, commit them. If everything passed cleanly, no commit needed.
