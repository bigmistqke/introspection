# Remote Trace CLI Implementation Plan

> **Status:** landed (2026-05-15) · spec: `docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `introspect` read traces over HTTP from a server mounting `@introspection/serve`'s `createHandler`, by promoting the demo's `createFetchAdapter` into a published `createHttpReadAdapter` and replacing the CLI's `--dir <path>` with a single `--base <pathOrUrl>` flag whose value discriminates by URL scheme.

**Architecture:**
- `createHttpReadAdapter(baseUrl)` ships from `@introspection/serve/client`, speaking the Spec C verb-prefix protocol (`/dirs/<sub>`, `/file/<path>`) — the same protocol the local viewer fetches.
- The CLI parses one top-level `--base` flag: contains `://` → URL (only `http(s)://` accepted) → HTTP adapter; anything else → filesystem path → `createNodeAdapter`. The parsed adapter flows into every read command; the write-side commands (`debug`, `serve`) accept only the path form.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, commander.js, `fetch` (Node 18+ global), `tsup` for builds.

**Spec:** `docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md`

---

## File Structure

**New files**
- `packages/serve/src/client.ts` — exports `createHttpReadAdapter`. Implements `StorageAdapter` from `@introspection/types` over `fetch` against `createHandler`'s `/dirs/`/`/file/` verbs. Throws on `listDirectories` non-OK (the spec's resolved decision point — the demo's `[]` behaviour is a demo affordance only).
- `packages/serve/src/__tests__/client.test.ts` — unit tests for `createHttpReadAdapter` (per-method behaviour, base-URL normalization, error cases).
- `packages/serve/src/__tests__/equivalence.test.ts` — equivalence: a `TraceReader` built on `createHttpReadAdapter` reads the same data as one built on `createNodeAdapter` over the same fixture, with `fetch` stubbed to delegate into `createHandler` (no real network).
- `packages/cli/src/base.ts` — pure parser `parseBase(value)` returning a discriminated `ParsedBase` union; `createAdapterFromBase(value)` for read commands.
- `packages/cli/test/base.test.ts` — unit tests for `parseBase` (path vs URL discrimination, unsupported scheme errors, default).

**Modified files**
- `packages/serve/package.json` — add `./client` export.
- `packages/types/src/index.ts` — add `base?: string` to `IntrospectConfig`.
- `packages/cli/src/index.ts` — replace top-level `--dir` with `--base`; route read commands through `createAdapterFromBase`; `debug`/`serve` actions reject URL form.
- `packages/cli/test/integration.test.ts` — `--dir` → `--base` in the five existing call sites.
- `packages/cli/README.md` — document `--base`.
- Demo importers — `demos/react-trace-list/src/App.tsx`, `demos/wc-graph/src/main.ts`, `demos/vanilla-basic/src/main.ts`, `demos/solid-streaming/src/App.tsx`: change `import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'` → `import { createHttpReadAdapter } from '@introspection/serve/client'` and the call site.
- `demos/shared/package.json` — drop the `./fetch-adapter` export.

**Deleted files**
- `demos/shared/src/fetch-adapter.ts`
- `demos/shared/test/fetch-adapter.test.ts`

---

## Task 1: `createHttpReadAdapter` in `@introspection/serve/client`

Promote the demo's `createFetchAdapter` into `@introspection/serve` under the `./client` subpath. The implementation is mostly the demo's, with two changes:
- `StorageAdapter` is imported from `@introspection/types` (not `@introspection/read`).
- `listDirectories` on non-OK **throws** rather than returning `[]` (spec §Error handling).

**Files:**
- Create: `packages/serve/src/client.ts`
- Create: `packages/serve/src/__tests__/client.test.ts`
- Modify: `packages/serve/package.json` (add `./client` to `exports` and to the `tsup` build entries)

- [ ] **Step 1: Write the failing test**

Create `packages/serve/src/__tests__/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpReadAdapter } from '../client.js'

const calls: Array<string> = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      if (url.endsWith('/dirs/')) return new Response(JSON.stringify(['run-a']), { status: 200 })
      if (url.endsWith('/dirs/run-a')) return new Response(JSON.stringify(['trace-1']), { status: 200 })
      if (url.endsWith('/file/run-a/trace-1/meta.json')) return new Response('{"id":"trace-1"}', { status: 200 })
      if (url.endsWith('/file/missing')) return new Response('not found', { status: 404 })
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createHttpReadAdapter', () => {
  it('listDirectories() hits /dirs/', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.listDirectories()).toEqual(['run-a'])
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })

  it('listDirectories(subPath) hits /dirs/<subPath>', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.listDirectories('run-a')).toEqual(['trace-1'])
    expect(calls).toEqual(['https://h/_introspect/dirs/run-a'])
  })

  it('readText hits /file/<path>', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.readText('run-a/trace-1/meta.json')).toBe('{"id":"trace-1"}')
    expect(calls).toEqual(['https://h/_introspect/file/run-a/trace-1/meta.json'])
  })

  it('readJSON parses client-side via readText', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    expect(await adapter.readJSON('run-a/trace-1/meta.json')).toEqual({ id: 'trace-1' })
  })

  it('readBinary returns a Uint8Array', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    const bytes = await adapter.readBinary('run-a/trace-1/meta.json')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('{"id":"trace-1"}')
  })

  it('listDirectories THROWS on a non-OK response (resolved decision, not [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const adapter = createHttpReadAdapter('https://h/_introspect')
    await expect(adapter.listDirectories()).rejects.toThrow(/listDirectories.*404/)
  })

  it('read* throws on a non-OK response', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect')
    await expect(adapter.readText('missing')).rejects.toThrow(/Failed to fetch missing: 404/)
  })

  it('strips a trailing slash from baseUrl', async () => {
    const adapter = createHttpReadAdapter('https://h/_introspect/')
    await adapter.listDirectories()
    expect(calls).toEqual(['https://h/_introspect/dirs/'])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
pnpm --filter @introspection/serve test
```
Expected: failure with "Cannot find module '../client.js'" (or similar resolution error).

