# @introspection/types

Shared TypeScript types for the introspection system. Used by all packages.

## Table of Contents

- [Events](#events)
  - [TraceEvent](#traceevent)
  - [Event types](#event-types)
- [Supporting types](#supporting-types)
  - [StackFrame](#stackframe)
  - [ScopeFrame](#scopeframe)
  - [BodySummary](#bodysummary)
  - [Snapshot](#snapshot)
- [Plugin interface](#plugin-interface)
  - [IntrospectionPlugin](#introspectionplugin)
  - [BusPayloadMap and BusTrigger](#buspayloadmap-and-bustrigger)
  - [PluginContext](#plugincontext)
  - [WatchHandle](#watchhandle)
- [Session format](#session-format)
  - [SessionMeta](#sessionmeta)
  - [TraceFile](#tracefile)
- [IntrospectHandle](#introspecthandle)

## Install

```bash
pnpm add -D @introspection/types
```

---

## Events

### `TraceEvent`

Union of all event types. Every event extends `BaseEvent`:

```ts
interface BaseEvent {
  id: string
  timestamp: number   // ms since test start
  source: EventSource
  initiator?: string  // id of the event that caused this one (best-effort)
}

type EventSource = 'cdp' | 'agent' | 'playwright' | 'plugin'
```

| `source` value | When used |
|---|---|
| `'cdp'` | Network requests, JS errors, navigation — directly from Chrome DevTools Protocol |
| `'agent'` | Marks, snapshots, response bodies — written by the Node-side session recorder |
| `'playwright'` | Page action events — emitted by the page proxy |
| `'plugin'` | Events pushed from browser-side plugins |

### Event types

#### `network.request`
```ts
data: {
  cdpRequestId: string
  url: string
  method: string
  headers: Record<string, string>
  postData?: string
}
```

#### `network.response`
```ts
data: {
  cdpRequestId: string
  requestId: string   // same as cdpRequestId — stable across request/response pair
  url: string
  status: number
  headers: Record<string, string>
  bodyRef?: string        // relative path to the body asset (assets/<uuid>.body.json)
  bodySummary?: BodySummary
}
```

#### `network.error`
```ts
data: { url: string; errorText: string }
```

#### `js.error`
```ts
data: { message: string; stack: StackFrame[] }
```

#### `browser.navigate`

Emitted on full page navigations and same-document URL changes.

```ts
data: { from: string; to: string }
```

#### `mark`
```ts
data: { label: string; extra?: Record<string, unknown> }
```

#### `playwright.action`

Emitted for tracked page proxy method calls. Function arguments and unserializable objects are replaced with placeholder strings.

```ts
data: { method: string; args: unknown[] }
```

#### `playwright.result`
```ts
data: {
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
}
```

#### `asset`

Points to a file written in `assets/`. Additional fields in `data` come from the `metadata` passed to `writeAsset`.

```ts
data: {
  path: string        // relative path: 'assets/<uuid>.<kind>.<ext>'
  kind: string        // e.g. 'body', 'snapshot', 'webgl-state', 'webgl-canvas'
  contentType?: 'json' | 'html' | 'text' | 'image' | 'binary'
  summary?: BodySummary
  trigger?: string
  url?: string
  scopeCount?: number
  // ...any other metadata fields passed by the writer
}
```

#### `PluginEvent`

Open-ended event type for browser-side plugins. `type` is plugin-defined (e.g. `'webgl.uniform'`).

```ts
source: 'plugin'
type: string
data: Record<string, unknown>
```

---

## Supporting types

### `StackFrame`
```ts
interface StackFrame {
  functionName: string
  file: string      // source-mapped
  line: number      // 1-based
  column: number
}
```

### `ScopeFrame`
```ts
interface ScopeFrame {
  frame: string                       // 'functionName (file:line)'
  locals: Record<string, unknown>
}
```

### `BodySummary`
```ts
interface BodySummary {
  keys: string[]
  scalars: Record<string, string | number | boolean | null>
  arrays: Record<string, { length: number; itemKeys: string[] }>
  errorFields: Record<string, unknown>   // values of common error-related keys
}
```

### `Snapshot`
```ts
interface Snapshot {
  timestamp: number
  trigger: 'js.error' | 'debugger.paused' | 'manual'
  url: string
  dom: string
  scopes: ScopeFrame[]
  globals: Record<string, unknown>
}
```

---

## Plugin interface

### `IntrospectionPlugin`

```ts
interface IntrospectionPlugin {
  name: string
  description?: string
  events?: Record<string, string>                                    // event type → human description
  options?: Record<string, { description: string; value: unknown }>  // option name → metadata
  script?: string  // browser-side IIFE injected as an init script on every navigation (optional)
  install(ctx: PluginContext): Promise<void>
}
```

### `BusPayloadMap` and `BusTrigger`

`BusPayloadMap` is an augmentable interface — declare module merging lets plugins add their own triggers:

```ts
interface BusPayloadMap {
  'manual': { trigger: 'manual'; timestamp: number }
  'detach': { trigger: 'detach'; timestamp: number }
  // plugins extend this via: declare module '@introspection/types' { interface BusPayloadMap { ... } }
}

type BusTrigger = keyof BusPayloadMap
```

### `PluginContext`

Passed to `plugin.install()`. Provides access to the page, CDP session, event bus, and session writer.

```ts
interface PluginContext {
  page: PluginPage   // minimal page abstraction: evaluate()
  cdpSession: {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
    on(event: string, handler: (params: unknown) => void): void  // subscribe to raw CDP events
  }
  emit(event: Omit<TraceEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void
  writeAsset(opts: {
    kind: string
    content: string | Buffer
    ext?: string
    metadata: { timestamp: number; [key: string]: unknown }
    source?: EventSource
  }): Promise<string>   // returns relative asset path
  timestamp(): number   // ms since session start
  addSubscription(pluginName: string, spec: unknown): Promise<WatchHandle>
  bus: {
    on<T extends BusTrigger>(trigger: T, handler: (payload: BusPayloadMap[T]) => void | Promise<void>): void
    emit<T extends BusTrigger>(trigger: T, payload: BusPayloadMap[T]): Promise<void>
  }
}
```

`addSubscription` installs a browser-side watch by calling `window.__introspect_plugins__[pluginName].watch(spec)` and registers the subscription for automatic re-apply after navigation. Returns a `WatchHandle` with `unwatch()`.

`cdpSession.on()` subscribes to raw CDP events (e.g. `Network.requestWillBeSent`) from within `install()`. This is how built-in plugins like `network()` and `jsError()` wire themselves up.

`bus` provides a typed async event bus scoped to the session. `bus.on()` registers a handler. `bus.emit()` runs all registered handlers concurrently and resolves only after all settle. Use `bus.on('manual', ...)` to react to `handle.snapshot()` calls, `bus.on('detach', ...)` for teardown capture, and `bus.on('js.error', ...)` (augmented by `jsError()`) for error captures.

### `WatchHandle`

```ts
interface WatchHandle {
  unwatch(): Promise<void>
}
```

---

## Session format

### `SessionMeta`

```ts
interface SessionMeta {
  version: '2'
  id: string
  startedAt: number    // unix ms
  endedAt?: number     // unix ms; set when session ends
  label?: string
  plugins?: PluginMeta[]
}

interface PluginMeta {
  name: string
  description?: string
  events?: Record<string, string>
  options?: Record<string, { description: string; value: unknown }>
}
```

### `TraceFile`

Logical representation of a full session as read by the CLI.

```ts
interface TraceFile {
  version: '2'
  session: Omit<SessionMeta, 'version'>
  events: TraceEvent[]
  snapshots: Snapshot[]
}
```

---

## `IntrospectHandle`

Returned by `attach()`.

```ts
interface IntrospectHandle {
  page: Page                                           // proxy-wrapped Page
  mark(label: string, data?: Record<string, unknown>): void
  snapshot(): Promise<void>
  detach(result?: DetachResult): Promise<void>
}

interface DetachResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped'
  duration?: number
  error?: string
}
```
