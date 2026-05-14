# @introspection/playwright

Attaches CDP-based tracing to a Playwright `Page`. Captures network requests, JS errors with scope locals, DOM snapshots, and Playwright actions into a structured NDJSON session on disk.

## Table of contents

- [Install](#install)
- [Usage](#usage)
- [attach(page, opts)](#attachpage-opts)
- [IntrospectHandle](#introspecthandle)
- [What gets captured automatically](#what-gets-captured-automatically)
- [withIntrospect (Playwright integration)](#withintrospect-playwright-integration)
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

## withIntrospect (Playwright integration)

Adoption is two touch points. Wrap the config:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'
import { withIntrospect } from '@introspection/playwright'
import { defaults } from '@introspection/plugin-defaults'

export default withIntrospect(
  defineConfig({ testDir: './test' }),
  { plugins: defaults() },
)
```

…and import `test` / `expect` from the package in test files:

```ts
// my.spec.ts
import { test, expect } from '@introspection/playwright'

test('example', async ({ page }) => {
  await page.goto('/')
  // every test is captured automatically — no per-test opt-in
})
```

`withIntrospect(playwrightConfig, options)` stashes the config in a module
singleton (re-read in each worker, since Playwright re-evaluates the config
file per worker) and composes introspection's `globalSetup` / `globalTeardown`
into the config via Playwright's array form, preserving the project's own.

`options`:

| Option | Type | Description |
|---|---|---|
| `plugins` | `IntrospectionPlugin[]` | **required** — plugins to install, e.g. `defaults()` |
| `reporters` | `IntrospectionReporter[]` | reporters wired into each per-test session writer (optional) |
| `mode` | `'on' \| 'retain-on-failure' \| 'on-first-retry'` | retention knob, default `'on'` (optional) |

Each test produces a session directory at
`.introspect/<run-id>/<project>__<test-id>/` containing `events.ndjson`,
`meta.json` (with `status` and `project`), and `assets/`. The run directory
also carries a `meta.json` (`RunMeta`: id, branch, commit, startedAt, endedAt,
aggregate status). The built-in auto-fixture emits `test.start` / `test.end`
and captures `test.step` boundaries as `step.start` / `step.end` events.

Environment variables:

| Variable | Effect |
|---|---|
| `INTROSPECT_RUN_ID` | Run directory name (CI sets e.g. `<branch>_<pipeline>`); otherwise auto-generated |
| `INTROSPECT_DIR` | Base directory for runs (default `.introspect`) |
| `INTROSPECT_RUN_BRANCH` / `INTROSPECT_RUN_COMMIT` | Override the git-detected branch / commit in `RunMeta` |
| `INTROSPECT_TRACING=0` | Fully disables introspection for the run |

The lower-level `attach()` / `session()` primitives remain available for
ad-hoc capture outside the Playwright test runner.

---

## Exports

```ts
import { attach, session, withIntrospect, test, expect } from '@introspection/playwright'
import type {
  AttachOptions, SessionOptions, SessionContext,
  WithIntrospectOptions, IntrospectMode,
  BusPayloadMap, BusTrigger,
} from '@introspection/playwright'
```