- [ ] **Step 3: Add the `./client` export to `packages/serve/package.json`**

Edit `packages/serve/package.json` so `exports` reads:

```json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "import": "./dist/index.js"
  },
  "./node": {
    "types": "./src/node.ts",
    "import": "./dist/node.js"
  },
  "./client": {
    "types": "./src/client.ts",
    "import": "./dist/client.js"
  }
}
```

And update the build script so `tsup` emits the new entry:

```json
"build": "tsup src/index.ts src/node.ts src/client.ts --format esm --dts"
```

- [ ] **Step 4: Implement `createHttpReadAdapter`**

Create `packages/serve/src/client.ts`:

```ts
import type { StorageAdapter } from '@introspection/types'

/**
 * Creates a StorageAdapter that reads trace data over HTTP from a server
 * mounting @introspection/serve's createHandler. Uses the verb-prefix protocol:
 *
 *   GET <base>/dirs/<subPath?>  → JSON string[]
 *   GET <base>/file/<path>      → raw bytes
 *
 * readJSON parses client-side via readText.
 *
 * On a non-OK response, every method throws — including listDirectories, which
 * does NOT swallow errors as `[]`. A wrong --base must surface as an error,
 * not as "no traces found".
 *
 * @param baseUrl - URL prefix where the handler is mounted
 *                  (e.g. https://ci.example/_introspect). A trailing slash is stripped.
 */
export function createHttpReadAdapter(baseUrl: string): StorageAdapter {
  const base = baseUrl.replace(/\/$/, '')

  const adapter: StorageAdapter = {
    async listDirectories(subPath?: string) {
      const url = subPath ? `${base}/dirs/${subPath}` : `${base}/dirs/`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`listDirectories(${JSON.stringify(subPath)}) failed: ${response.status} from ${url}`)
      }
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

- [ ] **Step 5: Run the test and confirm it passes**

Run:
```bash
pnpm --filter @introspection/serve test
```
Expected: all `createHttpReadAdapter` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/serve/src/client.ts packages/serve/src/__tests__/client.test.ts packages/serve/package.json
git commit -m "feat(serve): add createHttpReadAdapter at @introspection/serve/client

Promotes the demo's createFetchAdapter. Implements StorageAdapter over
the Spec C verb-prefix protocol. listDirectories throws on non-OK so a
wrong --base surfaces as an error, not 'no traces found'."
```

---

## Task 2: Equivalence test — HTTP adapter ≡ node adapter

Prove the new HTTP adapter reads the same data as the filesystem adapter when served by `createHandler`. Use `fetch` stubbed to dispatch into `createHandler` directly (no socket). Two `TraceReader`s, one fixture, identical output.

**Files:**
- Create: `packages/serve/src/__tests__/equivalence.test.ts`
- Reuse fixture: `packages/serve/src/__tests__/fixtures/introspect/`

- [ ] **Step 1: Inspect the existing fixture**

Run:
```bash
ls packages/serve/src/__tests__/fixtures/introspect/
cat packages/serve/src/__tests__/fixtures/introspect/session-1/meta.json
```
Expected: a `session-1/` directory with `meta.json` and `events.ndjson`. If the fixture lacks a `<run-id>/<trace-id>/` two-level hierarchy (older Spec B fixture), extend it in this step — create `run-1/` with the existing trace nested inside:

```bash
mkdir -p packages/serve/src/__tests__/fixtures/introspect/run-1
mv packages/serve/src/__tests__/fixtures/introspect/session-1 packages/serve/src/__tests__/fixtures/introspect/run-1/trace-1
# write run meta
cat > packages/serve/src/__tests__/fixtures/introspect/run-1/meta.json <<'EOF'
{"version":"1","id":"run-1","startedAt":1,"endedAt":2,"status":"passed"}
EOF
```

If the fixture is already two-level, skip the move.

- [ ] **Step 2: Write the failing test**

Create `packages/serve/src/__tests__/equivalence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createHandler } from '../index.js'
import { createNodeAdapter } from '@introspection/read/node'
import { createTraceReader, listRuns, listTraces } from '@introspection/read'
import { createHttpReadAdapter } from '../client.js'

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'introspect',
)

const PREFIX = '/_introspect'
const BASE = `http://localhost${PREFIX}`

