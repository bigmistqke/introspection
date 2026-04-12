# Contributing

Introspection is a Playwright-integrated tracing framework. A session records a stream of typed trace events and their associated assets to disk; **plugins are the unit of feature capture** — each one subscribes to Chrome DevTools Protocol (CDP) events or page state and emits trace events. The read side is environment-agnostic, so traces can be queried from Node, a browser, or anywhere with a `StorageAdapter`.

Most contributions fall into one of these shapes, roughly descending by frequency:

- **[Adding a plugin](#plugins)** — new feature capture.
- **[Adding event or asset types](#types)** — usually part of a plugin.
- **Core framework work** — see the package map below.

## Packages

| Package | Purpose |
|---|---|
| `@introspection/types` | Source of truth for all types — events, assets, plugins, sessions |
| `@introspection/utils` | Shared: bus, debug, CDP normalizers, snapshot, body summariser |
| `@introspection/write` | Node-only session recording — directories, NDJSON, assets |
| `@introspection/read` | Environment-agnostic querying via `StorageAdapter`; reactive queries |
| `@introspection/playwright` | Attach tracing to a Playwright page |
| `introspect` | CLI for querying traces |

Plugins live in `plugins/`. Demos in `demos/`.

**Read vs write are separate on purpose.** Write uses `fs` directly (Node-only). Read accepts any `StorageAdapter` (`listDirectories`, `readText`, `readBinary?`) and runs in any environment. Built-in adapters: `createNodeAdapter(dir)` in `@introspection/read/node`, `createFetchAdapter(baseUrl)` in `demos/shared`.

## Plugins

A plugin is a **factory function** that returns an `IntrospectionPlugin`. At session startup, `attach()` calls `install(ctx)` once per plugin; the plugin wires up CDP subscriptions and emits trace events from within.

```ts
import type { IntrospectionPlugin, PluginContext } from '@introspection/types'

export function example(): IntrospectionPlugin {
  return {
    name: 'example',
    description: 'One-line summary',
    events: {
      'example.thing': 'Fires when a thing happens',
    },
    async install(ctx: PluginContext): Promise<void> {
      await ctx.cdpSession.send('SomeDomain.enable')
      ctx.cdpSession.on('SomeDomain.event', (parameters) => {
        ctx.emit({ type: 'example.thing', metadata: { /* ... */ } })
      })
    },
  }
}
```

Plugins are always factories (never singletons) so callers can pass per-instance options: `example({ verbose: true })`.

### PluginContext

| Field | Use when |
|---|---|
| `ctx.page` | You need to `evaluate` browser JS from the plugin side. Minimal — prefer CDP when possible. |
| `ctx.cdpSession.send(method, parameters)` | Issue a CDP command. Returns the typed result. |
| `ctx.cdpSession.on(event, handler)` | Subscribe to a specific CDP event. |
| `ctx.rawCdpSession` | **Escape hatch** — instrumentation plugins only (see `plugin-cdp`). Mutating it affects every plugin in the session. |
| `ctx.emit(event)` | Emit a trace event. Fire-and-forget is safe — the write queue is advanced synchronously and `handle.flush()` awaits the tail. |
| `ctx.writeAsset({ kind, content, ext? })` | Persist binary/text content to the session's assets directory. Returns an `AssetRef` to attach to an event via `event.assets`. |
| `ctx.timestamp()` | Current ms-since-test-start; matches the timestamp stamped onto events. |
| `ctx.bus.on(trigger, handler)` | Subscribe to trace events (typed) or lifecycle triggers (`manual`, `detach`, `snapshot`). Use this when a plugin reacts to another plugin's events without coupling to it. |
| `ctx.bus.emit(trigger, payload)` | Fire a lifecycle trigger. `ctx.emit` already fires on the bus; don't double-emit. |
| `ctx.track(operation)` | Wrap async work the framework can't see on its own — out-of-band timers, detached promise chains, body fetches kicked off from inside a handler. `handle.flush()` waits for it. Do **not** wrap `ctx.emit` in `track` — emits are already tracked. |
| `ctx.addSubscription(pluginName, spec)` | Browser-side watches that must survive navigation. Used by plugins with a `script` and a runtime watch registry. |

### Emitting events & writing assets

`ctx.emit(event)` is fire-and-forget-safe: internally it synchronously pushes to the session's write queue, and `session.flush()` returns that queue's tail. Every emit before flush is awaited.

When a payload is too large or too binary for event metadata, write it as an asset and link it:

```ts
const asset = await ctx.writeAsset({ kind: 'json', content: JSON.stringify(body) })
ctx.emit({ type: 'example.thing', metadata: { /* ... */ }, assets: [asset] })
```

To correlate two events emitted by the same logical operation (e.g. a request and its body), set `initiator: otherEvent.id` on the second one.

### Plugins with browser-side code

When capture requires running in the page (e.g. `PerformanceObserver`, framework detection), provide `script: string` — an IIFE that runs on every navigation via `page.addInitScript`. Browser code sends events back via the binding `window.__introspect_push__(payload)` where `payload` is a JSON-stringified `EmitInput`.

For browser-side subscriptions that must survive navigation, use `ctx.addSubscription(pluginName, spec)`. See `plugins/plugin-performance/` for a complete example.

### Step-by-step: adding a new in-repo plugin

1. **Scaffold** `plugins/plugin-<name>/` by copying the layout from `plugin-js-error` (the minimal example):
   ```
   package.json
   tsconfig.json
   playwright.config.ts
   src/index.ts
   test/<name>.spec.ts
   README.md
   ```
   Change the package name in `package.json`. Everything else (scripts, exports, devDependencies, ESM config) stays identical across plugins.

2. **Register event types** in `packages/types/src/index.ts` — see [Types](#types) below.

3. **Write `src/index.ts`** following the plugin shape.

4. **Write `README.md`** — install, usage, event table, caveats, options. Follow `plugin-network/README.md` or `plugin-cdp/README.md` for format.

5. **Write tests** — see [Testing plugins](#testing-plugins).

6. **Install & build**:
   ```bash
   pnpm install
   pnpm -C plugins/plugin-<name> build
   ```

7. **Consider `plugin-defaults`** — if this should be enabled by default, add it to `plugins/plugin-defaults/src/index.ts`.

### Testing plugins

Plugins are tested end-to-end with real Playwright against a real browser. **No mocking** — a mocked CDP session tests your mock, not your plugin.

Standard scaffold (see `plugins/plugin-js-error/test/js-error.spec.ts` for a minimal version, `plugins/plugin-network/test/network.spec.ts` for one with an HTTP server):

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { attach } from '@introspection/playwright'
import { example } from '../dist/index.js'

let outDir: string

test.beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'introspect-example-'))
})

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

