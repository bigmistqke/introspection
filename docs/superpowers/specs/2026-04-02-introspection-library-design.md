# Introspection Library Design

**Date:** 2026-04-02
**Status:** Approved

## Overview

A TypeScript runtime introspection library for web app testing. Gives AI agents (like Claude Code) debugger-level visibility into a running browser — network, DOM, errors, events, variable state — without a human filtering console output. The VS Code debugger is the reference mental model: structured, queryable runtime data rather than raw console noise.

Primary workflow: Playwright-based web app testing. An AI runs a test, the library records a trace, the AI queries the trace via a rich CLI to understand what happened and why.

## Architecture

The system has three layers: a **Vite plugin** (the hub), a **browser agent** (optional, for semantic marks and plugin hosting), and a **CLI** (the AI's query interface).

### Data flow

```
Browser page
├── @introspection/browser (optional injected JS)
│   ├── semantic marks  — introspect.mark('user submitted form')
│   └── plugin host     — runs Redux/React plugins in-page
│       └── ── WebSocket ──► Vite plugin server
│
└── CDP session (via @introspection/playwright)
    ├── Network domain  — full request/response bodies
    ├── Runtime domain  — heap eval, variable inspection
    ├── Debugger domain — real source-mapped stack traces
    ├── DOM domain      — deep snapshots
    └── ── Node.js ───► Vite plugin server

Vite plugin server (Node.js)
├── merges + deduplicates both streams
├── resolves source maps at capture time
├── buffers trace per test session
├── triggers rich snapshots on error
├── runs server-side plugin transforms
└── exposes query socket for CLI

introspect CLI
├── connects to Vite plugin socket (live queries)
└── reads .trace.json (post-mortem queries)
```

### Two modes

**Test mode (Playwright + Vite) — primary:**
Browser agent + CDP session. `attach(page)` opens CDP via Playwright's internal API — no `--remote-debugging-port` flag, no external WebSocket. Full variable inspection, real stack traces, complete network bodies.

**Dev mode — out of scope for v1.**
An AI can spin up a one-off Playwright test and get full introspection. Dev-mode browser-agent-only support is a weaker experience and deferred.

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
        ignore: ['react.render'],
        network: {
          ignoreUrls: [/\.(png|jpg|woff|css)/, /analytics/],
          ignoreHeaders: ['authorization'],
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
  await attach(page)  // one line — opens CDP, starts recording
  await page.goto('/login')
  await page.fill('[name=email]', 'user@example.com')
  await page.fill('[name=password]', 'password')
  await page.click('[type=submit]')
  await expect(page).toHaveURL('/dashboard')
})
```

## Data Model

### Trace file

One `.trace.json` per test, written to `.introspect/` at test end. Named from the test title.

```
.introspect/
  login--should-redirect-on-success.trace.json
  bodies/
    evt_042.json    # full response bodies, never in trace file
    evt_043.json
```

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
- `initiator` — links event to the event that caused it (e.g. response → request, request → click)

### Event types

**CDP-sourced:**
- `network.request` — url, method, headers, postData
- `network.response` — status, headers, `bodyRef` (id), `bodySummary` (top-level keys + any error fields)
- `network.error` — url, errorText
- `js.error` — message, source-mapped stack frames
- `js.console` — level, serialized args (not raw strings)
- `dom.snapshot` — targeted snapshot (visible form elements, focused element, current route). Full DOM only in `on-error` snapshot.
- `variable.snapshot` — scope chain + evaluated expressions at error time

**Browser agent-sourced:**
- `browser.click` — target selector, text, coordinates
- `browser.input` — target selector, value
- `browser.navigate` — from, to
- `mark` — label, arbitrary data (custom annotation)

**Playwright-sourced:**
- `playwright.action` — records the AI's own Playwright calls (click, fill, goto, etc.) so they appear in the trace timeline

**Plugin-sourced:**
- `redux.action` — type, payload, stateBefore, stateAfter
- `react.error` — error, componentStack (error boundaries only, not every render)
- `plugin.<name>` — arbitrary plugin data

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

### Response bodies

Bodies are stored as sidecar JSON files, never in the trace. The trace carries a `bodySummary` with top-level keys and any error fields surfaced automatically. The CLI is the query layer — the AI never reads raw body files directly.

## CLI Interface

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
introspect body evt_042 --path=".error"     # extract a field
introspect body evt_042 --jq='.users[] | select(.active)'  # jq query

# DOM
introspect dom --at=error                   # DOM snapshot at failure

# Live queries (browser still open via attach())
introspect eval "window.store.getState()"   # arbitrary JS eval via CDP
introspect eval "document.title"
```

`introspect summary` is the most important command — the AI asks "what happened?" and gets a readable narrative before deciding which detail commands to run.

All commands default to the most recent trace. `--trace=<name>` selects a specific one.

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

Zero app code changes. Hooks into React's internal fiber via `__REACT_DEVTOOLS_GLOBAL_HOOK__` — the same mechanism React DevTools uses. Only emits on error boundaries and uncaught render errors (not every render). Contributes the component tree to error snapshots.

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

- **CDP via Playwright's internal API** — no `--remote-debugging-port` flag required. `attach(page)` uses `page.context().newCDPSession(page)` internally.
- **Source maps resolved at capture time** — stack traces always show original file/line, never bundled code.
- **Response bodies as sidecar files** — keeps trace files small and readable; CLI is the query layer.
- **`introspect summary` first** — the CLI is designed so the AI starts with a narrative overview, then drills in. Not the other way around.
- **Storage is an implementation detail** — JSON + jq is sufficient for single-test traces at v1 scale. SQLite is a natural migration if cross-test querying becomes important.
- **Plugin `transformEvent` returning `null` drops events** — this is how configurable filtering works for noisy event types.
- **No dev mode in v1** — AI can create one-off Playwright tests for full introspection. Dev-mode browser-agent-only support is deferred.
