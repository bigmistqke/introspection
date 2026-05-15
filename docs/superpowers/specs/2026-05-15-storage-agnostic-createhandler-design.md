# Storage-Agnostic `createHandler` — Design

> **Status:** landed (2026-05-15) · plan: `docs/superpowers/plans/2026-05-15-storage-agnostic-createhandler.md`

Make `@introspection/serve`'s `createHandler` a generic transport that exposes
any `StorageAdapter` over HTTP, so the HTTP-served `read` path can navigate
the `<run-id>/<trace-id>/` hierarchy established by Spec B. The handler
loses its filesystem and trace-vocabulary knowledge; `@introspection/read`
does all interpretation on top — the same layering Spec B set up locally.

> **Position.** This is **Spec C** of the remote-trace-CLI chain
> (`2026-05-14-remote-trace-cli-design.md`, Sequencing): A ✓ → B ✓ → **C** →
> D. Spec B made `read` hierarchy-aware locally; it also pushed the four
> HTTP-served demos (vanilla-basic, wc-graph, react-trace-list,
> solid-streaming) into a `test.skip` state because today's `createHandler`
> is flat and can't serve the hierarchy. This spec lands the HTTP-side fix
> and un-skips them.

## Why

`createHandler` today (`packages/serve/src/handler.ts`) is **sync**, does raw
`fs` calls, and exposes a **semantic** vocabulary: `GET /` → top-level dirs,
`GET /:trace/meta.json`, `GET /:trace/events.ndjson`,
`GET /:trace/events` (parsed JSON), `GET /:trace/events?sse` (live SSE),
`GET /:trace/assets/...`. It is **flat**: `GET /<run>/<trace>/meta.json`
404s because the handler treats `<run>` as the trace segment and the rest
matches no branch.

`@introspection/read` (post-Spec B) reads via `StorageAdapter`'s four methods
— `listDirectories(subPath?)`, `readText(path)`, `readBinary(path)`,
`readJSON(path)` — across `<run>/<trace>/...` paths. It needs an
`HTTP`-backed `StorageAdapter` (`createFetchAdapter`) whose calls reach a
handler that serves the same four operations against the same path space.

Today's handler can't do that. This spec makes it do exactly that — and
nothing more.

## Scope

**In scope:**

- `@introspection/serve`'s `createHandler` becomes a generic
  `StorageAdapter`-over-HTTP transport with two URL verbs (`dirs/`, `file/`).
  Clean-break signature: `createHandler({ adapter, prefix })`. Async.
  Buffers reads. No SSE, no `meta.json`/`events.ndjson`/`events`/`assets/*`
  knowledge.
- Path-traversal protection in `createNodeAdapter` itself (defense in depth):
  every method validates that the resolved target stays inside the base
  directory and throws `TraversalError` otherwise. The handler maps that to
  `403`.
- `serve()` node helper keeps the `{ directory }` convenience by building a
  node adapter internally. The demo `introspectionServe` Vite plugin (in
  `demos/shared`) does the same.
