# @introspection/read

Programmatic access to introspection trace data for custom analysis and scripting. Environment-agnostic — bring your own storage adapter.

## Install

```bash
pnpm add @introspection/read
```

## Usage

### With the Node adapter

```ts
import { createTraceReader, listTraces } from '@introspection/read/node'

const traces = await listTraces('.introspect')
const trace = await createTraceReader('.introspect', traces[0].id)

const allEvents = await trace.events.ls()
const jsErrors = await trace.events.query({ type: 'js.error' })
const assets = await trace.assets.ls()
const body = await trace.assets.read('abc123.body.json')
```

### With a custom adapter

```ts
import { createTraceReader, type StorageAdapter } from '@introspection/read'

const adapter: StorageAdapter = {
  listDirectories: () => fetch('/api/traces').then(r => r.json()),
  readText: (path) => fetch(`/data/${path}`).then(r => r.text()),
  fileSize: (path) => fetch(`/data/${path}`, { method: 'HEAD' })
    .then(r => Number(r.headers.get('content-length'))),
}

const trace = await createTraceReader(adapter, 'trace-id')
```

## API

### `StorageAdapter`

```ts
interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  fileSize(path: string): Promise<number>
}
```

All paths are relative to the adapter's base (e.g. `"trace-id/meta.json"`).

### `createTraceReader(adapter, traceId?)`

Creates a `TraceReader` by loading trace data through the adapter.

### `listTraces(adapter)`

Lists all traces, sorted by most recent first. Returns `TraceSummary[]`.

### `TraceReader`

```ts
interface TraceReader {
  id: string
  events: EventsAPI
  assets: AssetsAPI
}
```

### `EventsAPI`

```ts
interface EventsAPI {
  ls(): Promise<TraceEvent[]>
  query(filter: EventsFilter): Promise<TraceEvent[]>
}
```

### `AssetsAPI`

```ts
interface AssetsAPI {
  ls(): Promise<AssetEvent[]>
  read(path: string): Promise<string | { path: string; sizeKB: number }>
}
```

### Node adapter (`@introspection/read/node`)

```ts
import { createNodeAdapter, createTraceReader, listTraces } from '@introspection/read/node'
```

- `createNodeAdapter(dir)` — creates a `StorageAdapter` backed by `fs`
- `createTraceReader(dir, traceId?)` — convenience wrapper
- `listTraces(dir)` — convenience wrapper
