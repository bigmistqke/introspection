# Introspection 2.0 — CDP-Only Pivot Design

**Date:** 2026-04-06
**Status:** Approved

## Overview

A clean-slate 2.0 of the introspection library. Remove the Vite dependency, the BrowserAgent WebSocket transport, and the plugin system entirely. The result is a minimal, honest package structure: a framework-agnostic `@introspection/core` that handles CDP utilities and session I/O, and a thin `@introspection/playwright` glue layer. Everything else is deleted until it earns its place back.

## Package Structure

```
packages/
  types/       — shared TypeScript types (trimmed — no plugin interfaces)
  core/        — CDP normalizers, snapshot, session-writer, eval-socket (new)
  playwright/  — attach() + Page proxy (slimmed)

deleted:
  vite/
  browser/
  plugin-redux/
  plugin-react/
  plugin-zustand/
  plugin-webgl/
```

`@introspection/core` has zero runtime dependencies outside of Node builtins. `@introspection/playwright` depends only on `@introspection/core`, `@introspection/types`, and `@playwright/test` as a peer.

## Data Flow

```
Playwright test
└── attach(page)
    ├── page.context().newCDPSession(page)
    │   ├── Network.*  → core/cdp.ts normalizers → session-writer → events.ndjson
    │   ├── Runtime.*  → core/cdp.ts normalizers → session-writer → events.ndjson
    │   ├── Debugger.* → core/snapshot.ts        → snapshots/<trigger>.json
    │   └── DOM.*      → core/snapshot.ts        → snapshots/<trigger>.json
    │
    └── proxy.ts (Page proxy)
        └── playwright.action events → session-writer → events.ndjson

.introspect/<session-id>/
  meta.json
  events.ndjson            ← one line per event, appended as they arrive
  bodies/<id>.json         ← full response bodies
  snapshots/<trigger>.json

core/eval-socket.ts
  .introspect/.socket      ← Unix domain socket, reads events.ndjson on each query
```

No in-memory event accumulation. `attach()` writes directly to disk. The eval socket reads the ndjson file fresh on each query.

## `@introspection/core`

### `session-writer.ts`
Manages the session directory on disk.

- `initSessionDir(outDir, { id, startedAt, label })` — creates directory, writes `meta.json`, creates empty `events.ndjson`
- `appendEvent(outDir, sessionId, event)` — appends one JSON line to `events.ndjson`; if `network.response` with a body, writes sidecar to `bodies/<id>.json`
- `finalizeSession(outDir, sessionId, endedAt)` — writes `endedAt` to `meta.json`

### `cdp.ts`
Pure normalizer functions — no I/O, no state.

- `normaliseCdpNetworkRequest(raw, startedAt)` → `NetworkRequestEvent`
- `normaliseCdpNetworkResponse(raw, startedAt)` → `NetworkResponseEvent`
- `normaliseCdpJsError(raw, startedAt)` → `JsErrorEvent`

### `snapshot.ts`
Takes a DOM + scope chain snapshot via any object with a `send(method, params)` interface — not Playwright-specific.

- `takeSnapshot({ cdpSession, trigger, url, callFrames })` → `OnErrorSnapshot`
  - Captures full DOM via `DOM.getDocument` + `DOM.getOuterHTML`
  - Captures local variable scope from call frames via `Runtime.getProperties`
  - Captures key globals (`location.pathname`, `localStorage`, `sessionStorage`)

### `eval-socket.ts`
Unix domain socket server for live CLI queries against a session.

- `createEvalSocket(socketPath, sessionNdjsonPath)` → `{ shutdown() }`
- Listens for newline-delimited JSON messages: `{ id, type: 'eval', expression }`
- On each query: reads and parses `events.ndjson` from disk, runs expression via `vm.runInNewContext` with `{ events, session }` context
- Responds with `{ id, result }` or `{ id, error }`

Reading from disk on each query means no in-memory accumulation — the socket can answer queries about a completed session after `attach()` has exited, as long as `.socket` still exists.

## `@introspection/playwright`

### `attach.ts`