beforeEach(() => {
  const nodeAdapter = createNodeAdapter(fixtureDir)
  const handler = createHandler({ adapter: nodeAdapter, prefix: PREFIX })

  // Stub global fetch: turn the URL into the request shape createHandler expects.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.startsWith('http://localhost') ? url.slice('http://localhost'.length) : url
    const response = await handler({ url: path })
    if (response === null) return new Response('', { status: 404 })
    return response
  }) as unknown as typeof globalThis.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createHttpReadAdapter ≡ createNodeAdapter through createHandler', () => {
  it('listRuns returns identical results', async () => {
    const fs = await listRuns(createNodeAdapter(fixtureDir))
    const http = await listRuns(createHttpReadAdapter(BASE))
    expect(http).toEqual(fs)
  })

  it('listTraces returns identical results for a run', async () => {
    const fsRuns = await listRuns(createNodeAdapter(fixtureDir))
    const runId = fsRuns[0].id
    const fs = await listTraces(createNodeAdapter(fixtureDir), runId)
    const http = await listTraces(createHttpReadAdapter(BASE), runId)
    expect(http).toEqual(fs)
  })

  it('createTraceReader.meta is identical', async () => {
    const fsRuns = await listRuns(createNodeAdapter(fixtureDir))
    const runId = fsRuns[0].id
    const fs = await createTraceReader(createNodeAdapter(fixtureDir), { runId })
    const http = await createTraceReader(createHttpReadAdapter(BASE), { runId })
    expect(http.meta).toEqual(fs.meta)
  })

  it('createTraceReader.events.ls() is identical', async () => {
    const fsRuns = await listRuns(createNodeAdapter(fixtureDir))
    const runId = fsRuns[0].id
    const fs = await createTraceReader(createNodeAdapter(fixtureDir), { runId })
    const http = await createTraceReader(createHttpReadAdapter(BASE), { runId })
    expect(await http.events.ls()).toEqual(await fs.events.ls())
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails or passes**

Run:
```bash
pnpm --filter @introspection/serve test equivalence
```
Expected: PASS. If it fails for fixture-hierarchy reasons, fix the fixture per Step 1 and re-run. No `createHttpReadAdapter` changes should be needed — the implementation from Task 1 already speaks the right protocol.

- [ ] **Step 4: Commit**

```bash
git add packages/serve/src/__tests__/equivalence.test.ts packages/serve/src/__tests__/fixtures/
git commit -m "test(serve): assert HTTP adapter equivalence with node adapter

A TraceReader built on createHttpReadAdapter returns the same listRuns,
listTraces, meta, and events as one built on createNodeAdapter, when
served through createHandler. fetch is stubbed to dispatch directly
into the handler — no real network."
```

---

## Task 3: Migrate demos to `@introspection/serve/client`

Four demo files import `createFetchAdapter` from `@introspection/demo-shared/fetch-adapter`. Switch them to `createHttpReadAdapter` from `@introspection/serve/client`.

**Files:**
- Modify: `demos/react-trace-list/src/App.tsx`
- Modify: `demos/wc-graph/src/main.ts`
- Modify: `demos/vanilla-basic/src/main.ts`
- Modify: `demos/solid-streaming/src/App.tsx`

- [ ] **Step 1: Update `demos/react-trace-list/src/App.tsx`**

Find the line:
```ts
import { createFetchAdapter } from '@introspection/demo-shared/fetch-adapter'
```
Replace with:
```ts
import { createHttpReadAdapter } from '@introspection/serve/client'
```
And the call site `createFetchAdapter(baseUrl)` → `createHttpReadAdapter(baseUrl)`.

- [ ] **Step 2: Update `demos/wc-graph/src/main.ts`**

Same swap: import path and call site `createFetchAdapter('/__introspect')` → `createHttpReadAdapter('/__introspect')`.

- [ ] **Step 3: Update `demos/vanilla-basic/src/main.ts`**

Same swap.

- [ ] **Step 4: Update `demos/solid-streaming/src/App.tsx`**

Same swap. The import is double-quoted here; preserve quote style.

- [ ] **Step 5: Add `@introspection/serve` to each demo's package.json if missing**

For each demo, check `demos/<demo>/package.json` `dependencies`:

```bash
for d in demos/react-trace-list demos/wc-graph demos/vanilla-basic demos/solid-streaming; do
  grep -q '@introspection/serve' "$d/package.json" || echo "MISSING in $d"
done
```

For any that print "MISSING", add `"@introspection/serve": "workspace:*"` to that demo's `dependencies`. Run `pnpm install` once at the end if any were added.

- [ ] **Step 6: Type-check each demo**

Run:
```bash
for d in demos/react-trace-list demos/wc-graph demos/vanilla-basic demos/solid-streaming; do
  echo "=== $d ===" && pnpm --filter "@introspection/$(basename $d)" typecheck 2>&1 | tail -5
done
```
(Filter name may need to match each demo's `package.json` `name` — adjust the filter if a demo's package name differs.)

Expected: each demo type-checks clean.

- [ ] **Step 7: Run demo tests as a smoke check**

Run:
```bash
pnpm -r test --filter './demos/*' 2>&1 | tail -20
```
Expected: demo tests still pass (the four HTTP-demo tests Spec C un-skipped should remain green).

- [ ] **Step 8: Commit**

```bash
git add demos/react-trace-list/ demos/wc-graph/ demos/vanilla-basic/ demos/solid-streaming/
git commit -m "demos: migrate to createHttpReadAdapter from @introspection/serve/client

Drop the @introspection/demo-shared/fetch-adapter import in favour of
the published adapter. Behaviour is identical except listDirectories
now throws on non-OK (was: returns []). Demo flows hit happy paths only."
```

---

## Task 4: Delete the demo `fetch-adapter`

Nothing imports `createFetchAdapter` anymore. Remove the file, its test, and its package export so future readers don't think there are two adapters.

**Files:**
- Delete: `demos/shared/src/fetch-adapter.ts`
- Delete: `demos/shared/test/fetch-adapter.test.ts`
- Modify: `demos/shared/package.json` (drop the `./fetch-adapter` export)

- [ ] **Step 1: Verify no remaining importers**

Run:
```bash
grep -rn "demo-shared/fetch-adapter\|fetch-adapter.js\|createFetchAdapter" \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  packages/ plugins/ demos/
```
Expected: no matches outside `demos/shared/` itself.

- [ ] **Step 2: Delete the files**

```bash
rm demos/shared/src/fetch-adapter.ts demos/shared/test/fetch-adapter.test.ts
```

- [ ] **Step 3: Drop the `./fetch-adapter` export from `demos/shared/package.json`**

Open `demos/shared/package.json` and remove the `"./fetch-adapter": { ... }` entry from `exports`. The `./vite-plugin` entry remains.

- [ ] **Step 4: Re-run the verification grep**

```bash
grep -rn "fetch-adapter" demos/ packages/ plugins/
```
Expected: no matches (or only inside `node_modules`).

- [ ] **Step 5: Type-check the workspace**

Run:
```bash
pnpm -r typecheck 2>&1 | tail -20
```
Expected: no errors related to the missing module.

- [ ] **Step 6: Commit**

```bash
git add demos/shared/
git commit -m "demos: drop the demo-local fetch-adapter

createFetchAdapter has moved to @introspection/serve/client as
createHttpReadAdapter. Its single implementation now lives next to
createHandler, where the protocol contract is maintained."
```

---

## Task 5: `parseBase` + `createAdapterFromBase` in the CLI (pure, not yet wired)

Adds the path-vs-URL discriminator that `--base` will use. Pure functions, tested in isolation; not yet hooked into the CLI program.

**Files:**
- Create: `packages/cli/src/base.ts`
- Create: `packages/cli/test/base.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/base.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'path'
import { parseBase, createAdapterFromBase } from '../src/base.js'

describe('parseBase', () => {
  it('defaults to ./.introspect when value is undefined', () => {
    expect(parseBase(undefined)).toEqual({ kind: 'path', path: resolve('./.introspect') })
  })

  it('treats a relative filesystem path as path (resolved)', () => {
    expect(parseBase('./traces')).toEqual({ kind: 'path', path: resolve('./traces') })
  })

  it('treats an absolute filesystem path as path', () => {
    expect(parseBase('/var/tmp/x')).toEqual({ kind: 'path', path: resolve('/var/tmp/x') })
  })

  it('treats http://... as URL', () => {
    expect(parseBase('http://h/_introspect')).toEqual({ kind: 'url', url: 'http://h/_introspect' })
  })

  it('treats https://... as URL', () => {
    expect(parseBase('https://h/_introspect')).toEqual({ kind: 'url', url: 'https://h/_introspect' })
  })

  it('throws on ftp:// (unsupported scheme)', () => {
    expect(() => parseBase('ftp://h/x')).toThrow(/Unsupported URL scheme.*ftp.*--base/)
  })

  it('throws on a typo like htttp:// (unsupported scheme)', () => {
    expect(() => parseBase('htttp://h/x')).toThrow(/Unsupported URL scheme.*htttp.*--base/)
  })

  it('treats a plain word without :// as a relative path', () => {
    expect(parseBase('foo')).toEqual({ kind: 'path', path: resolve('foo') })
  })
})

describe('createAdapterFromBase', () => {
  it('returns a StorageAdapter shape for a path', async () => {
    const adapter = createAdapterFromBase('./does-not-exist')
    expect(typeof adapter.listDirectories).toBe('function')
    expect(typeof adapter.readText).toBe('function')
    expect(typeof adapter.readBinary).toBe('function')
    expect(typeof adapter.readJSON).toBe('function')
  })

  it('returns a StorageAdapter shape for a URL', () => {
    const adapter = createAdapterFromBase('https://h/_introspect')
    expect(typeof adapter.listDirectories).toBe('function')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
pnpm --filter @introspection/cli test base
```
Expected: failure resolving `../src/base.js`.

- [ ] **Step 3: Implement `parseBase` and `createAdapterFromBase`**

Create `packages/cli/src/base.ts`:

```ts
import { resolve } from 'path'
import type { StorageAdapter } from '@introspection/types'
import { createNodeAdapter } from '@introspection/read/node'
import { createHttpReadAdapter } from '@introspection/serve/client'

export type ParsedBase =
  | { kind: 'path'; path: string }
  | { kind: 'url'; url: string }

const DEFAULT_BASE = './.introspect'

/**
 * Parse the value of --base (or `base` in introspect.config.ts) into a
 * tagged result. A value containing `://` is treated as a URL; only http://
 * and https:// are accepted, anything else throws. Any other value is a
 * filesystem path, resolved against process.cwd().
 */
export function parseBase(value: string | undefined): ParsedBase {
  const raw = value ?? DEFAULT_BASE
  if (!raw.includes('://')) {
    return { kind: 'path', path: resolve(raw) }
  }
  const scheme = raw.slice(0, raw.indexOf(':'))
  if (scheme !== 'http' && scheme !== 'https') {
    throw new Error(
      `Unsupported URL scheme '${scheme}' for --base; use http:// or https://`,
    )
  }
  return { kind: 'url', url: raw }
}

export function createAdapterFromBase(value: string | undefined): StorageAdapter {
  const parsed = parseBase(value)
  if (parsed.kind === 'path') return createNodeAdapter(parsed.path)
  return createHttpReadAdapter(parsed.url)
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
pnpm --filter @introspection/cli test base
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/base.ts packages/cli/test/base.test.ts
git commit -m "feat(cli): add parseBase + createAdapterFromBase

Pure parser for the --base value: contains '://' → URL (only http(s)
accepted); otherwise filesystem path. Default ./.introspect. Not yet
wired into the CLI program — that's the next task."
```

---

## Task 6: Add `base?: string` to `IntrospectConfig`

Lets users write `export default { base: 'https://ci.example/_introspect' }` in `introspect.config.ts` instead of passing `--base` every time.

**Files:**
- Modify: `packages/types/src/index.ts` (the `IntrospectConfig` interface)

- [ ] **Step 1: Locate the type**

Run:
```bash
grep -n "interface IntrospectConfig" packages/types/src/index.ts
```
Expected: a single hit (around line 803).

- [ ] **Step 2: Add `base?: string`**

Open `packages/types/src/index.ts`. The interface currently reads:

```ts
export interface IntrospectConfig {
  plugins?: PluginSet
  reporters?: ReporterSet
}
```

Change it to:

```ts
export interface IntrospectConfig {
  plugins?: PluginSet
  reporters?: ReporterSet
  /**
   * Where the CLI reads traces from. Filesystem path or http(s):// URL.
   * Overridden by the --base CLI flag. Defaults to './.introspect'.
   */
  base?: string
}
```

- [ ] **Step 3: Type-check the workspace**

Run:
```bash
pnpm -r typecheck 2>&1 | tail -20
```
Expected: no errors. The field is optional, no existing code breaks.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "types: add base?: string to IntrospectConfig

Configuration field for the trace source. Read by the CLI in the next
task; introspect.config.ts authors can default it once instead of
passing --base on every invocation."
```

---

## Task 7: Rewire CLI — `--base` replaces `--dir`

The big swap. The top-level `--dir <path>` becomes `--base <pathOrUrl>`. Each read command resolves the parsed base into a `StorageAdapter` and threads it through. The `debug` and `serve` actions accept only the path form (URL form errors). Integration tests get the `--dir` → `--base` swap in the same commit.

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/integration.test.ts`
- Modify: `packages/cli/src/commands/debug.ts` (rename `dir` field to `basePath` — only the path form is valid for debug)

- [ ] **Step 1: Update the integration test FIRST (it will be the verifier)**

In `packages/cli/test/integration.test.ts`, replace the five `'--dir', dir` argument pairs with `'--base', dir`. After the edit, the five test invocations read:

```ts
const out = runCli(['runs', '--base', dir])
const out = runCli(['list', '--base', dir])
const out = runCli(['list', '--base', dir, '--run', 'run-old'])
const out = runCli(['summary', '--base', dir])
const out = runCli(['summary', '--base', dir, '--run', 'run-old', '--trace-id', 'sess-o'])
```

- [ ] **Step 2: Run the integration test and confirm it now fails**

Run:
```bash
pnpm --filter @introspection/cli build && pnpm --filter @introspection/cli test integration
```
Expected: failure — the CLI does not yet recognise `--base`.

- [ ] **Step 3: Rewire `packages/cli/src/index.ts`**

Replace the whole file content with the version below. Key changes:
- Top-level `.option('--dir <path>', …)` becomes `.option('--base <pathOrUrl>', …)`.
- Imports drop `@introspection/read/node` (the dir-string wrappers) and pull adapter-based functions from `@introspection/read`.
- A helper `getAdapter()` calls `createAdapterFromBase(program.opts().base)` once per command.
- A second helper `getBasePath()` is used by `debug` and the `serve` action; it calls `parseBase` and throws if the result is a URL.

```ts
#!/usr/bin/env node
import { Command } from 'commander'
import { buildSummary } from './commands/summary.js'
import { formatNetworkTable } from './commands/network.js'
import { formatEvents } from './commands/events.js'
import { formatPlugins } from './commands/plugins.js'
import { runDebug } from './commands/debug.js'
import { runPayloadCommand } from './commands/payload.js'
import { formatRunsTable } from './commands/runs.js'
import { formatTracesTable } from './commands/list.js'
import { fileURLToPath } from 'url'
import { listSkills, detectPlatform, getInstallRoot, installSkills } from './commands/skills.js'
import { createTraceReader, listRuns, listTraces } from '@introspection/read'
import { serve } from '@introspection/serve/node'
import { parseBase, createAdapterFromBase } from './base.js'

const BUNDLED_SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
const program = new Command()

program.name('introspect').description('Query Playwright test introspection traces').version('0.1.0')
  .option('--base <pathOrUrl>', 'Trace source: a filesystem path or http(s):// URL (default: ./.introspect)')

function getAdapter() {
  return createAdapterFromBase(program.opts().base as string | undefined)
}

/** For commands that write to disk (debug) or serve a directory. URL form errors. */
function getBasePath(): string {
  const parsed = parseBase(program.opts().base as string | undefined)
  if (parsed.kind === 'url') {
    throw new Error('This command requires a local --base path; URL form is read-only')
  }
  return parsed.path
}

async function loadTrace(opts: { run?: string; traceId?: string; verbose?: boolean }) {
  return createTraceReader(getAdapter(), { runId: opts.run, traceId: opts.traceId, verbose: opts.verbose })
}

program
  .command('debug [url]')
  .description('Debug a live page with introspection')
  .option('--serve <path>', 'Serve a local file or directory instead of a URL')
  .option('--config <path>', 'Path to introspect.config.ts')
  .option('--playwright <script>', 'Playwright script to run (file or inline)')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (url, opts) => {
    const dir = getBasePath()
    await runDebug({ url, serve: opts.serve, config: opts.config, playwright: opts.playwright, verbose: opts.verbose, dir })
  })

program.command('summary')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    const events = await trace.events.ls()
    const summary = {
      id: trace.id,
      label: trace.meta.label,
      startedAt: trace.meta.startedAt,
      endedAt: trace.meta.endedAt,
    }
    console.log(buildSummary(summary, events))
  })

