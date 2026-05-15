# StorageAdapter Hierarchy + Hierarchy-Aware read — Implementation Plan

> **Status:** landed (2026-05-14) · spec: `docs/superpowers/specs/2026-05-14-storageadapter-hierarchy-design.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@introspection/read` and the `introspect` CLI navigate the two-level `<run-id>/<trace-id>/` trace layout that `withIntrospect` established on disk.

**Architecture:** `StorageAdapter` gets one change — `listDirectories(subPath?)`. `@introspection/read` builds `listRuns()` / `listTraces(runId)` / hierarchy-aware `createTraceReader` on top, reading `RunMeta` / `TraceMeta`. The node + memory adapters implement the widened method. `introspect debug` is updated to produce a one-trace run so every shipped producer uses the single model. The CLI gains an `introspect runs` command, `introspect list` scoped to a run, and `--run` selection across the per-trace commands.

**Tech Stack:** TypeScript (NodeNext), pnpm workspace, tsup (build), vitest (tests for `@introspection/types`, `@introspection/read`, `@introspection/cli`).

**Spec:** `docs/superpowers/specs/2026-05-14-storageadapter-hierarchy-design.md`

---

## File Structure

**Modify:**
- `packages/types/src/index.ts` — `StorageAdapter.listDirectories` gains an optional `subPath`.
- `packages/read/src/node.ts` — `createNodeAdapter` honours `subPath`; new `/node` wrappers `listRuns(dir)` / `listTraces(dir, runId)`.
- `packages/read/src/memory.ts` — `createMemoryReadAdapter` honours `subPath`.
- `packages/read/src/index.ts` — `RunSummary` type; `listRuns`; `listTraces(adapter, runId)`; `TraceSummary` gains `project`/`status`; hierarchy-aware `createTraceReader`; `getLatestRunId` + `getLatestTraceId(adapter, runId)`.
- `packages/read/test/helpers.ts` — `writeFixtureRun`; `writeFixtureTrace` nests under a run id.
- `packages/read/test/list-traces.test.ts`, `packages/read/test/trace-reader.test.ts` — migrated to the hierarchy.
- `packages/read/test/node-adapter.test.ts`, `packages/read/test/memory.test.ts` — add nested-listing cases.
- `packages/playwright/src/index.ts` — export `resolveRunId`.
- `packages/cli/src/commands/debug.ts` — produce a run directory.
- `packages/cli/test/commands/debug.test.ts` — migrated to the run layout.
- `packages/cli/src/index.ts` — `loadTrace` resolves `runId`+`traceId`; `--run` on per-trace commands; `runs` command; `list` scoped to a run.

**Create:**
- `packages/cli/src/commands/runs.ts` — `formatRunsTable(runs)` pure formatter.
- `packages/cli/src/commands/list.ts` — `formatTracesTable(traces)` pure formatter.
- `packages/cli/test/commands/runs.test.ts`, `packages/cli/test/commands/list.test.ts` — formatter tests.
- `packages/cli/test/integration.test.ts` — subprocess test of `runs` / `list` / `summary` against a fixture tree.

---

## Task 1: `StorageAdapter.listDirectories(subPath?)` + node adapter

**Files:**
- Modify: `packages/types/src/index.ts`, `packages/read/src/node.ts`
- Test: `packages/read/test/node-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/read/test/node-adapter.test.ts`, inside the `describe('createNodeAdapter', ...)` block (before its closing `})`):

```ts
  it('listDirectories(subPath) lists directories nested under subPath', async () => {
    await mkdir(join(dir, 'run-a', 'sess-1'), { recursive: true })
    await mkdir(join(dir, 'run-a', 'sess-2'), { recursive: true })
    await writeFile(join(dir, 'run-a', 'meta.json'), '{}')
    const adapter = createNodeAdapter(dir)
    expect((await adapter.listDirectories('run-a')).sort()).toEqual(['sess-1', 'sess-2'])
  })

  it('listDirectories(subPath) returns [] when subPath does not exist', async () => {
    const adapter = createNodeAdapter(dir)
    expect(await adapter.listDirectories('nope')).toEqual([])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/read && pnpm exec vitest run test/node-adapter.test.ts`
Expected: FAIL — `adapter.listDirectories('run-a')` ignores the argument and returns the top-level dirs (`['run-a']`), not `['sess-1','sess-2']`.

- [ ] **Step 3: Widen the interface and implement it**

In `packages/types/src/index.ts`, change the `StorageAdapter` interface's first method:

```ts
export interface StorageAdapter {
  listDirectories(subPath?: string): Promise<string[]>
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  readJSON<T = unknown>(path: string): Promise<T>
}
```

In `packages/read/src/node.ts`, replace the `listDirectories` method of `createNodeAdapter` (it currently takes no argument):

```ts
    async listDirectories(subPath?: string) {
      const target = subPath ? join(dir, subPath) : dir
      try {
        const entries = await readdir(target, { withFileTypes: true })
        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
      } catch {
        return []
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/read && pnpm exec vitest run test/node-adapter.test.ts`
Expected: PASS (new cases + existing `createNodeAdapter` cases). Then `cd packages/types && pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/read/src/node.ts packages/read/test/node-adapter.test.ts
git commit -m "types,read: StorageAdapter.listDirectories accepts an optional subPath"
```

---

## Task 2: memory adapter `listDirectories(subPath?)`

**Files:**
- Modify: `packages/read/src/memory.ts`
- Test: `packages/read/test/memory.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/read/test/memory.test.ts`, inside its top-level `describe` block (before the closing `})`):

