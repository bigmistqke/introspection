# @introspection/read

Programmatic access to introspection trace data for custom analysis and scripting. Environment-agnostic — bring your own storage adapter.

## Install

```bash
pnpm add @introspection/read
```

## Usage

### With the Node adapter

```ts
import { createSessionReader, listSessions } from '@introspection/read/node'

const sessions = await listSessions('.introspect')
const session = await createSessionReader('.introspect', sessions[0].id)

const allEvents = await session.events.ls()
const jsErrors = await session.events.query({ type: 'js.error' })
const assets = await session.assets.ls()
const body = await session.assets.read('abc123.body.json')
```

### With a custom adapter

```ts
import { createSessionReader, type StorageAdapter } from '@introspection/read'

const adapter: StorageAdapter = {
  listDirectories: () => fetch('/api/sessions').then(r => r.json()),
  readText: (path) => fetch(`/data/${path}`).then(r => r.text()),
  fileSize: (path) => fetch(`/data/${path}`, { method: 'HEAD' })
    .then(r => Number(r.headers.get('content-length'))),
}

const session = await createSessionReader(adapter, 'session-id')
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

All paths are relative to the adapter's base (e.g. `"session-id/meta.json"`).

### `createSessionReader(adapter, sessionId?)`

Creates a `SessionReader` by loading trace data through the adapter.

### `listSessions(adapter)`

Lists all sessions, sorted by most recent first. Returns `SessionSummary[]`.

### `SessionReader`

```ts
interface SessionReader {
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
import { createNodeAdapter, createSessionReader, listSessions } from '@introspection/read/node'
```

- `createNodeAdapter(dir)` — creates a `StorageAdapter` backed by `fs`
- `createSessionReader(dir, sessionId?)` — convenience wrapper
- `listSessions(dir)` — convenience wrapper