program.command('network')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--failed')
  .option('--url <pattern>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    const events = await trace.events.ls()
    console.log(formatNetworkTable(events, opts))
  })

program.command('runs')
  .description('List recorded runs')
  .action(async () => {
    const adapter = getAdapter()
    const runs = await listRuns(adapter)
    if (runs.length === 0) { console.error('No runs found'); process.exit(1) }
    console.log(formatRunsTable(runs))
  })

program.command('list')
  .description('List traces in a run')
  .option('--run <id>', 'Run id (default: latest run)')
  .action(async (opts: { run?: string }) => {
    const adapter = getAdapter()
    const runs = await listRuns(adapter)
    if (runs.length === 0) { console.error('No runs found'); process.exit(1) }
    if (opts.run && !runs.some(r => r.id === opts.run)) {
      console.error(`Run '${opts.run}' not found`); process.exit(1)
    }
    const runId = opts.run ?? runs[0].id
    const traces = await listTraces(adapter, runId)
    if (traces.length === 0) { console.error(`No traces in run '${runId}'`); process.exit(1) }
    console.log(formatTracesTable(traces))
  })

program.command('plugins')
  .description('Show plugin metadata for a trace')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const trace = await loadTrace(opts)
    console.log(formatPlugins(trace.meta))
  })