```ts
  it('listDirectories(subPath) lists directories nested under subPath', async () => {
    const store = new Map<string, string | Uint8Array>([
      ['run-a/meta.json', '{}'],
      ['run-a/sess-1/meta.json', '{}'],
      ['run-a/sess-2/events.ndjson', ''],
      ['run-b/sess-x/meta.json', '{}'],
    ])
    const adapter = createMemoryReadAdapter(store)
    expect((await adapter.listDirectories()).sort()).toEqual(['run-a', 'run-b'])
    expect((await adapter.listDirectories('run-a')).sort()).toEqual(['sess-1', 'sess-2'])
    expect(await adapter.listDirectories('run-b')).toEqual(['sess-x'])
    expect(await adapter.listDirectories('missing')).toEqual([])
  })
```

If `memory.test.ts` does not already import `createMemoryReadAdapter`, ensure the import at the top of the file reads:

```ts
import { createMemoryReadAdapter } from '../src/memory.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/read && pnpm exec vitest run test/memory.test.ts`
Expected: FAIL — `listDirectories('run-a')` ignores the argument and returns `['run-a','run-b']`.

- [ ] **Step 3: Implement**

In `packages/read/src/memory.ts`, replace the `listDirectories` method of `createMemoryReadAdapter`:

```ts
    async listDirectories(subPath?: string) {
      const prefix = subPath ? `${subPath.replace(/\/$/, '')}/` : ''
      const dirs = new Set<string>()
      for (const path of store.keys()) {
        if (prefix && !path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length)
        const segment = rest.split('/')[0]
        // a segment is a directory only if there is a path component after it
        if (segment && rest.includes('/')) dirs.add(segment)
      }
      return Array.from(dirs)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/read && pnpm exec vitest run test/memory.test.ts`
Expected: PASS (new case + existing memory cases).

- [ ] **Step 5: Commit**

```bash
git add packages/read/src/memory.ts packages/read/test/memory.test.ts
git commit -m "read: memory adapter listDirectories honours subPath"
```

---

## Task 3: `read` test helpers — run-aware fixtures

**Files:**
- Modify: `packages/read/test/helpers.ts`

This task has no test of its own — the helpers are exercised by Tasks 4 and 5. It updates the fixture builders so existing and new `read` tests can write the `<run-id>/<trace-id>/` layout.

- [ ] **Step 1: Replace `helpers.ts` with run-aware builders**

Replace the entire contents of `packages/read/test/helpers.ts` with:

```ts
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TraceEvent, TraceMeta, RunMeta } from '@introspection/types'

export interface FixtureTraceOptions {
  id: string
  startedAt: number
  endedAt?: number
  label?: string
  project?: string
  status?: TraceMeta['status']
  events?: TraceEvent[]
  assets?: Array<{ path: string; content: string | Buffer }>
}

export interface FixtureRunOptions {
  id: string
  startedAt: number
  endedAt?: number
  status?: RunMeta['status']
  branch?: string
  commit?: string
  traces?: FixtureTraceOptions[]
}

/** Writes a trace directory under a run directory, matching the on-disk layout. */
export async function writeFixtureTrace(
  dir: string,
  runId: string,
  options: FixtureTraceOptions,
): Promise<void> {
  const traceDir = join(dir, runId, options.id)
  await mkdir(join(traceDir, 'assets'), { recursive: true })

  const meta: TraceMeta = {
    version: '2',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    label: options.label,
    project: options.project,
    status: options.status,
  }
  await writeFile(join(traceDir, 'meta.json'), JSON.stringify(meta, null, 2))

  const ndjson = (options.events ?? []).map(event => JSON.stringify(event)).join('\n')
  await writeFile(join(traceDir, 'events.ndjson'), ndjson ? ndjson + '\n' : '')

  for (const asset of options.assets ?? []) {
    await writeFile(join(traceDir, asset.path), asset.content)
  }
}

/** Writes a run directory (RunMeta + its trace sub-directories). */
export async function writeFixtureRun(dir: string, options: FixtureRunOptions): Promise<void> {
  const runDir = join(dir, options.id)
  await mkdir(runDir, { recursive: true })

  const meta: RunMeta = {
    version: '1',
    id: options.id,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    status: options.status,
    branch: options.branch,
    commit: options.commit,
  }
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))

  for (const trace of options.traces ?? []) {
    await writeFixtureTrace(dir, options.id, trace)
  }
}

export function markEvent(id: string, timestamp: number, label: string): TraceEvent {
  return { id, type: 'mark', timestamp, metadata: { label } }
}

export function networkRequestEvent(id: string, timestamp: number, url: string): TraceEvent {
  return {
    id,
    type: 'network.request',
    timestamp,
    metadata: {
      cdpRequestId: id,
      cdpTimestamp: 0,
      cdpWallTime: 0,
      url,
      method: 'GET',
      headers: {},
    },
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd packages/read && pnpm exec tsc --noEmit`
Expected: FAIL — `list-traces.test.ts` and `trace-reader.test.ts` still call `writeFixtureTrace(dir, {...})` with the old 2-arg signature. That is expected; Tasks 4 and 5 migrate those files. The helper file itself must show no errors — confirm the only errors are in those two test files.

- [ ] **Step 3: Commit**

```bash
git add packages/read/test/helpers.ts
git commit -m "read(test): run-aware fixture helpers (writeFixtureRun, nested writeFixtureTrace)"
```

---

