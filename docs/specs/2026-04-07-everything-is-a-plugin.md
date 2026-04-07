# Everything is a Plugin

**Date:** 2026-04-07
**Branch:** `explore/everything-is-a-plugin`
**Status:** Approved — ready for implementation

---

## Motivation

`attach()` currently hard-codes two capabilities: network tracing and JS error capture. Both are always active, regardless of whether the caller wants them. There is no way to opt out, no way to configure them independently, and no way to compose custom behaviour alongside them.

The `pauseOnExceptions` option on `AttachOptions` is a symptom of this: it belongs to JS error capture, but lives on the top-level options object because JS error capture is baked in.

The plugin system already exists for third-party extensions like `webgl()`. This design extends that model so that network and JS error capture become first-class plugins, `attach()` becomes a thin host, and all behavioural decisions are made by the caller through `plugins`.

The result: `attach()` does less. Plugins do more. The API surface is smaller and more composable.

---

## Design Decisions

### 1. `network()` and `jsErrors()` become plugins

All network tracing logic (currently wired directly to CDP `Network.*` events in `attach.ts`) and all JS error capture logic (currently wired to `Debugger.paused` in `attach.ts`) are extracted into two plugin factories exported from `@introspection/playwright`:

```ts
network(): IntrospectionPlugin
jsErrors(opts?: JsErrorsOptions): IntrospectionPlugin
```

`attach()` retains no knowledge of either capability. It only knows about the plugin protocol.

### 2. `defaults()` composes them

A convenience factory composes `network()` and `jsErrors()` into a single array:

```ts
defaults(opts?: DefaultsOptions): IntrospectionPlugin[]
```

`defaults()` has no logic of its own beyond delegation. It is pure composition. Callers who want the standard behaviour pass `plugins: defaults()`. Callers who want to customise pass their own array.

### 3. `plugins` is required everywhere — no implicit defaults

`plugins` is a required field on both `AttachOptions` and the options accepted by `introspectFixture()`. There are no fallback defaults. If `plugins` is omitted, it is a type error.

This makes every call site explicitly declare its intent. The absence of `plugins: [defaults()]` is never silently wrong.

### 4. `capture()` is dropped from `IntrospectionPlugin`

The optional `capture?(trigger, timestamp)` method on `IntrospectionPlugin` is removed. Plugins that need to react to triggers (`'manual'`, `'detach'`, `'js.error'`) register handlers during `install()` via `ctx.bus.on(trigger, handler)`.

This unifies the two existing code paths (push-style bus events and pull-style `capture()` calls) into one. It also removes the need for `attach()` to iterate plugins and call `capture()` at specific moments — the bus handles dispatch.

Individual plugins may still expose their own capture methods as part of their specific return type. These are plugin-specific affordances, not part of the general contract. For example:

```ts
export interface WebGLPlugin extends IntrospectionPlugin {
  captureCanvas(opts?: { contextId?: string }): Promise<void>
  watch(opts: WatchOptions): Promise<WatchHandle>
}

export function webgl(): WebGLPlugin { ... }
```

Internally, `captureCanvas()` reuses the same logic as `ctx.bus.on('manual', ...)` — it writes assets and emits events — but is callable imperatively from test code. The `IntrospectionPlugin` interface stays minimal; richer plugins expose richer types.

### 5. `PluginContext` gains `cdpSession.on()` and `bus`

`PluginContext` is extended with two new capabilities:

```ts
export interface PluginContext {
  // existing
  page: PluginPage
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, handler: (params: unknown) => void): void   // NEW
  }
  emit(event: ...): void
  writeAsset(opts: ...): Promise<string>
  timestamp(): number
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>

  // NEW
  bus: {
    on<T extends BusTrigger>(
      trigger: T,
      handler: (payload: BusPayloadMap[T]) => void | Promise<void>
    ): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }
}
```

`cdpSession.on()` lets plugins subscribe to raw CDP events (e.g. `Network.requestWillBeSent`) without needing `attach()` to wire them up in advance.

`bus` provides a lightweight async event bus scoped to the session. `bus.emit()` is async and resolves only after all registered handlers for that trigger have settled (see decision 7).

