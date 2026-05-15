# StorageAdapter Hierarchy + Hierarchy-Aware `read` — Design

> **Status:** landed (2026-05-14) · plan: `docs/superpowers/plans/2026-05-14-storageadapter-hierarchy.md`

Make `@introspection/read` and the `introspect` CLI navigate the two-level
`<run-id>/<trace-id>/` trace layout that the `withIntrospect` work
established on disk. Today `read` assumes a flat `<trace>/` layout and is
semantically broken against real traces.

> **Position.** This is **Spec B** of the remote-trace-CLI chain
> (`2026-05-14-remote-trace-cli-design.md`, Sequencing): A → **B** → C → D.
> Spec A (the hierarchy contract + writer-side metadata) landed via the
> `withIntrospect` implementation. This spec makes the *read* side
> hierarchy-aware, end to end, **locally**. Spec C (storage-agnostic
> `createHandler`) and Spec D (the remote/HTTP adapter) follow; absorbing the
> full local CLI here leaves Spec D as purely the remote addition.

## Why

The `withIntrospect` work changed the canonical on-disk layout from flat
`<trace>/` to two-level `<run-id>/<trace-id>/`: a run directory holds a
`RunMeta` `meta.json` and one sub-directory per test, each with a `TraceMeta`
`meta.json` + `events.ndjson` + `assets/`.

`@introspection/read` predates that. `listTraces(adapter)` calls
`adapter.listDirectories()` (top level) and parses each `<id>/meta.json` as a
`TraceMeta` — so against a real trace it lists *run* directories and parses
`RunMeta` as `TraceMeta`. `createTraceReader` picks a top-level dir and
looks for `<id>/events.ndjson` — one level too high. The CLI, built on these,
is broken against any trace produced by `withIntrospect`.

## Scope

**In scope:**

- `StorageAdapter`: one interface change — `listDirectories(subPath?: string)`.
- `@introspection/read`: `listRuns()`, `listTraces(runId)`, hierarchy-aware
  `createTraceReader`; `RunSummary` type; `TraceSummary` gains
  `project` / `status`.
- The node and memory adapters implement `listDirectories(subPath?)`.
- `introspect debug` produces a run directory (a one-trace run) so the
  single organizational model holds for every shipped producer.
- The full local CLI: a new `introspect runs` command, `introspect list`
  scoped to a run, and `--run` selection across the per-trace commands.

**Out of scope:**

- The remote/HTTP `StorageAdapter` (`createHttpReadAdapter`) and `--url` /
  `--ci` — Spec D.
- Storage-agnostic `createHandler` — Spec C.
- The demo `fetch-adapter` — it still structurally satisfies the widened
  `StorageAdapter` type (a no-arg `listDirectories` is assignable to
  `listDirectories(subPath?)`); making it hierarchy-correct is Spec D's job.
- Any change to the `attach()` / `trace()` primitives. They remain
  flat-trace producers for ad-hoc/scripted use; only the *shipped*
  `introspect debug` command is updated to conform to the run model.

## Single organizational model

There is exactly one on-disk shape: `<dir>/<run-id>/<trace-id>/`. A run
directory has a `RunMeta` `meta.json`; a trace directory has a `TraceMeta`
`meta.json`, `events.ndjson`, and `assets/`. `project` is a `TraceMeta` field
and a filename prefix on `<trace-id>` — **not** a directory level (decided in
the `withIntrospect` brainstorm). So `read` navigates exactly two levels;
"traces for project X" is a filter on `listTraces(runId)`, not a directory
walk.

## Architecture

```
@introspection/types:  StorageAdapter
  listDirectories(subPath?)        ← the ONE interface change
  readText / readBinary / readJSON   (unchanged)
        │
   ┌────┴──────────────────┐
 createNodeAdapter    createMemoryReadAdapter
        │                  │
        └─────────┬────────┘
                  ▼
   @introspection/read   (hierarchy navigation, built on the adapter)
     listRuns(adapter)              → RunSummary[]
     listTraces(adapter, runId)   → TraceSummary[]   (each carries .project)
     createTraceReader(adapter, { runId?, traceId? })
                  │
                  ▼
   introspect CLI   (runs / list / summary / events / network / assets / plugins)
```

Storage stays dumb (list directory names, read bytes); all interpretation —
parsing `RunMeta` / `TraceMeta`, "latest" resolution, sorting — lives in
`read`.

## `StorageAdapter` change

In `@introspection/types`:

```ts
export interface StorageAdapter {
  listDirectories(subPath?: string): Promise<string[]>   // was: listDirectories()
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  readJSON<T = unknown>(path: string): Promise<T>
}
```

`listDirectories(subPath?)` returns the directory names directly under
`subPath` (relative to the adapter root); with no argument, the top level —
identical to today's behaviour. The change is backward-compatible at every
call site; only the implementers must be updated.

## `@introspection/read`

### Types

```ts
export interface RunSummary {
  id: string
  startedAt: number
  endedAt?: number
  status?: 'passed' | 'failed'        // RunMeta.status (absent if teardown didn't run)
  branch?: string
  commit?: string
  traceCount: number
}

export interface TraceSummary {
  id: string
  label?: string
  project?: string                    // new — from TraceMeta.project
  status?: TraceStatus              // new — from TraceMeta.status
  startedAt: number
  endedAt?: number
  duration?: number
}
```

`RunSummary` is new; `TraceSummary` gains `project` and `status`. Both stay
in `@introspection/read` (not `@introspection/types`) — they are
read-layer projections, not storage shapes.

### Functions

