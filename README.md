# @introspection

A Playwright/Vite tracing library that captures structured, AI-readable trace files from end-to-end tests. Each test run produces a `TraceFile` containing a chronological event log (network, JS errors, DOM snapshots, user interactions, plugin data) that can be queried offline with the `introspect` CLI or evaluated live against a running Vite dev session.

---

## Installation

```bash
# Core packages
pnpm add -D @introspection/vite        # Vite plugin (WebSocket hub + trace writer)
pnpm add -D @introspection/playwright  # attach(page) → IntrospectHandle
pnpm add -D @introspection/types       # shared TypeScript interfaces

# Optional: in-page plugin host
pnpm add -D @introspection/browser

# Optional: framework plugins
pnpm add -D @introspection/plugin-redux
pnpm add -D @introspection/plugin-react

# CLI (install once, globally or as a dev dep)
pnpm add -D introspect
```

---

## Quick start

### `vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { introspection } from '@introspection/vite'

export default defineConfig({
  plugins: [
    introspection({
      outDir: '.introspect',          // default
      capture: {
        responseBody: { maxSize: '50kb' },
      },
    }),
  ],
})
```

### Playwright test

```ts
import { test, expect } from '@playwright/test'
import { attach } from '@introspection/playwright'

test('add item to cart', async ({ page }) => {
  const { page: p, mark, detach } = await attach(page)

  await p.goto('/')
  mark('before-add')
  await p.getByRole('button', { name: 'Add to cart' }).click()
  await expect(p.getByText('1 item')).toBeVisible()

  await detach()
})
```

`attach(page)` opens a CDP session, forwards all browser events to the Vite plugin over WebSocket, and returns a proxy-wrapped `page` that also records Playwright actions. `detach()` flushes the trace to `<outDir>/<test-title>.json`.

---

## CLI reference

Run `introspect <command> [options]` against the trace files in `.introspect/`.

| Command | Description | Key flags |
|---|---|---|
| `summary` | Test status, actions, failed requests, JS errors | `--trace <name>` |
| `timeline` | Chronological event log | `--trace <name>` |
| `errors` | JS errors with stack traces | `--trace <name>` |
| `vars` | Scope chain and globals from error snapshot | `--trace <name>` |
| `network` | Network requests table | `--trace <name>`, `--failed`, `--url <pattern>` |
| `body <id>` | Response body (raw or JSONPath) | `--path <jsonpath>` |
| `dom` | DOM snapshot from error | `--trace <name>` |
| `eval <expr>` | Evaluate expression against live session | — |

---

## Plugin: Redux

Pass `createReduxPlugin(store)` in the `plugins` array of your Vite config. The plugin monkey-patches `store.dispatch` to emit a `plugin.redux.action` event for every dispatched action, and includes the full Redux state in snapshots.

```ts
import { createReduxPlugin } from '@introspection/plugin-redux'
import { store } from './src/store'

introspection({ plugins: [createReduxPlugin(store)] })
```

Each event includes the action object and an array of top-level state keys whose values changed (`changedKeys`).

---

## Plugin: React

Pass `createReactPlugin()` in the `plugins` array. It installs itself as a React DevTools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) and emits a `plugin.react.commit` event on every fiber commit, listing the component names involved.

```ts
import { createReactPlugin } from '@introspection/plugin-react'

introspection({ plugins: [createReactPlugin()] })
```

The on-error snapshot includes a `mountedComponents` array with all currently mounted component names.

---

## Live eval

When `vite dev` is running with the introspection plugin, `introspect eval` connects to `.introspect/.socket` and evaluates a JavaScript expression against the live session context. The context exposes:

- `events` — full `TraceEvent[]` array for the current session
- `snapshot` — the most recent `OnErrorSnapshot`
- `test` — `TraceTest` metadata

```bash
# List all failed request URLs
introspect eval 'events.filter(e => e.type === "network.response" && e.data.status >= 400).map(e => e.data.url)'

# Inspect the Redux state captured at error time
introspect eval 'snapshot.plugins.redux.state'

# Find all React commits that included a specific component
introspect eval 'events.filter(e => e.type === "plugin.react.commit" && e.data.components.includes("CheckoutForm")).map(e => e.ts)'
```

---

## Config reference

`IntrospectionConfig` (passed to the `introspection()` Vite plugin):

| Field | Type | Default | Description |
|---|---|---|---|
| `plugins` | `IntrospectionPlugin[]` | `[]` | Framework plugins (Redux, React, custom) |
| `outDir` | `string` | `'.introspect'` | Output directory for trace files and eval socket |
| `capture.ignore` | `string[]` | — | Event types to suppress |
| `capture.network.ignoreUrls` | `RegExp[]` | — | Skip network events matching these URLs |
| `capture.network.ignoreHeaders` | `string[]` | — | Strip these headers from captured requests/responses |
| `capture.responseBody.maxSize` | `string` | — | Max response body size to capture (e.g. `'50kb'`) |
| `capture.responseBody.ignore` | `RegExp[]` | — | Skip body capture for Content-Types or URLs matching these patterns |
