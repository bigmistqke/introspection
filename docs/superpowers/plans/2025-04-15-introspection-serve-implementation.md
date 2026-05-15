# @introspection/serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@introspection/serve` package for serving introspection traces with handler factory + standalone server.

**Architecture:** 
- `packages/serve/src/index.ts` - handler factory (framework-agnostic, uses Web Request/Response)
- `packages/serve/src/node.ts` - serve() function + CLI re-exports from index
- Separate package config from demos/shared to avoid Vite plugin dependency

**Tech Stack:** Node.js, TypeScript, tsup for bundling

---

## File Structure

```
packages/serve/
├── package.json
├── vitest.config.ts
├── src/
│   ├── index.ts          # createHandler (framework-agnostic)
│   ├── node.ts          # serve() + CLI entry
│   ├── handler.ts       # handler internals
│   ├── errors.ts       # error responses
│   ├── types.ts        # shared types
│   └── __tests__/
│       ├── index.test.ts
│       └── streaming.test.ts
└── tsconfig.json
```

---

## Task 1: Create package scaffold

**Files:**
- Create: `packages/serve/package.json`
- Create: `packages/serve/tsconfig.json`
- Create: `packages/serve/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@introspection/serve",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./node": {
      "types": "./src/node.ts",
      "import": "./dist/node.js"
    }
  },
  "bin": {
    "introspect-serve": "./dist/node.js"
  },
  "scripts": {
    "build": "tsup src/index.ts src/node.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@introspection/types": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@introspection/serve': resolve(__dirname, 'src/index.ts'),
      '@introspection/serve/node': resolve(__dirname, 'src/node.ts'),
    },
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add packages/serve/
git commit -m "feat(serve): scaffold package"
```

---

## Task 2: Create types and error responses

**Files:**
- Create: `packages/serve/src/types.ts`
- Create: `packages/serve/src/errors.ts`

- [ ] **Step 1: Create types.ts**

```ts
export interface ServeOptions {
  directory: string
  prefix?: string
  streaming?: boolean
}

export interface NodeServeOptions extends ServeOptions {
  port: number
  host?: string
}

export interface TraceMeta {
  id: string
  label?: string
  startedAt?: number
}

export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 2: Create errors.ts**

```ts
import type { ErrorResponse } from './types.js'

export const ERROR_SESSION_NOT_FOUND: ErrorResponse = { error: 'Trace not found' }
export const ERROR_ASSET_NOT_FOUND: ErrorResponse = { error: 'Asset not found' }
export const ERROR_STREAMING_NOT_ENABLED: ErrorResponse = { 
  error: 'Streaming not enabled. Set streaming: true in options.' 
}

export function errorResponse(status: number, body: ErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/serve/src/types.ts packages/serve/src/errors.ts
git commit -m "feat(serve): add types and error utilities"
```

---

## Task 3: Create handler factory

**Files:**
- Create: `packages/serve/src/handler.ts`

- [ ] **Step 1: Write handler.ts**

```ts
import { existsSync, readdirSync, readFileSync, statSync, createReadStream } from 'fs'
import { resolve, join } from 'path'
import type { ServeOptions, TraceMeta } from './types.js'
import type { Readable } from 'stream'
import { errorResponse, ERROR_SESSION_NOT_FOUND, ERROR_ASSET_NOT_FOUND, ERROR_STREAMING_NOT_ENABLED } from './errors.js'

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  png: 'image/png',
  jpg: 'image/jpeg',
  html: 'text/html',
  txt: 'text/plain',
}

