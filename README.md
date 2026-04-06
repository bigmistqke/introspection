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
  const { page: p, mark, detach } = await attach(page, { testTitle: 'add item to cart' })

  await p.goto('/')
  mark('before-add')
  await p.getByRole('button', { name: 'Add to cart' }).click()

  await detach()
})
```

`attach(page)` opens a CDP session, captures network events, JS errors, and DOM snapshots, and returns a proxy-wrapped `page` that also records Playwright actions. All events are written directly to `.introspect/<session-id>/events.ndjson` as they arrive. `detach()` finalizes the session.

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

## `attach()` options

```ts
interface AttachOptions {
  outDir?: string       // default: '.introspect'
  testTitle?: string    // included in session metadata
  workerIndex?: number  // Playwright worker index
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

## Session directory layout

```
.introspect/
  <session-id>/
    meta.json              ← { id, startedAt, endedAt?, label }
    events.ndjson          ← one event per line (network, JS errors, actions, assets)
    assets/
      <uuid>.body.json        ← full response bodies
      <uuid>.snapshot.json    ← on-error or manual DOM+scope snapshots
```

All events are appended to `events.ndjson` as they arrive. Assets (response bodies, snapshots) are written to `assets/` with a corresponding `asset` event in the stream pointing to the file.