- **`listRuns(adapter): Promise<RunSummary[]>`** — `adapter.listDirectories()`
  for run-dir names; for each, `readJSON('<runId>/meta.json')` as `RunMeta`
  and `listDirectories(runId)` for the trace count. Skips a run whose
  `meta.json` is missing or malformed. Sorted by `startedAt` descending.

- **`listTraces(adapter, runId): Promise<TraceSummary[]>`** —
  `adapter.listDirectories(runId)` for trace-dir names; for each,
  `readText('<runId>/<traceId>/meta.json')` parsed as `TraceMeta`. Skips
  malformed trace metas. Sorted by `startedAt` descending.

- **`createTraceReader(adapter, { runId?, traceId?, verbose? })`** —
  resolves `runId` (latest run by `RunMeta.startedAt` when omitted), then
  `traceId` (latest trace in that run by `TraceMeta.startedAt` when
  omitted), then reads `<runId>/<traceId>/meta.json` and
  `<runId>/<traceId>/events.ndjson`. The reader's `resolvePayload` resolves
  asset paths against `<runId>/<traceId>/`.

  The current `getLatestTraceId(adapter)` helper splits into
  `getLatestRunId(adapter)` and `getLatestTraceId(adapter, runId)`.

> **Signature change.** `listTraces` gains a required `runId` argument and
> `createTraceReader`'s options gain `runId`. This is a breaking change to
> `@introspection/read`'s API; the in-repo consumers (the CLI, `/node`
> wrappers) are updated in this spec. There are no other consumers.

## Adapters

- **node** (`createNodeAdapter`): `listDirectories(subPath?)` →
  `readdir(join(dir, subPath ?? ''), { withFileTypes: true })`, filter to
  directories. A nonexistent `subPath` returns `[]` (matching today's
  catch-all-on-error behaviour).
- **memory** (`createMemoryReadAdapter`): `listDirectories(subPath?)` → of the
  store keys, take those under `subPath + '/'` (or all, when omitted) and
  collect the next path segment, de-duplicated.
- **`/node` convenience wrappers**: `createTraceReader(dir, opts)` stays;
  add `listRuns(dir)` and `listTraces(dir, runId)`; the old `listTraces(dir)`
  signature is replaced.

## `introspect debug` → produces a run

`runDebug` (`packages/cli/src/commands/debug.ts`) currently does
`attach(page, { outDir: opts.dir })`, yielding a flat `<dir>/<trace>/`. It
changes to:

1. Resolve a run-id — a timestamped id (the same scheme as the playwright
   side's `resolveRunId`: `<YYYYMMDD-HHmmss>-<random>`).
2. `mkdir <dir>/<run-id>/` and write a minimal `RunMeta`
   (`{ version: '1', id, startedAt }`).
3. `attach(page, { outDir: <dir>/<run-id> })` — the trace lands at
   `<dir>/<run-id>/<trace-id>/`.
4. On completion, update the `RunMeta` with `endedAt` and a `status` derived
   from the trace outcome.
5. Print both ids: `Trace saved to: <run-id>/<trace-id>`, and the query
   hint `introspect events --run <run-id> --trace-id <trace-id>`.

Git detection is skipped for `debug` runs — they are ad-hoc, not CI builds.

## CLI

`--dir` is unchanged (the `.introspect` root). One new flag, `--run <id>`,
across the trace-scoped commands; the existing `--trace-id <id>` is kept
as-is (no rename).

| Command | Behaviour |
|---|---|
| `introspect runs` | **New.** `listRuns(dir)` → a table: run id, status, branch, started, trace count. |
| `introspect list` | `listTraces(dir, runId)` where `runId` is `--run` or the latest run. Table: trace id, project, status, duration. |
| `summary` / `events` / `network` / `assets` / `plugins` | Gain `--run <id>`. `loadTrace` becomes `createTraceReader(dir, { runId, traceId })`; both resolve to "latest" when their flag is omitted. |
| `debug` | Produces a run (above). |

Zero-config use is preserved: `introspect summary` with no flags means "latest
trace of the latest run."

## Error handling

- Empty `.introspect` / no run directories → `listRuns` returns `[]`; `runs`
  and the trace commands print a "No runs found" message and exit non-zero
  (mirrors today's "No traces found").
- A `meta.json` that is missing or malformed (run- or trace-level) → that
  entry is skipped in listings; preserves today's resilience.
- `--run <id>` naming a directory that does not exist → `Run '<id>' not found`.
- `--trace-id <id>` not present in the resolved run → `Trace '<id>' not
  found in run '<runId>'`.
- A run directory with zero trace sub-directories → `listRuns` reports it
  with `traceCount: 0`; `createTraceReader` against it throws `No traces
  in run '<id>'`.

## Testing

- **Adapters** — `listDirectories(subPath?)` for node and memory: top-level
  listing, nested listing, omitted `subPath`, nonexistent `subPath`.
- **`read`** — against a fixture `.introspect` tree with two runs of a few
  traces each: `listRuns` (shape, `traceCount`, sort order, skipping a
  malformed run meta), `listTraces(runId)` (shape incl. `project`/`status`,
  sort order, skipping a malformed trace meta), `createTraceReader`
  resolution (explicit `runId`+`traceId`; latest-run; latest-trace-in-run;
  the not-found and empty-run error cases).
- **`introspect debug`** — the existing debug test, updated: asserts the
  output is `<run-id>/<trace-id>/` with a `RunMeta` at the run level and a
  `TraceMeta` at the trace level.
- **CLI** — `introspect runs` output; `introspect list` with and without
  `--run`; per-command `--run` / `--trace-id` resolution including the
  not-found errors; zero-config "latest of latest" resolution.