export function createHandler(options: ServeOptions) {
  const { directory, prefix = '/_introspect', streaming = false } = options
  const resolvedDirectory = resolve(directory)

  return (request: { url: string; headers?: Record<string, string> }): Response | null => {
    const url = request.url
    if (!url.startsWith(prefix)) return null

    const path = url.slice(prefix.length)

    // GET / - list traces
    if (path === '' || path === '/') {
      if (!existsSync(resolvedDirectory)) {
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } })
      }
      const entries = readdirSync(resolvedDirectory, { withFileTypes: true })
      const traces = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      return new Response(JSON.stringify(traces), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse traceId and remainder
    const segments = path.split('/').filter(Boolean)
    const traceId = segments[0]
    const remainder = segments.slice(1).join('/')

    if (!traceId) {
      return errorResponse(400, { error: 'Missing trace ID' })
    }

    const traceDir = join(resolvedDirectory, traceId)

    // Security: ensure traceDir is under resolvedDirectory
    const resolvedTraceDir = resolve(traceDir)
    if (!resolvedTraceDir.startsWith(resolvedDirectory)) {
      return errorResponse(403, { error: 'Forbidden' })
    }

    if (!existsSync(traceDir)) {
      return errorResponse(404, ERROR_SESSION_NOT_FOUND)
    }

    // GET /:trace/meta.json
    if (remainder === 'meta.json') {
      const metaPath = join(traceDir, 'meta.json')
      if (!existsSync(metaPath)) {
        const meta: TraceMeta = { id: traceId }
        return new Response(JSON.stringify(meta), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      return new Response(JSON.stringify({ ...meta, id: traceId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /:trace/events.ndjson
    if (remainder === 'events.ndjson') {
      const eventsPath = join(traceDir, 'events.ndjson')
      if (!existsSync(eventsPath)) {
        return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      // For streaming, return empty - events come via SSE
      if (streaming) {
        return new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } })
      }
      const stat = statSync(eventsPath)
      const stream = createReadStream(eventsPath)
      return new Response(stream as any, {
        headers: { 'Content-Type': 'application/x-ndjson', 'Content-Length': stat.size },
      })
    }

    // GET /:trace/events (SSE endpoint - streaming only)
    if (remainder === 'events' && streaming) {
      const eventsPath = join(traceDir, 'events.ndjson')
      if (!existsSync(eventsPath)) {
        return new Response('', { 
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } 
        })
      }
      // SSE streaming - return a streaming response
      const encoder = new TextEncoder()
      let buffer = ''
      
      const stream = new ReadableStream({
        start(controller) {
          const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(l => l.trim())
          let index = 0
          const sendNext = () => {
            if (index >= lines.length) {
              controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
              controller.close()
              return
            }
            const event = lines[index]
            controller.enqueue(encoder.encode(`data: ${event}\n\n`))
            index++
            setTimeout(sendNext, 10)
          }
          sendNext()
        }
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    // Streaming endpoint without streaming enabled
    if (remainder === 'events' && !streaming) {
      return errorResponse(400, ERROR_STREAMING_NOT_ENABLED)
    }

    // GET /:trace/assets/:path
    if (remainder.startsWith('assets/')) {
      const assetPath = join(traceDir, remainder)
      const resolvedAssetPath = resolve(assetPath)
      
      if (!resolvedAssetPath.startsWith(resolvedTraceDir)) {
        return errorResponse(403, { error: 'Forbidden' })
      }
      
      if (!existsSync(assetPath)) {
        return errorResponse(404, ERROR_ASSET_NOT_FOUND)
      }

      const stat = statSync(assetPath)
      const extension = assetPath.split('.').pop()?.toLowerCase()
      const contentType = CONTENT_TYPES[extension ?? ''] ?? 'application/octet-stream'
      const stream = createReadStream(assetPath)
      
      return new Response(stream as any, {
        headers: { 'Content-Type': contentType, 'Content-Length': stat.size },
      })
    }

    return errorResponse(404, { error: 'Not found' })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/serve/src/handler.ts
git commit -m "feat(serve): add handler factory"
```

---

## Task 4: Create index.ts exports

**Files:**
- Create: `packages/serve/src/index.ts`

- [ ] **Step 1: Create index.ts**

```ts
export { createHandler, type ServeOptions } from './handler.js'
export { type TraceMeta, type NodeServeOptions, type ErrorResponse } from './types.js'
export { 
  errorResponse, 
  ERROR_SESSION_NOT_FOUND, 
  ERROR_ASSET_NOT_FOUND, 
  ERROR_STREAMING_NOT_ENABLED 
} from './errors.js'
```

- [ ] **Step 2: Commit**

```bash
git add packages/serve/src/index.ts
git commit -m "feat(serve): export handler from index"
```

---

## Task 5: Create node.ts (serve + CLI)

**Files:**
- Create: `packages/serve/src/node.ts`

- [ ] **Step 1: Create node.ts**

```ts
import { createServer, type Server } from 'http'
import { createHandler, type ServeOptions, type NodeServeOptions } from './index.js'

export { type NodeServeOptions } from './index.js'

export function serve(options: NodeServeOptions): Server {
  const { port, host = '0.0.0.0', ...handlerOptions } = options
  const handler = createHandler(handlerOptions)

  const server = createServer((req, res) => {
    const request = {
      url: req.url ?? '',
      headers: req.headers as Record<string, string>,
    }
    const response = handler(request)
    
    if (response === null) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    const body = response.body
    if (body instanceof ReadableStream) {
      // @ts-expect-error - Node.js stream types
      body.pipeTo(new WritableStream({
        write(chunk) {
          res.write(chunk)
        },
        close() {
          res.end()
        }
      }))
    } else if (body) {
      res.end(body)
    } else {
      res.end()
    }
  })

  server.listen(port, host, () => {
    console.log(`Serving introspection traces at http://${host}:${port}${handlerOptions.prefix}`)
  })

  return server
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options: NodeServeOptions = {
    directory: '.introspect',
    port: 3456,
    prefix: '/_introspect',
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-d' || arg === '--directory') {
      options.directory = args[++i]
    } else if (arg === '-p' || arg === '--port') {
      options.port = parseInt(args[++i], 10)
    } else if (arg === '--prefix') {
      options.prefix = args[++i]
    } else if (arg === '--streaming') {
      options.streaming = true
    } else if (arg === '--host') {
      options.host = args[++i]
    }
  }

  serve(options)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/serve/src/node.ts
git commit -m "feat(serve): add serve function and CLI"
```

---

## Task 6: Test the implementation

**Files:**
- Create: `packages/serve/src/__tests__/handler.test.ts`
- Run: tests

- [ ] **Step 1: Create test helper fixtures**

First create test fixtures:
```bash
mkdir -p packages/serve/src/__tests__/fixtures/.introspect/trace-1
echo '{"id":"trace-1","label":"Test Trace","startedAt":1234567890}' > packages/serve/src/__tests__/fixtures/.introspect/trace-1/meta.json
echo '{"type":"test","timestamp":100,"metadata":{}}' > packages/serve/src/__tests__/fixtures/.introspect/trace-1/events.ndjson
```

- [ ] **Step 2: Write handler tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createHandler } from '../index.js'
import { resolve } from 'path'

const fixturesDir = resolve(__dirname, '../fixtures')

describe('createHandler', () => {
  it('lists traces', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
  })

  it('returns empty array when directory does not exist', () => {
    const handler = createHandler({ directory: '/nonexistent' })
    const response = handler({ url: '/_introspect/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('returns trace meta', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/trace-1/meta.json' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
  })

  it('returns 404 for missing trace', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/nonexistent/meta.json' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(404)
  })

  it('returns events ndjson', () => {
    const handler = createHandler({ directory: fixturesDir })
    const response = handler({ url: '/_introspect/trace-1/events.ndjson' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/x-ndjson')
  })

  it('returns 400 for streaming endpoint without streaming enabled', () => {
    const handler = createHandler({ directory: fixturesDir, streaming: false })
    const response = handler({ url: '/_introspect/trace-1/events' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd packages/serve && npm test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/serve/src/__tests__/
git commit -m "feat(serve): add handler tests"
```

---

## Task 7: Build and verify

**Files:**
- Run: build
- Run: typecheck

- [ ] **Step 1: Build**

```bash
cd packages/serve && npm run build
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/serve && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/serve/dist/
git commit -m "feat(serve): build package"
```

---

## Task 8: Update demo-shared to use the package

**Files:**
- Modify: `demos/shared/src/vite-plugin.ts`

- [ ] **Step 1: Update vite-plugin to re-export from @introspection/serve**

Keep the Vite plugin wrapper but import the handler from @introspection/serve:

```ts
import { createHandler } from '@introspection/serve'
import type { Plugin } from 'vite'

export interface IntrospectionServeOptions {
  directory?: string
  prefix?: string
}

export function introspectionServe(options?: IntrospectionServeOptions): Plugin {
  const prefix = options?.prefix ?? '/__introspect'
  return {
    name: 'introspection-serve',
    configureServer(server) {
      const handler = createHandler({
        directory: options?.directory ?? '.introspect',
        prefix,
      })
      server.middlewares.use((req, res, next) => {
        // Convert express request to handler format
        const request = { url: req.url ?? '' }
        const response = handler(request)
        if (response === null) return next()
        res.statusCode = response.status
        response.headers.forEach((value, key) => {
          res.setHeader(key, value)
        })
        res.end()
      })
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add demos/shared/src/vite-plugin.ts
git commit -m "refactor(demos): use @introspection/serve in vite-plugin"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|----------------|------|
| createHandler function | Task 3 |
| serve function | Task 5 |
| CLI | Task 5 |
| Static endpoints | Task 3 |
| Streaming endpoint | Task 3 |
| Error responses | Task 2 |
| Path traversal prevention | Task 3 |
| Exports pattern (./node) | Task 1 |

---

**Plan complete.** Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this trace using executing-plans, batch execution with checkpoints

Which approach?