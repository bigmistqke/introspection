# StorageAdapter Hierarchy + Hierarchy-Aware `read` — Design

Make `@introspection/read` and the `introspect` CLI navigate the two-level
`<run-id>/<session-id>/` trace layout that the `withIntrospect` work
established on disk. Today `read` assumes a flat `<session>/` layout and is
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
`<session>/` to two-level `<run-id>/<session-id>/`: a run directory holds a
`RunMeta` `meta.json` and one sub-directory per test, each with a `SessionMeta`
`meta.json` + `events.ndjson` + `assets/`.

`@introspection/read` predates that. `listSessions(adapter)` calls
`adapter.listDirectories()` (top level) and parses each `<id>/meta.json` as a
`SessionMeta` — so against a real trace it lists *run* directories and parses
`RunMeta` as `SessionMeta`. `createSessionReader` picks a top-level dir and
looks for `<id>/events.ndjson` — one level too high. The CLI, built on these,
is broken against any trace produced by `withIntrospect`.

## Scope

**In scope:**

- `StorageAdapter`: one interface change — `listDirectories(subPath?: string)`.
- `@introspection/read`: `listRuns()`, `listSessions(runId)`, hierarchy-aware
  `createSessionReader`; `RunSummary` type; `SessionSummary` gains
  `project` / `status`.
- The node and memory adapters implement `listDirectories(subPath?)`.
- `introspect debug` produces a run directory (a one-session run) so the
  single organizational model holds for every shipped producer.
- The full local CLI: a new `introspect runs` command, `introspect list`
  scoped to a run, and `--run` selection across the per-session commands.

**Out of scope:**

- The remote/HTTP `StorageAdapter` (`createHttpReadAdapter`) and `--url` /
  `--ci` — Spec D.
- Storage-agnostic `createHandler` — Spec C.
- The demo `fetch-adapter` — it still structurally satisfies the widened
  `StorageAdapter` type (a no-arg `listDirectories` is assignable to
  `listDirectories(subPath?)`); making it hierarchy-correct is Spec D's job.
- Any change to the `attach()` / `session()` primitives. They remain
  flat-session producers for ad-hoc/scripted use; only the *shipped*
  `introspect debug` command is updated to conform to the run model.

## Single organizational model

There is exactly one on-disk shape: `<dir>/<run-id>/<session-id>/`. A run
directory has a `RunMeta` `meta.json`; a session directory has a `SessionMeta`
`meta.json`, `events.ndjson`, and `assets/`. `project` is a `SessionMeta` field
and a filename prefix on `<session-id>` — **not** a directory level (decided in
the `withIntrospect` brainstorm). So `read` navigates exactly two levels;
"sessions for project X" is a filter on `listSessions(runId)`, not a directory
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
     listSessions(adapter, runId)   → SessionSummary[]   (each carries .project)
     createSessionReader(adapter, { runId?, sessionId? })
                  │
                  ▼
   introspect CLI   (runs / list / summary / events / network / assets / plugins)
```

Storage stays dumb (list directory names, read bytes); all interpretation —
parsing `RunMeta` / `SessionMeta`, "latest" resolution, sorting — lives in
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
  sessionCount: number
}

export interface SessionSummary {
  id: string
  label?: string
  project?: string                    // new — from SessionMeta.project
  status?: SessionStatus              // new — from SessionMeta.status
  startedAt: number
  endedAt?: number
  duration?: number
}
```

`RunSummary` is new; `SessionSummary` gains `project` and `status`. Both stay
in `@introspection/read` (not `@introspection/types`) — they are
read-layer projections, not storage shapes.

### Functions

- **`listRuns(adapter): Promise<RunSummary[]>`** — `adapter.listDirectories()`
  for run-dir names; for each, `readJSON('<runId>/meta.json')` as `RunMeta`
  and `listDirectories(runId)` for the session count. Skips a run whose
  `meta.json` is missing or malformed. Sorted by `startedAt` descending.

- **`listSessions(adapter, runId): Promise<SessionSummary[]>`** —
  `adapter.listDirectories(runId)` for session-dir names; for each,
  `readText('<runId>/<sessionId>/meta.json')` parsed as `SessionMeta`. Skips
  malformed session metas. Sorted by `startedAt` descending.