async function readEvents(outDirectory: string) {
  const entries = await readdir(outDirectory)
  const ndjson = await readFile(join(outDirectory, entries[0], 'events.ndjson'), 'utf-8')
  return ndjson.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('captures the thing', async ({ page }) => {
  const handle = await attach(page, { outDir, plugins: [example()] })
  await page.goto('data:text/html,<body>hi</body>')
  // trigger the behavior
  await handle.flush()
  await handle.detach()

  const events = await readEvents(outDir)
  const event = events.find((e: { type: string }) => e.type === 'example.thing')
  expect(event).toBeDefined()
})
```

Rules to follow:

- **Import from `dist/`, not `src/`.** Tests run against the built output to mirror consumer usage. `pnpm build` before `pnpm test`.
- **`await handle.flush()` before reading events.** Flush drains the CDP event queue (no-op roundtrip) and awaits the write queue tail.
- **`await handle.detach()` to finalize the session** and close the CDP channel.
- **Unique tmp directory per test** via `mkdtemp`. Tests run serially but shared state is still a footgun.
- **For network-body tests, use a real HTTP server.** Playwright's `route.fulfill` is served via Fetch.fulfillRequest; `Network.getResponseBody` returns "No data found" and `loadingFinished` never fires. See `plugin-network`'s test for the pattern.
- **Assert on behavior, not type shape.** The type checker covers shape. Tests verify that events actually fire, values match, assets land on disk, etc.

Run one plugin: `pnpm -C plugins/plugin-<name> test`. Run every plugin's tests: `pnpm test` from the repo root.

## Types

All event and asset types live in `packages/types/src/index.ts`. Both `TraceEventMap` and `AssetDataMap` are TypeScript interfaces designed to be **augmentable via declaration merging**, so in-repo and third-party plugins use the same pattern.

### In-repo (direct edit)

Define the event interface, then register it in the map:

```ts
export interface ExampleThingEvent extends BaseEvent {
  type: 'example.thing'
  metadata: { value: string }
}

export interface TraceEventMap {
  // ...existing entries
  'example.thing': ExampleThingEvent
}
```

The type now flows into `TraceEvent`, `EventsFilter`, `query.watch()`, and everywhere else that consumes the event union. No side-effect imports, no registration calls.

Asset kinds work the same way via `AssetDataMap`:

```ts
export interface AssetDataMap {
  // ...existing entries
  'my-capture': { path: string; size?: number; contentType: 'image' }
}
```

The `AssetEventData` discriminated union is derived automatically; consumers narrow on `kind` to get the typed data shape.

### Third-party (declaration merging)

From a package outside this repo:

```ts
import type { BaseEvent } from '@introspection/types'

export interface MyCustomEvent extends BaseEvent {
  type: 'custom.metric'
  metadata: { name: string; value: number }
}

declare module '@introspection/types' {
  interface TraceEventMap {
    'custom.metric': MyCustomEvent
  }
}
```

Same result — the augmented type flows through the whole system.

### Why centralize?

- One import source — no import chains to remember.
- Type narrowing works everywhere (discriminated unions on `type` and `kind`).
- No risk of forgetting a side-effect import that registers types.
- Clear separation: built-in types live in source, third-party types use augmentation.

## Code style

- **No `as never` casts.** Use a proper type, a narrower cast (`as Record<string, unknown>`, `as object`), or a typed wrapper. `as never` suppresses errors without explaining why.
- **No abbreviated variable names.** Write `parameters` not `params`, `error` not `err`, `event` not `evt`, `result` not `res`. Full names make code searchable and self-documenting.
- **Test actual behaviors, not type shapes.** Anything the type checker catches doesn't need a test.
- **No mocking.** Tests run against real implementations (real browsers via Playwright, real file I/O, etc.).

### Verbose logging (required for all APIs)

All public APIs and CLI commands **must** support verbose logging via the `createDebug` pattern. This is a **hard requirement** for all new features.

**For APIs (factories, functions):**
```ts
import { createDebug } from '@introspection/utils'

export interface MyApiOptions {
  verbose?: boolean
  // ...other options
}

export function myApi(options?: MyApiOptions) {
  const debug = createDebug('my-api', options?.verbose ?? false)
  debug('initialized', { /* context details */ })
  // ... implementation
}
```

**For CLI commands:**
```ts
program.command('my-command')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    // pass verbose to any APIs called
  })
```

**How it works:**
- When `verbose` is `false` (default), `debug()` calls are no-ops with zero overhead.
- When `verbose` is `true`, each `debug()` call logs to console with `[module-name]` prefix.
- Use debug calls to trace execution flow and state changes — document the "why" of the code through these calls.
- The `--verbose` flag flows from CLI through all APIs via options objects.

Every API and command must follow this pattern. If an API can be instantiated, it gets a `verbose?: boolean` option. If a command loads data or calls an API, it gets a `--verbose` flag.