- `demos/shared/src/fetch-adapter.ts` rewritten against the new wire
  protocol; `listDirectories` honours `subPath` (its current ignoring of it
  is the silent bug Spec B's review missed).
- SSE / live-tailing leaves `@introspection/serve` entirely and moves into
  the solid-streaming demo as a separate Vite plugin
  (`demos/solid-streaming/scripts/vite-plugin-sse.ts`), serving
  its own URL (`GET /_introspect/stream/<run>/<trace>/events`). The
  solid-streaming demo's `useEventSource` is updated to the new URL.
- The four currently-skipped HTTP-demo tests are un-skipped, **and tightened
  where they're weak**: the wc-graph and react-trace-list tests today only
  check UI elements render and "passed" against broken data; each must
  additionally verify a captured event surfaces in the rendered output.

**Out of scope:**

- Promoting `createFetchAdapter` into `@introspection/serve/client` as a
  public `createHttpReadAdapter` — that is Spec D, alongside `introspect
  --url` / `--ci`. This spec keeps the fetch adapter inside `demos/shared`
  but makes it correct against the new protocol.
- Auth, CORS, rate-limiting. The reference target serves traces on an
  internal network; add middleware around `createHandler` if/when needed.
- Streaming-large-read endpoints — `readBinary` buffers (decision from the
  earlier genericization brainstorm; events files are not pathologically
  large in normal use). A `readStream` method is a follow-up if profiling
  ever justifies it.
- Symlink-following safety. The traversal guard rejects path strings that
  escape; it does not `realpath` to detect symlinks inside the base
  pointing outward. The writer (introspection itself) controls `.introspect/`
  contents, so the attack surface is narrow. Documented limit.

## Architecture

```
                StorageAdapter (4 methods, async)
                          │
   ┌──────────────────────┼──────────────────────┐
   ▼                      ▼                      ▼
 ad-hoc capture     remote read           future S3, …
 (local fs)         (over HTTP)
                          │
                  createFetchAdapter (a StorageAdapter; demo)
                          │
                          ▼
              ┌─────────────────────────────┐
              │  @introspection/serve        │
              │  createHandler({ adapter })  │
              │  exposes any StorageAdapter  │
              │  over HTTP                   │
              └──────────────┬───────────────┘
                             │
                  served from any StorageAdapter
                  (default mounting: createNodeAdapter(dir))
```

Layering, parallel to Spec B:

- **`@introspection/types`** — `StorageAdapter` (unchanged from Spec B).
- **`@introspection/read`** — `createNodeAdapter`, `createMemoryReadAdapter`,
  and the run/trace interpretation layer (`listRuns`, `listTraces`,
  `createTraceReader`). The traversal guard ships here, inside
  `createNodeAdapter`.
- **`@introspection/serve`** — `createHandler({ adapter })`. Generic
  transport. No filesystem code outside what flows through the adapter. New
  workspace dep: `@introspection/read` (for `createNodeAdapter`, consumed by
  the `serve()` and `introspectionServe` convenience wrappers). No cycle —
  `read` does not depend on `serve`.
- **`@introspection/cli`** — unchanged externally; its `introspect serve`
  command uses `serve({ directory })` whose internals migrate.
- **`demos/shared`** — `introspectionServe` Vite plugin updated to the new
  handler; `fetch-adapter` rewritten against the new protocol.
- **`demos/solid-streaming`** — gains its own SSE Vite plugin alongside
  `introspectionServe`.

## The wire protocol

Two URL verbs under the configured `prefix` (default `/_introspect`):

| URL | Adapter call | Returns |
|---|---|---|
| `GET <prefix>/dirs/` | `adapter.listDirectories()` | `200 application/json` — `string[]` |
| `GET <prefix>/dirs/<subPath>` | `adapter.listDirectories(subPath)` | `200 application/json` — `string[]` |
| `GET <prefix>/file/<path>` | `adapter.readBinary(path)` | `200 <type-from-extension>` — raw bytes |

`readText` and `readJSON` adapter methods both hit `GET /file/<path>` on the
client and parse client-side. The server returns bytes; the server does not
need to know whether the caller will parse JSON. `Content-Type` is derived
from path extension only (`.json` → `application/json`, `.ndjson` →
`application/x-ndjson`, `.png`/`.jpg`/`.jpeg` → `image/*`, else
`application/octet-stream`). The body is the file's raw bytes.

**Errors:**

| Condition | Status | Body |
|---|---|---|
| URL doesn't start with `<prefix>/dirs/` or `<prefix>/file/` | handler returns `null` (host server passes to next middleware — matches today) | — |
| Path escapes the adapter's base directory (`TraversalError`) | `403 Forbidden` | `{ "error": "Forbidden" }` |
| `listDirectories` on a path that doesn't exist | `200` | `[]` (matches `createNodeAdapter`'s graceful behaviour today) |
| `read*` on a file that doesn't exist | `404 Not Found` | `{ "error": "Not found" }` |
| Adapter throws unexpectedly | `500 Internal Server Error` | `{ "error": <message> }` |

## `createHandler`

```ts
import type { StorageAdapter } from '@introspection/types'

export interface ServeOptions {
  adapter: StorageAdapter
  prefix?: string                 // default '/_introspect'
}

export function createHandler(
  options: ServeOptions,
): (request: { url: string }) => Promise<Response | null>
```

Behaviour:

1. If `request.url` doesn't start with `prefix` → `null`.
2. Strip `prefix` from the URL. Match leading segment:
   - `dirs` → call `adapter.listDirectories(rest || undefined)`, return
     `200 application/json` with the array.
   - `file` → call `adapter.readBinary(rest)`, return `200
     <content-type-from-extension>` with the bytes.
   - anything else → `404 Not Found`.
3. Catch `TraversalError` → `403`. Catch a "missing file" error from the
   adapter (treat any throw on `readBinary` as `404` — adapters throw on
   missing files today; we standardise on that) → `404`. Other throws →
   `500`.
4. The handler does no filesystem operations itself; every byte and every
   directory name flows through the adapter.

Async because the adapter is async. Two in-repo consumers (`serve()` and the
demo Vite plugin) migrate to `await handler(request)`; both already
`async`-iterate the response body, so the await is small.

## Security: traversal guard in `createNodeAdapter`

The guard lives in `@introspection/read/node`, not in `@introspection/serve`,
so every consumer of `createNodeAdapter` — present and future — is protected
without relying on a guard one layer up.

```ts
import { resolve, sep } from 'path'

export class TraversalError extends Error {
  readonly name = 'TraversalError'
}

function safeJoin(base: string, sub: string): string {
  const baseResolved = resolve(base)
  const target = resolve(baseResolved, sub)
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new TraversalError(`Path '${sub}' escapes base directory`)
  }
  return target
}
```

Every `createNodeAdapter` method routes its incoming path string through
`safeJoin` before any `fs` call. Coverage:

- Literal `..` segments — `resolve` normalises them; `startsWith` rejects when
  the resolved path escapes the base.
- URL-encoded segments like `%2e%2e` are NOT decoded by `resolve` and are
  treated as literal directory names; they cannot reach a parent directory via
  the file system. The subsequent `fs` call against a path containing `%2e%2e`
  returns `ENOENT` (graceful `[]` for `listDirectories`, throw for reads which
  the handler maps to `404`). No `TraversalError` is thrown, but no escape
  occurs either.
- Absolute-path overrides (`/etc/passwd`) — `resolve(base, '/etc/passwd')`
  returns the absolute path; `startsWith(base + sep)` rejects.
- Empty segments, double slashes — normalised by `resolve` to no-ops.

**Documented limit (out of scope):** symlinks inside the base directory
pointing outward are not detected (would require `realpath` per read,
non-trivial cost). The trace writer controls `.introspect/` contents; this
is an acceptable narrow surface for the threat model.

`createHandler` recognises `TraversalError` (by `name`) and returns `403`.
The memory adapter does not need a guard — no filesystem to escape.

## `serve()` node helper

```ts
// @introspection/serve/node
import { createNodeAdapter } from '@introspection/read/node'
import { createHandler } from './index.js'

export function serve(options: {
  directory: string
  port: number
  host?: string
  prefix?: string
}): Server {
  const handler = createHandler({
    adapter: createNodeAdapter(options.directory),
    prefix: options.prefix,
  })
  const server = createServer(async (req, res) => {
    const response = await handler({ url: req.url ?? '' })
    if (response === null) { res.statusCode = 404; res.end('Not found'); return }
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    if (response.body) for await (const chunk of response.body) res.write(Buffer.from(chunk))
    res.end()
  })
  server.listen(options.port, options.host ?? '0.0.0.0', () => {
    console.log(`Serving introspection traces at http://${options.host ?? '0.0.0.0'}:${options.port}${options.prefix ?? '/_introspect'}`)
  })
  return server
}
```

External API unchanged from today (`{ directory, port, host?, prefix? }`).

## The demo Vite plugin `introspectionServe`

`demos/shared/src/vite-plugin.ts` migrates the same way: keeps
`{ directory?, prefix? }`, internally uses
`createHandler({ adapter: createNodeAdapter(resolvedDirectory), prefix })`,
and its `configureServer` middleware does `await handler(...)`.

## SSE — relocated to the solid-streaming demo

`@introspection/serve` loses everything SSE-related: the `events?sse`
branch, the `fs.watch` / `openSync` / `readSync` / `closeSync` imports.

The solid-streaming demo gets its own Vite plugin —
`demos/solid-streaming/scripts/vite-plugin-sse.ts` — that registers an SSE
endpoint. URL shape, consistent with the verb-prefix style:

```
GET /_introspect/stream/<runId>/<traceId>/events
```

The plugin owns the `fs.watch` + position-tracking logic that today lives in
`packages/serve/src/handler.ts`. `demos/solid-streaming/vite.config.ts`
mounts both plugins:

```ts
plugins: [
  solid(),
  introspectionServe(),         // generic protocol — /dirs/, /file/
  introspectionServeSSE(),      // solid-streaming-specific — /stream/
]
```

The solid-streaming `useEventSource` hook's URL is updated to the new shape.
Other demos do not get SSE; they do not need it.

## `createFetchAdapter` (demos/shared) rewrite

```ts
import type { StorageAdapter } from '@introspection/read'

