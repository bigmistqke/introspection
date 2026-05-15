# Storage-Agnostic `createHandler` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@introspection/serve`'s `createHandler` a generic `StorageAdapter`-over-HTTP transport (verb-prefix URLs `/dirs/` and `/file/`, no trace vocabulary, async, no SSE), with traversal protection pushed down into `createNodeAdapter`, the demo `fetch-adapter` rewritten against the new wire protocol, SSE relocated into a solid-streaming-only Vite plugin, and the four HTTP-served demo tests un-skipped (with the two weak ones tightened).

**Architecture:** `createHandler({ adapter })` exposes any `StorageAdapter` over HTTP as two verbs: `GET <prefix>/dirs/<subPath>` calls `adapter.listDirectories(subPath)`, `GET <prefix>/file/<path>` calls `adapter.readBinary(path)`. The handler holds no filesystem code; `serve()` and the demo `introspectionServe` Vite plugin keep their `{ directory }` convenience by building a node adapter internally. Traversal protection lives in `createNodeAdapter` (defense in depth — throws `TraversalError` on escape, handler maps to `403`). `readJSON`/`readText` parse client-side via the bytes returned from `/file/`. SSE leaves `@introspection/serve` and moves into the solid-streaming demo as its own Vite plugin serving `/_introspect/stream/<run>/<trace>/events`.

