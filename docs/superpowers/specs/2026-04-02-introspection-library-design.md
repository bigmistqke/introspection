# Introspection Library Design

**Date:** 2026-04-02
**Status:** Approved

## Overview

A TypeScript runtime introspection library for AI-driven web app testing. Gives AI agents (like Claude Code) debugger-level visibility into a running browser — network, DOM, errors, events, variable state — without a human filtering console output. The VS Code debugger is the reference mental model: structured, queryable runtime data rather than raw console noise.

Primary workflow: Playwright-based web app testing. An AI runs a test, the library records a trace, the AI queries the trace via a rich CLI to understand what happened and why.

## Architecture

The system has three layers: a **Vite plugin** (the hub), a **browser agent** (optional, for semantic marks and plugin hosting), and a **CLI** (the AI's query interface).

### Data flow

```
Browser page
├── @introspection/browser (optional injected JS)
│   ├── semantic marks  — introspect.mark('user submitted form')
│   └── plugin host     — runs Redux/React plugins in-page
│       └── ── WebSocket ──► Vite plugin server (ws://localhost:<vite-port>/__introspection)
│
└── CDP session (via @introspection/playwright)
    ├── Network domain  — full request/response bodies
    ├── Runtime domain  — heap eval, variable inspection
    ├── Debugger domain — raw stack traces (source-mapped by Vite plugin)
    ├── DOM domain      — deep snapshots
    └── ── forwarded over same WS ──► Vite plugin server

Vite plugin server (Node.js)
├── merges + deduplicates both streams
├── resolves source maps via Vite's module graph (has access to all source maps)
├── buffers trace per test session
├── triggers rich snapshots on error and navigation
├── runs server-side plugin transforms
└── exposes CLI query socket at .introspect/.socket (Unix domain socket)

introspect CLI
├── connects to .introspect/.socket (live queries, browser still open)
└── reads .trace.json (post-mortem queries, browser closed)
```

### Vite as a required runtime dependency

`attach(page)` connects to the Vite dev server over WebSocket (`ws://localhost:<vitePort>/__introspection`). **Vite must be running when tests execute.** This is the standard setup for projects using Playwright with Vite (e.g., via `@playwright/test` launching the app via Vite). The Vite port is discovered from the `VITE_PORT` environment variable (set automatically by Vite) or falls back to `5173`.

Source map resolution happens entirely inside the Vite plugin, which has full access to Vite's module graph. `@introspection/playwright` forwards raw CDP frames (with minified positions) over the WebSocket — the Vite plugin resolves them before writing to the trace.

### Two modes

**Test mode (Playwright + Vite) — primary:**
Browser agent + CDP session. `attach(page)` opens a CDP session via Playwright's internal API, forwards events to the Vite plugin, and returns an instrumented handle. No `--remote-debugging-port` flag required.

**Dev mode — out of scope for v1.**
An AI can spin up a one-off Playwright test and get full introspection. Dev-mode browser-agent-only support is deferred.

## Packages

| Package | Purpose |
|---|---|
| `@introspection/vite` | Vite plugin — hub of the system |
| `@introspection/browser` | Optional browser agent — semantic marks + plugin host |
| `@introspection/playwright` | `attach(page)` — CDP bridge, required for test mode |
| `introspect` | CLI — AI queries traces |
| `@introspection/plugin-redux` | Captures Redux store state + actions |
| `@introspection/plugin-react` | Captures React error boundaries + component tree on error |

## Setup

```ts
// vite.config.ts
import { introspection } from '@introspection/vite'
import { reduxPlugin } from '@introspection/plugin-redux'

export default defineConfig({
  plugins: [
    introspection({
      plugins: [reduxPlugin()],
      capture: {
        ignore: ['redux.action'],         // drop entire event types
        network: {
          ignoreUrls: [/\.(png|jpg|woff|css)/, /analytics/],
          ignoreHeaders: ['authorization'],  // redact, not skip
        },
        responseBody: {
          maxSize: '50kb',               // per-body size cap
          ignore: [/\.(png|jpg|woff)/],  // skip binary response bodies
        }
      }
    })
  ]
})
```

```ts
// any Playwright test
import { attach } from '@introspection/playwright'

test('login redirects on success', async ({ page }) => {
  const introspect = await attach(page)  // returns IntrospectHandle

  await page.goto('/login')
  await introspect.mark('filling credentials')   // optional semantic mark from Node.js
  await page.fill('[name=email]', 'user@example.com')
  await page.fill('[name=password]', 'password')
  await page.click('[type=submit]')
  await expect(page).toHaveURL('/dashboard')
})
```

## `attach(page)` — IntrospectHandle

`attach(page)` is async and returns an `IntrospectHandle`:

```ts
interface IntrospectHandle {
  page: Page                  // Proxy-wrapped Playwright page — use this instead of the original for playwright.action tracking
  mark(label: string, data?: Record<string, unknown>): void  // emit a mark event from Node.js
  snapshot(): Promise<void>   // manually trigger an on-demand snapshot
  detach(): Promise<void>     // stop recording and flush trace to disk
}
```

`detach()` is called automatically at test teardown via Playwright's `afterEach`-equivalent hook registered inside `attach()`. Manual `detach()` is needed only if the caller manages teardown explicitly.

### `playwright.action` interception

`attach(page)` returns a `Proxy`-wrapped page object that intercepts method calls and emits `playwright.action` events before delegating to the real page. This is transparent to the test — TypeScript types are preserved via `Proxy<Page>`.

```ts
// Internal — what attach() does
const proxy = new Proxy(page, {
  get(target, prop) {
    const original = target[prop as keyof Page]
    if (typeof original === 'function' && TRACKED_METHODS.includes(prop as string)) {
      return (...args: unknown[]) => {
        emit({ type: 'playwright.action', data: { method: prop, args: sanitize(args) } })
        return (original as Function).apply(target, args)
      }
    }
    return original
  }
})
```

`TRACKED_METHODS` covers: `click`, `fill`, `goto`, `press`, `selectOption`, `check`, `uncheck`, `hover`, `dragAndDrop`, `evaluate`, `waitForURL`, `waitForSelector`.

The returned `IntrospectHandle` also carries the proxy: `const { page: instrumentedPage, mark, snapshot, detach } = await attach(page)`. Tests use `instrumentedPage` to get `playwright.action` tracking. Using the original `page` still works — it just omits `playwright.action` events.

### Playwright assertion failure → CDP snapshot

When `expect(...).toHaveURL(...)` or any Playwright assertion throws, the Vite plugin needs to capture browser state immediately. The mechanism:

1. `attach()` wraps Playwright's `expect` via `test.use({ expect: wrappedExpect })` or a try/catch inside the proxy.
2. On assertion failure, before re-throwing, `attach()` calls `snapshot()` — which sends a CDP command to capture DOM, scope chain, and plugin state synchronously.
3. The snapshot completes (await) before the error propagates to the test runner.

If wrapping `expect` is not feasible in a given Playwright version, the test author calls `introspect.snapshot()` explicitly in a `try/catch` around assertions. This fallback is documented.

## `initiator` linkage

Every event carries an optional `initiator` field pointing to the `id` of the event that caused it.

**Network requests:** CDP's `Network.requestWillBeSent` event includes an `initiator` object with a call stack. The Vite plugin matches the top frame of that call stack against recent `browser.click` or `playwright.action` events using a 500ms time window + file/line intersection. If a match is found, the network event's `initiator` is set to that event's `id`. If not matched, `initiator` is omitted.

**Network responses:** `initiator` points to the corresponding `network.request` event id.

**`js.error`:** `initiator` points to the most recent `browser.click` or `playwright.action` within the same call stack lineage if determinable, otherwise omitted.

This is best-effort — complex async flows may not produce reliable linkage. The `initiator` field is a hint for the AI, not a guaranteed causal chain.

## Data Model

### Trace file

One `.trace.json` per test, written to `.introspect/` at test end. Named from the test title, slugified, with a Playwright worker index suffix to avoid collisions in parallel runs.

```
.introspect/
  login--should-redirect-on-success--w0.trace.json
  login--should-redirect-on-success--w1.trace.json  ← parallel worker
  bodies/
    evt_042.json    # full response bodies, never in trace file
    evt_043.json
  .socket           # Unix domain socket for live CLI queries (deleted on Vite stop)
```

Naming scheme: `<slugified-title>--w<workerIndex>.trace.json`. If worker index is unavailable, a short timestamp suffix is used instead.

```json
{
  "version": "1",
  "test": {
    "title": "login > should redirect on success",
    "file": "tests/login.spec.ts",
    "status": "failed",
    "duration": 3241,
    "error": "expect(url).toBe('/dashboard') → received '/login'"
  },
  "events": [],
  "snapshots": {
    "on-error": {}
  }
}
```

### Event shape

```json
{
  "id": "evt_042",
  "type": "network.response",
  "ts": 1823,
  "source": "cdp",
  "initiator": "evt_038",
  "data": {}
}
```

- `ts` — milliseconds since test start
- `source` — `"cdp"` | `"agent"` | `"plugin"` (for deduplication)
- `initiator` — best-effort link to the event that caused this one

### Event types

**CDP-sourced:**
- `network.request` — url, method, headers, postData
- `network.response` — status, headers, `bodyRef` (id), `bodySummary` (see below)
- `network.error` — url, errorText
- `js.error` — message, source-mapped stack frames
- `js.console` — level, serialized args (not raw strings)
- `dom.snapshot` — fires on every `browser.navigate` event. Payload contains: visible form elements (selector + value), focused element selector, and current URL. Written as a regular entry in the `events` array. Full serialized DOM is only captured in the `on-error` snapshot (not in routine `dom.snapshot` events).
- `variable.snapshot` — scope chain + evaluated expressions, fires on `js.error` and on-demand

**Browser agent-sourced:**
- `browser.click` — target selector, text, coordinates
- `browser.input` — target selector, value
- `browser.navigate` — from, to
- `mark` — label, arbitrary data (custom annotation)

**Playwright-sourced (via Proxy):**
- `playwright.action` — method name + sanitized args for all tracked Playwright calls

**Plugin-sourced:**
- `redux.action` — type, payload, stateBefore, stateAfter
- `react.error` — error, componentStack (error boundaries only)
- `plugin.<name>` — arbitrary plugin data

### `bodySummary` definition

`bodySummary` includes:
- Top-level keys of the response JSON
- Values of all scalar top-level fields (strings, numbers, booleans)
- For array fields: the array length and the first element's shape (keys only)
- For nested object fields: one level of keys, no values
- Any field named `error`, `message`, `code`, `status`, or `detail` at any depth, surfaced at the top level as `errorFields`

Example for `{ "users": [{...}, ...], "total": 150, "error": null }`:
```json
{
  "keys": ["users", "total", "error"],
  "scalars": { "total": 150, "error": null },
  "arrays": { "users": { "length": 148, "itemKeys": ["id", "name", "email", "active"] } },
  "errorFields": {}
}
```

### On-error snapshot

Triggered automatically on any uncaught JS error or failed Playwright assertion. Richer than individual events.

```json
{
  "ts": 3100,
  "trigger": "js.error",
  "url": "/login",
  "dom": "<full serialized DOM>",
  "scopes": [
    { "frame": "handleSubmit (auth.ts:42)", "vars": { "response": { "status": 401 } } },
    { "frame": "onClick (LoginForm.tsx:18)", "vars": { "email": "user@example.com" } }
  ],
  "globals": {
    "localStorage": { "token": null },
    "location": { "pathname": "/login" }
  },
  "plugins": {
    "redux": { "auth": { "status": "error", "user": null } }
  }
}
```

Stack frames are **source-mapped at capture time** — the AI always sees original file/line references, never bundled code.

### `capture` config schema

```ts
interface CaptureConfig {
  ignore?: string[]              // event type strings to drop entirely e.g. ['redux.action']
  network?: {
    ignoreUrls?: RegExp[]        // skip request+response for matching URLs
    ignoreHeaders?: string[]     // redact these header names (replaced with '<redacted>')
  }
  responseBody?: {
    maxSize?: string             // e.g. '50kb' — bodies over this size get summary only
    ignore?: RegExp[]            // skip body capture — matched against Content-Type header first, then request URL if no Content-Type match
  }
}
```

`capture.ignore` accepts full event type strings (`'redux.action'`, `'browser.click'`). Partial prefixes are not supported in v1.

## CLI Interface

All commands default to the most recent trace file in `.introspect/`. `--trace=<name>` selects a specific one.

```bash
# Overview — start here
introspect summary                          # plain-language narrative of what happened
introspect timeline                         # chronological event list

# Errors
introspect errors                           # all JS errors with source-mapped stacks
introspect vars --at=error                  # scope chain at moment of failure

# Network
introspect network                          # all requests/responses, tabular
introspect network --failed                 # non-2xx only
introspect network --url=/api/auth          # filter by URL pattern
introspect body evt_042                     # pretty-print full response body
introspect body evt_042 --path=".error"     # extract a field (dot-notation)
introspect body evt_042 --jq='.users[] | select(.active)'  # jq query

# DOM
introspect dom --at=error                   # DOM snapshot at failure

# Live queries (requires Vite running and browser open via attach())
introspect eval "window.store.getState()"   # arbitrary JS eval via CDP Runtime domain
introspect eval "document.title"
```

**Live query socket:** The Vite plugin writes a Unix domain socket at `.introspect/.socket`. The CLI connects to this socket for live queries. If `.socket` does not exist, live queries fail with a clear message: `"No active session — start Vite and run attach(page) in a test"`.

`introspect summary` is the primary entry point — the AI asks "what happened?" and gets a readable narrative before deciding which detail commands to run.

## Plugin System

Plugins are two-sided: a **browser side** (runs in the page, accesses app internals) and a **server side** (transforms the event stream). Either side is optional.

```ts
interface IntrospectionPlugin {
  name: string
  browser?: {
    setup(agent: BrowserAgent): void
    snapshot(): Record<string, unknown>   // called on every on-error snapshot
  }
  server?: {
    transformEvent(event: TraceEvent): TraceEvent | null  // null = drop event
    extendSnapshot(snapshot: Snapshot): Record<string, unknown>
  }
}
```

**Browser-side plugins require `@introspection/browser` to be loaded.** The browser agent provides the `BrowserAgent` instance and the WebSocket channel that `agent.emit()` uses to send events to the Vite plugin server. If the browser agent is not injected, browser-side plugin `setup()` is never called and its events are silently absent from the trace. The Vite plugin logs a warning if a plugin with a `browser` side is registered but the browser agent has not connected.

### Redux plugin

Registered via Redux middleware — one line in store setup, no other app changes.

```ts
import { reduxMiddleware } from '@introspection/plugin-redux'
const store = configureStore({
  middleware: (m) => m().concat(reduxMiddleware)
})
```

Emits `redux.action` events with before/after state. Contributes full store state to every error snapshot.

### React plugin

Zero app code changes. Hooks into React's internal fiber via `__REACT_DEVTOOLS_GLOBAL_HOOK__` — the same mechanism React DevTools uses. Only emits on error boundaries and uncaught render errors. Contributes the component tree to error snapshots.

### Custom plugins

```ts
const routerPlugin: IntrospectionPlugin = {
  name: 'router',
  browser: {
    setup(agent) {
      router.on('navigate', (from, to) => {
        agent.emit({ type: 'plugin.router', data: { from, to, params: to.params } })
      })
    },
    snapshot: () => ({ route: router.current })
  }
}
```

## Key Design Decisions

- **Vite is required** — `attach(page)` connects to Vite's dev server WebSocket. Source map resolution lives in the Vite plugin, which has access to Vite's module graph. This is a deliberate constraint: the library targets projects already using Vite, which covers the vast majority of modern web app setups.
- **CDP via Playwright's internal API** — no `--remote-debugging-port` flag required. `attach(page)` uses `page.context().newCDPSession(page)` internally.
- **Source maps resolved at capture time** — stack traces always show original file/line, never bundled code.
- **Response bodies as sidecar files** — keeps trace files small and readable; CLI is the query layer.
- **`initiator` is best-effort** — causal linking via CDP's initiator call stack + time-window matching. Reliable for simple flows, advisory for complex async scenarios.
- **`introspect summary` first** — the CLI is designed so the AI starts with a narrative overview, then drills in.
- **Storage is an implementation detail** — JSON + jq is sufficient for single-test traces at v1 scale. SQLite is a natural migration if cross-test querying becomes important.
- **Plugin `transformEvent` returning `null` drops events** — this is how configurable filtering works.
- **No dev mode in v1** — AI can create one-off Playwright tests for full introspection. Dev-mode browser-agent-only support is deferred.