`BusPayloadMap` defines the closed set of triggers and their payloads. `BusTrigger` is `keyof BusPayloadMap`. Adding a new trigger requires adding an entry to `BusPayloadMap`.

### 6. `handle.snapshot()` emits `'manual'` on the bus

When `handle.snapshot()` is called, it emits `'manual'` on the bus after taking the DOM snapshot. Plugins that want to capture additional data at snapshot time register via `ctx.bus.on('manual', handler)` inside their `install()`.

This replaces the previous pattern of `attach()` iterating `plugin.capture('manual', ...)` after taking the snapshot.

### 7. `handle.detach()` emits `'detach'` on the bus

When `handle.detach()` is called, it emits `'detach'` on the bus before finalizing the session. `bus.emit()` is async and resolves only after all handlers settle (`Promise.allSettled`). This replaces the current `pending` set drain mechanism.

The `pending` set currently exists to ensure that in-flight async operations started from CDP event handlers (e.g. scope collection during `Debugger.paused`) complete before the session is finalized. The bus `'detach'` emit provides the same guarantee, but in a way that is visible and hookable by plugins.

### 8. `opts.pauseOnExceptions` is removed from `AttachOptions`

`AttachOptions.pauseOnExceptions` is removed. The equivalent configuration is passed to `jsErrors()`:

```ts
// Before
attach(page, { plugins: [defaults()], pauseOnExceptions: 'all' })

// After
attach(page, { plugins: [network(), jsErrors({ pauseOnExceptions: 'all' })] })
```

### 9. `CaptureResult` type is retired

`CaptureResult` is the return type of the old `capture()` method. Once `capture()` is removed from `IntrospectionPlugin` and the `webgl()` plugin is migrated to `ctx.bus.on()`, `CaptureResult` is no longer needed. It will be removed from `@introspection/types` as part of the `webgl()` migration.

`CaptureResult` remains in the codebase until the `webgl()` migration is complete. It should not be used in any new code.

### 10. Breaking change

All existing `attach()` and `introspectFixture()` call sites must be updated to add `plugins`. See the migration guide below.

---

## Interface Changes

### `AttachOptions`

```ts
// Before
export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
  plugins?: IntrospectionPlugin[]
  verbose?: boolean
  pauseOnExceptions?: 'all' | 'uncaught'
}

// After
export interface AttachOptions {
  outDir?: string
  testTitle?: string
  workerIndex?: number
  plugins: IntrospectionPlugin[]   // required; no default
  verbose?: boolean
  // pauseOnExceptions removed — use jsErrors({ pauseOnExceptions: ... }) instead
}
```

### `IntrospectionPlugin`

```ts
// Before
export interface IntrospectionPlugin {
  name: string
  script: string
  install(ctx: PluginContext): Promise<void>
  capture?(trigger: 'js.error' | 'manual' | 'detach', timestamp: number): Promise<CaptureResult[]>
}

// After
export interface IntrospectionPlugin {
  name: string
  script?: string          // optional — not all plugins have browser-side code
  install(ctx: PluginContext): Promise<void>
  // capture removed — use ctx.bus.on(trigger, handler) inside install()
}
```

### `PluginContext`

```ts
// Before
export interface PluginContext {
  page: PluginPage
  cdpSession: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
  emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>
  timestamp(): number
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
}

// After
export interface BusPayloadMap {
  'manual':   { trigger: 'manual';   timestamp: number }
  'detach':   { trigger: 'detach';   timestamp: number }
  'js.error': { trigger: 'js.error'; timestamp: number }
}

export type BusTrigger = keyof BusPayloadMap

export interface PluginContext {
  page: PluginPage
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, handler: (params: unknown) => void): void   // NEW
  }
  emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>
  timestamp(): number
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
  bus: {                                                           // NEW
    on<T extends BusTrigger>(
      trigger: T,
      handler: (payload: BusPayloadMap[T]) => void | Promise<void>
    ): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }
}
```

---

## New Exports from `@introspection/playwright`

### `network()`

```ts
export function network(): IntrospectionPlugin
```

Installs network tracing. Registers CDP `Network.*` event handlers via `ctx.cdpSession.on()` and emits `network.request`, `network.response`, and `network.error` trace events. Writes response bodies as sidecar assets.