```ts
interface AttachOptions {
  outDir?: string        // default: '.introspect'
  testTitle?: string
  workerIndex?: number
}

interface IntrospectHandle {
  page: Page             // proxy-wrapped Page — use instead of original for action tracking
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}

const handle = await attach(page, { testTitle: 'checkout flow' })
```

`attach()`:
1. Generates a `sessionId` (UUID)
2. Calls `initSessionDir`
3. Opens a CDP session via `page.context().newCDPSession(page)`
4. Enables CDP domains: `Network`, `Runtime`, `Debugger`, `DOM`, `Page`
5. Sets `Debugger.setPauseOnExceptions` to `uncaught`
6. Wires CDP event listeners → normalizers → `appendEvent`
7. On `Debugger.paused` (exception): captures scope, stores as `pendingSnapshot`, resumes
8. On `Runtime.exceptionThrown`: calls `takeSnapshot`, writes to `snapshots/js.error.json`
9. Creates eval socket at `<outDir>/.socket`
10. Returns `IntrospectHandle` with proxy-wrapped page

`detach()`:
1. Optionally emits a `playwright.result` event
2. Calls `finalizeSession`
3. Shuts down the eval socket
4. Detaches the CDP session

### `proxy.ts`
Wraps a Playwright `Page` in a `Proxy` that intercepts tracked methods and emits `playwright.action` events before delegating. Tracked methods: `click`, `fill`, `goto`, `press`, `selectOption`, `check`, `uncheck`, `hover`, `dragAndDrop`, `evaluate`, `waitForURL`, `waitForSelector`.

## `@introspection/types`

Trimmed to remove all plugin-related interfaces:

- Remove: `IntrospectionPlugin`, `BrowserAgent`-related types, `IntrospectionConfig.plugins`, `IntrospectionServerMethods`, `PlaywrightClientMethods`
- Keep: all event types (`TraceEvent`, `NetworkRequestEvent`, etc.), `OnErrorSnapshot`, `SessionMeta`, `StackFrame`, `ScopeFrame`, `IntrospectHandle`, `DetachResult`, `BodySummary`

## Session Directory Layout

```
.introspect/
  <session-id>/
    meta.json              ← { version, id, startedAt, label, endedAt? }
    events.ndjson          ← one TraceEvent per line
    bodies/
      <event-id>.json      ← full response body for network.response events
    snapshots/
      js.error.json        ← on-error snapshot
      manual.json          ← on-demand snapshot (handle.snapshot())
  .socket                  ← Unix domain socket (deleted on detach)
```

## What Is Deleted

### Packages
- `@introspection/vite` — entire package
- `@introspection/browser` — entire package
- `@introspection/plugin-redux`
- `@introspection/plugin-react`
- `@introspection/plugin-zustand`
- `@introspection/plugin-webgl`

### From `@introspection/playwright`
- `@bigmistqke/rpc` dependency
- `ws` dependency
- `@introspection/vite` dependency
- All WebSocket / RPC code

### From `@introspection/types`
- `IntrospectionPlugin` interface
- `IntrospectionConfig` (plugin array, capture config)
- `IntrospectionServerMethods`, `PlaywrightClientMethods` RPC types

### Demos
- `demos/checkout/` — depends on Vite + plugin-redux; delete or gut to a bare Playwright test

## Key Design Decisions

- **No in-memory event accumulation** — `attach()` writes directly to disk. The eval socket reads ndjson on each query. Memory footprint stays flat regardless of test duration.
- **`@introspection/core` is framework-agnostic** — its only dependency is Node builtins. Any CDP-capable tool (Puppeteer, raw `chrome-remote-interface`) can use it in the future.
- **`@introspection/playwright` is a thin glue layer** — it provides the Playwright `Page` proxy and wires `page.context().newCDPSession()` into core. The logic lives in core.
- **Plugin system deferred** — not deleted forever, just not present in 2.0. A future plugin design will be a separate spec built on this core.
- **Source maps deferred** — a future optional `@introspection/vite` plugin can serve source maps via a lightweight endpoint. `attach()` will accept an optional `sourceMapUrl` when that exists.
- **One eval socket per session** — created inside `attach()`, bound to that session's directory, torn down on `detach()`.
