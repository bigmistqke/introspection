# Typed RPC Protocol Design

**Package changes:** `@introspection/types`, `@introspection/vite`, `@introspection/playwright`, `@introspection/browser`
**Date:** 2026-04-03

---

## Goal

Replace the hand-rolled untyped WebSocket protocol (string-matched JSON messages) with typed, bidirectional RPC using `@bigmistqke/rpc/websocket`. Fixes the `sessionId` routing bug in `BrowserAgent`, eliminates the `SNAPSHOT_REQUEST → TAKE_SNAPSHOT → SNAPSHOT` roundtrip, and gives all three connection participants a compile-time-checked interface.

---

## Background

The current protocol between the Vite plugin server, Playwright process, and browser pages is entirely untyped. Messages like `START_SESSION`, `EVENT`, `END_SESSION`, `SNAPSHOT_REQUEST`, `TAKE_SNAPSHOT`, and `SNAPSHOT` are string-matched across three files (`server.ts`, `attach.ts`, `browser/src/index.ts`) with `Record<string, unknown>` payloads and pervasive `as string` / `as never` casts. Known bugs:

- `BrowserAgent.emit()` sends events without `sessionId`, so browser-originated events are silently unroutable to any session.
- The snapshot roundtrip requires three separate message types and manual correlation across a request/response cycle.

---

## Architecture

### Transport

Single `/__introspection` WebSocket endpoint — unchanged. Both Playwright and browser clients connect here. `@bigmistqke/rpc/websocket` works with any `WebSocketLike`:

```ts
interface WebSocketLike {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
}
```

Both Node.js `ws.WebSocket` (Playwright, Vite) and native browser `WebSocket` satisfy this interface without adapters.

### Participants

```
Playwright process          Vite server (Node.js)       Browser page
──────────────────          ─────────────────────       ────────────
rpc<ServerMethods>     ←→   expose(serverMethods)   ←→  rpc<ServerMethods>
expose(playwrightMethods)   rpc<PlaywrightMethods>       (no server→browser calls)
```

The server exposes the same method set to all connections. Each client type calls only the methods relevant to it. The server stores a `rpc<PlaywrightClientMethods>(ws)` proxy per session so it can call back to Playwright when a snapshot is needed.

---

## Protocol Types (`@introspection/types`)

Three interfaces replace all untyped message strings. Added to `packages/types/src/index.ts`.

### `IntrospectionServerMethods`

Methods the Vite server exposes — called by both Playwright and browser clients:

```ts
export interface IntrospectionServerMethods {
  /** Called by Playwright to register a new test session. */
  startSession(params: { id: string; testTitle: string; testFile: string }): void

  /** Called by Playwright or browser to append an event to a session. */
  event(sessionId: string, event: TraceEvent): void

  /** Called by Playwright at test end to write the trace file and close the session. */
  endSession(sessionId: string, result: TestResult, outDir: string, workerIndex: number): void

  /** Called by Playwright to store an on-error snapshot for the session. */
  snapshot(sessionId: string, data: OnErrorSnapshot): void

  /** Called by browser to trigger a CDP snapshot on the Playwright side. */
  requestSnapshot(sessionId: string, trigger: string): void
}
```

### `PlaywrightClientMethods`

Methods Playwright exposes — called by the server when it needs to capture a snapshot:

```ts
export interface PlaywrightClientMethods {
  /** Server calls this to request a CDP snapshot from the Playwright process. */
  takeSnapshot(): OnErrorSnapshot
}
```

### `BrowserClientMethods`

Browser connections expose no methods the server calls back on:

```ts
export type BrowserClientMethods = Record<never, never>
```

---

## Server (`packages/vite/src/server.ts`)

The 60-line `if/else if` message dispatch is replaced by a single `expose` call per connection. `Session.ws: WebSocket` is replaced by `Session.playwrightProxy: RPC<PlaywrightClientMethods>`.

```ts
import { expose, rpc, type RPC } from '@bigmistqke/rpc/websocket'
import type { IntrospectionServerMethods, PlaywrightClientMethods } from '@introspection/types'

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
      if (transformed && config.capture?.ignore?.includes(transformed.type)) transformed = null
      if (transformed) {
        if (transformed.type === 'js.error' && resolveFrame) {
          transformed = { ...transformed, data: { ...transformed.data, stack: transformed.data.stack.map(resolveFrame) } }
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
        session.snapshot = await session.playwrightProxy.takeSnapshot()
      } catch (err) {
        console.error('[introspection] snapshot request failed:', err)
      }
    },
  }, { to: ws })
})
```