No options. The `network()` plugin captures all requests unconditionally. Filtering (if needed in future) can be added as an option without affecting the plugin contract.

### `jsErrors(opts?)`

```ts
export interface JsErrorsOptions {
  pauseOnExceptions?: 'all' | 'uncaught'   // default: 'uncaught'
}

export function jsErrors(opts?: JsErrorsOptions): IntrospectionPlugin
```

Installs JS error capture. Enables the CDP `Debugger` domain, sets pause-on-exceptions mode, and registers a `Debugger.paused` handler via `ctx.cdpSession.on()`. On each exception, it collects scope locals, emits a `js.error` event, and writes a snapshot asset. It registers a `ctx.bus.on('manual', ...)` handler to write an additional snapshot when `handle.snapshot()` is called.

### `defaults(opts?)`

```ts
export interface DefaultsOptions {
  jsErrors?: JsErrorsOptions
}

export function defaults(opts?: DefaultsOptions): IntrospectionPlugin[]
```

Returns `[network(), jsErrors(opts?.jsErrors)]`. This is the drop-in for call sites that want standard behaviour without customisation.

---

## Migration Guide

### Call sites: `attach()`

```ts
// Before
const handle = await attach(page)

// After
import { attach, defaults } from '@introspection/playwright'
const handle = await attach(page, { plugins: defaults() })
```

If you were using `pauseOnExceptions`:

```ts
// Before
const handle = await attach(page, { pauseOnExceptions: 'all' })

// After
import { attach, network, jsErrors } from '@introspection/playwright'
const handle = await attach(page, { plugins: [network(), jsErrors({ pauseOnExceptions: 'all' })] })
```

### Call sites: `introspectFixture()`

```ts
// Before
const { test, expect } = introspectFixture()

// After
import { introspectFixture, defaults } from '@introspection/playwright'
const { test, expect } = introspectFixture({ plugins: defaults() })
```

### Custom plugin authors: migrating `capture()`

If your plugin implements `capture()`, rewrite it as `ctx.bus.on()` calls inside `install()`:

```ts
// Before
const myPlugin: IntrospectionPlugin = {
  name: 'my-plugin',
  script: SCRIPT,
  async install(ctx) { /* ... */ },
  async capture(trigger, timestamp) {
    if (trigger === 'manual') {
      return [{ kind: 'my-data', content: await collectData(), summary: {} }]
    }
    return []
  },
}

// After
const myPlugin: IntrospectionPlugin = {
  name: 'my-plugin',
  script: SCRIPT,
  async install(ctx) {
    ctx.bus.on('manual', async () => {
      await ctx.writeAsset({
        kind: 'my-data',
        content: await collectData(),
        metadata: { timestamp: ctx.timestamp() },
      })
    })
  },
}
```

The `'detach'` trigger works the same way. Register `ctx.bus.on('detach', ...)` for any teardown capture that must complete before the session is finalized.

### Custom plugin authors: subscribing to CDP events

Previously, plugins that needed raw CDP events had to request that `attach()` wire them up, or reach outside the plugin protocol. Now, use `ctx.cdpSession.on()` directly inside `install()`:

```ts
async install(ctx) {
  ctx.cdpSession.on('Network.requestWillBeSent', (params) => {
    // params is unknown — narrow it
    const request = params as { requestId: string; request: { url: string } }
    ctx.emit({ type: 'network.request', source: 'plugin', data: { url: request.request.url } })
  })
}
```

---

## What Stays the Same

- The `IntrospectHandle` interface (`page`, `mark()`, `snapshot()`, `detach()`) is unchanged.
- The trace event format (`TraceEvent`, all event types, `TraceFile`, `SessionMeta`) is unchanged.
- The `Snapshot` type and snapshot file format are unchanged.
- The `addSubscription()` / `WatchHandle` protocol for browser-side subscriptions is unchanged.
- The `PluginRegistry` mechanics (subscription tracking, re-application after navigation) are unchanged.
- The `webgl()` plugin public API (`watch()`, `captureCanvas()`) is unchanged; only its internal implementation migrates from `capture()` to `ctx.bus.on()`.
- The `@introspection/core` package is unaffected.
- The `@introspection/cli` package is unaffected.