## Task 4: `read` — `RunSummary` + `listRuns`, `TraceSummary` + `listTraces(runId)`

**Files:**
- Modify: `packages/read/src/index.ts`
- Test: `packages/read/test/list-traces.test.ts` (migrated + extended)

- [ ] **Step 1: Replace `list-traces.test.ts` with run + trace listing tests**

Replace the entire contents of `packages/read/test/list-traces.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { listRuns, listTraces } from '../src/index.js'
import { createNodeAdapter } from '../src/node.js'
import { writeFixtureRun } from './helpers.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-read-list-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listRuns', () => {
  it('returns empty array when no runs exist', async () => {
    expect(await listRuns(createNodeAdapter(dir))).toEqual([])
  })

  it('returns empty array when directory does not exist', async () => {
    expect(await listRuns(createNodeAdapter(join(dir, 'missing')))).toEqual([])
  })

  it('reads runs, orders by startedAt descending, counts traces', async () => {
    await writeFixtureRun(dir, {
      id: 'old', startedAt: 100, endedAt: 150, status: 'passed', branch: 'main',
      traces: [{ id: 's1', startedAt: 110 }],
    })
    await writeFixtureRun(dir, {
      id: 'new', startedAt: 300, status: 'failed',
      traces: [{ id: 's1', startedAt: 310 }, { id: 's2', startedAt: 320 }],
    })

    const runs = await listRuns(createNodeAdapter(dir))
    expect(runs.map(run => run.id)).toEqual(['new', 'old'])
    expect(runs[0]).toMatchObject({ id: 'new', status: 'failed', traceCount: 2 })
    expect(runs[1]).toMatchObject({ id: 'old', status: 'passed', branch: 'main', traceCount: 1 })
  })

  it('skips runs with unreadable meta.json', async () => {
    await writeFixtureRun(dir, { id: 'ok', startedAt: 100 })
    await mkdir(join(dir, 'broken'))
    await writeFile(join(dir, 'broken', 'meta.json'), 'not-json{')

    const runs = await listRuns(createNodeAdapter(dir))
    expect(runs.map(run => run.id)).toEqual(['ok'])
  })
})

describe('listTraces', () => {
  it('returns traces of a run, ordered by startedAt descending', async () => {
    await writeFixtureRun(dir, {
      id: 'run', startedAt: 100,
      traces: [
        { id: 'old', startedAt: 110, project: 'browser-mobile', status: 'passed' },
        { id: 'new', startedAt: 130, project: 'browser-desktop', status: 'failed' },
        { id: 'mid', startedAt: 120 },
      ],
    })

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.map(s => s.id)).toEqual(['new', 'mid', 'old'])
    expect(traces[0]).toMatchObject({ id: 'new', project: 'browser-desktop', status: 'failed' })
  })

  it('computes duration when endedAt is present', async () => {
    await writeFixtureRun(dir, {
      id: 'run', startedAt: 100,
      traces: [
        { id: 'done', startedAt: 100, endedAt: 450 },
        { id: 'open', startedAt: 500 },
      ],
    })

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.find(s => s.id === 'done')!.duration).toBe(350)
    expect(traces.find(s => s.id === 'open')!.duration).toBeUndefined()
  })

  it('returns empty array for a run with no traces', async () => {
    await writeFixtureRun(dir, { id: 'run', startedAt: 100 })
    expect(await listTraces(createNodeAdapter(dir), 'run')).toEqual([])
  })

  it('skips traces with unreadable meta.json', async () => {
    await writeFixtureRun(dir, { id: 'run', startedAt: 100, traces: [{ id: 'ok', startedAt: 110 }] })
    await mkdir(join(dir, 'run', 'broken'))
    await writeFile(join(dir, 'run', 'broken', 'meta.json'), 'not-json{')

    const traces = await listTraces(createNodeAdapter(dir), 'run')
    expect(traces.map(s => s.id)).toEqual(['ok'])
  })
})
```

> Note: `listRuns` / `listTraces` here are the `/index.js` adapter-taking functions. The `/node` dir-taking wrappers are Task 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/read && pnpm exec vitest run test/list-traces.test.ts`
Expected: FAIL — `listRuns` is not exported; `listTraces` has the old `(adapter)` signature.

- [ ] **Step 3: Implement in `packages/read/src/index.ts`**

Add `RunMeta` and `TraceStatus` to the type import at the top of the file (the existing import from `@introspection/types`):

```ts
import type { TraceEvent, TraceReader, TraceMeta, RunMeta, TraceStatus, EventsFilter, Watchable, WatchableWithFilter, StorageAdapter, PayloadRef } from '@introspection/types'
```

Replace the `TraceSummary` interface and the `listTraces` function with:

```ts
export interface RunSummary {
  id: string
  startedAt: number
  endedAt?: number
  status?: RunMeta['status']
  branch?: string
  commit?: string
  traceCount: number
}

export interface TraceSummary {
  id: string
  label?: string
  project?: string
  status?: TraceStatus
  startedAt: number
  endedAt?: number
  duration?: number
}

export async function listRuns(adapter: StorageAdapter): Promise<RunSummary[]> {
  const runIds = await adapter.listDirectories()
  if (runIds.length === 0) return []

  const results = await Promise.all(
    runIds.map(async (id): Promise<RunSummary | null> => {
      try {
        const meta = JSON.parse(await adapter.readText(`${id}/meta.json`)) as RunMeta
        const traces = await adapter.listDirectories(id)
        return {
          id: meta.id,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
          status: meta.status,
          branch: meta.branch,
          commit: meta.commit,
          traceCount: traces.length,
        }
      } catch {
        return null // skip malformed runs
      }
    }),
  )

  return results.filter((r): r is RunSummary => r !== null).sort((a, b) => b.startedAt - a.startedAt)
}