const skillsCmd = program.command('skills').description('Manage AI skills for this project')

skillsCmd
  .command('list')
  .description('List available skills')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    const skills = await listSkills(BUNDLED_SKILLS_DIR)
    if (skills.length === 0) {
      console.error('No skills found. Try reinstalling the introspect package.')
      process.exit(1)
    }
    const maxNameLen = Math.max(...skills.map(skill => skill.name.length))
    for (const skill of skills) {
      console.log(`${skill.name.padEnd(maxNameLen + 2)}${skill.description}`)
    }
  })

skillsCmd
  .command('install')
  .description('Install AI skills into your project')
  .option('--platform <name>', 'Target platform (claude)')
  .option('--dir <path>', 'Override install directory')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts: { platform?: string; dir?: string; verbose?: boolean }) => {
    const cwd = process.cwd()

    if (opts.dir && opts.platform) {
      process.stderr.write('Warning: --platform is ignored when --dir is specified.\n')
    } else if (opts.platform && opts.platform !== 'claude') {
      console.error(`Unknown platform: ${opts.platform}. Supported platforms: claude`)
      process.exit(1)
    }

    let platform: 'claude' = 'claude'
    if (!opts.platform && !opts.dir) {
      const detected = await detectPlatform(cwd)
      if ('error' in detected) {
        console.error(detected.error)
        process.exit(1)
      }
      if (!detected.detected) {
        process.stderr.write('No platform detected; defaulting to claude. Use --platform to be explicit.\n')
      }
      platform = detected.platform
    }

    const installRoot = getInstallRoot({ platform, cwd, dir: opts.dir })
    const results = await installSkills(BUNDLED_SKILLS_DIR, installRoot)

    for (const result of results) {
      if (result.overwritten) process.stderr.write(`Overwriting existing skill: ${result.path}\n`)
      console.log(`Installed ${result.name} → ${result.path}`)
    }
  })

