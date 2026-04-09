# @introspection/query

Programmatic access to introspection trace data for custom analysis and scripting.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
  - [createSession](#createsessiondir-sessionid)
  - [Session](#session)
  - [EventsAPI](#eventsapi)
  - [AssetsAPI](#assetsapi)
- [Event Types](#event-types)

## Install

```bash
pnpm add @introspection/query
```

## Usage

```ts
import { createSession } from '@introspection/query'

const session = await createSession('./traces')

// List all events
const allEvents = await session.events.ls()

// Filter events by type
const jsErrors = await session.events.query({ type: 'jsError' })
const networkCalls = await session.events.query({ type: 'fetch' })

// List all assets
const assets = await session.assets.ls()

// Read asset content
const html = await session.assets.read('index.html')
```

## API

### `createSession(dir, sessionId?)`

Creates a session by loading trace data from disk.

| Parameter | Type | Description |
|-----------|------|-------------|
| `dir` | `string` | Path to the traces directory |
| `sessionId` | `string` | Specific session ID (optional, uses latest if omitted) |

Returns a `Session` object.

### Session

```ts
interface Session {
  dir: string
  id: string
  events: EventsAPI
  assets: AssetsAPI
}
```

| Property | Type | Description |
|----------|------|-------------|
| `dir` | `string` | Path to traces directory |
| `id` | `string` | Session ID |
| `events` | `EventsAPI` | API for querying events |
| `assets` | `AssetsAPI` | API for reading assets |

### EventsAPI

```ts
interface EventsAPI {
  ls(): Promise<TraceEvent[]>
  query(filters: EventsFilters): Promise<TraceEvent[]>
}

interface EventsFilters {
  type?: string       // Event type (e.g., 'jsError', 'fetch', 'resource')
  source?: string     // Event source (e.g., 'page', 'system')
}
```

**Examples:**

```ts
// All events
const all = await session.events.ls()

// By type (comma-separated for multiple)
const errors = await session.events.query({ type: 'jsError' })
const networkAndErrors = await session.events.query({ type: 'fetch,jsError' })

// By source
const pageEvents = await session.events.query({ source: 'page' })
```

### AssetsAPI

```ts
interface AssetsAPI {
  ls(): Promise<AssetEvent[]>
  read(path: string): Promise<string | { path: string; sizeKB: number }>
}
```

**Examples:**

```ts
// All assets
const assets = await session.assets.ls()

// Read text content
const html = await session.assets.read('index.html')
const css = await session.assets.read('styles.css')

// Read binary content (images return size info only)
const screenshot = await session.assets.read('screenshot.png')
// Returns: { path: 'screenshot.png', sizeKB: 245.3 }
```

## Event Types

| Type | Description |
|------|-------------|
| `jsError` | JavaScript errors caught by the page |
| `fetch` | Fetch/XHR network requests |
| `resource` | Resource loads (scripts, styles, images) |
| `asset` | Asset file stored during trace |
| `performance` | Performance measurements |
| `debugger` | Debugger pause events |