**Tech Stack:** TypeScript (NodeNext), pnpm workspace, tsup (build), vitest (unit tests in `@introspection/serve`, `@introspection/read`, `demos/shared`), Playwright Test (demo `*.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-05-15-storage-agnostic-createhandler-design.md`

---

## File Structure

**Modify:**
- `packages/read/src/node.ts` — adds `TraversalError` + a `safeJoin` helper used by every method; `createNodeAdapter` routes through it.
- `packages/read/src/index.ts` — re-exports `TraversalError` so `@introspection/serve` can import it.
- `packages/read/test/node-adapter.test.ts` — adds traversal cases.
- `packages/serve/src/handler.ts` — complete rewrite: generic transport, async, two verbs, no SSE, no semantic endpoints.
- `packages/serve/src/types.ts` — `ServeOptions` becomes `{ adapter, prefix? }`; drop `TraceMeta`; keep `NodeServeOptions` adjusted.
- `packages/serve/src/index.ts` — re-export shape changes (no more `TraceMeta`, no `ERROR_SESSION_NOT_FOUND`/`ERROR_ASSET_NOT_FOUND`).
- `packages/serve/src/errors.ts` — simplifies to a single `errorResponse(status, body)` helper.
- `packages/serve/src/node.ts` — `serve()` builds a node adapter and the new handler.
- `packages/serve/src/__tests__/handler.test.ts` — rewritten against a stub `StorageAdapter`.
- `packages/serve/package.json` — adds `@introspection/read` as a workspace dependency.
- `demos/shared/src/vite-plugin.ts` — `introspectionServe` migrates to `createHandler({ adapter })`, async middleware.
- `demos/shared/src/fetch-adapter.ts` — rewritten against the new wire protocol; `listDirectories` honours `subPath`.
- `demos/shared/test/fetch-adapter.test.ts` — new tests against a mocked `fetch` (the package currently has no tests; vitest is already a workspace dev-dep).
- `demos/shared/package.json` — adds vitest as a dev-dep and a `test` script.
- `demos/shared/vitest.config.ts` — new (minimal).
- `demos/solid-streaming/vite.config.ts` — adds the new SSE plugin alongside `introspectionServe()`.
- `demos/solid-streaming/src/App.tsx` — switches from "let `read` resolve latest" to explicit `listRuns` → pick latest → `listTraces(runId)` → pick latest, so the SSE URL can be built with the actual `runId`.
- `demos/solid-streaming/scripts/streaming.spec.ts` — un-skip; the test today is already strict.
- `demos/vanilla-basic/test/demo.spec.ts` — un-skip; the test today is already strict.
- `demos/wc-graph/test/demo.spec.ts` — un-skip **and tighten**.
- `demos/react-trace-list/test/demo.spec.ts` — un-skip **and tighten**.

**Create:**
- `demos/solid-streaming/scripts/vite-plugin-sse.ts` — solid-streaming-only Vite plugin serving `GET /<prefix>/stream/<run>/<trace>/events` with `fs.watch`-based SSE tailing of `events.ndjson`. Owns the live-tail logic that today lives in `packages/serve/src/handler.ts`.
- `demos/shared/test/fetch-adapter.test.ts` (listed under Modify-set above; created here).
- `demos/shared/vitest.config.ts` (same).

**Delete:** nothing.

---

## Task 1: Traversal guard in `createNodeAdapter`

**Files:**
- Modify: `packages/read/src/node.ts`
- Modify: `packages/read/src/index.ts`
- Test: `packages/read/test/node-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append the following `describe` block to `packages/read/test/node-adapter.test.ts` (after the existing `describe('node convenience wrappers', ...)` block):

```ts
describe('createNodeAdapter — traversal guard', () => {
  it('throws TraversalError on .. in listDirectories', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.listDirectories('..')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on absolute path in listDirectories', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.listDirectories('/etc')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on .. in readText', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readText('../secret.txt')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on absolute path in readText', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readText('/etc/passwd')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on traversal inside compound path in readBinary', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readBinary('safe/../../escape')).rejects.toThrow(/escapes base directory/)
  })

  it('throws TraversalError on .. in readJSON', async () => {
    const adapter = createNodeAdapter(dir)
    await expect(adapter.readJSON('../other.json')).rejects.toThrow(/escapes base directory/)
  })

  it('errors are TraversalError instances (name)', async () => {
    const adapter = createNodeAdapter(dir)
    try {
      await adapter.readText('../x')
      throw new Error('expected throw')
    } catch (e) {
      expect((e as Error).name).toBe('TraversalError')
    }
  })

  it('valid nested paths still work', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'x.txt'), 'ok')
    const adapter = createNodeAdapter(dir)
    expect(await adapter.readText('sub/x.txt')).toBe('ok')
    expect(await adapter.listDirectories('sub')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/read && pnpm exec vitest run test/node-adapter.test.ts`
Expected: FAIL — the traversal cases either succeed (returning empty / leaking data) or throw something other than a `TraversalError` named error.

- [ ] **Step 3: Implement the traversal guard in `createNodeAdapter`**

Replace the contents of `packages/read/src/node.ts` with:

```ts
import { readdir, readFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import type { TraceReader } from '@introspection/types'
import {
  type StorageAdapter,
  type TraceSummary,
  type RunSummary,
  createTraceReader as createTraceReaderFromAdapter,
  listRuns as listRunsFromAdapter,
  listTraces as listTracesFromAdapter,
} from './index.js'

export type { StorageAdapter, TraceSummary, RunSummary } from './index.js'
export type { TraceReader, EventsFilter, EventsAPI } from '@introspection/types'

export class TraversalError extends Error {
  override readonly name = 'TraversalError'
}

function safeJoin(base: string, sub: string): string {
  const baseResolved = resolve(base)
  const target = resolve(baseResolved, sub)
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new TraversalError(`Path '${sub}' escapes base directory`)
  }
  return target
}

export function createNodeAdapter(dir: string): StorageAdapter {
  return {
    async listDirectories(subPath?: string) {
      const target = subPath ? safeJoin(dir, subPath) : dir
      try {
        const entries = await readdir(target, { withFileTypes: true })
        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch (err) {
        if ((err as Error).name === 'TraversalError') throw err
        return []
      }
    },
    async readText(path: string) {
      return readFile(safeJoin(dir, path), 'utf-8')
    },
    async readBinary(path: string) {
      return readFile(safeJoin(dir, path))
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      const text = await readFile(safeJoin(dir, path), 'utf-8')
      return JSON.parse(text) as T
    },
  }
}

export async function createTraceReader(
  dir: string,
  options?: { runId?: string; traceId?: string; verbose?: boolean },
): Promise<TraceReader> {
  return createTraceReaderFromAdapter(createNodeAdapter(dir), options)
}

export async function listRuns(dir: string): Promise<RunSummary[]> {
  return listRunsFromAdapter(createNodeAdapter(dir))
}

export async function listTraces(dir: string, runId: string): Promise<TraceSummary[]> {
  return listTracesFromAdapter(createNodeAdapter(dir), runId)
}
```

> Note the `try/catch` in `listDirectories`: it keeps the existing "missing dir → `[]`" behaviour for genuine fs errors, but re-throws `TraversalError` so the guard is never silently swallowed.

- [ ] **Step 4: Re-export `TraversalError` from the package root**

In `packages/read/src/index.ts`, add this line to the existing block of re-exports (near `export { createMemoryReadAdapter } ...`):

```ts
export { TraversalError } from './node.js'
```

(The class lives in `node.ts` because it's only meaningful for the node adapter; re-exporting from `index.ts` lets `@introspection/serve` import it from `@introspection/read` without depending on `/node`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/read && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS — all `read` tests including the new traversal cases; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/read/src/node.ts packages/read/src/index.ts packages/read/test/node-adapter.test.ts
git commit -m "read: traversal guard in createNodeAdapter (TraversalError, safeJoin)"
```

---

## Task 2: Rewrite `createHandler` as a generic `StorageAdapter`-over-HTTP transport

**Files:**
- Modify: `packages/serve/src/handler.ts`, `packages/serve/src/types.ts`, `packages/serve/src/errors.ts`, `packages/serve/src/index.ts`, `packages/serve/package.json`
- Test: `packages/serve/src/__tests__/handler.test.ts`

- [ ] **Step 1: Add `@introspection/read` as a workspace dependency**

In `packages/serve/package.json`, change the `dependencies` block to:

```json
  "dependencies": {
    "@introspection/types": "workspace:*",
    "@introspection/read": "workspace:*"
  },
```

Run `pnpm install` from the repo root to update the lockfile.

- [ ] **Step 2: Write the failing handler test (full rewrite)**

Replace the contents of `packages/serve/src/__tests__/handler.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { createHandler } from '../index.js'
import type { StorageAdapter } from '@introspection/types'
import { TraversalError } from '@introspection/read'

function stubAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    async listDirectories(subPath?: string) {
      if (overrides.listDirectories) return overrides.listDirectories(subPath)
      return []
    },
    async readText(path: string) {
      if (overrides.readText) return overrides.readText(path)
      throw new Error('not found')
    },
    async readBinary(path: string) {
      if (overrides.readBinary) return overrides.readBinary(path)
      throw new Error('not found')
    },
    async readJSON<T = unknown>(path: string): Promise<T> {
      if (overrides.readJSON) return overrides.readJSON<T>(path)
      throw new Error('not found')
    },
  }
}

describe('createHandler — protocol', () => {
  it('returns null when the URL does not start with prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter() })
    const response = await handler({ url: '/other/path' })
    expect(response).toBeNull()
  })

  it('GET /dirs/ calls listDirectories(undefined) and returns a JSON array', async () => {
    const calls: Array<string | undefined> = []
    const adapter = stubAdapter({
      async listDirectories(sub) { calls.push(sub); return ['run-a', 'run-b'] },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/dirs/' })
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
    expect(await response!.json()).toEqual(['run-a', 'run-b'])
    expect(calls).toEqual([undefined])
  })

  it('GET /dirs/<sub> calls listDirectories with subPath', async () => {
    const calls: Array<string | undefined> = []
    const adapter = stubAdapter({
      async listDirectories(sub) { calls.push(sub); return ['sess-1'] },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/dirs/run-a' })
    expect(await response!.json()).toEqual(['sess-1'])
    expect(calls).toEqual(['run-a'])
  })

  it('GET /file/<path> calls readBinary and returns the bytes', async () => {
    const calls: string[] = []
    const adapter = stubAdapter({
      async readBinary(path) { calls.push(path); return new TextEncoder().encode('{"hello":"world"}') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/run-a/meta.json' })
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json')
    expect(await response!.text()).toBe('{"hello":"world"}')
    expect(calls).toEqual(['run-a/meta.json'])
  })

  it('Content-Type is derived from file extension', async () => {
    const adapter = stubAdapter({ async readBinary() { return new Uint8Array() } })
    const handler = createHandler({ adapter })
    const cases: Array<[string, string]> = [
      ['/_introspect/file/x/events.ndjson', 'application/x-ndjson'],
      ['/_introspect/file/x/a.png', 'image/png'],
      ['/_introspect/file/x/a.jpg', 'image/jpeg'],
      ['/_introspect/file/x/a.jpeg', 'image/jpeg'],
      ['/_introspect/file/x/unknown.bin', 'application/octet-stream'],
    ]
    for (const [url, type] of cases) {
      const response = await handler({ url })
      expect(response!.headers.get('content-type')).toBe(type)
    }
  })

  it('returns 403 when the adapter throws TraversalError', async () => {
    const adapter = stubAdapter({
      async readBinary() { throw new TraversalError('nope') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/../etc' })
    expect(response!.status).toBe(403)
    expect(await response!.json()).toEqual({ error: 'Forbidden' })
  })

  it('returns 404 when readBinary throws (missing file)', async () => {
    const adapter = stubAdapter({
      async readBinary() { throw new Error('ENOENT') },
    })
    const handler = createHandler({ adapter })
    const response = await handler({ url: '/_introspect/file/missing' })
    expect(response!.status).toBe(404)
  })

  it('returns 404 for unknown verb under the prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter() })
    const response = await handler({ url: '/_introspect/garbage' })
    expect(response!.status).toBe(404)
  })

  it('honours a custom prefix', async () => {
    const handler = createHandler({ adapter: stubAdapter({ async listDirectories() { return ['x'] } }), prefix: '/api/trace' })
    expect(await handler({ url: '/api/trace/dirs/' })).not.toBeNull()
    expect(await handler({ url: '/_introspect/dirs/' })).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/serve && pnpm exec vitest run`
Expected: FAIL — the current handler doesn't take `{ adapter }`, doesn't recognise `/dirs/` or `/file/`, and many cases throw or return the wrong shape.

- [ ] **Step 4: Rewrite `packages/serve/src/types.ts`**

Replace the contents with:

```ts
import type { StorageAdapter } from '@introspection/types'

export interface ServeOptions {
  adapter: StorageAdapter
  prefix?: string
}

export interface NodeServeOptions {
  directory: string
  port: number
  host?: string
  prefix?: string
}

export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 5: Simplify `packages/serve/src/errors.ts`**

Replace the contents with:

```ts
export interface ErrorResponse {
  error: string
}

export function errorResponse(status: number, body: ErrorResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
```

(The old semantic constants `ERROR_SESSION_NOT_FOUND` / `ERROR_ASSET_NOT_FOUND` are dropped — the new handler emits `{ error: 'Not found' }` / `{ error: 'Forbidden' }` inline.)

- [ ] **Step 6: Rewrite `packages/serve/src/handler.ts`**

Replace the contents with:

```ts
import type { ServeOptions } from './types.js'
import { errorResponse } from './errors.js'

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  html: 'text/html',
  txt: 'text/plain',
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = path.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function createHandler(options: ServeOptions) {
  const { adapter, prefix = '/_introspect' } = options

  return async (request: { url: string }): Promise<Response | null> => {
    const url = request.url
    if (!url.startsWith(prefix)) return null

    const tail = url.slice(prefix.length).replace(/^\/+/, '')
    // tail is now "dirs/<sub>", "dirs", "dirs/", "file/<path>", or something else
    let verb: 'dirs' | 'file' | null = null
    let rest = ''
    if (tail === 'dirs' || tail === 'dirs/' || tail.startsWith('dirs/')) {
      verb = 'dirs'
      rest = tail === 'dirs' || tail === 'dirs/' ? '' : tail.slice('dirs/'.length)
    } else if (tail.startsWith('file/')) {
      verb = 'file'
      rest = tail.slice('file/'.length)
    } else {
      return errorResponse(404, { error: 'Not found' })
    }

    try {
      if (verb === 'dirs') {
        const dirs = await adapter.listDirectories(rest || undefined)
        return new Response(JSON.stringify(dirs), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      // verb === 'file'
      if (!rest) return errorResponse(404, { error: 'Not found' })
      const bytes = await adapter.readBinary(rest)
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(rest),
          'Content-Length': String(bytes.byteLength),
        },
      })
    } catch (err) {
      if ((err as Error).name === 'TraversalError') {
        return errorResponse(403, { error: 'Forbidden' })
      }
      if (verb === 'file') {
        // Treat any read failure as not-found — adapters throw on missing files.
        return errorResponse(404, { error: 'Not found' })
      }
      return errorResponse(500, { error: (err as Error).message })
    }
  }
}
```

> The handler does not import `@introspection/read` at runtime — it recognises `TraversalError` by `name`, not by `instanceof`. The test imports `TraversalError` for the stub adapter; the handler does not.

- [ ] **Step 7: Update `packages/serve/src/index.ts`**

Replace the contents with:

```ts
export { createHandler } from './handler.js'
export type { ServeOptions, NodeServeOptions, ErrorResponse } from './types.js'
export { errorResponse } from './errors.js'
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/serve && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS — all handler tests; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/serve/src packages/serve/package.json pnpm-lock.yaml
git commit -m "serve: rewrite createHandler as generic StorageAdapter-over-HTTP transport"
```

---

## Task 3: Rewrite `serve()` node helper

**Files:**
- Modify: `packages/serve/src/node.ts`

(The existing `handler.test.ts` did not cover `serve()`; the package has no integration test for it today. This task includes a small integration test for the new shape.)

- [ ] **Step 1: Write the failing integration test**

Create `packages/serve/src/__tests__/serve.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { serve } from '../node.js'
import type { Server } from 'http'

let server: Server | undefined
let dir: string | undefined

afterEach(async () => {
  await new Promise<void>((resolveFn) => server?.close(() => resolveFn()))
  server = undefined
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = undefined
  }
})

describe('serve() node helper', () => {
  it('serves a directory tree end-to-end over HTTP', async () => {
    dir = await mkdtemp(join(tmpdir(), 'introspect-serve-'))
    await mkdir(join(dir, 'run-1', 'sess-1'), { recursive: true })
    await writeFile(join(dir, 'run-1', 'meta.json'), '{"version":"1","id":"run-1","startedAt":1}')
    await writeFile(join(dir, 'run-1', 'sess-1', 'meta.json'), '{"version":"2","id":"sess-1","startedAt":1}')

    server = serve({ directory: dir, port: 0, host: '127.0.0.1' })
    await new Promise<void>((r) => server!.on('listening', r))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const rootList = await fetch(`http://127.0.0.1:${port}/_introspect/dirs/`).then((r) => r.json())
    expect(rootList).toEqual(['run-1'])

    const runList = await fetch(`http://127.0.0.1:${port}/_introspect/dirs/run-1`).then((r) => r.json())
    expect(runList).toEqual(['sess-1'])

    const meta = await fetch(`http://127.0.0.1:${port}/_introspect/file/run-1/sess-1/meta.json`).then((r) => r.json())
    expect(meta).toMatchObject({ version: '2', id: 'sess-1' })

    const escape = await fetch(`http://127.0.0.1:${port}/_introspect/file/../etc/passwd`)
    expect(escape.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/serve && pnpm exec vitest run src/__tests__/serve.test.ts`
Expected: FAIL — `serve` still takes the old `{ directory }`-with-flat-handler shape; the `/dirs/` and `/file/` URLs don't route.

- [ ] **Step 3: Rewrite `packages/serve/src/node.ts`**

Replace the contents with:

```ts
import { createServer, type Server } from 'http'
import { createNodeAdapter } from '@introspection/read/node'
import { createHandler } from './handler.js'
import type { NodeServeOptions } from './types.js'

export type { NodeServeOptions } from './types.js'

export function serve(options: NodeServeOptions): Server {
  const { directory, port, host = '0.0.0.0', prefix } = options
  const handler = createHandler({
    adapter: createNodeAdapter(directory),
    ...(prefix !== undefined ? { prefix } : {}),
  })

  const server = createServer(async (req, res) => {
    const response = await handler({ url: req.url ?? '' })
    if (response === null) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(Buffer.from(chunk))
      }
    }
    res.end()
  })

  server.listen(port, host, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.log(`Serving introspection traces at http://${host}:${actualPort}${prefix ?? '/_introspect'}`)
  })

  return server
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/serve && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS — both `handler.test.ts` and the new `serve.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/serve/src/node.ts packages/serve/src/__tests__/serve.test.ts
git commit -m "serve: rewrite serve() node helper to use the generic createHandler"
```

---

## Task 4: Update `demos/shared` `introspectionServe` Vite plugin

**Files:**
- Modify: `demos/shared/src/vite-plugin.ts`

(This is a mechanical refactor — no separate test; covered by demo integration tests in Task 8.)

- [ ] **Step 1: Rewrite `demos/shared/src/vite-plugin.ts`**

Replace the contents with:

```ts
import { resolve } from 'path'
import { createHandler } from '@introspection/serve'
import { createNodeAdapter } from '@introspection/read/node'
import type { Plugin } from 'vite'

export interface IntrospectionServeOptions {
  directory?: string
  prefix?: string
}

export function introspectionServe(options?: IntrospectionServeOptions): Plugin {
  const prefix = options?.prefix ?? '/__introspect'
  let resolvedDirectory: string

  return {
    name: 'introspection-serve',

    configResolved(config) {
      resolvedDirectory = options?.directory
        ? resolve(options.directory)
        : resolve(config.root, '.introspect')
    },

    configureServer(server) {
      const handler = createHandler({
        adapter: createNodeAdapter(resolvedDirectory),
        prefix,
      })

      server.middlewares.use(async (req, res, next) => {
        const request = { url: req.url ?? '' }
        const response = await handler(request)
        if (response === null) return next()

        res.statusCode = response.status
        response.headers.forEach((value, key) => {
          res.setHeader(key, value)
        })

        const body = response.body
        if (body) {
          for await (const chunk of body) {
            res.write(Buffer.from(chunk))
          }
        }
        res.end()
      })
    },
  }
}
```

- [ ] **Step 2: Confirm `demos/shared` has `@introspection/read` as a dep**

`grep '"@introspection/read"' demos/shared/package.json` — should print a `"workspace:*"` line. If absent, add it under `dependencies` and run `pnpm install`.

- [ ] **Step 3: Typecheck the package**

Run: `cd demos/shared && pnpm exec tsc --noEmit`
Expected: typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add demos/shared/src/vite-plugin.ts
git commit -m "demos/shared: introspectionServe migrates to the new createHandler({ adapter })"
```

---

## Task 5: Rewrite `createFetchAdapter` against the new wire protocol

**Files:**
- Modify: `demos/shared/src/fetch-adapter.ts`, `demos/shared/package.json`
- Create: `demos/shared/test/fetch-adapter.test.ts`, `demos/shared/vitest.config.ts`

- [ ] **Step 1: Add a vitest config + test script to `demos/shared`**

Create `demos/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true } })
```

In `demos/shared/package.json`, add a `test` script and `vitest` as a dev-dep:

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
```

```json
  "devDependencies": {
    "vitest": "^2.0.0"
  }
```

Run `pnpm install` from the repo root.

- [ ] **Step 2: Write the failing test**

Create `demos/shared/test/fetch-adapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFetchAdapter } from '../src/fetch-adapter.js'

const calls: Array<string> = []
let stubFetch: typeof globalThis.fetch

beforeEach(() => {
  calls.length = 0
  stubFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    if (url.endsWith('/dirs/'))         return new Response(JSON.stringify(['run-a']), { status: 200 })
    if (url.endsWith('/dirs/run-a'))    return new Response(JSON.stringify(['sess-1']), { status: 200 })
    if (url.endsWith('/file/run-a/sess-1/meta.json')) return new Response('{"id":"sess-1"}', { status: 200 })
    if (url.endsWith('/file/missing')) return new Response('not found', { status: 404 })
    return new Response('', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  vi.stubGlobal('fetch', stubFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFetchAdapter', () => {
  it('listDirectories() hits /dirs/', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual(['run-a'])
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })

  it('listDirectories(subPath) hits /dirs/<subPath>', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories('run-a')).toEqual(['sess-1'])
    expect(calls).toEqual(['https://h/_introspect/dirs/run-a'])
  })

  it('readText hits /file/<path>', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.readText('run-a/sess-1/meta.json')).toBe('{"id":"sess-1"}')
    expect(calls).toEqual(['https://h/_introspect/file/run-a/sess-1/meta.json'])
  })

  it('readJSON parses client-side via readText', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.readJSON('run-a/sess-1/meta.json')).toEqual({ id: 'sess-1' })
  })

  it('readBinary returns a Uint8Array', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    const bytes = await adapter.readBinary('run-a/sess-1/meta.json')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('{"id":"sess-1"}')
  })

  it('listDirectories returns [] on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const adapter = createFetchAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual([])
  })

  it('read* throws on a non-OK response', async () => {
    const adapter = createFetchAdapter('https://h/_introspect')
    await expect(adapter.readText('missing')).rejects.toThrow(/Failed to fetch missing: 404/)
  })

  it('strips a trailing slash from baseUrl', async () => {
    const adapter = createFetchAdapter('https://h/_introspect/')
    await adapter.listDirectories()
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demos/shared && pnpm exec vitest run`
Expected: FAIL — `listDirectories` ignores `subPath`, `readText` uses `${base}/${path}` instead of `${base}/file/${path}`, etc.

- [ ] **Step 4: Rewrite `demos/shared/src/fetch-adapter.ts`**

Replace the contents with:

```ts
import type { StorageAdapter } from '@introspection/read'

/**
 * Creates a StorageAdapter that fetches data over HTTP from a server that
 * exposes the @introspection/serve protocol:
 *
 *   GET <baseUrl>/dirs/<subPath?>  → JSON string[]
 *   GET <baseUrl>/file/<path>      → raw bytes
 *
 * `readJSON` parses client-side via `readText`, so the server never has to
 * know which extensions are JSON.
 *
 * @param baseUrl - URL prefix where the handler is mounted (e.g. `/_introspect`).
 */
export function createFetchAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')

  const adapter: StorageAdapter = {
    async listDirectories(subPath?: string) {
      const url = subPath ? `${base}/dirs/${subPath}` : `${base}/dirs/`
      const response = await fetch(url)
      if (!response.ok) return []
      return response.json()
    },

    async readText(path: string) {
      const response = await fetch(`${base}/file/${path}`)
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return response.text()
    },

    async readBinary(path: string) {
      const response = await fetch(`${base}/file/${path}`)
      if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },

    async readJSON<T = unknown>(path: string): Promise<T> {
      return JSON.parse(await adapter.readText(path)) as T
    },
  }

  return adapter
}
```

> Note: `readJSON` calls `adapter.readText(path)` (named binding) rather than `this.readText(path)` — `this` is unreliable when methods are destructured.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demos/shared && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS — all 8 fetch-adapter tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add demos/shared/src/fetch-adapter.ts demos/shared/test/fetch-adapter.test.ts demos/shared/vitest.config.ts demos/shared/package.json pnpm-lock.yaml
git commit -m "demos/shared: rewrite createFetchAdapter against the new wire protocol"
```

---

## Task 6: Solid-streaming SSE Vite plugin

**Files:**
- Create: `demos/solid-streaming/scripts/vite-plugin-sse.ts`

(No dedicated unit test — the existing solid-streaming demo test exercises SSE end-to-end and is un-skipped in Task 8.)

- [ ] **Step 1: Create the SSE Vite plugin**

Create `demos/solid-streaming/scripts/vite-plugin-sse.ts`:

```ts
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, watch as fsWatch } from 'fs'
import { resolve, join } from 'path'
import type { Plugin } from 'vite'