`writeTrace` errors are now caught and logged (previously unhandled, could leave sessions stuck). The `SNAPSHOT_REQUEST → TAKE_SNAPSHOT → SNAPSHOT` three-message roundtrip is collapsed into a single awaited `takeSnapshot()` call.

---

## Playwright (`packages/playwright/src/attach.ts`)

Manual `ws.send(JSON.stringify(...))` calls replaced by a typed proxy. The `TAKE_SNAPSHOT` / `SNAPSHOT` message listeners are removed. `expose` registers `takeSnapshot` for server callbacks.

```ts
import { rpc, expose } from '@bigmistqke/rpc/websocket'
import type { IntrospectionServerMethods, PlaywrightClientMethods } from '@introspection/types'

const ws = new WS(viteUrl)
// wait for open...

const server = rpc<IntrospectionServerMethods>(ws)

expose<PlaywrightClientMethods>({
  async takeSnapshot() {
    return collectSnapshot(page, cdpSession)
  },
}, { to: ws })

// Session lifecycle:
await server.startSession({ id, testTitle, testFile })
await server.event(sessionId, event)
await server.snapshot(sessionId, snapshotData)       // if taken on Playwright side directly
await server.endSession(sessionId, result, outDir, workerIndex)
```

---

## Browser (`packages/browser/src/index.ts`)

`BrowserAgent` uses the native browser `WebSocket` (satisfies `WebSocketLike`). The `sessionId` is passed explicitly to every `event()` call — fixing the routing bug where events were silently dropped.

```ts
import { rpc } from '@bigmistqke/rpc/websocket'
import type { IntrospectionServerMethods } from '@introspection/types'

class BrowserAgent {
  private server: ReturnType<typeof rpc<IntrospectionServerMethods>>

  static connect(url: string, sessionId: string): BrowserAgent {
    const ws = new WebSocket(url)
    const server = rpc<IntrospectionServerMethods>(ws)
    return new BrowserAgent(sessionId, server)
  }

  emit(event: TraceEvent): void {
    // sessionId is always present — no more silent routing failures
    this.server.event(this.sessionId, event)
  }
}
```

Browser connections call only `event` (and optionally `requestSnapshot`). They never call `startSession` or `endSession`.

---

## Dependencies

| Package | New dependency |
|---|---|
| `@introspection/vite` | `@bigmistqke/rpc` |
| `@introspection/playwright` | `@bigmistqke/rpc` |
| `@introspection/browser` | `@bigmistqke/rpc` |
| `@introspection/types` | none (interfaces only) |

`@bigmistqke/rpc` version `^0.1.6`. Its only runtime dependency is `valibot` (used for message validation internally).

---

## What Is Removed

- `msg.type === 'START_SESSION'` / `'EVENT'` / `'END_SESSION'` / `'SNAPSHOT_REQUEST'` / `'SNAPSHOT'` string matching in `server.ts`
- `ws.send(JSON.stringify({ type: 'TAKE_SNAPSHOT', ... }))` in `server.ts`
- `ws.on('message', ...)` raw JSON parsing in `server.ts`
- All `as string` / `as never` casts on incoming WS message fields
- The `TAKE_SNAPSHOT` receive handler and `SNAPSHOT` send in `attach.ts`
- `ws.send(JSON.stringify({ type: 'EVENT', event }))` without sessionId in `browser/src/index.ts`

---

## Testing

- `packages/vite/test/server.test.ts` — replace mock WS message sending with `rpc<IntrospectionServerMethods>(mockWs).startSession(...)` etc. Test that `requestSnapshot` awaits `takeSnapshot` and stores the result.
- `packages/vite/test/server.test.ts` — test that `endSession` errors are caught and logged, session is deleted in `finally`.
- `packages/playwright/test/attach.test.ts` — verify `expose({ takeSnapshot })` is called and the server proxy uses typed method calls.
- `packages/browser/test/browser-agent.test.ts` — verify `event(sessionId, ...)` is called with sessionId always present.

---

## Out of Scope

- CLI enhancements (`--json`, `--outDir`) — separate effort
- Plugin lifecycle (`teardown()`) — separate effort
- Package coupling cleanup (extract snapshot from vite) — separate effort
- `shallowChangedKeys` deduplication — trivial, can be done inline during any future plugin work
