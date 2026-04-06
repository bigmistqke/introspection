# @introspection

A CDP-based tracing library for Playwright tests. Captures structured, AI-readable event streams from end-to-end tests — network requests, JS errors, DOM snapshots, Playwright actions — written to disk as NDJSON for offline querying with the `introspect` CLI.

No Vite required. No browser-side agent. Attach directly to a Playwright `Page` via CDP.

---

## Installation

```bash
pnpm add -D @introspection/playwright  # attach(page) → IntrospectHandle
pnpm add -D introspect                 # CLI for querying traces
```

---

## Quick start

```ts
import { test } from '@playwright/test'
import { attach } from '@introspection/playwright'

test('add item to cart', async ({ page }) => {
  const handle = await attach(page, { testTitle: 'add item to cart' })

  await handle.page.goto('/')
  handle.mark('before-add')
  await handle.page.getByRole('button', { name: 'Add to cart' }).click()

  await handle.detach()
})
```

`attach(page)` opens a CDP session, captures network events, JS errors, and DOM snapshots, and returns a proxy-wrapped `page` that also records Playwright actions. All events are written directly to `.introspect/<session-id>/events.ndjson` as they arrive. `detach()` drains any in-flight handlers and finalizes the session.

---

## `attach()` options

```ts
interface AttachOptions {
  outDir?: string                  // default: '.introspect'
  testTitle?: string               // included in session metadata
  workerIndex?: number             // Playwright worker index
  plugins?: IntrospectionPlugin[]  // browser-side plugins (e.g. webgl())
  verbose?: boolean                // log lifecycle events to stderr
}
```

---

## `IntrospectHandle`

```ts
interface IntrospectHandle {
  page: Page                                          // proxy-wrapped Page — use instead of original
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>                           // capture DOM + scope manually
  detach(result?: DetachResult): Promise<void>
}
```

---

## Plugins

Plugins inject a browser-side script and receive CDP session access on the Node side. They emit events into the same NDJSON stream and can write typed assets on snapshot/error/detach.

### `@introspection/plugin-webgl`

Intercepts WebGL calls to track uniforms, draw calls, texture binds, and GL context state. On snapshot it serializes the full GL state and captures each canvas as a PNG.

```bash
pnpm add -D @introspection/plugin-webgl
```

```ts
import { attach } from '@introspection/playwright'
import { webgl } from '@introspection/plugin-webgl'

test('shader renders correctly', async ({ page }) => {
  const plugin = webgl()
  const handle = await attach(page, { plugins: [plugin] })

  await handle.page.goto('/canvas-demo')

  // Watch specific uniforms or draw calls
  await plugin.watch({ event: 'uniform', name: 'u_time', valueChanged: true })
  await plugin.watch({ event: 'draw' })

  // ...interact with the page...

  await handle.snapshot()   // captures GL state + canvas PNG
  await handle.detach()
})
```

**Watch options:**

| event | options | emits |
|---|---|---|
| `uniform` | `name?: string \| RegExp`, `valueChanged?: boolean`, `contextId?` | `webgl.uniform` |
| `draw` | `primitive?`, `contextId?` | `webgl.draw-arrays` / `webgl.draw-elements` |
| `texture-bind` | `unit?`, `contextId?` | `webgl.texture-bind` |

Each `plugin.watch(...)` returns a `WatchHandle` with an `unwatch()` method. Subscriptions are automatically re-applied after navigation.

**Captured assets** (on `snapshot()`, `js.error`, and `detach`):

- `webgl-state.json` — uniforms, bound textures, viewport, blend/depth state
- `webgl-canvas.png` — pixel content of each WebGL canvas

---

## Fixture helper

For automatic attach/detach per test with test result propagation:

```ts
// playwright.config.ts or a fixtures file
import { introspectFixture } from '@introspection/playwright'

export const { test, expect } = introspectFixture({ outDir: '.introspect' })
```

The fixture attaches on test start, passes `handle` as a fixture, and calls `detach({ status, duration, error })` automatically on completion.

---

## CLI reference

Run `introspect <command>` against session files in `.introspect/`.

| Command | Description | Key flags |
|---|---|---|
| `summary` | Session status, actions, failed requests, JS errors | `--session <id>` |
| `timeline` | Chronological event log | `--session <id>`, `--type`, `--source` |
| `errors` | JS errors with stack traces | `--session <id>` |
| `snapshot` | Scope chain and globals from error snapshot | `--session <id>` |
| `network` | Network requests table | `--session <id>`, `--failed`, `--url <pattern>` |
| `body <eventId>` | Response body (raw or JSONPath) | `--path <jsonpath>` |
| `dom` | DOM snapshot from error | `--session <id>` |
| `events [expr]` | Filter and transform events | `--type`, `--source`, `--since`, `--last` |
| `eval <expr>` | Evaluate JS expression against session | `--session <id>` |
| `list` | List all recorded sessions | — |

---

## Session directory layout

```
.introspect/
  <session-id>/
    meta.json              ← { id, startedAt, endedAt?, label }
    events.ndjson          ← one event per line (network, JS errors, actions, assets, plugin events)
    assets/
      <uuid>.body.json        ← full response bodies
      <uuid>.snapshot.json    ← on-error or manual DOM+scope snapshots
      <uuid>.webgl-state.json ← GL uniform/texture/viewport state (plugin-webgl)
      <uuid>.webgl-canvas.png ← canvas pixel capture (plugin-webgl)
```

All events are appended to `events.ndjson` as they arrive. Assets are written to `assets/` with a corresponding `asset` event in the stream pointing to the file.