export interface IntrospectionServeSSEOptions {
  directory?: string
  /** URL path under which the SSE endpoint is mounted. Default '/__introspect/stream'. */
  prefix?: string
}

/**
 * Demo-local Vite plugin: serves Server-Sent Events tailing of `events.ndjson`
 * for the solid-streaming demo. Mounted alongside `introspectionServe()`.
 *
 *   GET <prefix>/<runId>/<traceId>/events
 *
 * Sends every existing line of `<runId>/<traceId>/events.ndjson` as an SSE
 * `data:` frame, then watches the file and sends new lines as they're written.
 * This logic used to live in @introspection/serve's createHandler; it moved
 * here when createHandler became a generic StorageAdapter transport (no
 * filesystem code, no fs.watch).
 */
export function introspectionServeSSE(options?: IntrospectionServeSSEOptions): Plugin {
  const prefix = options?.prefix ?? '/__introspect/stream'
  let resolvedDirectory: string

  return {
    name: 'introspection-serve-sse',

    configResolved(config) {
      resolvedDirectory = options?.directory
        ? resolve(options.directory)
        : resolve(config.root, '.introspect')
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith(prefix + '/')) return next()

        const tail = url.slice(prefix.length + 1)
        // Match: <runId>/<traceId>/events
        const match = tail.match(/^([^/]+)\/([^/]+)\/events(?:\?.*)?$/)
        if (!match) return next()
        const [, runId, traceId] = match

        const eventsPath = join(resolvedDirectory, runId, traceId, 'events.ndjson')
        if (!existsSync(eventsPath)) {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        // Send the existing content as SSE frames.
        const initial = readFileSync(eventsPath, 'utf-8')
        let position = statSync(eventsPath).size
        for (const line of initial.split('\n').filter((l) => l.trim())) {
          res.write(`data: ${line}\n\n`)
        }

        // Tail the file with fs.watch.
        const sendNew = () => {
          try {
            const stat = statSync(eventsPath)
            if (stat.size <= position) return
            const fd = openSync(eventsPath, 'r')
            const buffer = Buffer.alloc(stat.size - position)
            readSync(fd, buffer, 0, buffer.length, position)
            closeSync(fd)
            position = stat.size
            for (const line of buffer.toString('utf-8').split('\n').filter((l) => l.trim())) {
              res.write(`data: ${line}\n\n`)
            }
          } catch { /* file deleted or changed during read */ }
        }
        const watcher = fsWatch(eventsPath, (eventType) => {
          if (eventType === 'change') sendNew()
        })

        req.on('close', () => watcher.close())
      })
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd demos/solid-streaming && pnpm exec tsc --noEmit`
Expected: typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add demos/solid-streaming/scripts/vite-plugin-sse.ts
git commit -m "demos/solid-streaming: add SSE Vite plugin (relocated from @introspection/serve)"
```

---

## Task 7: Wire the SSE plugin into the solid-streaming demo

**Files:**
- Modify: `demos/solid-streaming/vite.config.ts`, `demos/solid-streaming/src/App.tsx`

- [ ] **Step 1: Wire the plugin into `vite.config.ts`**

Replace the contents of `demos/solid-streaming/vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { introspectionServe } from '@introspection/demo-shared/vite-plugin'
import { introspectionServeSSE } from './scripts/vite-plugin-sse.js'

export default defineConfig({
  plugins: [solid(), introspectionServe(), introspectionServeSSE()],
  server: {
    port: 5177,
    strictPort: true,
  },
})
```

- [ ] **Step 2: Update `App.tsx` to resolve runId explicitly and build the new SSE URL**

In `demos/solid-streaming/src/App.tsx`, change the imports and the trace/URL resolution.

Locate the existing import line `import { createTraceReader } from "@introspection/read";` and replace it with:

```tsx
import { createTraceReader, listRuns, listTraces } from "@introspection/read";
```

Locate the existing `createTraceReader(adapter, { verbose: VERBOSE })` call (around line 53 today) and replace the surrounding block that resolves the trace so the app tracks `runId` alongside `traceId`. Replace the block that assigns the trace promise/signal with:

```tsx
// Resolve latest run + latest trace up front so we have runId for the SSE URL.
const traceContext = (async () => {
  const runs = await listRuns(adapter);
  if (runs.length === 0) return null;
  const runId = runs[0].id;
  const traces = await listTraces(adapter, runId);
  if (traces.length === 0) return null;
  const traceId = traces[0].id;
  const reader = await createTraceReader(adapter, { runId, traceId, verbose: VERBOSE });
  return { runId, traceId, reader };
})();
```

…and update the existing `useEventSource(...)` call to use the new URL shape and `runId`:

```tsx
const { status } = useEventSource(
  () => props.trace ? `/__introspect/stream/${props.runId}/${props.trace.id}/events` : null,
  () => props.trace,
);
```

Wherever the component reads `props.trace`, surface the new `props.runId` from the resolved context. This is a small structural edit; do it by making the consuming component accept `runId: string | undefined` alongside the existing `trace` prop, sourced from `traceContext`.

> The exact prop-plumbing depends on the current `App.tsx` structure; the principle is: resolve `{ runId, traceId, reader }` up front, then thread `runId` through to wherever the SSE URL is built.

- [ ] **Step 3: Typecheck**

Run: `cd demos/solid-streaming && pnpm exec tsc --noEmit`
Expected: typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add demos/solid-streaming/vite.config.ts demos/solid-streaming/src/App.tsx
git commit -m "demos/solid-streaming: mount the SSE plugin and use the new /stream/ URL"
```

---

## Task 8: Un-skip and tighten the four HTTP-demo tests

**Files:**
- Modify: `demos/vanilla-basic/test/demo.spec.ts`, `demos/wc-graph/test/demo.spec.ts`, `demos/react-trace-list/test/demo.spec.ts`, `demos/solid-streaming/scripts/streaming.spec.ts`

- [ ] **Step 1: Un-skip `demos/vanilla-basic/test/demo.spec.ts`**

Remove the `// SKIPPED: blocked on Spec C` comment block (lines just above the test) and change `test.skip(` back to `test(`. The vanilla-basic test today is already strict (it checks `#timeline .event` is visible) — no tightening needed.

- [ ] **Step 2: Un-skip and **tighten** `demos/wc-graph/test/demo.spec.ts`**

Remove the `// SKIPPED: blocked on Spec C` comment block, change `test.skip(` → `test(`. **Tighten** the assertions: today the test only checks that the `<select>` has at least one option; add an assertion that the captured trace's id appears as an option. After the existing `expect(await options.count()).toBeGreaterThan(0)` line, append:

```ts
  // Tighten: verify the captured trace id is actually surfaced
  const captured = handle.trace.id
  const optionTexts = await options.allTextContents()
  expect(optionTexts.some(t => t.includes(captured))).toBe(true)
```

- [ ] **Step 3: Un-skip and **tighten** `demos/react-trace-list/test/demo.spec.ts`**

Remove the `// SKIPPED: blocked on Spec C` comment block, change `test.skip(` → `test(`. **Tighten:** the current `expect(page.locator('body')).toContainText(/Traces|No traces/, ...)` matches both the success and the empty paths. Replace that line with:

```ts
  // Tighten: verify the captured trace id is actually rendered (not "No traces")
  await expect(page.locator('body')).toContainText(handle.trace.id, { timeout: 10000 })
```

(`handle` is the `attachRun` return; `handle.trace.id` is the captured trace's id.)

- [ ] **Step 4: Un-skip `demos/solid-streaming/scripts/streaming.spec.ts`**

Remove the `// SKIPPED: blocked on Spec C` comment block and change `test.skip(` back to `test(`. The streaming test today is already strict (it checks `.event` selectors visible, event count > 0, detail panel after click).

- [ ] **Step 5: Build everything so demos resolve their workspace deps**

Run: `pnpm build` from the repo root.
Expected: build succeeds.

- [ ] **Step 6: Run the demo tests**

Run: `pnpm exec turbo test --filter './demos/**'`
Expected: PASS — all 5 demo `#test` tasks (static-report, vanilla-basic, wc-graph, react-trace-list, solid-streaming).

- [ ] **Step 7: Run the full workspace test**

Run: `pnpm exec turbo test`
Expected: PASS — all 52 tasks.

- [ ] **Step 8: Commit**

```bash
git add demos/vanilla-basic/test/demo.spec.ts demos/wc-graph/test/demo.spec.ts demos/react-trace-list/test/demo.spec.ts demos/solid-streaming/scripts/streaming.spec.ts
git commit -m "demos: un-skip the four HTTP-demo tests (tighten wc-graph + react-trace-list)"
```

---

## Task 9: Update the remote-trace-CLI spec's Spec C bullet

**Files:**
- Modify: `docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md`

The Spec C bullet in the Sequencing section was a rough outline written before Spec B was implemented; it still says "Two-level routing: GET / → runs (with metadata), GET /<run>/ → traces" — which is contradicted by the generic-protocol decision in the actual Spec C spec.

- [ ] **Step 1: Update the bullet**

In `docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md`, locate the Spec C bullet (around line 106 — `Spec C — createHandler whole-tree + storage-agnostic`) and replace its three "create/Two-level/SSE/new demo/MUST also" sub-bullets with the actual shape now spec'd:

```
Spec C — createHandler as a generic StorageAdapter-over-HTTP transport
  · createHandler({ adapter }) — async, no filesystem code, no trace
    vocabulary; just two URL verbs: GET <prefix>/dirs/<subPath> →
    adapter.listDirectories(subPath); GET <prefix>/file/<path> →
    adapter.readBinary(path). readText/readJSON parse client-side.
  · Traversal protection pushed down into createNodeAdapter
    (TraversalError; handler maps to 403).
  · serve({ directory }) keeps the convenience by building a node adapter
    internally; demos/shared/introspectionServe likewise.
  · SSE leaves @introspection/serve entirely and moves into a
    solid-streaming-only Vite plugin (GET /__introspect/stream/<run>/
    <trace>/events).
  · Also fixes demos/shared/fetch-adapter.ts (listDirectories honours
    subPath; reads hit /file/...) and un-skips the four HTTP-demo tests,
    tightening the weak ones (wc-graph + react-trace-list).
  · Full design: docs/superpowers/specs/2026-05-15-storage-agnostic-
    createhandler-design.md.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md
git commit -m "docs(specs): update remote-trace-CLI's Spec C bullet to match the landed design"
```

---

## Self-Review

**Spec coverage:**
- Generic `StorageAdapter`-over-HTTP transport with verb-prefix URLs → Task 2. ✓
- `{ adapter }` clean-break signature, async, buffered reads, no SSE/semantic endpoints → Task 2. ✓
- Traversal guard in `createNodeAdapter` (`TraversalError`, `safeJoin`) → Task 1. ✓
- Handler maps `TraversalError` → `403`; missing-file → `404`; unknown verb → `404`; prefix mismatch → `null` → Task 2 (test cases + implementation). ✓
- `serve()` keeps `{ directory }` convenience via `createNodeAdapter` → Task 3. ✓
- `demos/shared` `introspectionServe` Vite plugin updated → Task 4. ✓
- `createFetchAdapter` rewritten against the new wire protocol; `listDirectories(subPath?)` honoured → Task 5. ✓
- SSE relocated to a solid-streaming-only Vite plugin serving `/<prefix>/stream/<run>/<trace>/events` → Tasks 6 + 7. ✓
- Un-skip the four HTTP-demo tests; tighten wc-graph + react-trace-list → Task 8. ✓
- Out-of-scope items (auth, CORS, streaming, symlink-following, fetch-adapter promotion to `@introspection/serve/client`) — confirmed not addressed; left for Spec D / future. ✓

**Placeholder scan:** Task 7's prop-plumbing description ("the principle is: resolve `{ runId, traceId, reader }` up front, then thread `runId` through to wherever the SSE URL is built") is the one place the plan trusts the engineer to apply a clear principle rather than handing them line-numbered edits — `App.tsx`'s exact structure is enough in flux relative to the spec that exact line edits would be fragile. The principle is concrete and the verifying test (Task 8 streaming step) catches a wrong implementation.

**Type consistency:** `TraversalError` defined in Task 1, exported from `@introspection/read/index.js`, recognised by `name` in the handler (Task 2) and used in the handler test (Task 2). `ServeOptions = { adapter, prefix? }` defined in Task 2 step 4, consumed by `createHandler` (Task 2 step 6) and by `serve()` (Task 3). `NodeServeOptions = { directory, port, host?, prefix? }` defined in Task 2 step 4, consumed by `serve()` (Task 3). `IntrospectionServeOptions = { directory?, prefix? }` defined in Task 4. `IntrospectionServeSSEOptions = { directory?, prefix? }` defined in Task 6. `createFetchAdapter(baseUrl)` returns `StorageAdapter` (Task 5).
