# @introspection/query

Programmatic access to introspection trace data for custom analysis and scripting.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
  - [listSessions](#listsessionsdir)
  - [SessionSummary](#sessionsummary)
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

const session = await createSession('.introspect')

// List all events
const allEvents = await session.events.ls()

// Filter events by type
const jsErrors = await session.events.query({ type: 'js.error' })
const networkCalls = await session.events.query({ type: 'network.request' })

// List all assets
const assets = await session.assets.ls()

// Read asset content
const body = await session.assets.read('abc123.body.json')
```

## API

### `listSessions(dir)`

Lists all sessions in a traces directory, sorted by most recent first.

```ts
import { listSessions } from '@introspection/query'

const sessions = await listSessions('./traces')
// Returns: [{ id: 'abc', label: 'test', startedAt: 1234567890, duration: 5000 }, ...]
```

### `SessionSummary`

```ts
interface SessionSummary {
  id: string
  label?: string
  startedAt: number    // unix ms
  endedAt?: number    // unix ms
  duration?: number    // ms (endedAt - startedAt)
}
```

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
  type?: string       // Event type (e.g., 'js.error', 'network.request', 'asset')
  source?: string     // Event source (e.g., 'cdp', 'agent', 'playwright', 'plugin')
}
```

**Examples:**

```ts
// All events
const all = await session.events.ls()

// By type (comma-separated for multiple)
const errors = await session.events.query({ type: 'js.error' })
const networkAndErrors = await session.events.query({ type: 'network.request,js.error' })

// By source
const cdpEvents = await session.events.query({ source: 'cdp' })
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

// Read text content (JSON bodies, snapshots, etc.)
const body = await session.assets.read('abc123.body.json')
const scopes = await session.assets.read('def456.scopes.json')

// Read binary content (images return size info only)
const canvas = await session.assets.read('ghi789.webgl-canvas.png')
// Returns: { path: 'ghi789.webgl-canvas.png', sizeKB: 245.3 }
```

## Event Types

| Type | Description |
|------|-------------|
| `network.request` | Outgoing HTTP request |
| `network.response` | HTTP response with optional body summary |
| `network.error` | Failed or aborted request |
| `js.error` | Uncaught JS exceptions and unhandled rejections |
| `browser.navigate` | Page navigations and URL changes |
| `playwright.action` | Tracked page proxy method calls |
| `playwright.result` | Test result (passed/failed/timedOut/skipped) |
| `mark` | User-defined timeline annotation |
| `asset` | File written to assets directory |
| `console` | Browser console output |
