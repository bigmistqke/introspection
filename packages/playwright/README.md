# @introspection/playwright

Attaches CDP-based tracing to a Playwright `Page`. Captures network requests, JS errors with scope locals, DOM snapshots, and Playwright actions into a structured NDJSON session on disk.

## Install

```bash
pnpm add -D @introspection/playwright
```

## Usage

```ts
import { attach } from '@introspection/playwright'

const handle = await attach(page, { testTitle: 'my test' })

await handle.page.goto('/')
handle.mark('step', { extra: 'data' })
await handle.snapshot()           // capture DOM + scope manually
await handle.detach()             // finalize session
```

Use `handle.page` (the proxy-wrapped page) instead of the original — it records Playwright actions as `playwright.action` events.

---

## `attach(page, opts?)`

```ts
function attach(page: Page, opts?: AttachOptions): Promise<IntrospectHandle>
```

Opens a CDP session on the page and begins recording. Enables Network, Runtime, Debugger, DOM, and Page CDP domains.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `outDir` | `string` | `'.introspect'` | Directory to write session files |
| `testTitle` | `string` | `'unknown test'` | Label stored in session metadata |
| `workerIndex` | `number` | — | Playwright worker index (informational) |
| `plugins` | `IntrospectionPlugin[]` | `[]` | Browser-side plugins to install |
| `verbose` | `boolean` | `false` | Log lifecycle events to stderr |

---

## `IntrospectHandle`

### `handle.page`

A `Proxy`-wrapped version of the original Playwright `Page`. Use this for all test interactions. The following methods emit `playwright.action` events into the session:

`click` · `fill` · `goto` · `press` · `selectOption` · `check` · `uncheck` · `hover` · `dragAndDrop` · `evaluate` · `waitForURL` · `waitForSelector`

All other `Page` methods pass through unmodified.

Function arguments (e.g. in `evaluate`) are serialized as `'[function]'`; unserializable objects become `'[unserializable]'`.

### `handle.mark(label, data?)`

Emits a `mark` event synchronously. Useful for annotating the timeline with test steps.

```ts
handle.mark('before-submit', { userId: 42 })
```

### `handle.snapshot()`

Captures a DOM snapshot and globals snapshot via CDP, writes it to `assets/`, and triggers `plugin.capture('manual')` on each plugin. The asset event appears in `events.ndjson`.

### `handle.detach(result?)`

Drains any in-flight async handlers, calls `plugin.capture('detach')` on each plugin, finalizes the session (writes `endedAt` to `meta.json`), and detaches the CDP session.

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

On uncaught JS errors the debugger pauses to collect scope locals (up to 5 frames, 3 scope levels, 20 properties each), then resumes before writing the snapshot and error event.

---

## Fixture

For automatic attach/detach with test result propagation:

```ts
// fixtures.ts
import { introspectFixture } from '@introspection/playwright/fixture'
export const { test, expect } = introspectFixture({ outDir: '.introspect' })
```

```ts
// my.spec.ts
import { test, expect } from './fixtures'

test('example', async ({ page, introspect }) => {
  await page.goto('/')
  introspect.mark('loaded')
  // detach() is called automatically with { status, duration, error } from testInfo
})
```

`introspectFixture(opts?)` options:

| Option | Type | Description |
|---|---|---|
| `outDir` | `string` | Session output directory |
| `viteUrl` | `string` | Base URL passed through to attach |

The `introspect` fixture value is the full `IntrospectHandle`. The fixture is auto-used (`{ auto: true }`), so it activates for every test even without destructuring it.

---

## Exports

```ts
import { attach } from '@introspection/playwright'
import { introspectFixture, test, expect } from '@introspection/playwright/fixture'
```