program
  .command('events')
  .description('Filter and transform trace events')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--filter <expr>', 'Boolean predicate per event (event), e.g. \'event.metadata.status >= 400\'')
  .option('--format <fmt>', 'Output format: text (default) or json')
  .option('--type <patterns>', 'Comma-separated event types. Supports prefix: "network.*"')
  .option('--after <ms>', 'Keep events after this timestamp (ms)', (v) => parseFloat(v))
  .option('--before <ms>', 'Keep events before this timestamp (ms)', (v) => parseFloat(v))
  .option('--since <label>', 'Keep events after the named mark event')
  .option('--last <n>', 'Keep only the last N events', (v) => parseInt(v, 10))
  .option(
    '--payload <names>',
    'Comma-separated list of payload names to include (repeatable). Note: combining with --filter that references a dropped payload will silently zero-match.',
    (v: string, prev: string[] = []) => prev.concat(v.split(',').map(s => s.trim()).filter(Boolean)),
  )
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (error) {
      console.error(String(error))
      process.exit(1)
    }
    try {
      const events = await trace.events.ls()
      const out = await formatEvents(events, opts, trace)
      if (out) console.log(out)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })

program.command('payload')
  .description('Print one named payload of one event to stdout')
  .argument('<event-id>')
  .argument('<name>')
  .option('--run <id>')
  .option('--trace-id <id>')
  .option('--verbose', 'Enable verbose debug logging')
  .action(async (eventId: string, name: string, opts) => {
    let trace
    try {
      trace = await loadTrace(opts)
    } catch (error) {
      console.error(String(error))
      process.exit(1)
    }
    try {
      await runPayloadCommand({ eventId, name }, trace, process.stdout)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(1)
    }
  })

