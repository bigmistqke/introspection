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
  .introspect/<session-id>/.socket   ← Unix domain socket, reads events.ndjson on each query
```

No in-memory event accumulation. `attach()` writes directly to disk. The eval socket reads the ndjson file fresh on each query.

## `@introspection/core`

### `session-writer.ts`
Manages the session directory on disk.

- `initSessionDir(outDir, { id, startedAt, label })` — creates directory, writes `meta.json`, creates empty `events.ndjson`
- `appendEvent(outDir, sessionId, event)` — appends one JSON line to `events.ndjson`
- `writeAsset({ directory, name, kind, content, ext?, metadata: { timestamp, ...rest } })` → `Promise<string>` — writes content to `assets/<uuid>.<kind>.<ext>`, appends an `asset` event to `events.ndjson` (with `metadata` merged into `data`), and returns the relative path (e.g. `assets/3f8a2c1d.snapshot.json`). `directory` is the `outDir` root, `name` is the session ID. `ext` defaults to `'json'` — pass `'png'` for screenshots, etc. `content` accepts `string | Buffer` to support both text and binary assets. `timestamp` is required (milliseconds since session start) — making it required ensures asset events are correctly aligned with the rest of the event stream. `kind` becomes the semantic label in the filename and in the `asset` event's `kind` field.
- `finalizeSession(outDir, sessionId, endedAt)` — writes `endedAt` to `meta.json`

**Asset model:** All sidecar files (response bodies, snapshots, future screenshots, WebGL states) are written to `assets/` via `writeAsset`. `writeAsset` atomically writes the file and appends the `asset` event — callers never append asset events manually. The `asset` event carries an inline summary so the AI can reason about the asset without opening the file.

**Body-fetching flow:** When `Network.loadingFinished` fires, `attach()` calls `Network.getResponseBody`, awaits `writeAsset` (which writes the file and appends the `asset` event), then appends the `network.response` event (with `bodySummary` inline). The await-before-append ordering guarantees the asset file exists before any event referencing it lands in `events.ndjson`. Multiple concurrent `loadingFinished` handlers each manage their own local variables independently.

### `cdp.ts`
Pure normalizer functions — no I/O, no state.

- `normaliseCdpNetworkRequest(raw, startedAt)` → `NetworkRequestEvent`
- `normaliseCdpNetworkResponse(raw, startedAt)` → `NetworkResponseEvent`
- `normaliseCdpJsError(raw, startedAt)` → `JsErrorEvent`

### `snapshot.ts`
Takes a DOM + scope chain snapshot via any object with a `send(method, params)` interface — not Playwright-specific.

- `takeSnapshot({ cdpSession, trigger, url, callFrames? })` → `OnErrorSnapshot`
  - Captures full DOM via `DOM.getDocument` + `DOM.getOuterHTML`
  - Captures local variable scope from call frames via `Runtime.getProperties` — `callFrames` is optional; when absent or empty (e.g. `trigger: 'manual'` called from Node.js with no paused context), scope capture is skipped and `scopes` is `[]`
  - Captures key globals (`location.pathname`, `localStorage`, `sessionStorage`)

### `eval-socket.ts`
Unix domain socket server for live CLI queries against a session. Uses Node's built-in `vm` module (`vm.runInNewContext`) — this is a Node.js-only dependency by design; Bun/Deno are not supported targets.

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
4. Enables CDP domains: `Network`, `Runtime`, `Debugger`, `DOM` (`Page` is not required and is not enabled)
5. Sets `Debugger.setPauseOnExceptions` to `uncaught`
6. Wires CDP event listeners → normalizers → `appendEvent`; `proxy.ts` receives a pre-bound `emit` callback (closing over `outDir` and `sessionId`) so it never references session state directly
7. On `Debugger.paused` (exception/promiseRejection): captures scope chain via `Runtime.getProperties`, stores as `pendingSnapshot`, then resumes. Scope capture happens here — while the debugger is paused and `objectId`s are still valid — not in the `exceptionThrown` handler.
8. On `Runtime.exceptionThrown`: captures `pendingSnapshot`, clears it, calls `takeSnapshot`, merges scopes, calls `writeAsset` with `kind: 'snapshot'` (which atomically writes the file and appends the `asset` event), then appends the `js.error` event. This ordering guarantees the `asset` event precedes its corresponding `js.error` event in `events.ndjson`.
9. Creates eval socket at `<outDir>/<sessionId>/.socket`
10. Returns `IntrospectHandle` with proxy-wrapped page

**Scope capture ordering:** `Debugger.paused` and `Runtime.exceptionThrown` may fire in either order. Scope is captured exclusively inside `Debugger.paused` (while the engine is paused and `objectId`s are valid) and stored in `pendingSnapshot`. The `exceptionThrown` handler merges it in regardless of which event fires first — if `exceptionThrown` fires before `Debugger.paused` has resolved, the snapshot is written with empty scopes and `pendingSnapshot` is cleared when `Debugger.paused` resolves (no second snapshot is written).

**Known limitation — rapid successive exceptions:** If two uncaught exceptions fire in rapid succession and their `Debugger.paused` events interleave before the corresponding `exceptionThrown` events, the second `Debugger.paused` may overwrite `pendingSnapshot` before the first `exceptionThrown` merges it. The first exception's snapshot would then contain the second exception's scope. This is an accepted limitation in 2.0 — it affects only the scope chain of rapid multi-exception scenarios, not the event stream itself.

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
- Remove: `'playwright.assertion'` from `OnErrorSnapshot['trigger']` union — this trigger was driven by the old browser-side RPC flow which no longer exists. Valid triggers in 2.0: `'js.error' | 'manual'`.
- Keep: all event types (`TraceEvent`, `NetworkRequestEvent`, etc.), `OnErrorSnapshot`, `SessionMeta`, `StackFrame`, `ScopeFrame`, `IntrospectHandle`, `BodySummary`, `DetachResult`
- Add: `AssetEvent` — new event type for all sidecar files:
  ```ts
  interface AssetEvent extends BaseEvent {
    type: 'asset'
    data: {
      path: string           // relative to session dir: 'assets/<uuid>.<kind>.json'
      kind: string           // 'body' | 'snapshot' | 'screenshot' | 'webgl-state' | ...
      // kind-specific inline summary fields (all optional):
      summary?: BodySummary  // for kind='body'
      trigger?: string       // for kind='snapshot'
      url?: string           // for kind='snapshot'
      scopeCount?: number    // for kind='snapshot'
    }
  }
  ```
- `DetachResult` — simplified to `{ status: 'passed' | 'failed' | 'timedOut'; error?: string }`. Emitted as a `playwright.result` event when passed to `detach()`.

## Session Directory Layout

```
.introspect/
  <session-id>/
    meta.json              ← { version, id, startedAt, label, endedAt? }
    events.ndjson          ← one TraceEvent per line (including asset events)
    assets/
      <uuid>.body.json        ← full response body (ext='json')
      <uuid>.snapshot.json    ← on-error or manual snapshot (ext='json')
      <uuid>.screenshot.png   ← future: screenshots (ext='png')
      <uuid>.webgl-state.json ← future: WebGL state captures (ext='json')
    .socket                ← Unix domain socket (deleted on detach)
```

All sidecar files live in `assets/`. The UUID is generated by `writeAsset` and ensures collision-free filenames across all asset types. The `kind` segment (`body`, `snapshot`, etc.) makes files identifiable without opening them. The event stream (`events.ndjson`) is the complete index — every asset has a corresponding `asset` event with an inline summary.

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
