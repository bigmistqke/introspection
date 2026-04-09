# @introspection/core

Internal utilities used by `@introspection/playwright`. Handles CDP event normalization, session file I/O, body summarization, and DOM/scope snapshots.

You generally don't need to use this directly — `@introspection/playwright` provides the full integration. This package is documented for plugin authors and contributors.

## Table of Contents

- [Session I/O](#session-io)
  - [initSessionDir](#initsessiondiroutdir-params)
  - [appendEvent](#appeenteventoutdir-sessionid-event)
  - [writeAsset](#writeassetopts)
  - [finalizeSession](#finalizesessionoutdir-sessionid-endedat)
- [CDP normalizers](#cdp-normalizers)
  - [normaliseCdpNetworkRequest](#normalisecdpnetworkrequestparams-startedat)
  - [normaliseCdpNetworkResponse](#normalisecdpnetworkresponseparams-startedat)
  - [normaliseCdpJsError](#normalisecdpjserrorparams-startedat)
- [Snapshot](#snapshot)
  - [takeSnapshot](#takesnapshotopts)
- [Body summarization](#body-summarization)
  - [summariseBody](#summarisebodyrawjson)
- [Bus](#bus)
  - [createBus](#createbus)
- [Debug](#debug)
  - [createDebug](#createdebugtitle-enabled)

## API

---

### Session I/O

#### `initSessionDir(outDir, params)`

Creates the session directory structure and writes the initial `meta.json`.

```ts
await initSessionDir(outDir, {
  id: string,
  startedAt: number,   // unix ms
  label?: string,
  plugins?: PluginMeta[],  // plugin metadata to record in meta.json
})
```

Creates:
```
{outDir}/{id}/
  meta.json
  events.ndjson   (empty)
  assets/
```

---

#### `appendEvent(outDir, sessionId, event)`

Appends a single `TraceEvent` as a JSON line to `events.ndjson`.

```ts
await appendEvent(outDir, sessionId, event)
```

---

#### `writeAsset(opts)`

Writes content to `assets/<uuid>.<kind>.<ext>`, then appends an `asset` event to `events.ndjson`. Returns the relative path (`assets/<filename>`).

```ts
const path = await writeAsset({
  directory: string,           // outDir
  name: string,                // sessionId
  kind: string,                // e.g. 'snapshot', 'body', 'webgl-state'
  content: string | Buffer,
  ext?: string,                // default: 'json'
  id?: string,                 // custom event id; auto-generated if omitted
  metadata: {
    timestamp: number,         // required; becomes event.timestamp
    [key: string]: unknown,    // any additional fields become event.data
  },
  source?: EventSource,        // default: 'agent'
})
// returns: 'assets/abc123.snapshot.json'
```

The `asset` event written to `events.ndjson` looks like:

```ts
{
  id: string,
  type: 'asset',
  timestamp: metadata.timestamp,
  source: source,
  data: { path, kind, ...restOfMetadata }
}
```

---

#### `finalizeSession(outDir, sessionId, endedAt)`

Writes `endedAt` into `meta.json` to mark the session as complete.

```ts
await finalizeSession(outDir, sessionId, Date.now())
```

---

### CDP normalizers

Convert raw CDP event params into typed `TraceEvent` objects. All accept the raw CDP params object and `startedAt` (unix ms) for computing relative timestamps.

#### `normaliseCdpNetworkRequest(params, startedAt)`

Converts `Network.requestWillBeSent` → `NetworkRequestEvent`.

```ts
{
  type: 'network.request',
  source: 'cdp',
  data: { cdpRequestId, url, method, headers, postData? }
}
```

#### `normaliseCdpNetworkResponse(params, startedAt)`

Converts `Network.responseReceived` → `NetworkResponseEvent`.

```ts
{
  type: 'network.response',
  source: 'cdp',
  data: { cdpRequestId, requestId, url, status, headers, bodyRef?, bodySummary? }
}
```

`bodyRef` is populated once the body is written to assets. `bodySummary` is a shallow parse of the response JSON.

#### `normaliseCdpJsError(params, startedAt)`

Converts an `exceptionDetails` object → `JsErrorEvent`. Stack frames use 1-indexed lines.

```ts
{
  type: 'js.error',
  source: 'cdp',
  data: {
    message: string,   // exception.description or exceptionDetails.text
    stack: StackFrame[]
  }
}
```

---

### Snapshot

#### `takeSnapshot(opts)`

Captures DOM, scope locals, and globals from a live CDP session.

```ts
const snap = await takeSnapshot({
  cdpSession: { send(method, params?): Promise<unknown> },
  trigger: 'js.error' | 'debugger.paused' | 'manual',
  url: string,
  callFrames?: CallFrame[],   // Debugger.CallFrame array; defaults to []
})
```

Returns:

```ts
{
  timestamp: number,
  trigger: 'js.error' | 'debugger.paused' | 'manual',
  url: string,
  dom: string,                         // full outerHTML
  scopes: ScopeFrame[],
  globals: {
    'location.pathname': string,
    'localStorage': object,
    'sessionStorage': object,
  }
}
```

All CDP calls inside `takeSnapshot` are individually try/caught — a failure to capture DOM or globals is non-fatal and leaves the corresponding field empty.

---

### Body summarization

#### `summariseBody(rawJson)`

Parses a JSON string and returns a shallow structural summary for indexing in events. Does not throw — returns an empty summary on non-JSON input.

```ts
const summary = summariseBody(raw)
```

Returns:

```ts
interface BodySummary {
  keys: string[]                                       // top-level keys
  scalars: Record<string, string | number | boolean | null>   // primitive leaf values
  arrays: Record<string, { length: number; itemKeys: string[] }>  // arrays with first-item keys
  errorFields: Record<string, unknown>                 // values of common error-related keys
}
```

---

### Bus

#### `createBus()`

Creates a typed async event bus scoped to a session. Used internally by `attach()`.

```ts
const bus = createBus()

bus.on('manual', async (payload) => { /* ... */ })
await bus.emit('manual', { trigger: 'manual', timestamp: Date.now() })
```

`bus.emit()` runs all registered handlers concurrently and resolves after all settle.

---

### Debug

#### `createDebug(title, enabled)`

Creates a conditional stderr logger. When `enabled` is `false`, calls are no-ops.

```ts
const debug = createDebug('my-plugin', true)
debug('something happened', { detail: 42 })
```
