# @introspection/playwright

Attaches CDP-based tracing to a Playwright `Page`. Captures network requests, JS errors with scope locals, DOM snapshots, and Playwright actions into a structured NDJSON session on disk.

## Table of contents

- [Install](#install)
- [Usage](#usage)
- [attach(page, opts)](#attachpage-opts)
- [IntrospectHandle](#introspecthandle)
- [What gets captured automatically](#what-gets-captured-automatically)
- [Fixture](#fixture)
- [Exports](#exports)

## Install

```bash
pnpm add -D @introspection/playwright
```

## Usage

```ts
import { attach } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'
```

Use `handle.page` (the proxy-wrapped page) instead of the original — it records Playwright actions as `playwright.action` events.

---

## `attach(page, opts)`

```ts
function attach(page: Page, opts: AttachOptions): Promise<IntrospectHandle>
```

Opens a CDP session on the page and begins recording. CDP domains are enabled by the plugins passed in `opts.plugins`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `outDir` | `string` | `'.introspect'` | Directory to write session files |
| `testTitle` | `string` | `'unknown test'` | Label stored in session metadata |
| `workerIndex` | `number` | — | Playwright worker index (informational) |
| `plugins` | `IntrospectionPlugin[]` | **required** | Plugins to install — use `defaults()` for standard behaviour |
| `verbose` | `boolean` | `false` | Log lifecycle events to stderr |

---

## `IntrospectHandle`

### `handle.page`

A `Proxy`-wrapped version of the original Playwright `Page`. Use this for all test interactions. The following methods emit `playwright.action` events into the session:

`click` · `fill` · `goto` · `press` · `selectOption` · `check` · `uncheck` · `hover` · `dragAndDrop` · `evaluate` · `waitForURL` · `waitForSelector`

All other `Page` methods pass through unmodified.

Function arguments and unserializable objects are replaced with placeholder strings in the event log.

### `handle.emit(event)`

Emits a trace event to the session. Use this to record custom timeline markers or data.

```ts
await handle.emit({ type: 'mark', metadata: { label: 'before-submit', extra: { userId: 42 } } })
```

Mark events are useful for annotating the timeline with test steps. The `metadata.label` field is required; `metadata.extra` is optional arbitrary data.

### `handle.snapshot()`

Captures a DOM snapshot and globals snapshot via CDP, writes it to `assets/`, and emits `'manual'` on the bus so plugins can react. The asset event appears in `events.ndjson`.

### `handle.detach(result?)`

Emits `'detach'` on the bus (awaiting all handlers), finalizes the session (writes `endedAt` to `meta.json`), and detaches the CDP session.

Pass an optional result to emit a `playwright.result` event:

```ts
await handle.detach({ status: 'passed', duration: testInfo.duration })
```

`DetachResult`:

```ts
interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
}
```

---

## What gets captured automatically

| Event type | Source | Trigger |
|---|---|---|
| `network.request` | `cdp` | Every outgoing request |
| `network.response` | `cdp` | Every response (with body written to assets) |
| `network.error` | `cdp` | Failed/aborted requests |
| `js.error` | `cdp` | Uncaught exceptions and unhandled rejections |
| `browser.navigate` | `cdp` | Full navigations and same-document URL changes |
| `playwright.action` | `playwright` | Tracked page method calls (see above) |
| `asset` | `cdp` / `plugin` | Response bodies, DOM snapshots, plugin captures |

On uncaught JS errors the debugger pauses to collect scope locals from the call stack, then resumes before writing the snapshot and error event.

---

## Fixture

For automatic attach/detach with test result propagation:

```ts
// fixtures.ts
import { introspectFixture } from '@introspection/playwright/fixture'
import { defaults } from '@introspection/plugin-defaults'
export const { test, expect } = introspectFixture({ outDir: '.introspect', plugins: defaults() })
```

```ts
// my.spec.ts
import { test, expect } from './fixtures'

test('example', async ({ page, introspect }) => {
  await page.goto('/')
  await introspect.emit({ type: 'mark', metadata: { label: 'loaded' } })
  // detach() is called automatically with { status, duration, error } from testInfo
})
```

`introspectFixture(opts)` options:

| Option | Type | Description |
|---|---|---|
| `plugins` | `IntrospectionPlugin[]` | **required** — plugins to install, e.g. `defaults()` |
| `outDir` | `string` | Session output directory |
| `viteUrl` | `string` | Vite dev server URL (optional) |

The `introspect` fixture value is the full `IntrospectHandle`. The fixture is auto-used (`{ auto: true }`), so it activates for every test even without destructuring it.

On test failure or timeout, the fixture automatically calls `handle.snapshot()` before `detach()`, so DOM state and scope locals are always captured when a test fails.

---

## Exports

```ts
import { attach } from '@introspection/playwright'
import type { AttachOptions, BusPayloadMap, BusTrigger } from '@introspection/playwright'
import { introspectFixture } from '@introspection/playwright/fixture'
```
