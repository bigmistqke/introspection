# @introspection/serve Design

## Overview

A deployable server package for serving introspection traces. Provides a handler factory + standalone server for serving trace data read-only, with optional SSE streaming.

## Package

`@introspection/serve`

## Exports

| Entry | Description |
|-------|-------------|
| `.` | Handler factory (framework-agnostic) |
| `./node` | `serve()` function + CLI (Node-specific) |

```json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "import": "./dist/index.js"
  },
  "./node": {
    "types": "./src/node.ts",
    "import": "./dist/node.js"
  }
}
```

## Motivation

Current demos use `introspectionServe()` Vite plugin for dev-only serving. This package enables:
- Deployment to production (not dev-only)
- Framework-agnostic — handler can be mounted on any server
- Protocol that other backends (Go, Rust, etc.) could implement

## API

### createHandler

Creates a request handler for custom servers (Express, Fastify, std Node).

```ts
import { createHandler } from '@introspection/serve'

const handler = createHandler({
  directory: './.introspect',
  prefix: '/_introspect',
  streaming: false,
})
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `directory` | `string` | required | Path to `.introspect` directory |
| `prefix` | `string` | `/_introspect` | URL prefix |
| `streaming` | `boolean` | `false` | Enable SSE for live events |

**Returns:** `(request: Request) => Response | null`

Returns `null` if the request doesn't match the prefix (pass to next handler).

**Request type** is interface-compatible with:
- `std.Request` (Web standard)
- Express/Fastify adapters can wrap it

### serve

Spin up a standalone server.

```ts
import { serve } from '@introspection/serve'

serve({
  directory: './.introspect',
  port: 3456,
  prefix: '/_introspect',
  streaming: false,
})
```

Same options as `createHandler`, plus:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | required | Port to listen on |
| `host` | `string` | `0.0.0.0` | Host to bind to |

**Returns:** `Server` (node http Server)

### CLI

```bash
introspect-serve --directory .introspect --port 3456
```

Options:
- `--directory, -d` (required)
- `--port, -p` (default: 3456)
- `--prefix` (default: `/_introspect`)
- `--streaming` (enable SSE)
- `--host` (default: `0.0.0.0`)

## Endpoints

### Static (always)

```
GET /_introspect/                 → 200 ["id1", "id2"]
GET /_introspect/:id/meta.json    → 200 { id, label?, startedAt }
GET /_introspect/:id/events.ndjson → 200 (stream of NDJSON)
GET /_introspect/:id/assets/:path → 200 (file with Content-Type)
```

### Streaming (when streaming: true)

```
GET /_introspect/:id/events → 200 text/event-stream
```

SSE events:
- `data: <TraceEvent JSON>` — new event
- `data: {}` with event: `done` — all events sent

### Error Responses

| Scenario | Status | Body |
|----------|--------|------|
| Directory doesn't exist | 200 | `[]` |
| Trace not found | 404 | `{ error: "Trace not found" }` |
| Asset not found | 404 | `{ error: "Asset not found" }` |
| Streaming endpoint without streaming enabled | 400 | `{ error: "Streaming not enabled. Set streaming: true in options." }` |

## Security

- Path traversal prevention: all paths must resolve under `directory`
- No write operations
- No auth (intentionally)

## Implementation Notes

- File watching uses `fs.watch` — only active when `streaming: true`
- SSE uses EventSource pattern compatible with `useEventSource` from demo
- Handler is framework-agnostic via Web `Request`/`Response` types