const serveCmd = program.command('serve').description('Serve introspection traces over HTTP')
serveCmd
  .option('-p, --port <port>', 'Port to listen on', '3456')
  .option('--prefix <path>', 'URL prefix', '/_introspect')
  .option('--host <address>', 'Host to bind to', '0.0.0.0')
  .action(async (opts: { port: string; prefix: string; host: string }) => {
    const dir = getBasePath()
    serve({
      directory: dir,
      port: parseInt(opts.port, 10),
      prefix: opts.prefix,
      host: opts.host,
    })
  })

program.parseAsync()
```

Note: `debug.ts` keeps its `dir` field name internally; the value just comes from `getBasePath()` now. No change needed in `debug.ts` itself.

- [ ] **Step 4: Build the CLI and run the integration test**

Run:
```bash
pnpm --filter @introspection/cli build && pnpm --filter @introspection/cli test integration
```
Expected: integration tests now pass.

- [ ] **Step 5: Run the full CLI test suite**

Run:
```bash
pnpm --filter @introspection/cli test
```
Expected: all tests pass. The per-command unit tests do not call the CLI binary, so they should be unaffected.

- [ ] **Step 6: Add a CLI test for URL-form rejection on debug/serve**

In `packages/cli/test/integration.test.ts`, add a new `describe` block at the end:

```ts
describe('introspect --base URL form rejection on write commands', () => {
  it('debug rejects a URL --base', () => {
    expect(() => runCli(['--base', 'https://h/_introspect', 'debug', 'https://example.com'])).toThrow()
  })

  it('serve rejects a URL --base', () => {
    expect(() => runCli(['--base', 'https://h/_introspect', 'serve'])).toThrow()
  })
})
```

`runCli` (via `execFileSync`) throws on a non-zero exit. The CLI must exit non-zero with the "local --base path" message in stderr. If `runCli` doesn't capture stderr, switch the assertion to use a try/catch and inspect `error.stderr`. The current `runCli` helper:

```ts
function runCli(args: string[]): string {
  return execFileSync('node', [cliEntry, ...args], { encoding: 'utf-8' })
}
```

If needed, broaden it:

```ts
function runCli(args: string[]): string {
  return execFileSync('node', [cliEntry, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}
```

For the new tests to surface the rejection error, the CLI's action callbacks for `debug` and `serve` must catch the `getBasePath()` throw and exit non-zero rather than let the unhandled rejection bubble. Wrap each like this in `packages/cli/src/index.ts`:

```ts
// debug action body — wrap the getBasePath() + runDebug call
.action(async (url, opts) => {
  try {
    const dir = getBasePath()
    await runDebug({ url, serve: opts.serve, config: opts.config, playwright: opts.playwright, verbose: opts.verbose, dir })
  } catch (error) {
    console.error(String((error as Error).message ?? error))
    process.exit(1)
  }
})

// serve action body — same wrap
.action(async (opts: { port: string; prefix: string; host: string }) => {
  try {
    const dir = getBasePath()
    serve({ directory: dir, port: parseInt(opts.port, 10), prefix: opts.prefix, host: opts.host })
  } catch (error) {
    console.error(String((error as Error).message ?? error))
    process.exit(1)
  }
})
```

- [ ] **Step 7: Run the full CLI test suite again**

Run:
```bash
pnpm --filter @introspection/cli build && pnpm --filter @introspection/cli test
```
Expected: all tests pass, including the new rejection cases.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/integration.test.ts
git commit -m "feat(cli): replace --dir with --base <pathOrUrl>

Top-level --base accepts a filesystem path or an http(s):// URL.
URL form constructs createHttpReadAdapter; path form constructs
createNodeAdapter. Read commands (summary, network, runs, list,
plugins, events, payload) receive a StorageAdapter; write commands
(debug, serve) require the path form and exit non-zero on URL form.

--dir is removed. The CLI is pre-1.0; demos and tests are updated in
the same change."
```

---

## Task 8: CLI uses `config.base` when `--base` is not supplied

If the user has `export default { base: 'https://ci.example/_introspect' }` in `introspect.config.ts`, `introspect summary` (no flag) should resolve against it.

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `packages/cli/test/integration.test.ts` (inside a new `describe`):

```ts
describe('config.base fallback', () => {
  it('uses config.base when --base is not supplied', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'introspect-cfg-'))
    // Write a config that points at our fixture dir.
    await writeFile(
      join(cfgDir, 'introspect.config.mjs'),
      `export default { base: ${JSON.stringify(dir)} }`,
    )
    const out = execFileSync('node', [cliEntry, 'runs'], { encoding: 'utf-8', cwd: cfgDir })
    expect(out).toContain('run-new')
    await rm(cfgDir, { recursive: true, force: true })
  })

  it('--base wins over config.base', async () => {
    const cfgDir = await mkdtemp(join(tmpdir(), 'introspect-cfg-'))
    await writeFile(
      join(cfgDir, 'introspect.config.mjs'),
      `export default { base: '/nonexistent-config-base' }`,
    )
    const out = execFileSync('node', [cliEntry, '--base', dir, 'runs'], { encoding: 'utf-8', cwd: cfgDir })
    expect(out).toContain('run-new')
    await rm(cfgDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run:
```bash
pnpm --filter @introspection/cli build && pnpm --filter @introspection/cli test integration
```
Expected: the new config-fallback tests fail — the CLI ignores config today.

- [ ] **Step 3: Wire `config.base` into the CLI startup**

In `packages/cli/src/index.ts`, modify the `getAdapter` / `getBasePath` helpers to consult `loadIntrospectConfig` when `program.opts().base` is falsy.

Add an import near the top:

```ts
import { loadIntrospectConfig } from '@introspection/config'
```

Replace the two helpers with these (`getAdapter` becomes async; callers already await it via Promise chaining since they're inside async actions):

```ts
let cachedBase: string | undefined
async function resolveBaseValue(): Promise<string | undefined> {
  const flag = program.opts().base as string | undefined
  if (flag) return flag
  if (cachedBase !== undefined) return cachedBase || undefined
  try {
    const config = await loadIntrospectConfig({ cwd: process.cwd() })
    cachedBase = config?.base ?? ''
    return config?.base
  } catch {
    cachedBase = ''
    return undefined
  }
}

async function getAdapter() {
  return createAdapterFromBase(await resolveBaseValue())
}

async function getBasePath(): Promise<string> {
  const parsed = parseBase(await resolveBaseValue())
  if (parsed.kind === 'url') {
    throw new Error('This command requires a local --base path; URL form is read-only')
  }
  return parsed.path
}
```

Then `await` the helpers wherever they're called. Each call site changes from:

```ts
const adapter = getAdapter()
```

to:

```ts
const adapter = await getAdapter()
```

…and `loadTrace` becomes:

```ts
async function loadTrace(opts: { run?: string; traceId?: string; verbose?: boolean }) {
  return createTraceReader(await getAdapter(), { runId: opts.run, traceId: opts.traceId, verbose: opts.verbose })
}
```

The `debug` and `serve` actions change `getBasePath()` → `await getBasePath()`.

- [ ] **Step 4: Re-run the integration test**

Run:
```bash
pnpm --filter @introspection/cli build && pnpm --filter @introspection/cli test integration
```
Expected: all tests pass, including the two new config-fallback cases.

- [ ] **Step 5: Run the full CLI test suite**

Run:
```bash
pnpm --filter @introspection/cli test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/integration.test.ts
git commit -m "feat(cli): fall back to config.base when --base is not supplied

Read base from introspect.config.ts via loadIntrospectConfig. The
--base flag still wins; config.base is the convenience default so
users don't have to repeat the flag every invocation."
```

---

## Task 9: Update `packages/cli/README.md` for `--base`

**Files:**
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Find and replace the top-level `--dir` mentions**

The README references the trace-source flag in two places (around lines 29 and 32 at time of writing). Replace:

```
introspect --dir <path>   # trace directory (default: .introspect in cwd)
```

with:

```
introspect --base <pathOrUrl>   # trace source: a path or http(s):// URL (default: ./.introspect)
```

And replace:

```
All commands accept `--dir` to point at a non-default trace directory.
```

with:

```
All commands accept `--base` to point at a non-default trace source. The value is a filesystem path (e.g. `./.introspect`) or an `http(s)://` URL pointing at a server that mounts `@introspection/serve`. `debug` and `serve` accept only the path form. The default is `./.introspect`. May also be set as `base` in `introspect.config.ts`.
```

Leave the two `skills install --dir` references untouched — that's a different `--dir` (the install-directory flag), unrelated to trace source.

- [ ] **Step 2: Verify no stale `--dir` references for the trace source remain**

Run:
```bash
grep -nE "introspect.*--dir|All commands accept .--dir" packages/cli/README.md
```
Expected: no matches (only the `skills install --dir` entries remain elsewhere in the file).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(cli): document --base, drop --dir for trace source

--dir survives only inside 'skills install' as the install-directory
override; the trace-source flag is now --base, accepting either a
filesystem path or an http(s):// URL."
```

---

## Self-Review

(Done by the author of this plan, before handoff.)

**Spec coverage:**
- Spec §Why — context only, no code task.
- Spec §Scope: `createHttpReadAdapter` at `@introspection/serve/client` ✓ Task 1. Demos drop local copy ✓ Tasks 3 + 4. `introspect --base <pathOrUrl>` replaces `--dir` ✓ Task 7. Config `base` ✓ Tasks 6 + 8. Hard-cut `--dir` removal ✓ Task 7.
- Spec §`createHttpReadAdapter` behaviour — `listDirectories` throws on non-OK ✓ Task 1 (Step 4 + test). `/dirs/`/`/file/` URL shape ✓ Task 1. `readJSON` client-side ✓ Task 1.
- Spec §CLI surface — single `--base`, scheme discrimination, unsupported-scheme error ✓ Task 5 + Task 7.
- Spec §Run selection — explicitly under-specified in the spec; out of scope of this plan.
- Spec §Error handling — bad/unreachable base URL surfaces a clear error ✓ Task 1 (read methods throw with status), Task 7 (debug/serve URL rejection). `listDirectories` non-OK throws ✓ Task 1. Unsupported scheme errors at startup ✓ Task 5.
- Spec §Testing — `createHttpReadAdapter` equivalence ✓ Task 2. CLI argument resolution ✓ Tasks 5 + 7 + 8.

**Placeholder scan:** Every step has the actual edit or command. No "TBD", no "handle edge cases", no "similar to Task N." Code blocks are full where code is changed.

**Type consistency:**
- `ParsedBase` is defined once (Task 5) and used everywhere with the same `kind: 'path' | 'url'` shape.
- `createHttpReadAdapter` signature matches the spec.
- `IntrospectConfig.base` is added in Task 6 and consumed in Task 8.
- `getAdapter` / `getBasePath` start sync in Task 7 then become async in Task 8 — Step 3 of Task 8 explicitly walks every call site to add `await`. This is the riskiest naming carry; flagged.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-15-remote-trace-cli.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