- **`createSessionReader(adapter, { runId?, sessionId?, verbose? })`** —
  resolves `runId` (latest run by `RunMeta.startedAt` when omitted), then
  `sessionId` (latest session in that run by `SessionMeta.startedAt` when
  omitted), then reads `<runId>/<sessionId>/meta.json` and
  `<runId>/<sessionId>/events.ndjson`. The reader's `resolvePayload` resolves
  asset paths against `<runId>/<sessionId>/`.

  The current `getLatestSessionId(adapter)` helper splits into
  `getLatestRunId(adapter)` and `getLatestSessionId(adapter, runId)`.

> **Signature change.** `listSessions` gains a required `runId` argument and
> `createSessionReader`'s options gain `runId`. This is a breaking change to
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
- **`/node` convenience wrappers**: `createSessionReader(dir, opts)` stays;
  add `listRuns(dir)` and `listSessions(dir, runId)`; the old `listSessions(dir)`
  signature is replaced.

## `introspect debug` → produces a run

`runDebug` (`packages/cli/src/commands/debug.ts`) currently does
`attach(page, { outDir: opts.dir })`, yielding a flat `<dir>/<session>/`. It
changes to:

1. Resolve a run-id — a timestamped id (the same scheme as the playwright
   side's `resolveRunId`: `<YYYYMMDD-HHmmss>-<random>`).
2. `mkdir <dir>/<run-id>/` and write a minimal `RunMeta`
   (`{ version: '1', id, startedAt }`).
3. `attach(page, { outDir: <dir>/<run-id> })` — the session lands at
   `<dir>/<run-id>/<session-id>/`.
4. On completion, update the `RunMeta` with `endedAt` and a `status` derived
   from the session outcome.
5. Print both ids: `Session saved to: <run-id>/<session-id>`, and the query
   hint `introspect events --run <run-id> --session-id <session-id>`.

Git detection is skipped for `debug` runs — they are ad-hoc, not CI builds.

## CLI

`--dir` is unchanged (the `.introspect` root). One new flag, `--run <id>`,
across the session-scoped commands; the existing `--session-id <id>` is kept
as-is (no rename).

| Command | Behaviour |
|---|---|
| `introspect runs` | **New.** `listRuns(dir)` → a table: run id, status, branch, started, session count. |
| `introspect list` | `listSessions(dir, runId)` where `runId` is `--run` or the latest run. Table: session id, project, status, duration. |
| `summary` / `events` / `network` / `assets` / `plugins` | Gain `--run <id>`. `loadSession` becomes `createSessionReader(dir, { runId, sessionId })`; both resolve to "latest" when their flag is omitted. |
| `debug` | Produces a run (above). |

Zero-config use is preserved: `introspect summary` with no flags means "latest
session of the latest run."

## Error handling

- Empty `.introspect` / no run directories → `listRuns` returns `[]`; `runs`
  and the session commands print a "No runs found" message and exit non-zero
  (mirrors today's "No sessions found").
- A `meta.json` that is missing or malformed (run- or session-level) → that
  entry is skipped in listings; preserves today's resilience.
- `--run <id>` naming a directory that does not exist → `Run '<id>' not found`.
- `--session-id <id>` not present in the resolved run → `Session '<id>' not
  found in run '<runId>'`.
- A run directory with zero session sub-directories → `listRuns` reports it
  with `sessionCount: 0`; `createSessionReader` against it throws `No sessions
  in run '<id>'`.

## Testing

- **Adapters** — `listDirectories(subPath?)` for node and memory: top-level
  listing, nested listing, omitted `subPath`, nonexistent `subPath`.
- **`read`** — against a fixture `.introspect` tree with two runs of a few
  sessions each: `listRuns` (shape, `sessionCount`, sort order, skipping a
  malformed run meta), `listSessions(runId)` (shape incl. `project`/`status`,
  sort order, skipping a malformed session meta), `createSessionReader`
  resolution (explicit `runId`+`sessionId`; latest-run; latest-session-in-run;
  the not-found and empty-run error cases).
- **`introspect debug`** — the existing debug test, updated: asserts the
  output is `<run-id>/<session-id>/` with a `RunMeta` at the run level and a
  `SessionMeta` at the session level.
- **CLI** — `introspect runs` output; `introspect list` with and without
  `--run`; per-command `--run` / `--session-id` resolution including the
  not-found errors; zero-config "latest of latest" resolution.