export async function listTraces(adapter: StorageAdapter, runId: string): Promise<TraceSummary[]> {
  const traceIds = await adapter.listDirectories(runId)
  if (traceIds.length === 0) return []

  const results = await Promise.all(
    traceIds.map(async (id): Promise<TraceSummary | null> => {
      try {
        const meta = JSON.parse(await adapter.readText(`${runId}/${id}/meta.json`)) as TraceMeta
        return {
          id: meta.id,
          label: meta.label,
          project: meta.project,
          status: meta.status,
          startedAt: meta.startedAt,
          endedAt: meta.endedAt,
          duration: meta.endedAt ? meta.endedAt - meta.startedAt : undefined,
        }
      } catch {
        return null // skip malformed traces
      }
    }),
  )

  return results.filter((s): s is TraceSummary => s !== null).sort((a, b) => b.startedAt - a.startedAt)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/read && pnpm exec vitest run test/list-traces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read/src/index.ts packages/read/test/list-traces.test.ts
git commit -m "read: add RunSummary/listRuns; listTraces takes a runId"
```

---

## Task 5: `read` — hierarchy-aware `createTraceReader`

**Files:**
- Modify: `packages/read/src/index.ts`
- Test: `packages/read/test/trace-reader.test.ts` (migrated)

- [ ] **Step 1: Replace `trace-reader.test.ts` selection tests with hierarchy versions**

In `packages/read/test/trace-reader.test.ts`, change the helper import line to:

```ts
import { writeFixtureRun, markEvent, networkRequestEvent } from './helpers.js'
```

Then replace the `describe('createTraceReader — selection & meta', ...)` block's body so every `writeFixtureTrace(dir, {...})` call becomes a `writeFixtureRun(dir, { ... traces: [...] })` call. Concretely, replace the **first four** `it(...)` cases (selection + "throws when no traces") with:

```ts
  it('selects the latest trace of the latest run when no ids are given', async () => {
    await writeFixtureRun(dir, { id: 'run-old', startedAt: 100, traces: [{ id: 's', startedAt: 110 }] })
    await writeFixtureRun(dir, {
      id: 'run-new', startedAt: 500,
      traces: [{ id: 'early', startedAt: 510 }, { id: 'late', startedAt: 590 }],
    })
    const reader = await createTraceReader(dir)
    expect(reader.id).toBe('late')
  })

  it('selects a specific trace within the latest run when traceId is given', async () => {
    await writeFixtureRun(dir, {
      id: 'run', startedAt: 100,
      traces: [{ id: 'a', startedAt: 110 }, { id: 'b', startedAt: 120 }],
    })
    const reader = await createTraceReader(dir, { traceId: 'a' })
    expect(reader.id).toBe('a')
  })

  it('selects a trace within an explicitly named run', async () => {
    await writeFixtureRun(dir, { id: 'run-1', startedAt: 100, traces: [{ id: 'x', startedAt: 110 }] })
    await writeFixtureRun(dir, { id: 'run-2', startedAt: 500, traces: [{ id: 'y', startedAt: 510 }] })
    const reader = await createTraceReader(dir, { runId: 'run-1' })
    expect(reader.id).toBe('x')
  })

  it('throws when no runs exist', async () => {
    await expect(createTraceReader(dir)).rejects.toThrow(/No runs found/)
  })

  it('throws when the named run has no traces', async () => {
    await writeFixtureRun(dir, { id: 'empty', startedAt: 100 })
    await expect(createTraceReader(dir, { runId: 'empty' })).rejects.toThrow(/No traces in run/)
  })
```

For every **remaining** `it(...)` case in the file (the `meta`, `events`, `resolvePayload`, `watch` cases — whichever exist below), wrap each `writeFixtureTrace(dir, { id: X, ... })` call as a single-trace run: `writeFixtureRun(dir, { id: 'run', startedAt: <same startedAt>, traces: [{ id: X, ... }] })`, and leave the `createTraceReader(dir)` / `createTraceReader(dir, { traceId: X })` calls as-is (they resolve within that one run). The reader's `id` is still the trace id, so existing `reader.id` / `reader.meta` assertions are unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/read && pnpm exec vitest run test/trace-reader.test.ts`
Expected: FAIL — `createTraceReader` resolves a top-level dir as a trace: it reads `<runId>/meta.json` (a `RunMeta`) as the trace meta and looks for `<runId>/events.ndjson`, which does not exist.

- [ ] **Step 3: Implement in `packages/read/src/index.ts`**

Replace the `CreateTraceReaderOptions` interface and the head of `createTraceReader` (down to and including the `loadEvents` call) with:

```ts
export interface CreateTraceReaderOptions {
  runId?: string
  traceId?: string
  verbose?: boolean
}

export async function createTraceReader(adapter: StorageAdapter, options?: CreateTraceReaderOptions): Promise<TraceReader> {
  const debug = createDebug('trace-reader', options?.verbose ?? false)

  const runId = options?.runId ?? (await getLatestRunId(adapter))
  if (!runId) throw new Error('No runs found')

  const id = options?.traceId ?? (await getLatestTraceId(adapter, runId))
  if (!id) throw new Error(`No traces in run '${runId}'`)

  const prefix = `${runId}/${id}`

  const metaRaw = await adapter.readText(`${prefix}/meta.json`)
  const meta = JSON.parse(metaRaw) as TraceMeta

  const initialEvents = await loadEvents(adapter, prefix)
  debug('loaded', initialEvents.length, 'events from', prefix)
```

In `resolvePayload`, change the asset path from `${id}/${ref.path}` to `${prefix}/${ref.path}`:

```ts
      const fullPath = `${prefix}/${ref.path}`
```

Replace the `getLatestTraceId` helper and the `loadEvents` helper at the bottom of the file with:

```ts
async function getLatestRunId(adapter: StorageAdapter): Promise<string | null> {
  const runIds = await adapter.listDirectories()
  if (runIds.length === 0) return null

  const metas = await Promise.all(
    runIds.map(async id => {
      try {
        const meta = JSON.parse(await adapter.readText(`${id}/meta.json`)) as { startedAt: number }
        return { id, startedAt: meta.startedAt }
      } catch {
        return { id, startedAt: 0 }
      }
    }),
  )
  metas.sort((a, b) => b.startedAt - a.startedAt)
  return metas[0].id
}

async function getLatestTraceId(adapter: StorageAdapter, runId: string): Promise<string | null> {
  const traceIds = await adapter.listDirectories(runId)
  if (traceIds.length === 0) return null

  const metas = await Promise.all(
    traceIds.map(async id => {
      try {
        const meta = JSON.parse(await adapter.readText(`${runId}/${id}/meta.json`)) as { startedAt: number }
        return { id, startedAt: meta.startedAt }
      } catch {
        return { id, startedAt: 0 }
      }
    }),
  )
  metas.sort((a, b) => b.startedAt - a.startedAt)
  return metas[0].id
}

async function loadEvents(adapter: StorageAdapter, tracePrefix: string): Promise<TraceEvent[]> {
  const eventsRaw = await adapter.readText(`${tracePrefix}/events.ndjson`)
  return eventsRaw
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TraceEvent)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/read && pnpm exec vitest run`
Expected: PASS — all `read` tests (`node-adapter`, `memory`, `list-traces`, `trace-reader`, `match-event-type`). Then `pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read/src/index.ts packages/read/test/trace-reader.test.ts
git commit -m "read: createTraceReader resolves a trace within a run"
```

---

## Task 6: `@introspection/read/node` convenience wrappers

**Files:**
- Modify: `packages/read/src/node.ts`
- Test: `packages/read/test/node-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `packages/read/test/node-adapter.test.ts`:

```ts
describe('node convenience wrappers', () => {
  it('listRuns(dir) and listTraces(dir, runId) read the on-disk hierarchy', async () => {
    const { writeFixtureRun } = await import('./helpers.js')
    await writeFixtureRun(dir, {
      id: 'run-1', startedAt: 200, status: 'passed',
      traces: [{ id: 'sess-a', startedAt: 210, project: 'p' }],
    })
    const { listRuns, listTraces } = await import('../src/node.js')
    const runs = await listRuns(dir)
    expect(runs.map(r => r.id)).toEqual(['run-1'])
    expect(runs[0].traceCount).toBe(1)
    const traces = await listTraces(dir, 'run-1')
    expect(traces.map(s => s.id)).toEqual(['sess-a'])
    expect(traces[0].project).toBe('p')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/read && pnpm exec vitest run test/node-adapter.test.ts`
Expected: FAIL — `listRuns` is not exported from `../src/node.js`, and `listTraces` there has the old `(dir)` signature.

- [ ] **Step 3: Implement in `packages/read/src/node.ts`**

Update the import from `./index.js` to pull in the new functions and `RunSummary`:

```ts
import {
  type StorageAdapter,
  type TraceSummary,
  type RunSummary,
  createTraceReader as createTraceReaderFromAdapter,
  listRuns as listRunsFromAdapter,
  listTraces as listTracesFromAdapter,
} from './index.js'
```

Update the re-export type line:

```ts
export type { StorageAdapter, TraceSummary, RunSummary } from './index.js'
```

Replace the `createTraceReader` and `listTraces` wrappers at the bottom of the file with:

```ts
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/read && pnpm exec vitest run test/node-adapter.test.ts && pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/read/src/node.ts packages/read/test/node-adapter.test.ts
git commit -m "read/node: add listRuns(dir) and listTraces(dir, runId) wrappers"
```

---

## Task 7: export `resolveRunId` from `@introspection/playwright`

**Files:**
- Modify: `packages/playwright/src/index.ts`

`introspect debug` (Task 8) needs run-id generation; `@introspection/cli` already depends on `@introspection/playwright`. Expose the existing `resolveRunId`.

- [ ] **Step 1: Add the export**

In `packages/playwright/src/index.ts`, add after the `withIntrospect` exports:

```ts
export { resolveRunId } from './run-id.js'
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd packages/playwright && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/playwright/src/index.ts
git commit -m "playwright: export resolveRunId"
```

---

## Task 8: `introspect debug` produces a run directory

**Files:**
- Modify: `packages/cli/src/commands/debug.ts`
- Test: `packages/cli/test/commands/debug.test.ts`

- [ ] **Step 1: Migrate the debug test to the run layout**

In `packages/cli/test/commands/debug.test.ts`: `runDebug` will now return a `{ runId, traceId }` object instead of a bare trace-id string. Replace each assertion block that uses the return value and `listTraces`/`createTraceReader`. Specifically, change the import line:

```ts
import { createTraceReader, listRuns, listTraces } from '@introspection/read/node'
```

And in the first test (`serves a local HTML file and records a trace`), replace the body after the `runDebug({...})` call with:

```ts
    const result = await runDebug({
      serve: resolve(fixturesDir, 'index.html'),
      config: resolve(fixturesDir, 'introspect.config.js'),
      dir: tempDir,
    })

    expect(result.runId).toBeDefined()
    expect(result.traceId).toBeDefined()

    // The run directory exists with a RunMeta and one trace
    const runs = await listRuns(tempDir)
    expect(runs.map(r => r.id)).toContain(result.runId)
    const traces = await listTraces(tempDir, result.runId)
    expect(traces.map(s => s.id)).toContain(result.traceId)

    // The trace reader resolves within the run
    const reader = await createTraceReader(tempDir, { runId: result.runId, traceId: result.traceId })
    expect(reader.id).toBe(result.traceId)
```

For any other test in the file that calls `runDebug` and inspects its result, apply the same shape change (`const result = await runDebug(...)`, then use `result.runId` / `result.traceId`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run test/commands/debug.test.ts`
Expected: FAIL — `runDebug` still returns a string; `listRuns` import / `listTraces(dir, runId)` signature don't match yet.

- [ ] **Step 3: Implement in `packages/cli/src/commands/debug.ts`**

Add imports near the top of the file:

```ts
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { resolveRunId } from '@introspection/playwright'
import type { RunMeta } from '@introspection/types'
```

Change `runDebug`'s return type and the capture block. Replace the `try { ... return handle.trace.id } finally { ... }` region with:

```ts
  const runId = resolveRunId(process.env)
  const runDir = join(opts.dir, runId)
  await mkdir(runDir, { recursive: true })
  const startedAt = Date.now()
  const runMeta: RunMeta = { version: '1', id: runId, startedAt }
  await writeFile(join(runDir, 'meta.json'), JSON.stringify(runMeta, null, 2))

  try {
    // Attach introspection — the trace lands at <runDir>/<trace-id>/
    const handle = await attach(page, {
      outDir: runDir,
      plugins,
      testTitle: `debug: ${navigationUrl}`,
    })

    // Navigate to URL
    await page.goto(navigationUrl)

    // Run playwright script if provided
    if (opts.playwright) {
      let script = opts.playwright
      if (script.endsWith('.ts') || script.endsWith('.js')) {
        script = await readFile(script, 'utf-8')
      }
      const fn = new Function('page', `return (async () => { ${script} })()`)
      await fn(page)
    }

    // Flush and detach
    await handle.flush()
    await handle.detach()

    // Finalize the run meta
    await writeFile(
      join(runDir, 'meta.json'),
      JSON.stringify({ ...runMeta, endedAt: Date.now() } satisfies RunMeta, null, 2),
    )

    console.log(`\n✓ Trace saved to: ${runId}/${handle.trace.id}`)
    console.log(`  Query with: introspect events --run ${runId} --trace-id ${handle.trace.id}`)

    return { runId, traceId: handle.trace.id }
  } finally {
    await browser.close()
    if (serverInfo?.server) {
      serverInfo.server.close()
    }
  }
```

Change the function signature line from `export async function runDebug(opts: DebugOptions) {` to:

```ts
export async function runDebug(opts: DebugOptions): Promise<{ runId: string; traceId: string }> {
```

- [ ] **Step 4: Update the `debug` command's call site in `packages/cli/src/index.ts`**

The `debug` command action currently does `await runDebug({...})` and ignores the return value — no change needed there. Confirm by reading `packages/cli/src/index.ts` around the `.command('debug [url]')` block; the action does not use the return value, so it is unaffected.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run test/commands/debug.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/debug.ts packages/cli/test/commands/debug.test.ts
git commit -m "cli: introspect debug produces a one-trace run directory"
```

---

## Task 9: `introspect runs` command — `formatRunsTable`

**Files:**
- Create: `packages/cli/src/commands/runs.ts`, `packages/cli/test/commands/runs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/commands/runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRunsTable } from '../../src/commands/runs.js'
import type { RunSummary } from '@introspection/read'

const runs: RunSummary[] = [
  { id: 'main_4821', startedAt: 1_700_000_000_000, endedAt: 1_700_000_060_000, status: 'failed', branch: 'main', traceCount: 12 },
  { id: '20260514-101500-ab12', startedAt: 1_699_900_000_000, status: 'passed', branch: 'feat-x', traceCount: 3 },
]

describe('formatRunsTable', () => {
  it('renders one row per run with id, status, branch and trace count', () => {
    const out = formatRunsTable(runs)
    expect(out).toContain('main_4821')
    expect(out).toContain('failed')
    expect(out).toContain('main')
    expect(out).toContain('12')
    expect(out).toContain('20260514-101500-ab12')
    expect(out).toContain('passed')
    expect(out).toContain('feat-x')
  })

  it('handles a run with no status or branch', () => {
    const out = formatRunsTable([{ id: 'r', startedAt: 1, traceCount: 0 }])
    expect(out).toContain('r')
    expect(out).toContain('0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run test/commands/runs.test.ts`
Expected: FAIL — `../../src/commands/runs.js` does not exist.

- [ ] **Step 3: Implement `packages/cli/src/commands/runs.ts`**

```ts
import type { RunSummary } from '@introspection/read'

/** Renders a plain-text table of runs, newest first (caller passes them pre-sorted). */
export function formatRunsTable(runs: RunSummary[]): string {
  return runs
    .map(run => {
      const status = run.status ?? 'running'
      const branch = run.branch ?? '-'
      const started = new Date(run.startedAt).toISOString()
      const count = `${run.traceCount} trace${run.traceCount === 1 ? '' : 's'}`
      return `${run.id.padEnd(28)}  ${status.padEnd(8)}  ${branch.padEnd(16)}  ${started}  ${count}`
    })
    .join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run test/commands/runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/runs.ts packages/cli/test/commands/runs.test.ts
git commit -m "cli: add formatRunsTable for the runs command"
```

---

## Task 10: `introspect list` formatter — `formatTracesTable`

**Files:**
- Create: `packages/cli/src/commands/list.ts`, `packages/cli/test/commands/list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/commands/list.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatTracesTable } from '../../src/commands/list.js'
import type { TraceSummary } from '@introspection/read'

const traces: TraceSummary[] = [
  { id: 'default__tabs-favorites', startedAt: 100, endedAt: 1100, project: 'browser-mobile', status: 'failed' },
  { id: 'default__player-offline', startedAt: 200, project: 'browser-desktop' },
]

describe('formatTracesTable', () => {
  it('renders one row per trace with id, project, status and duration', () => {
    const out = formatTracesTable(traces)
    expect(out).toContain('default__tabs-favorites')
    expect(out).toContain('browser-mobile')
    expect(out).toContain('failed')
    expect(out).toContain('1000ms')
    expect(out).toContain('default__player-offline')
    expect(out).toContain('browser-desktop')
  })

  it('shows running/ongoing markers when status and endedAt are absent', () => {
    const out = formatTracesTable([{ id: 's', startedAt: 1 }])
    expect(out).toContain('s')
    expect(out).toContain('ongoing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm exec vitest run test/commands/list.test.ts`
Expected: FAIL — `../../src/commands/list.js` does not exist.

- [ ] **Step 3: Implement `packages/cli/src/commands/list.ts`**

```ts
import type { TraceSummary } from '@introspection/read'

/** Renders a plain-text table of traces within a run, newest first. */
export function formatTracesTable(traces: TraceSummary[]): string {
  return traces
    .map(trace => {
      const project = trace.project ?? '-'
      const status = trace.status ?? 'running'
      const duration = trace.duration != null ? `${trace.duration}ms` : 'ongoing'
      return `${trace.id.padEnd(40)}  ${project.padEnd(16)}  ${status.padEnd(10)}  ${duration}`
    })
    .join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm exec vitest run test/commands/list.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/list.ts packages/cli/test/commands/list.test.ts
git commit -m "cli: add formatTracesTable for the list command"
```

---

## Task 11: CLI wiring — `--run` selection, `runs` and `list` commands

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/integration.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `packages/cli/test/integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = join(packageRoot, 'dist', 'index.js')

function runCli(args: string[]): string {
  return execFileSync('node', [cliEntry, ...args], { encoding: 'utf-8' })
}

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'introspect-cli-int-'))

  // run-old (older), run-new (newer); run-new has two traces
  await mkdir(join(dir, 'run-old', 'sess-o'), { recursive: true })
  await writeFile(join(dir, 'run-old', 'meta.json'), JSON.stringify({ version: '1', id: 'run-old', startedAt: 100, endedAt: 200, status: 'passed', branch: 'main' }))
  await writeFile(join(dir, 'run-old', 'sess-o', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-o', startedAt: 110, endedAt: 190, status: 'passed', project: 'p' }))
  await writeFile(join(dir, 'run-old', 'sess-o', 'events.ndjson'), '')

  await mkdir(join(dir, 'run-new', 'sess-early'), { recursive: true })
  await mkdir(join(dir, 'run-new', 'sess-late'), { recursive: true })
  await writeFile(join(dir, 'run-new', 'meta.json'), JSON.stringify({ version: '1', id: 'run-new', startedAt: 500, status: 'failed', branch: 'feat' }))
  await writeFile(join(dir, 'run-new', 'sess-early', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-early', startedAt: 510, project: 'p' }))
  await writeFile(join(dir, 'run-new', 'sess-early', 'events.ndjson'), '')
  await writeFile(join(dir, 'run-new', 'sess-late', 'meta.json'), JSON.stringify({ version: '2', id: 'sess-late', startedAt: 590, label: 'the late one', project: 'p' }))
  await writeFile(join(dir, 'run-new', 'sess-late', 'events.ndjson'), '')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('introspect CLI — hierarchy navigation', () => {
  it('runs lists all runs, newest first', () => {
    const out = runCli(['runs', '--dir', dir])
    const firstLine = out.trim().split('\n')[0]
    expect(firstLine).toContain('run-new')
    expect(out).toContain('run-old')
  })

  it('list defaults to the latest run', () => {
    const out = runCli(['list', '--dir', dir])
    expect(out).toContain('sess-early')
    expect(out).toContain('sess-late')
    expect(out).not.toContain('sess-o')
  })

  it('list --run scopes to the named run', () => {
    const out = runCli(['list', '--dir', dir, '--run', 'run-old'])
    expect(out).toContain('sess-o')
    expect(out).not.toContain('sess-early')
  })

  it('summary with no flags resolves the latest trace of the latest run', () => {
    const out = runCli(['summary', '--dir', dir])
    expect(out).toContain('sess-late')
  })

  it('summary --run --trace-id targets a specific trace', () => {
    const out = runCli(['summary', '--dir', dir, '--run', 'run-old', '--trace-id', 'sess-o'])
    expect(out).toContain('sess-o')
  })
})
```

- [ ] **Step 2: Build and run the test to verify it fails**

Run: `cd packages/cli && pnpm build && pnpm exec vitest run test/integration.test.ts`
Expected: FAIL — `introspect runs` is not a command; `list` lists top-level dirs as traces; `summary` resolves wrongly.

- [ ] **Step 3: Implement the wiring in `packages/cli/src/index.ts`**

Change the `@introspection/read/node` import:

```ts
import { createTraceReader, listRuns, listTraces } from '@introspection/read/node'
```

Add the formatter imports near the other command imports:

```ts
import { formatRunsTable } from './commands/runs.js'
import { formatTracesTable } from './commands/list.js'
```

Replace `loadTrace` with a `runId`-aware version:

```ts
async function loadTrace(opts: { run?: string; traceId?: string; verbose?: boolean }) {
  const dir = program.opts().dir as string
  return createTraceReader(dir, { runId: opts.run, traceId: opts.traceId, verbose: opts.verbose })
}
```

Add `.option('--run <id>')` to each per-trace command — `summary`, `network`, `events`, `plugins`, and `payload`. For example, the `summary` command becomes:

```ts
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
```

Apply the same one-line `.option('--run <id>')` addition to `network`, `events`, `plugins`, and `payload` (each already has `--trace-id`; insert `--run` directly above it). Their `.action` handlers already call `loadTrace(opts)`, which now forwards `opts.run` — no further change to those handlers.

Replace the entire `program.command('list')` block with the run-scoped version:

```ts
program.command('runs')
  .description('List recorded runs')
  .action(async () => {
    const dir = program.opts().dir as string
    const runs = await listRuns(dir)
    if (runs.length === 0) { console.error(`No runs found in ${dir}`); process.exit(1) }
    console.log(formatRunsTable(runs))
  })

program.command('list')
  .description('List traces in a run')
  .option('--run <id>', 'Run id (default: latest run)')
  .action(async (opts: { run?: string }) => {
    const dir = program.opts().dir as string
    const runs = await listRuns(dir)
    if (runs.length === 0) { console.error(`No runs found in ${dir}`); process.exit(1) }
    const runId = opts.run ?? runs[0].id
    if (opts.run && !runs.some(r => r.id === opts.run)) {
      console.error(`Run '${opts.run}' not found in ${dir}`); process.exit(1)
    }
    const traces = await listTraces(dir, runId)
    if (traces.length === 0) { console.error(`No traces in run '${runId}'`); process.exit(1) }
    console.log(formatTracesTable(traces))
  })
```

- [ ] **Step 4: Build and run the integration test to verify it passes**

Run: `cd packages/cli && pnpm build && pnpm exec vitest run test/integration.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Run the full CLI suite and typecheck**

Run: `cd packages/cli && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS — all command tests (`runs`, `list`, `summary`, `network`, `events`, `plugins`, `payload`, `skills`, `debug`, `integration`); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/test/integration.test.ts
git commit -m "cli: add introspect runs, scope list to a run, --run selection"
```

---

## Self-Review

**Spec coverage:**
- `StorageAdapter.listDirectories(subPath?)` → Task 1. ✓
- node + memory adapters implement it → Tasks 1, 2. ✓
- `RunSummary` type; `listRuns` → Task 4. ✓
- `TraceSummary` gains `project`/`status`; `listTraces(runId)` → Task 4. ✓
- hierarchy-aware `createTraceReader`; `getLatestRunId` + `getLatestTraceId(runId)` → Task 5. ✓
- `/node` wrappers `listRuns(dir)` / `listTraces(dir, runId)` → Task 6. ✓
- `introspect debug` produces a run directory → Tasks 7, 8. ✓
- `introspect runs` command → Tasks 9, 11. ✓
- `introspect list` scoped to a run → Tasks 10, 11. ✓
- `--run` across per-trace commands (`summary`/`network`/`events`/`plugins`/`payload`) → Task 11. ✓
- Error handling — "No runs found" (Tasks 5, 11), malformed meta skipped (Tasks 4, 5), `--run` not found (Task 11), empty-run error (Tasks 5, 11). ✓
- Migrating the existing flat-layout tests → folded into Tasks 4 (`list-traces.test.ts`), 5 (`trace-reader.test.ts`), 8 (`debug.test.ts`). ✓

> Spec note reconciled: the spec's Section 6 listed `assets` among the per-trace commands; the CLI has no `assets` command — the real per-trace set is `summary`/`network`/`events`/`plugins`/`payload`, which is what Task 11 wires.

**Placeholder scan:** none — every code step contains complete code; the one "apply the same change to N other commands" instruction (Task 11 Step 3) names each command explicitly and shows the exact one-line `.option` addition.

**Type consistency:** `StorageAdapter.listDirectories(subPath?)` defined in Task 1, consumed in Tasks 4–6. `RunSummary` defined in Task 4, re-exported in Task 6, consumed in Tasks 9, 11. `TraceSummary` extended in Task 4, consumed in Tasks 6, 10, 11. `createTraceReader`'s `{ runId?, traceId?, verbose? }` options defined in Task 5, wrapped in Task 6, called in Task 8 and via `loadTrace` in Task 11. `runDebug` returns `{ runId, traceId }` from Task 8 — the `debug` command in `index.ts` ignores the return value (confirmed in Task 8 Step 4), so no mismatch. `getLatestRunId` / `getLatestTraceId(adapter, runId)` defined and used only within `packages/read/src/index.ts` (Task 5).