export function createFetchAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')
  return {
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
      return JSON.parse(await this.readText(path)) as T
    },
  }
}
```

Two notable points relative to today:

- `listDirectories` accepts `subPath` (its current ignoring of it is the
  silent bug Spec B's review missed).
- `readJSON` parses client-side via `readText`, so the server never has to
  know which extensions are JSON.

## Un-skip the four HTTP-demo tests

Remove `test.skip` → `test` and the `// SKIPPED: blocked on Spec C` comment
block in:

- `demos/vanilla-basic/test/demo.spec.ts`
- `demos/wc-graph/test/demo.spec.ts`
- `demos/react-trace-list/test/demo.spec.ts`
- `demos/solid-streaming/scripts/streaming.spec.ts`

**Tighten the weak ones.** Today the wc-graph and react-trace-list tests
only check that UI elements render — they "passed" while the data layer was
silently broken. Each must additionally verify a captured event reaches the
rendered output:

- `wc-graph`: assert that the `<select>` contains an option for the just-
  captured trace id (not just that the select has at least one option).
- `react-trace-list`: assert that the page renders a trace card for the
  just-captured trace id (not just that the body contains the word
  "Traces" — that string also appears in the "No traces" path).

The vanilla-basic and solid-streaming tests are already strict enough.

## Testing

- **`createHandler`** — vitest in `@introspection/serve`, against a memory
  adapter (no fs):
  - prefix mismatch → `null`
  - `GET /dirs/` → calls `adapter.listDirectories(undefined)`, returns the
    array as JSON
  - `GET /dirs/<sub>` → calls `adapter.listDirectories('<sub>')`, returns
    the array
  - `GET /file/<path>` → calls `adapter.readBinary('<path>')`, returns
    bytes with the right `Content-Type`
  - unknown verb (`/_introspect/garbage`) → `404`
  - adapter throws `TraversalError` → `403`
  - adapter throws "missing file" on `readBinary` → `404`
  - adapter throws unexpectedly → `500`
- **`createNodeAdapter` traversal guards** — new tests in
  `@introspection/read`. For each of the four methods, attempts with `..`
  segments, an absolute-path string, and a URL-decoded `..` (`%2e%2e`)
  throw `TraversalError`. Existing node-adapter tests stay green.
- **`serve()` node helper** — integration test in `@introspection/serve`:
  spin up `serve()` on an ephemeral port pointed at a fixture directory,
  fetch through it, assert listing + read work end-to-end.
- **`createFetchAdapter`** — unit tests in `demos/shared` (or wherever
  convenient) against a mocked `fetch`: assert `listDirectories(subPath)`
  hits `/dirs/<subPath>`, reads hit `/file/<path>`, error statuses surface
  the right way.
- **Solid-streaming SSE plugin** — keep the existing solid-streaming demo
  test as the end-to-end verification; it already exercises SSE.
- **The four un-skipped demos** — they are integration coverage for
  everything above stitched together. Tightening the weak ones closes the
  silent-pass loophole.

## Out of scope (cross-reference)

- **`createHttpReadAdapter` as a public `@introspection/serve/client`
  export** — Spec D
  (`docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md`).
- **`introspect --url` / `--ci` / `resolveRun`** — Spec D.
- **Auth / CORS / rate-limiting / TLS** — host-server concern.
- **Streaming large reads** — buffered for now; revisit only if profiling
  justifies a `readStream` adapter method.
- **Symlink-following safety** — documented limit in §"Security".
